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

    paginate(html) {
        const pageHeightPx = this.spec.getLineBlockHeightPx();
        const contentWidthPx = this.spec.getBodyContentWidthPx();
        const preparedHtml = this.prepareBodyHtml(html);

        const measureRoot = document.createElement("div");
        measureRoot.className = "pleading-measure-root";
        measureRoot.style.width = `${contentWidthPx}px`;
        measureRoot.innerHTML = `<div class="pleading-measure-body">${preparedHtml}</div>`;
        document.body.appendChild(measureRoot);

        const bodyEl = measureRoot.querySelector(".pleading-measure-body");
        bodyEl.style.boxSizing = "border-box";

        const totalHeight = bodyEl.scrollHeight;
        const pageCount = this.spec.getPageCount(totalHeight);
        const pages = [];

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
            const slice = document.createElement("div");
            slice.className = "pleading-export-clip";
            slice.style.height = `${pageHeightPx}px`;
            slice.style.overflow = "hidden";

            const inner = document.createElement("div");
            inner.className = "pleading-export-clip-inner";
            inner.innerHTML = preparedHtml;
            inner.style.marginTop = `-${pageIndex * pageHeightPx}px`;
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
