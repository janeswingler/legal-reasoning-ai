/*
 * Reloads once the window grows past the minimum size, but only when the page
 * was first opened too small. The pleading editor measures page scale and
 * pagination from a container the gate hides, so those numbers are zero for a
 * load that happened behind the gate. Resizing restores the scale on its own via
 * ResizeObserver, but not the pagination, so a fresh load is the safe path.
 *
 * Keep this query in sync with the breakpoints in css/screen-gate.css.
 */
const SCREEN_GATE_QUERY = "(max-width: 899px), (max-height: 449px)";

(function initScreenGate() {
    if (typeof window.matchMedia !== "function") {
        return;
    }

    const gate = window.matchMedia(SCREEN_GATE_QUERY);
    if (!gate.matches) {
        return;
    }

    let reloading = false;
    const reloadWhenLargeEnough = (event) => {
        if (event.matches || reloading) {
            return;
        }
        reloading = true;
        window.location.reload();
    };

    if (typeof gate.addEventListener === "function") {
        gate.addEventListener("change", reloadWhenLargeEnough);
    } else if (typeof gate.addListener === "function") {
        gate.addListener(reloadWhenLargeEnough);
    }
})();
