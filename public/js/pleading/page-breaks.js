function stripPleadingPageBreakMarkup(html) {
    const container = document.createElement("div");
    container.innerHTML = html || "";
    container.querySelectorAll(".pleading-page-start").forEach((el) => {
        el.classList.remove("pleading-page-start");
    });
    container
        .querySelectorAll(".pleading-page-spacer, .pleading-page-gap")
        .forEach((el) => {
            el.remove();
        });
    return container.innerHTML;
}

function getRootBlockNode(quill, index) {
    const lineInfo = quill.getLine(index);
    if (!lineInfo) {
        return null;
    }

    let node = lineInfo[0].domNode;
    while (node && node.parentElement !== quill.root) {
        node = node.parentElement;
    }
    return node;
}

function collectVisualLines(quill, spec) {
    const lines = [];
    const defaultLineHeight = spec.getLineHeightPx();

    Array.from(quill.root.children).forEach((block) => {
        if (
            block.classList.contains("pleading-page-spacer") ||
            block.classList.contains("pleading-page-gap")
        ) {
            return;
        }

        const blockBlot = Quill.find(block);
        if (!blockBlot) {
            return;
        }

        const blockStart = quill.getIndex(blockBlot);
        const hasText = block.textContent.replace(/\u200b/gi, "").length > 0;

        if (!hasText) {
            lines.push({ index: blockStart, height: defaultLineHeight });
            return;
        }

        const lineStarts = [{ index: blockStart, top: null }];
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let node;
        let prevTop = null;

        while ((node = walker.nextNode())) {
            for (let offset = 0; offset < node.length; offset += 1) {
                const range = document.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + 1);
                const top = range.getBoundingClientRect().top;
                const leaf = Quill.find(node, true);

                if (prevTop !== null && Math.abs(top - prevTop) > 1 && leaf) {
                    lineStarts.push({
                        index: quill.getIndex(leaf, offset),
                        top,
                    });
                }

                if (lineStarts[0].top === null) {
                    lineStarts[0].top = top;
                }

                prevTop = top;
            }
        }

        for (let lineIndex = 0; lineIndex < lineStarts.length; lineIndex += 1) {
            const current = lineStarts[lineIndex];
            const next = lineStarts[lineIndex + 1];
            const height =
                next && current.top !== null && next.top !== null
                    ? Math.max(defaultLineHeight, Math.round(next.top - current.top))
                    : defaultLineHeight;
            lines.push({ index: current.index, height });
        }
    });

    return lines;
}

function getPageStartIndices(visualLines, linesPerPage) {
    const starts = [];
    visualLines.forEach((line, lineIndex) => {
        if (lineIndex > 0 && lineIndex % linesPerPage === 0) {
            starts.push(line.index);
        }
    });
    return [...new Set(starts)];
}

function clearPageStartMarkers(root) {
    root.querySelectorAll(".pleading-page-start").forEach((el) => {
        el.classList.remove("pleading-page-start");
    });
    root.querySelectorAll(".pleading-page-spacer, .pleading-page-gap").forEach((el) => {
        el.remove();
    });
}

function markBlockPageStart(blockNode) {
    if (blockNode && !blockNode.classList.contains("pleading-page-start")) {
        blockNode.classList.add("pleading-page-start");
    }
}

function applyPageStartAt(quill, index) {
    const lineInfo = quill.getLine(index);
    if (!lineInfo) {
        return 0;
    }

    let delta = 0;
    let targetIndex = index;

    if (lineInfo[1] > 0) {
        quill.insertText(index, "\n", Quill.sources.SILENT);
        delta = 1;
        targetIndex = index + 1;
    }

    const blockNode = getRootBlockNode(quill, targetIndex);
    markBlockPageStart(blockNode);
    return delta;
}

function syncPleadingPageBreaks(quill, spec) {
    if (quill.__pleadingPageBreakSync) {
        return collectVisualLines(quill, spec).length;
    }

    quill.__pleadingPageBreakSync = true;

    try {
        const savedSelection = quill.getSelection();
        clearPageStartMarkers(quill.root);

        const visualLines = collectVisualLines(quill, spec);
        const pageStarts = getPageStartIndices(visualLines, spec.linesPerPage);
        let selectionDelta = 0;

        [...pageStarts].sort((left, right) => right - left).forEach((startIndex) => {
            const splitDelta = applyPageStartAt(quill, startIndex);
            if (savedSelection && startIndex <= savedSelection.index) {
                selectionDelta += splitDelta;
            }
        });

        if (savedSelection) {
            quill.setSelection(
                savedSelection.index + selectionDelta,
                savedSelection.length,
                Quill.sources.SILENT
            );
        }

        return collectVisualLines(quill, spec).length;
    } finally {
        quill.__pleadingPageBreakSync = false;
    }
}
