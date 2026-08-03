function getContainingListItem(node, editorEl) {
    let current = node;
    while (current && current !== editorEl) {
        if (current.nodeType === Node.ELEMENT_NODE && current.tagName === "LI") {
            return current;
        }
        current = current.parentNode;
    }
    return null;
}

function isEmptyListItem(listItem) {
    const text = listItem.textContent.replace(/\u200b/gi, "").trim();
    return text === "" && !listItem.querySelector("img, table, ul, ol");
}

class PleadingEditor {
    constructor({
        spec,
        paperEl,
        scaleSizerEl,
        scaleFrameEl,
        backdropEl,
        scrollSurfaceEl,
        editorEl,
        onChange,
    }) {
        this.spec = spec;
        this.paperEl = paperEl;
        this.scaleSizerEl = scaleSizerEl;
        this.scaleFrameEl = scaleFrameEl;
        this.backdropEl = backdropEl;
        this.scrollSurfaceEl = scrollSurfaceEl;
        this.editorEl = editorEl;
        this.onChange = onChange;
        this.chrome = new PleadingEditorChrome(spec, {
            backdropEl,
            scrollSurfaceEl,
            editorEl,
        });
        this.layoutFrameId = null;
        this.viewportScaleFrameId = null;
        this.isSyncingLayout = false;
        this.isComposing = false;

        spec.applyCssVariables(paperEl);

        this.editorEl.addEventListener("input", () => this.handleInput());
        this.editorEl.addEventListener("compositionstart", () => {
            this.isComposing = true;
        });
        this.editorEl.addEventListener("compositionend", () => {
            this.isComposing = false;
            this.scheduleLayout();
        });
        this.editorEl.addEventListener("paste", (event) => this.handlePaste(event));
        this.editorEl.addEventListener("keydown", (event) => this.handleKeydown(event));

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => this.scheduleViewportScale());
            this.resizeObserver.observe(this.paperEl);
        } else {
            window.addEventListener("resize", () => this.scheduleViewportScale());
        }

        this.ensureBlockStructure();
        this.syncLayout();
    }

    handleInput() {
        if (this.isComposing || this.isSyncingLayout) {
            return;
        }
        this.ensureBlockStructure();
        this.scheduleLayout();
        if (this.onChange) {
            this.onChange();
        }
    }

    handlePaste(event) {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") ?? "";
        document.execCommand("insertText", false, text);
    }

    handleKeydown(event) {
        if (event.key !== "Backspace" || this.isComposing) {
            return;
        }

        const selection = window.getSelection();
        if (!selection?.rangeCount || !selection.isCollapsed) {
            return;
        }

        const listItem = getContainingListItem(selection.anchorNode, this.editorEl);
        if (!listItem || !isEmptyListItem(listItem)) {
            return;
        }

        const list = listItem.parentElement;
        if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) {
            return;
        }

        event.preventDefault();

        const range = document.createRange();
        range.selectNodeContents(listItem);
        selection.removeAllRanges();
        selection.addRange(range);

        const command =
            list.tagName === "OL" ? "insertOrderedList" : "insertUnorderedList";
        document.execCommand(command, false, null);
        this.handleInput();
    }

    ensureBlockStructure() {
        if (!this.editorEl.childElementCount) {
            this.editorEl.innerHTML = "<p><br></p>";
        }
    }

    scheduleViewportScale() {
        if (this.viewportScaleFrameId !== null) {
            return;
        }

        this.viewportScaleFrameId = window.requestAnimationFrame(() => {
            this.viewportScaleFrameId = null;
            this.updateViewportScale();
        });
    }

    updateViewportScale() {
        if (!this.scaleSizerEl || !this.scaleFrameEl) {
            return;
        }

        const letterWidthPx = this.spec.getEditorPageWidthPx();
        const availableWidth = this.paperEl.clientWidth;
        const scale =
            letterWidthPx > 0 && availableWidth > 0
                ? Math.min(1, availableWidth / letterWidthPx)
                : 1;
        const naturalHeight = this.scrollSurfaceEl.offsetHeight;

        this.scaleFrameEl.style.width = `${letterWidthPx}px`;
        this.scaleFrameEl.style.height = `${naturalHeight}px`;
        this.scaleFrameEl.style.transform = `scale(${scale})`;
        this.scaleSizerEl.style.width = `${Math.ceil(letterWidthPx * scale)}px`;
        this.scaleSizerEl.style.height = `${Math.ceil(naturalHeight * scale)}px`;
    }

    scheduleLayout() {
        if (this.layoutFrameId !== null) {
            return;
        }

        this.layoutFrameId = window.requestAnimationFrame(() => {
            this.layoutFrameId = null;
            this.syncLayout();
        });
    }

    syncLayout() {
        if (this.isSyncingLayout) {
            return;
        }

        this.isSyncingLayout = true;

        try {
            const savedCaret = saveCaretOffset(this.editorEl);
            const { lineCount, caretRestoreNeeded } = syncPleadingPageBreaks(this.editorEl, this.spec);
            const pageCount = Math.max(1, Math.ceil(lineCount / this.spec.linesPerPage));
            this.chrome.sync(pageCount);
            if (caretRestoreNeeded) {
                restoreCaretOffset(this.editorEl, savedCaret);
            }
            this.scheduleViewportScale();
        } finally {
            this.isSyncingLayout = false;
        }
    }

    getHtml() {
        return stripPleadingPageBreakMarkup(this.editorEl.innerHTML);
    }

    getPageHtmls() {
        this.syncLayout();
        return getEditorPageHtmls(this.editorEl);
    }

    setHtml(html) {
        this.editorEl.innerHTML = html || "<p><br></p>";
        this.removeLeadingEmptyBlocks();
        this.syncLayout();
    }

    removeLeadingEmptyBlocks() {
        while (this.editorEl.children.length > 1) {
            const first = this.editorEl.firstElementChild;
            if (!first || !this.isEmptyBlock(first)) {
                break;
            }
            first.remove();
        }
    }

    isEmptyBlock(el) {
        const text = el.textContent.replace(/\u200b/gi, "").trim();
        return text === "" && !el.querySelector("img, table, ul, ol");
    }

    getPlainText() {
        return this.editorEl.textContent.replace(/\u200b/gi, "").trim();
    }

    focus() {
        this.editorEl.focus();
    }
}
