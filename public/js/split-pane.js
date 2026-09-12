/*
 * Divider between the chat pane and the submission editor.
 *
 * Three layouts: the two panes side by side ("split"), the editor alone with
 * the chat hidden ("editor_max"), and the chat alone with the editor hidden
 * ("chat_max"). The divider can be dragged, and it carries two buttons that
 * hide one pane or bring it back; Ctrl+Shift+[ and Ctrl+Shift+] do the same
 * from the keyboard. Every change is logged, and instrumentation.js reads the
 * current layout through window.appLayout so each heartbeat records it.
 *
 * The split ratio is the chat pane's share of the width the two panes divide
 * between them (gaps and the handle excluded), so it can be written straight
 * into the two fr values on .app-main. The study default is an even split.
 * Travel is bounded so that no reachable position is a useless one: each pane
 * keeps a working minimum. Those bounds live here rather than in a minmax()
 * track because a grid track cannot mix a px floor with an fr maximum.
 */
const SPLIT_STORAGE_KEY = "aillr.splitRatio.v2";
const SPLIT_MODE_STORAGE_KEY = "aillr.splitMode.v1";
const SPLIT_DEFAULT_RATIO = 0.5;
const SPLIT_MIN_CHAT_PX = 400;
const SPLIT_MIN_EDITOR_PX = 360;
const SPLIT_KEYBOARD_STEP = 0.02;

const LAYOUT_SPLIT = "split";
const LAYOUT_EDITOR_MAX = "editor_max";
const LAYOUT_CHAT_MAX = "chat_max";

