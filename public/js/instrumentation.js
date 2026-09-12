/**
 * Cross-cutting study instrumentation: attention (window/tab/pane focus),
 * typing effort, scrolling, text selection, clipboard content, and document
 * snapshots.
 *
 * Feature-specific events (send, submit, upload, layout changes) stay with the
 * feature code; everything here is behaviour that spans the whole app.
 */
(function () {
    const HEARTBEAT_MS = 30000;
    const TYPING_BUCKET_MS = 10000;
    const SCROLL_BUCKET_MS = 10000;
    const SNAPSHOT_MIN_INTERVAL_MS = 30000;
    const RESIZE_DEBOUNCE_MS = 500;
    const SELECTION_SETTLE_MS = 600;
    // A scroll event this soon after a wheel turn, key press, or pointer press
    // is the student's own. Anything later is the page scrolling itself, for
    // example when a new reply is brought into view.
    const USER_SCROLL_WINDOW_MS = 500;

    const editorEl = document.getElementById("noteEditor");
    const chatInputEl = document.getElementById("chatInput");
    const chatLogEl = document.getElementById("chatLog");
    const editorScrollEl = document.getElementById("pleadingPaper");
    const chatPaneEl = document.querySelector(".panel-chat");
    const editorPaneEl = document.querySelector(".panel-notes");

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

    /** split / chat_max / editor_max, or editor_only when there is no chat. */
    function currentLayoutMode() {
        if (!config.isAiEnabled) {
            return "editor_only";
        }
        return window.appLayout?.getMode?.() ?? "split";
    }

    function currentChatRatio() {
        if (!config.isAiEnabled) {
            return 0;
        }
        const ratio = window.appLayout?.getChatRatio?.();
        return Number.isFinite(ratio) ? Number(ratio.toFixed(3)) : null;
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
        // Close the open pane dwell first: time in another application must
        // not be counted as time in the pane they left behind.
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

        if (!visible) {
            pauseSurfaceDwell();
        }

        logEvent({
            eventType: visible ? "tab_visible" : "tab_hidden",
            elementName: "tab",
            page: "window",
            durationMs: elapsed,
        });

        if (visible) {
            resumeSurfaceDwell();
        } else {
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
                    layout: currentLayoutMode(),
                },
            });
        });
    });

    // ------------------------------------------------------------- pane dwell
    //
    // "In the chat" means the chat pane is the one the student last did
    // anything in: clicked, scrolled, typed, or selected text. Reading a reply
    // after sending a prompt therefore counts as chat time, and the clock only
    // moves to the editor when the student acts there. Keyboard focus alone
    // used to decide this, which left all reading time unattributed.

    let activeSurface = null;
    let surfaceSince = 0;
    // Where the mouse pointer is resting. Weaker than an interaction, so it is
    // reported on heartbeats rather than used to move the dwell clock.
    let pointerSurface = null;

    function openSurface(surface, trigger) {
        if (!surface || activeSurface === surface) {
            return;
        }
        closeSurface();
        activeSurface = surface;
        surfaceSince = now();
        logEvent({
            eventType: "surface_focus",
            elementName: surface,
            page: surface,
            eventProps: { trigger },
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

    // Leaving the window or the tab pauses the dwell clock without emitting a
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
        if (!pausedSurface || !windowFocused || !tabVisible) {
            return;
        }
        const surface = pausedSurface;
        pausedSurface = null;
        openSurface(surface, "resume");
    }

    function surfaceForNode(node) {
        const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (!element) {
            return null;
        }
        if (chatPaneEl?.contains(element)) {
            return SURFACE_CHAT;
        }
        if (editorPaneEl?.contains(element)) {
            return SURFACE_EDITOR;
        }
        return null;
    }

    function bindPaneInteractions(paneEl, surface) {
        if (!paneEl) {
            return;
        }
        // Capture phase so a control that stops propagation still counts.
        paneEl.addEventListener("pointerdown", () => openSurface(surface, "pointer"), true);
        paneEl.addEventListener("wheel", () => openSurface(surface, "scroll"), {
            passive: true,
            capture: true,
        });
        paneEl.addEventListener("focusin", () => openSurface(surface, "focus"));
        paneEl.addEventListener("pointerenter", () => {
            pointerSurface = surface;
        });
        paneEl.addEventListener("pointerleave", () => {
            if (pointerSurface === surface) {
                pointerSurface = null;
            }
        });
    }

    bindPaneInteractions(editorPaneEl, SURFACE_EDITOR);
    bindPaneInteractions(chatPaneEl, SURFACE_CHAT);

    if (editorEl) {
        editorEl.addEventListener("focusout", () => captureEditorSnapshot("blur"));
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
        openSurface(surface, "keyboard");

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

    // ---------------------------------------------------------------- scrolling
    //
    // Scrolling is the main thing a student does while reading a reply, so it
    // is recorded in 10-second windows like typing: distance up (re-reading),
    // distance down, and for the chat which message was in view at the end.
    // The page also scrolls itself when a reply arrives; those moves are
    // counted separately and never treated as attention.

    const SCROLL_KEYS = new Set([
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        " ",
    ]);

    const scrollBuckets = new Map();
    let lastScrollIntentAt = 0;
    let pointerHeld = false;

    function markScrollIntent() {
        lastScrollIntentAt = now();
    }

    window.addEventListener(
        "pointerdown",
        () => {
            pointerHeld = true;
            markScrollIntent();
        },
        true
    );
    window.addEventListener("pointerup", () => {
        pointerHeld = false;
    }, true);
    window.addEventListener("pointercancel", () => {
        pointerHeld = false;
    }, true);
    window.addEventListener("wheel", markScrollIntent, { passive: true, capture: true });
    window.addEventListener("touchmove", markScrollIntent, { passive: true, capture: true });
    window.addEventListener(
        "keydown",
        (event) => {
            if (SCROLL_KEYS.has(event.key)) {
                markScrollIntent();
            }
        },
        true
    );

    function isUserScroll() {
        return pointerHeld || now() - lastScrollIntentAt < USER_SCROLL_WINDOW_MS;
    }

    /**
     * The chat message closest to the middle of the visible chat area. Nearest
     * rather than "contains the midpoint", because the midpoint can fall in
     * the gap between two messages.
     */
    function visibleChatMessage() {
        if (!chatLogEl) {
            return null;
        }
        const logRect = chatLogEl.getBoundingClientRect();
        const midY = logRect.top + logRect.height / 2;
        const messages = chatLogEl.querySelectorAll(".message");

        let best = null;
        let bestDistance = Infinity;
        for (let index = 0; index < messages.length; index += 1) {
            const rect = messages[index].getBoundingClientRect();
            const distance =
                midY < rect.top ? rect.top - midY : midY > rect.bottom ? midY - rect.bottom : 0;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = {
                    index,
                    role: messages[index].classList.contains("message--assistant")
                        ? "assistant"
                        : "user",
                };
            }
            if (distance === 0) {
                break;
            }
        }
        return best;
    }

    function flushScrollBucket(surface) {
        const bucket = scrollBuckets.get(surface);
        scrollBuckets.delete(surface);
        if (!bucket || bucket.events === 0) {
            return;
        }

        const element = bucket.element;
        const props = {
            up: Math.round(bucket.up),
            down: Math.round(bucket.down),
            events: bucket.events,
            programmatic: bucket.programmatic,
            startTop: Math.round(bucket.startTop),
            endTop: Math.round(element.scrollTop),
            scrollHeight: element.scrollHeight,
            viewportHeight: element.clientHeight,
            atBottom:
                element.scrollTop + element.clientHeight >= element.scrollHeight - 4,
        };

        if (surface === SURFACE_CHAT) {
            const visible = visibleChatMessage();
            props.visibleMessageIndex = visible ? visible.index : null;
            props.visibleMessageRole = visible ? visible.role : null;
            props.messageCount = chatLogEl.querySelectorAll(".message").length;
            props.chatThreadId = currentChatThread();
        }

        logEvent({
            eventType: surface === SURFACE_CHAT ? "chat_scroll" : "editor_scroll",
            elementName: surface === SURFACE_CHAT ? "chat-log" : "pleading-paper",
            page: surface,
            valueNum: Math.round(bucket.up + bucket.down),
            durationMs: now() - bucket.startedAt,
            eventProps: props,
        });
    }

    function bindScroll(element, surface) {
        if (!element) {
            return;
        }
        let lastTop = element.scrollTop;

        element.addEventListener(
            "scroll",
            () => {
                const top = element.scrollTop;
                const delta = top - lastTop;
                lastTop = top;

                const userScroll = isUserScroll();
                if (userScroll) {
                    hadInputSinceHeartbeat = true;
                    openSurface(surface, "scroll");
                }

                let bucket = scrollBuckets.get(surface);
                if (!bucket) {
                    bucket = {
                        element,
                        startedAt: now(),
                        startTop: top - delta,
                        up: 0,
                        down: 0,
                        events: 0,
                        programmatic: 0,
                    };
                    scrollBuckets.set(surface, bucket);
                    setTimeout(() => flushScrollBucket(surface), SCROLL_BUCKET_MS);
                }

                if (!userScroll) {
                    bucket.programmatic += 1;
                    return;
                }

                bucket.events += 1;
                if (delta < 0) {
                    bucket.up += -delta;
                } else {
                    bucket.down += delta;
                }
            },
            { passive: true }
        );
    }

    bindScroll(chatLogEl, SURFACE_CHAT);
    bindScroll(editorScrollEl, SURFACE_EDITOR);

    // ---------------------------------------------------------------- selection
    //
    // Highlighting text in a reply is a strong reading signal even when nothing
    // is copied. Selections inside the editor are ordinary editing and are not
    // logged on their own.

    let selectionTimer = null;
    let lastSelectionKey = "";

    document.addEventListener("selectionchange", () => {
        const selection = window.getSelection?.();
        if (!selection || selection.isCollapsed) {
            return;
        }

        hadInputSinceHeartbeat = true;
        openSurface(surfaceForNode(selection.anchorNode), "selection");

        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => {
            const current = window.getSelection?.();
            if (!current || current.isCollapsed) {
                return;
            }
            if (!chatLogEl || !chatLogEl.contains(current.anchorNode)) {
                return;
            }
            const text = String(current);
            if (!text.trim()) {
                return;
            }
            // The same selection re-reported while the mouse is still moving
            // should not be logged twice.
            const key = `${text.length}:${text.slice(0, 40)}`;
            if (key === lastSelectionKey) {
                return;
            }
            lastSelectionKey = key;

            const surface = chatMessageSurface();
            logEvent({
                eventType: "chat_select",
                elementName: surface,
                page: SURFACE_CHAT,
                valueNum: text.length,
                eventProps: {
                    chars: text.length,
                    role: surface.replace("chat_message_", "").replace("chat_message", "unknown"),
                    chatThreadId: currentChatThread(),
                },
            });
        }, SELECTION_SETTLE_MS);
    });

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
                pointerSurface,
                layout: currentLayoutMode(),
                chatRatio: currentChatRatio(),
            },
        });

        hadInputSinceHeartbeat = false;
    }, HEARTBEAT_MS);

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
        for (const surface of Array.from(scrollBuckets.keys())) {
            flushScrollBucket(surface);
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
                layout: currentLayoutMode(),
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
