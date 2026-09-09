/**
 * Cross-cutting study instrumentation: attention (window/tab/pane focus),
 * typing effort, clipboard content, and document snapshots.
 *
 * Feature-specific events (send, submit, upload, split resize) stay with the
 * feature code; everything here is behaviour that spans the whole app.
 */
(function () {
    const HEARTBEAT_MS = 30000;
    const TYPING_BUCKET_MS = 10000;
    const SNAPSHOT_MIN_INTERVAL_MS = 30000;
    const RESIZE_DEBOUNCE_MS = 500;

    const editorEl = document.getElementById("noteEditor");
    const chatInputEl = document.getElementById("chatInput");
    const chatLogEl = document.getElementById("chatLog");

    const SURFACE_EDITOR = "editor";
    const SURFACE_CHAT = "chat";

    function now() {
        return Date.now();
    }

    function currentChatThread() {
        try {
            return typeof currentChatThreadId !== "undefined"
                ? currentChatThreadId
                : null;
        } catch {
            return null;
        }
    }

    // ---------------------------------------------------------------- attention

    let windowFocused = document.hasFocus();
    let windowStateSince = now();
    let tabVisible = document.visibilityState === "visible";
    let tabStateSince = now();

    window.addEventListener("focus", () => {
        if (windowFocused) {
            return;
        }
        const awayMs = now() - windowStateSince;
        windowFocused = true;
        windowStateSince = now();
        logEvent({
            eventType: "window_focus",
            elementName: "window",
            page: "window",
            durationMs: awayMs,
        });
        resumeSurfaceDwell();
    });

    window.addEventListener("blur", () => {
        if (!windowFocused) {
            return;
        }
        const presentMs = now() - windowStateSince;
        windowFocused = false;
        windowStateSince = now();
        // Close the open pane dwell first: focus stays on the DOM element while
        // the participant is in another app, which would otherwise inflate it.
        pauseSurfaceDwell();
        logEvent({
            eventType: "window_blur",
            elementName: "window",
            page: "window",
            durationMs: presentMs,
        });
    });

    document.addEventListener("visibilitychange", () => {
        const visible = document.visibilityState === "visible";
        if (visible === tabVisible) {
            return;
        }
        const elapsed = now() - tabStateSince;
        tabVisible = visible;
        tabStateSince = now();

        logEvent({
            eventType: visible ? "tab_visible" : "tab_hidden",
            elementName: "tab",
            page: "window",
            durationMs: elapsed,
        });

        if (!visible) {
            // Last reliable moment to persist work in progress: pagehide is too
            // late for a request body of this size.
            captureEditorSnapshot("blur");
            flushEvents();
        }
    });

    window.addEventListener("pagehide", () => {
        finishAllIntervals();
        endTelemetrySession("pagehide");
    });

    // Back-forward cache: the browser froze the page after pagehide and is now
    // resuming it in place, with all of this script's state intact. Without
    // this the sitting stays closed and nothing else from it is recorded.
    window.addEventListener("pageshow", (event) => {
        if (!event.persisted) {
            return;
        }
        const resumedAt = now();
        lastHeartbeatAt = resumedAt;
        windowStateSince = resumedAt;
        tabStateSince = resumedAt;
        windowFocused = document.hasFocus();
        tabVisible = document.visibilityState === "visible";
        startSnapshotTimer();

        reopenTelemetrySession().then(() => {
            logEvent({
                eventType: "session_start",
                elementName: "app",
                page: "app",
                eventProps: {
                    systemID: config.systemID,
                    aiEnabled: config.isAiEnabled,
                    isNewSession: false,
                    resumed: "bfcache",
                    width: window.innerWidth,
                    height: window.innerHeight,
                },
            });
        });
    });

    // ------------------------------------------------------------- pane dwell

    let activeSurface = null;
    let surfaceSince = 0;

    function openSurface(surface) {
        if (activeSurface === surface) {
            return;
        }
        closeSurface();
        activeSurface = surface;
        surfaceSince = now();
        logEvent({
            eventType: "surface_focus",
            elementName: surface,
            page: surface,
        });
    }

    function closeSurface() {
        if (!activeSurface) {
            return;
        }
        logEvent({
            eventType: "surface_blur",
            elementName: activeSurface,
            page: activeSurface,
            durationMs: now() - surfaceSince,
        });
        activeSurface = null;
    }

    // Window blur/focus pause and resume the dwell clock without emitting a
    // pane change, so "time in the editor" means time actually at the machine.
    let pausedSurface = null;

    function pauseSurfaceDwell() {
        if (!activeSurface) {
            return;
        }
        pausedSurface = activeSurface;
        closeSurface();
    }

    function resumeSurfaceDwell() {
        if (!pausedSurface) {
            return;
        }
        const surface = pausedSurface;
        pausedSurface = null;
        const stillFocused =
            (surface === SURFACE_EDITOR && document.activeElement === editorEl) ||
            (surface === SURFACE_CHAT && document.activeElement === chatInputEl);
        if (stillFocused) {
            openSurface(surface);
        }
    }

    if (editorEl) {
        editorEl.addEventListener("focusin", () => openSurface(SURFACE_EDITOR));
        editorEl.addEventListener("focusout", () => {
            if (activeSurface === SURFACE_EDITOR) {
                closeSurface();
            }
            captureEditorSnapshot("blur");
        });
    }

    if (chatInputEl) {
        chatInputEl.addEventListener("focusin", () => openSurface(SURFACE_CHAT));
        chatInputEl.addEventListener("focusout", () => {
            if (activeSurface === SURFACE_CHAT) {
                closeSurface();
            }
        });
    }

    // --------------------------------------------------------------- keystrokes

    const NAVIGATION_KEYS = new Set([
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "Tab",
    ]);

    const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

    function createBucket(surface, lengthAtStart) {
        return {
            surface,
            startedAt: now(),
            lengthAtStart,
            keystrokes: 0,
            chars: 0,
            backspaces: 0,
            deletes: 0,
            enters: 0,
            navigation: 0,
            shortcuts: 0,
        };
    }

    const buckets = new Map();
    let editorKeystrokesSinceSnapshot = 0;
    let hadInputSinceHeartbeat = false;

    function surfaceLength(surface) {
        if (surface === SURFACE_EDITOR) {
            return editorEl ? editorEl.textContent.length : 0;
        }
        return chatInputEl ? chatInputEl.value.length : 0;
    }

    function flushBucket(surface) {
        const bucket = buckets.get(surface);
        if (!bucket || bucket.keystrokes === 0) {
            buckets.delete(surface);
            return;
        }

        buckets.delete(surface);

        logEvent({
            eventType: "typing_burst",
            elementName: surface === SURFACE_EDITOR ? "note-editor" : "chat-input",
            page: surface,
            valueNum: bucket.keystrokes,
            durationMs: now() - bucket.startedAt,
            eventProps: {
                chars: bucket.chars,
                backspaces: bucket.backspaces,
                deletes: bucket.deletes,
                enters: bucket.enters,
                navigation: bucket.navigation,
                shortcuts: bucket.shortcuts,
                charDelta: surfaceLength(surface) - bucket.lengthAtStart,
            },
        });
    }

    function recordKeystroke(surface, event) {
        if (MODIFIER_KEYS.has(event.key)) {
            return;
        }

        hadInputSinceHeartbeat = true;

        let bucket = buckets.get(surface);
        if (!bucket) {
            bucket = createBucket(surface, surfaceLength(surface));
            buckets.set(surface, bucket);
            setTimeout(() => flushBucket(surface), TYPING_BUCKET_MS);
        }

        bucket.keystrokes += 1;

        // Ctrl+Z, Ctrl+B, Ctrl+V and friends are commands, not characters;
        // counting them as typed text would inflate the writing measures.
        if (event.ctrlKey || event.metaKey || event.altKey) {
            bucket.shortcuts += 1;
        } else if (event.key === "Backspace") {
            bucket.backspaces += 1;
        } else if (event.key === "Delete") {
            bucket.deletes += 1;
        } else if (event.key === "Enter") {
            bucket.enters += 1;
        } else if (NAVIGATION_KEYS.has(event.key)) {
            bucket.navigation += 1;
        } else if (event.key.length === 1) {
            bucket.chars += 1;
        }

        if (surface === SURFACE_EDITOR) {
            editorKeystrokesSinceSnapshot += 1;
            editorDirty = true;
        }
    }

    if (editorEl) {
        editorEl.addEventListener("keydown", (event) =>
            recordKeystroke(SURFACE_EDITOR, event)
        );
    }

    if (chatInputEl) {
        chatInputEl.addEventListener("keydown", (event) =>
            recordKeystroke(SURFACE_CHAT, event)
        );
    }

    // ---------------------------------------------------------------- clipboard

    function selectionText() {
        return String(window.getSelection?.() ?? "");
    }

    function sendClipboard(action, surface, content) {
        if (!content) {
            return;
        }
        hadInputSinceHeartbeat = true;
        postClipboardEvent({
            action,
            surface,
            content,
            chatThreadId: surface === "editor" ? null : currentChatThread(),
        });
    }

    function bindClipboard(element, resolveSurface, { includePaste = true } = {}) {
        if (!element) {
            return;
        }

        // On copy/cut the event's clipboardData is write-only, so the text has
        // to come from the selection instead of getData().
        element.addEventListener("copy", () =>
            sendClipboard("copy", resolveSurface(), selectionText())
        );
        element.addEventListener("cut", () =>
            sendClipboard("cut", resolveSurface(), selectionText())
        );

        if (includePaste) {
            element.addEventListener("paste", (event) => {
                const text = event.clipboardData?.getData("text/plain") ?? "";
                sendClipboard("paste", resolveSurface(), text);
            });
        }
    }

    /**
     * Copying the AI's answer and copying your own prompt back out mean very
     * different things, so the role travels with the event and ends up in the
     * paste's `origin`.
     */
    function chatMessageSurface() {
        const node = window.getSelection?.()?.anchorNode;
        const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        const message = element?.closest?.(".message");

        if (message?.classList.contains("message--assistant")) {
            return "chat_message_assistant";
        }
        if (message?.classList.contains("message--user")) {
            return "chat_message_user";
        }
        return "chat_message";
    }

    bindClipboard(editorEl, () => "editor");
    bindClipboard(chatInputEl, () => "chat_input");
    bindClipboard(chatLogEl, chatMessageSurface, { includePaste: false });

    // ---------------------------------------------------------------- snapshots

    let editorDirty = false;
    let lastSnapshotAt = 0;
    let snapshotTimer = null;

    function captureEditorSnapshot(reason, { force = false } = {}) {
        if (!editorEl) {
            return;
        }
        if (!force && !editorDirty) {
            return;
        }
        if (!force && now() - lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) {
            return;
        }

        editorDirty = false;
        lastSnapshotAt = now();
        const keystrokes = editorKeystrokesSinceSnapshot;
        editorKeystrokesSinceSnapshot = 0;

        // Plain text and word counts are derived from the HTML on the server.
        postEditorSnapshot({
            contentHtml: editorEl.innerHTML,
            reason,
            keystrokesSincePrev: keystrokes,
        });
    }

    function startSnapshotTimer() {
        if (!editorEl || snapshotTimer !== null) {
            return;
        }
        snapshotTimer = setInterval(
            () => captureEditorSnapshot("interval"),
            SNAPSHOT_MIN_INTERVAL_MS
        );
    }

    startSnapshotTimer();

    // ---------------------------------------------------------------- heartbeat

    let lastHeartbeatAt = now();

    setInterval(() => {
        const elapsed = now() - lastHeartbeatAt;
        lastHeartbeatAt = now();

        logEvent({
            eventType: "heartbeat",
            elementName: "app",
            page: "app",
            durationMs: elapsed,
            eventProps: {
                visible: tabVisible,
                windowFocused,
                hadInput: hadInputSinceHeartbeat,
                surface: activeSurface,
            },
        });

        hadInputSinceHeartbeat = false;
    }, HEARTBEAT_MS);

    // Scrolling and selecting are engagement too: without them, reading a long
    // AI response would be indistinguishable from having walked away.
    for (const element of [editorEl, chatLogEl]) {
        element?.addEventListener(
            "scroll",
            () => {
                hadInputSinceHeartbeat = true;
            },
            { passive: true }
        );
    }

    document.addEventListener("selectionchange", () => {
        if (!window.getSelection()?.isCollapsed) {
            hadInputSinceHeartbeat = true;
        }
    });

    // ------------------------------------------------------------------ resize

    let resizeTimer = null;

    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            logEvent({
                eventType: "viewport_resize",
                elementName: "window",
                page: "window",
                eventProps: {
                    width: window.innerWidth,
                    height: window.innerHeight,
                },
            });
        }, RESIZE_DEBOUNCE_MS);
    });

    // ------------------------------------------------------------------ startup

    function finishAllIntervals() {
        for (const surface of Array.from(buckets.keys())) {
            flushBucket(surface);
        }
        closeSurface();

        if (snapshotTimer !== null) {
            clearInterval(snapshotTimer);
            snapshotTimer = null;
        }
    }

    startTelemetrySession().then(() => {
        logEvent({
            eventType: "session_start",
            elementName: "app",
            page: "app",
            eventProps: {
                systemID: config.systemID,
                aiEnabled: config.isAiEnabled,
                // False means this is a reload inside an existing sitting
                // rather than the participant arriving fresh.
                isNewSession: config.isNewSession,
                width: window.innerWidth,
                height: window.innerHeight,
            },
        });

        if (document.hasFocus()) {
            windowFocused = true;
            windowStateSince = now();
        }
    });

    // Exposed for feature code (submit, export) to force a revision.
    window.captureEditorSnapshot = captureEditorSnapshot;
    window.markEditorDirty = function markEditorDirty() {
        editorDirty = true;
    };
})();
