class PleadingPaginator {
    constructor(spec) {
        this.spec = spec;
    }

    prepareBodyHtml(html) {
        const container = document.createElement("div");
        container.innerHTML = html;

        container.querySelectorAll("p, li").forEach((el) => {
            el.style.margin = "0";
            el.style.lineHeight = this.spec.getLineHeightCss();
            el.style.fontFamily = this.spec.fontFamily;
            el.style.fontSize = `${this.spec.fontSizePt}pt`;
            el.style.maxWidth = "100%";
            el.style.boxSizing = "border-box";
            el.style.overflowWrap = "break-word";
        });

        return container.innerHTML;
    }

    collectVisualLineTops(bodyEl) {
        const defaultLineHeight = this.spec.getLineHeightPx();
        const rootTop = bodyEl.getBoundingClientRect().top;
        const lines = [];

        Array.from(bodyEl.children).forEach((block) => {
            const hasText = block.textContent.replace(/\u200b/gi, "").length > 0;

            if (!hasText) {
                const top = block.getBoundingClientRect().top - rootTop;
                lines.push({ top, height: defaultLineHeight });
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
                    const top = range.getBoundingClientRect().top - rootTop;

                    if (prevTop === null || Math.abs(top - prevTop) > 1) {
                        lineStarts.push(top);
                    }

                    prevTop = top;
                }
            }

            if (!lineStarts.length) {
                const top = block.getBoundingClientRect().top - rootTop;
                lines.push({ top, height: defaultLineHeight });
                return;
            }

            for (let index = 0; index < lineStarts.length; index += 1) {
                const currentTop = lineStarts[index];
                const nextTop = lineStarts[index + 1];
                const height =
                    nextTop != null
                        ? Math.max(defaultLineHeight, Math.round(nextTop - currentTop))
                        : defaultLineHeight;
                lines.push({ top: currentTop, height });
            }
        });

        if (!lines.length) {
            lines.push({ top: 0, height: defaultLineHeight });
        }

        return lines;
    }

    paginate(html) {
        const linesPerPage = this.spec.linesPerPage;
        const contentWidthPx = this.spec.getBodyContentWidthPx();
        const preparedHtml = this.prepareBodyHtml(html);

        const measureRoot = document.createElement("div");
        measureRoot.className = "pleading-measure-root";
        measureRoot.style.cssText =
            "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;";
        measureRoot.style.width = `${contentWidthPx}px`;
        measureRoot.innerHTML = `<div class="pleading-measure-body">${preparedHtml}</div>`;
        document.body.appendChild(measureRoot);

        const bodyEl = measureRoot.querySelector(".pleading-measure-body");
        bodyEl.style.boxSizing = "border-box";

        const visualLines = this.collectVisualLineTops(bodyEl);
        const pageCount = Math.max(1, Math.ceil(visualLines.length / linesPerPage));
        const totalHeight = bodyEl.scrollHeight;
        const pages = [];

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
            const startLine = pageIndex * linesPerPage;
            const endLine = Math.min(startLine + linesPerPage, visualLines.length);
            const startTop = visualLines[startLine]?.top ?? 0;
            const endTop =
                endLine < visualLines.length
                    ? visualLines[endLine].top
                    : Math.max(totalHeight, startTop + this.spec.getLineBlockHeightPx());
            const pageHeightPx = Math.max(
                this.spec.getLineHeightPx(),
                Math.ceil(endTop - startTop)
            );

            const slice = document.createElement("div");
            slice.className = "pleading-export-clip";
            slice.style.height = `${pageHeightPx}px`;
            slice.style.overflow = "hidden";

            const inner = document.createElement("div");
            inner.className = "pleading-export-clip-inner";
            inner.innerHTML = preparedHtml;
            inner.style.marginTop = `-${Math.round(startTop)}px`;
            inner.style.width = `${contentWidthPx}px`;
            inner.style.maxWidth = "100%";
            inner.style.boxSizing = "border-box";
            inner.style.overflowX = "hidden";
            slice.appendChild(inner);
            measureRoot.appendChild(slice);

            pages.push(slice.outerHTML);
            measureRoot.removeChild(slice);
        }

        measureRoot.remove();
        return pages;
    }
}
