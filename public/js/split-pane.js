/*
 * Drag handle that divides the chat pane from the submission editor.
 *
 * The ratio is the chat pane's share of the width the two panes divide between
 * them (gaps and the handle excluded), so it can be written straight into the
 * two fr values on .app-main. The study default is an even split. Travel is
 * bounded so that no reachable position is a useless one: each pane keeps a
 * working minimum. Those bounds live here rather than in a minmax() track
 * because a grid track cannot mix a px floor with an fr maximum.
 */
const SPLIT_STORAGE_KEY = "aillr.splitRatio.v2";
const SPLIT_DEFAULT_RATIO = 0.5;
const SPLIT_MIN_CHAT_PX = 400;
const SPLIT_MIN_EDITOR_PX = 360;
const SPLIT_KEYBOARD_STEP = 0.02;

(function initSplitPane() {
    const main = document.querySelector(".app-main");
    const handle = document.getElementById("appSplitHandle");
    if (!main || !handle) {
        return;
    }

    // What the student asked for, which can be wider than the window currently
    // allows. Kept separate from the applied value so that shrinking and then
    // re-widening the window returns to their choice instead of the clamp.
    let desiredRatio = readStoredRatio();
    let appliedRatio = SPLIT_DEFAULT_RATIO;

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

    function commitRatio(source) {
        storeRatio(appliedRatio);

        if (typeof logEvent !== "function") {
            return;
        }

        logEvent({
            eventType: "split_resize",
            elementName: "split-handle",
            page: "assignment",
            valueNum: Number(appliedRatio.toFixed(3)),
            eventProps: { chatRatio: Number(appliedRatio.toFixed(3)), source },
        });
    }

    function ratioFromPointer(clientX) {
        const style = window.getComputedStyle(main);
        const left = main.getBoundingClientRect().left + parseFloat(style.paddingLeft);
        const shared = getSharedWidth();
        return shared > 0 ? (clientX - left) / shared : appliedRatio;
    }

    // Move and release are tracked on the window rather than through pointer
    // capture so the drag survives the cursor outrunning the 6px handle.
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
        // Stops the drag from selecting text in either pane.
        event.preventDefault();
        dragPointerId = event.pointerId;
        document.body.classList.add("is-splitting");
        window.addEventListener("pointermove", onDragMove);
        window.addEventListener("pointerup", onDragEnd);
        window.addEventListener("pointercancel", onDragEnd);
    });

    handle.addEventListener("dblclick", () => {
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
        applyRatio(next);
        commitRatio("keyboard");
    });

    window.addEventListener("resize", () => applyRatio(desiredRatio));

    applyRatio(desiredRatio);
})();
