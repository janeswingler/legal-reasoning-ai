class PleadingDocument {
    constructor(spec, contentHtml, { pageHtmls = null } = {}) {
        this.spec = spec;
        this.contentHtml = contentHtml;
        this.paginator = new PleadingPaginator(spec);
        this.bodyPages = pageHtmls?.length
            ? pageHtmls.map((html) => this.paginator.prepareBodyHtml(html))
            : this.paginator.paginate(contentHtml);
        this.stylesheet = new PleadingStylesheet(spec);
    }

    get pageCount() {
        return this.bodyPages.length;
    }

    renderPage(pageIndex) {
        return new PleadingPageView(this.spec, {
            pageNumber: pageIndex + 1,
            bodyHtml: this.bodyPages[pageIndex],
            mode: "export",
        });
    }

    renderExportRoot() {
        const root = document.createElement("div");
        root.className = "pleading-export-root";
        root.style.width = `${this.spec.getLetterWidthPx()}px`;
        this.spec.applyCssVariables(root);

        const style = document.createElement("style");
        style.textContent = this.stylesheet.render();
        root.appendChild(style);

        this.bodyPages.forEach((_bodyHtml, index) => {
            root.appendChild(this.renderPage(index).toElement());
        });

        return root;
    }
}

class PleadingEditorChrome {
    constructor(spec, { backdropEl, scrollSurfaceEl, editorEl }) {
        this.spec = spec;
        this.backdropEl = backdropEl;
        this.scrollSurfaceEl = scrollSurfaceEl;
        this.editorEl = editorEl;
        this.paginator = new PleadingPaginator(spec);
    }

    sync(pageCount) {
        const resolvedPageCount =
            pageCount ??
            this.paginator.paginate(stripPleadingPageBreakMarkup(this.editorEl.innerHTML)).length;
        const editorStridePx = this.spec.getEditorPageStridePx();
        const documentHeightPx = resolvedPageCount * editorStridePx;

        this.backdropEl.innerHTML = "";
        for (let index = 0; index < resolvedPageCount; index += 1) {
            const sheet = new PleadingPageView(this.spec, {
                pageNumber: index + 1,
                mode: "editor",
            }).toElement();
            this.backdropEl.appendChild(sheet);
        }

        this.scrollSurfaceEl.style.minHeight = `${documentHeightPx}px`;
        this.editorEl.style.minHeight = `${documentHeightPx}px`;

        return resolvedPageCount;
    }
}