(function initSplitPane() {
    const main = document.querySelector(".app-main");
    const handle = document.getElementById("appSplitHandle");
    if (!main || !handle) {
        return;
    }

    // System 1 has no chat and no divider. Without this guard the keyboard
    // shortcut could hide the only pane on the page.
    if (document.body.classList.contains("system-1")) {
        return;
    }

    const maximizeEditorBtn = document.getElementById("splitMaximizeEditor");
    const maximizeChatBtn = document.getElementById("splitMaximizeChat");

    const CHEVRON_LEFT =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const CHEVRON_RIGHT =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
        '<path d="m4.5 2.5 3.5 3.5-3.5 3.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    // What the student asked for, which can be wider than the window currently
    // allows. Kept separate from the applied value so that shrinking and then
    // re-widening the window returns to their choice instead of the clamp.
    let desiredRatio = readStoredRatio();
    let appliedRatio = SPLIT_DEFAULT_RATIO;
    let mode = LAYOUT_SPLIT;

    window.appLayout = {
        getMode: () => mode,
        getChatRatio: () => {
            if (mode === LAYOUT_CHAT_MAX) {
                return 1;
            }
            if (mode === LAYOUT_EDITOR_MAX) {
                return 0;
            }
            return appliedRatio;
        },
    };

    function readStoredRatio() {
        try {
            const stored = parseFloat(window.localStorage.getItem(SPLIT_STORAGE_KEY));
            return Number.isFinite(stored) ? stored : SPLIT_DEFAULT_RATIO;
        } catch (error) {
            return SPLIT_DEFAULT_RATIO;
        }
    }

    function storeRatio(value) {
        try {
            window.localStorage.setItem(SPLIT_STORAGE_KEY, String(value));
        } catch (error) {
            // Private browsing or a full quota: the split still works, it just
            // will not survive a reload.
        }
    }

    function readStoredMode() {
        try {
            const stored = window.localStorage.getItem(SPLIT_MODE_STORAGE_KEY);
            return [LAYOUT_SPLIT, LAYOUT_EDITOR_MAX, LAYOUT_CHAT_MAX].includes(stored)
                ? stored
                : LAYOUT_SPLIT;
        } catch (error) {
            return LAYOUT_SPLIT;
        }
    }

    function storeMode(value) {
        try {
            window.localStorage.setItem(SPLIT_MODE_STORAGE_KEY, value);
        } catch (error) {
            // See storeRatio.
        }
    }

    /** Width the two panes divide between them, minus gaps and the handle. */
    function getSharedWidth() {
        const style = window.getComputedStyle(main);
        const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const gapX = parseFloat(style.columnGap) * 2;
        return main.getBoundingClientRect().width - paddingX - gapX - handle.offsetWidth;
    }

    /** Legal range for the chat share, or null when the window is too narrow. */
    function getRatioBounds() {
        const shared = getSharedWidth();
        if (!(shared > 0)) {
            return null;
        }

        const min = SPLIT_MIN_CHAT_PX / shared;
        const max = 1 - SPLIT_MIN_EDITOR_PX / shared;
        return min > max ? null : { min, max };
    }

    function clampRatio(value) {
        const bounds = getRatioBounds();
        if (!bounds) {
            return SPLIT_DEFAULT_RATIO;
        }
        return Math.min(Math.max(value, bounds.min), bounds.max);
    }

    function applyRatio(value) {
        desiredRatio = value;
        appliedRatio = clampRatio(value);
        main.style.setProperty("--split-chat", `${appliedRatio}fr`);
        main.style.setProperty("--split-editor", `${1 - appliedRatio}fr`);

        const bounds = getRatioBounds();
        handle.setAttribute("aria-valuenow", String(Math.round(appliedRatio * 100)));
        handle.setAttribute("aria-valuemin", String(Math.round((bounds?.min ?? 0) * 100)));
        handle.setAttribute("aria-valuemax", String(Math.round((bounds?.max ?? 1) * 100)));

        // The editor zooms to the width it is given, so tell it directly rather
        // than waiting on its ResizeObserver. Absent until notes.js has run.
        window.pleadingEditor?.scheduleViewportScale();
    }

    function log(eventType, extra) {
        if (typeof logEvent !== "function") {
            return;
        }
        logEvent({
            eventType,
            elementName: "split-handle",
            page: "assignment",
            valueNum: Number(window.appLayout.getChatRatio().toFixed(3)),
            eventProps: {
                mode,
                chatRatio: Number(window.appLayout.getChatRatio().toFixed(3)),
                ...extra,
            },
        });
    }

    function commitRatio(source) {
        storeRatio(appliedRatio);
        log("split_resize", { source });
    }

    // ------------------------------------------------------------ layout modes

    function setButton(button, { icon, label, hidden }) {
        if (!button) {
            return;
        }
        button.hidden = Boolean(hidden);
        button.innerHTML = icon;
        button.setAttribute("aria-label", label);
        button.setAttribute("data-tooltip", label);
    }

    function updateHandleControls() {
        if (mode === LAYOUT_EDITOR_MAX) {
            setButton(maximizeEditorBtn, {
                icon: CHEVRON_RIGHT,
                label: "Show chat (Ctrl+Shift+])",
            });
            setButton(maximizeChatBtn, { icon: CHEVRON_RIGHT, label: "", hidden: true });
            handle.title = "Chat hidden. Click the arrow, drag, or double-click to bring it back.";
            return;
        }

        if (mode === LAYOUT_CHAT_MAX) {
            setButton(maximizeEditorBtn, { icon: CHEVRON_LEFT, label: "", hidden: true });
            setButton(maximizeChatBtn, {
                icon: CHEVRON_LEFT,
                label: "Show editor (Ctrl+Shift+[)",
            });
            handle.title = "Editor hidden. Click the arrow, drag, or double-click to bring it back.";
            return;
        }

        setButton(maximizeEditorBtn, {
            icon: CHEVRON_LEFT,
            label: "Hide chat, full-width editor (Ctrl+Shift+[)",
        });
        setButton(maximizeChatBtn, {
            icon: CHEVRON_RIGHT,
            label: "Hide editor, full-width chat (Ctrl+Shift+])",
        });
        handle.title = "Drag to resize. Double-click to reset. Arrows hide one side.";
    }

    function applyMode() {
        document.body.classList.toggle("is-editor-max", mode === LAYOUT_EDITOR_MAX);
        document.body.classList.toggle("is-chat-max", mode === LAYOUT_CHAT_MAX);
        updateHandleControls();

        if (mode === LAYOUT_SPLIT) {
            applyRatio(desiredRatio);
        }

        // The editor measures its page scale and pagination from its container,
        // which reads as zero while hidden. Coming back it needs both redone.
        if (mode !== LAYOUT_CHAT_MAX) {
            window.pleadingEditor?.scheduleViewportScale();
            window.pleadingEditor?.syncLayout?.();
        }
    }

    function setMode(next, source) {
        if (next === mode) {
            return;
        }
        const previous = mode;
        mode = next;
        storeMode(mode);
        applyMode();
        log("layout_change", { from: previous, source });
    }

    function toggleMode(target, source) {
        setMode(mode === target ? LAYOUT_SPLIT : target, source);
    }

    // Button presses must not start a drag on the handle underneath.
    for (const button of [maximizeEditorBtn, maximizeChatBtn]) {
        button?.addEventListener("pointerdown", (event) => event.stopPropagation());
        button?.addEventListener("dblclick", (event) => event.stopPropagation());
    }

    maximizeEditorBtn?.addEventListener("click", () => {
        toggleMode(LAYOUT_EDITOR_MAX, "button");
    });

    maximizeChatBtn?.addEventListener("click", () => {
        toggleMode(LAYOUT_CHAT_MAX, "button");
    });

    // Ctrl+Shift+[ hides the chat (the divider moves left); Ctrl+Shift+] hides
    // the editor. Chosen because Ctrl+Shift+Arrow already means "select a
    // word" inside the editor and Cmd+Shift+[ switches browser tabs on a Mac.
    document.addEventListener("keydown", (event) => {
        if (!(event.ctrlKey && event.shiftKey) || event.altKey || event.metaKey) {
            return;
        }
        if (event.code === "BracketLeft") {
            event.preventDefault();
            toggleMode(LAYOUT_EDITOR_MAX, "keyboard");
        } else if (event.code === "BracketRight") {
            event.preventDefault();
            toggleMode(LAYOUT_CHAT_MAX, "keyboard");
        }
    });

    // -------------------------------------------------------------- dragging

    function ratioFromPointer(clientX) {
        const style = window.getComputedStyle(main);
        const left = main.getBoundingClientRect().left + parseFloat(style.paddingLeft);
        const shared = getSharedWidth();
        return shared > 0 ? (clientX - left) / shared : appliedRatio;
    }

    // Move and release are tracked on the window rather than through pointer
    // capture so the drag survives the cursor outrunning the handle.
    let dragPointerId = null;

    function onDragMove(event) {
        if (event.pointerId !== dragPointerId) {
            return;
        }
        applyRatio(ratioFromPointer(event.clientX));
    }

    function onDragEnd(event) {
        if (event.pointerId !== dragPointerId) {
            return;
        }

        dragPointerId = null;
        window.removeEventListener("pointermove", onDragMove);
        window.removeEventListener("pointerup", onDragEnd);
        window.removeEventListener("pointercancel", onDragEnd);
        document.body.classList.remove("is-splitting");
        commitRatio("drag");
    }

    handle.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) {
            return;
        }
        // Stops the drag from selecting text in either pane.
        event.preventDefault();

        // Dragging a divider that has a pane hidden behind it brings the pane
        // back, then continues as a normal resize.
        if (mode !== LAYOUT_SPLIT) {
            setMode(LAYOUT_SPLIT, "drag");
        }

        dragPointerId = event.pointerId;
        document.body.classList.add("is-splitting");
        window.addEventListener("pointermove", onDragMove);
        window.addEventListener("pointerup", onDragEnd);
        window.addEventListener("pointercancel", onDragEnd);
    });

    handle.addEventListener("dblclick", (event) => {
        if (event.target.closest("button")) {
            return;
        }
        if (mode !== LAYOUT_SPLIT) {
            setMode(LAYOUT_SPLIT, "reset");
        }
        applyRatio(SPLIT_DEFAULT_RATIO);
        commitRatio("reset");
    });

    handle.addEventListener("keydown", (event) => {
        let next;

        if (event.key === "ArrowLeft") {
            next = appliedRatio - SPLIT_KEYBOARD_STEP;
        } else if (event.key === "ArrowRight") {
            next = appliedRatio + SPLIT_KEYBOARD_STEP;
        } else if (event.key === "Home") {
            next = SPLIT_DEFAULT_RATIO;
        } else {
            return;
        }

        event.preventDefault();
        if (mode !== LAYOUT_SPLIT) {
            setMode(LAYOUT_SPLIT, "keyboard");
        }
        applyRatio(next);
        commitRatio("keyboard");
    });

    window.addEventListener("resize", () => {
        if (mode === LAYOUT_SPLIT) {
            applyRatio(desiredRatio);
        }
    });

    // ---------------------------------------------------------------- startup

    mode = readStoredMode();
    applyRatio(desiredRatio);
    applyMode();
})();
