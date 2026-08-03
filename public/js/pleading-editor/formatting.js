/**
 * Block-level formatting for the pleading editor.
 *
 * Alignment and indent are applied to whole root blocks rather than through
 * document.execCommand, which produces inconsistent markup across browsers
 * (blockquote nesting for indent, and margin-based indent that the export
 * pipeline strips).
 *
 * Both survive into the PDF unchanged:
 *   - alignment is an inline text-align, which needs no stylesheet support
 *   - indent reuses the ql-indent-N classes the export stylesheet already
 *     defines, so nested list counters keep working
 *
 * Neither alters line height, so the 28-lines-per-page grid and the line
 * numbers stay correct. Indent narrows the text column, which reflows content
 * onto more lines - that is the intended behaviour, and the line numbering
 * recomputes to match.
 */

const PLEADING_ALIGNMENTS = ["left", "center", "right", "justify"];
const PLEADING_MAX_INDENT = 5;
const PLEADING_INDENT_CLASS = /^ql-indent-(\d)$/;

function isFormattableBlock(el) {
    return (
        el &&
        el.nodeType === Node.ELEMENT_NODE &&
        !el.classList.contains("pleading-page-gap")
    );
}

/** Root blocks (direct children of the editor) touched by the selection. */
function getSelectedRootBlocks(editorEl) {
    const selection = window.getSelection();
    const blocks = Array.from(editorEl.children).filter(isFormattableBlock);

    if (!selection?.rangeCount || !editorEl.contains(selection.anchorNode)) {
        return [];
    }

    const range = selection.getRangeAt(0);
    const touched = blocks.filter((block) => range.intersectsNode(block));

    // A collapsed caret can report no intersection on empty blocks.
    if (!touched.length) {
        const anchor = getRootBlock(selection.anchorNode, editorEl);
        return isFormattableBlock(anchor) ? [anchor] : [];
    }

    return touched;
}

function getIndentLevel(block) {
    for (const name of block.classList) {
        const match = name.match(PLEADING_INDENT_CLASS);
        if (match) {
            return Number(match[1]);
        }
    }
    return 0;
}

function setIndentLevel(block, level) {
    const clamped = Math.max(0, Math.min(PLEADING_MAX_INDENT, level));

    Array.from(block.classList)
        .filter((name) => PLEADING_INDENT_CLASS.test(name))
        .forEach((name) => block.classList.remove(name));

    if (clamped > 0) {
        block.classList.add(`ql-indent-${clamped}`);
    }
}

function applyBlockAlignment(editorEl, alignment) {
    if (!PLEADING_ALIGNMENTS.includes(alignment)) {
        return false;
    }

    const blocks = getSelectedRootBlocks(editorEl);
    if (!blocks.length) {
        return false;
    }

    blocks.forEach((block) => {
        // Left is the default, so store nothing rather than redundant markup.
        block.style.textAlign = alignment === "left" ? "" : alignment;
        if (!block.getAttribute("style")) {
            block.removeAttribute("style");
        }
    });

    return true;
}

function changeBlockIndent(editorEl, delta) {
    const blocks = getSelectedRootBlocks(editorEl);
    if (!blocks.length) {
        return false;
    }

    let changed = false;
    blocks.forEach((block) => {
        const current = getIndentLevel(block);
        const next = Math.max(0, Math.min(PLEADING_MAX_INDENT, current + delta));
        if (next !== current) {
            setIndentLevel(block, next);
            changed = true;
        }
    });

    return changed;
}

/** Alignment shared by every selected block, or null when they disagree. */
function getActiveAlignment(editorEl) {
    const blocks = getSelectedRootBlocks(editorEl);
    if (!blocks.length) {
        return null;
    }

    const values = new Set(
        blocks.map((block) => block.style.textAlign || "left")
    );

    return values.size === 1 ? [...values][0] : null;
}

function canIndent(editorEl, delta) {
    const blocks = getSelectedRootBlocks(editorEl);
    if (!blocks.length) {
        return false;
    }

    return blocks.some((block) => {
        const level = getIndentLevel(block);
        return delta > 0 ? level < PLEADING_MAX_INDENT : level > 0;
    });
}

/**
 * Carries block formatting onto a block created by a page split.
 *
 * Without this, a centred or indented paragraph that straddles a page boundary
 * loses its formatting on the continuation - visibly wrong in the PDF.
 */
function copyBlockFormatting(sourceBlock, targetBlock) {
    if (!sourceBlock || !targetBlock) {
        return;
    }

    if (sourceBlock.style.textAlign) {
        targetBlock.style.textAlign = sourceBlock.style.textAlign;
    }

    const level = getIndentLevel(sourceBlock);
    if (level > 0) {
        setIndentLevel(targetBlock, level);
    }
}
