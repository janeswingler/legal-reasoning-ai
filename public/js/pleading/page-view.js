class PleadingPageView {
    constructor(spec, { pageNumber, bodyHtml = "", mode = "export" }) {
        this.spec = spec;
        this.pageNumber = pageNumber;
        this.bodyHtml = bodyHtml;
        this.mode = mode;
    }

    static buildDoubleRulesHtml() {
        return (
            '<span class="pleading-rule-pair pleading-rule-pair--left" aria-hidden="true"></span>' +
            '<span class="pleading-rule-pair pleading-rule-pair--right" aria-hidden="true"></span>'
        );
    }

    buildLineNumbersHtml() {
        let html = "";
        for (let line = 1; line <= this.spec.linesPerPage; line += 1) {
            html += `<li>${line}</li>`;
        }
        return html;
    }

    buildExportBodyHtml() {
        const layout = this.spec.getExportContentLayout();
        return (
            '<div class="pleading-export-body" style="height:100%;overflow:hidden;box-sizing:border-box;">' +
            `<div class="pleading-export-content" style="margin-left:${layout.marginLeft};margin-right:${layout.marginRight};` +
            `width:${layout.contentWidthPx}px;max-width:100%;overflow:hidden;box-sizing:border-box;">` +
            `${this.bodyHtml}</div></div>`
        );
    }

    buildInnerHtml() {
        const lineNumbers =
            `<ol class="pleading-line-numbers" aria-hidden="true">${this.buildLineNumbersHtml()}</ol>`;
        const bodyFrame =
            '<div class="pleading-body-frame">' +
            PleadingPageView.buildDoubleRulesHtml() +
            (this.mode === "export" ? this.buildExportBodyHtml() : "") +
            "</div>";

        return (
            '<div class="pleading-line-block">' +
            lineNumbers +
            bodyFrame +
            "</div>" +
            `<div class="pleading-page-footer" aria-hidden="true">${this.pageNumber}</div>`
        );
    }

    getRootClassName() {
        if (this.mode === "editor") {
            return "pleading-sheet pleading-page pleading-page--editor";
        }
        return "pleading-export-page pleading-page";
    }

    toElement() {
        const page = document.createElement("div");
        page.className = this.getRootClassName();
        page.innerHTML = this.buildInnerHtml();
        return page;
    }

    toHtmlString() {
        return `<div class="${this.getRootClassName()}">${this.buildInnerHtml()}</div>`;
    }
}
