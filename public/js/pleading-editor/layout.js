function stripPleadingPageBreakMarkup(html) {
    const container = document.createElement("div");
    container.innerHTML = html || "";
    container.querySelectorAll(".pleading-page-start").forEach((el) => {
        el.classList.remove("pleading-page-start");
    });
    container.querySelectorAll(".pleading-page-gap").forEach((el) => {
        el.remove();
    });
    return container.innerHTML;
}

function getEditorPageHtmls(editorEl) {
    const pages = [];
    let currentBlocks = [];

    const flushPage = () => {
        if (!currentBlocks.length && pages.length > 0) {
            return;
        }
        const html = currentBlocks.join("") || "<p><br></p>";
        pages.push(html);
        currentBlocks = [];
    };

    Array.from(editorEl.children).forEach((child) => {
        if (child.classList.contains("pleading-page-gap")) {
            flushPage();
            return;
        }

        const clone = child.cloneNode(true);
        clone.classList.remove("pleading-page-start");
        currentBlocks.push(clone.outerHTML);
    });

    flushPage();
    return pages.length ? pages : ["<p><br></p>"];
}

function isLayoutBlock(el) {
    return (
        el &&
        el.nodeType === Node.ELEMENT_NODE &&
        !el.classList.contains("pleading-page-gap")
    );
}

function getRootBlock(node, editorEl) {
    let element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (element && element.parentElement !== editorEl) {
        element = element.parentElement;
    }
    return element;
}

function saveCaretOffset(editorEl) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editorEl.contains(selection.anchorNode)) {
        return null;
    }

    const range = selection.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(editorEl);
    preRange.setEnd(range.endContainer, range.endOffset);

    return {
        offset: preRange.toString().length,
        collapsed: range.collapsed,
    };
}

function restoreCaretOffset(editorEl, saved) {
    if (!saved) {
        return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    let remaining = saved.offset;
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);

    let node = walker.nextNode();
    while (node) {
        const length = node.textContent.length;
        if (remaining <= length) {
            range.setStart(node, remaining);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            return;
        }
        remaining -= length;
        node = walker.nextNode();
    }

    range.selectNodeContents(editorEl);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}

function collectVisualLines(editorEl, spec) {
    const lines = [];
    const defaultLineHeight = spec.getLineHeightPx();

    Array.from(editorEl.children).forEach((block) => {
        if (!isLayoutBlock(block)) {
            return;
        }

        const hasText = block.textContent.replace(/\u200b/gi, "").length > 0;

        if (!hasText) {
            lines.push({
                block,
                textNode: null,
                offset: 0,
                height: defaultLineHeight,
            });
            return;
        }

        const lineStarts = [];
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let node;
        let prevTop = null;

        while ((node = walker.nextNode())) {
            for (let offset = 0; offset < node.length; offset += 1) {
                const range = document.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + 1);
                const top = range.getBoundingClientRect().top;

                if (prevTop === null || Math.abs(top - prevTop) > 1) {
                    lineStarts.push({ textNode: node, offset, top });
                }

                prevTop = top;
            }
        }

        if (lineStarts.length === 0) {
            lines.push({
                block,
                textNode: null,
                offset: 0,
                height: defaultLineHeight,
            });
            return;
        }

        for (let lineIndex = 0; lineIndex < lineStarts.length; lineIndex += 1) {
            const current = lineStarts[lineIndex];
            const next = lineStarts[lineIndex + 1];
            const height =
                next && current.top !== null && next.top !== null
                    ? Math.max(defaultLineHeight, Math.round(next.top - current.top))
                    : defaultLineHeight;

            lines.push({
                block,
                textNode: current.textNode,
                offset: current.offset,
                height,
            });
        }
    });

    if (lines.length === 0) {
        lines.push({
            block: null,
            textNode: null,
            offset: 0,
            height: defaultLineHeight,
        });
    }

    return lines;
}

function clearPageBreakMarkup(root) {
    root.querySelectorAll(".pleading-page-start").forEach((el) => {
        el.classList.remove("pleading-page-start");
    });
    root.querySelectorAll(".pleading-page-gap").forEach((el) => {
        el.remove();
    });
}

function createPageGap() {
    const gap = document.createElement("div");
    gap.className = "pleading-page-gap";
    gap.setAttribute("contenteditable", "false");
    gap.setAttribute("aria-hidden", "true");
    return gap;
}

function splitBlockAtLineStart(block, textNode, offset) {
    if (!textNode || offset <= 0) {
        return { block, split: false };
    }

    const range = document.createRange();
    range.setStart(textNode, offset);
    range.setEnd(block, block.childNodes.length);

    if (range.collapsed) {
        return { block, split: false };
    }

    const tail = range.extractContents();
    const tagName = block.tagName.toLowerCase();
    const newBlock = document.createElement(tagName === "li" ? "li" : "p");
    newBlock.appendChild(tail);

    // Keep alignment/indent on the continuation, or a centred paragraph that
    // straddles a page boundary loses its formatting below the break.
    copyBlockFormatting(block, newBlock);

    if (!newBlock.textContent.replace(/\u200b/gi, "").length && !newBlock.querySelector("img, table, ul, ol")) {
        newBlock.innerHTML = "<br>";
    }

    block.parentNode.insertBefore(newBlock, block.nextSibling);
    return { block: newBlock, split: true };
}

function insertPageGapBefore(block) {
    if (!block || block.previousElementSibling?.classList.contains("pleading-page-gap")) {
        return false;
    }

    block.parentNode.insertBefore(createPageGap(), block);
    return true;
}

function syncPleadingPageBreaks(editorEl, spec) {
    if (editorEl.__pleadingPageBreakSync) {
        const visualLines = collectVisualLines(editorEl, spec);
        return {
            lineCount: visualLines.length,
            caretRestoreNeeded: false,
        };
    }

    editorEl.__pleadingPageBreakSync = true;

    try {
        clearPageBreakMarkup(editorEl);

        let visualLines = collectVisualLines(editorEl, spec);
        const pageBreakIndices = [];
        let caretRestoreNeeded = false;

        visualLines.forEach((_line, lineIndex) => {
            if (lineIndex > 0 && lineIndex % spec.linesPerPage === 0) {
                pageBreakIndices.push(lineIndex);
            }
        });

        [...pageBreakIndices].reverse().forEach((lineIndex) => {
            const line = visualLines[lineIndex];
            if (!line?.block) {
                return;
            }

            let targetBlock = line.block;

            if (line.textNode) {
                const splitResult = splitBlockAtLineStart(line.block, line.textNode, line.offset);
                targetBlock = splitResult.block;
                caretRestoreNeeded = caretRestoreNeeded || splitResult.split;
            }

            insertPageGapBefore(targetBlock);
            targetBlock.classList.add("pleading-page-start");
        });

        visualLines = collectVisualLines(editorEl, spec);
        return {
            lineCount: visualLines.length,
            caretRestoreNeeded,
        };
    } finally {
        editorEl.__pleadingPageBreakSync = false;
    }
}

function getPageCountFromEditor(editorEl, spec) {
    const { lineCount } = syncPleadingPageBreaks(editorEl, spec);
    return Math.max(1, Math.ceil(lineCount / spec.linesPerPage));
}
