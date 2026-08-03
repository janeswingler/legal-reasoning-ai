/**
 * Every container that can hold pleading body content.
 *
 * Written as a single :is() group rather than repeating each rule once per
 * scope. Specificity is identical (:is() takes its most specific argument, and
 * these are all single classes), but it keeps the generated sheet small: the
 * expanded form produced ~250 selectors and cost Chrome ~4.3s to parse on first
 * use, which showed up directly in PDF export time.
 */
const PLEADING_CONTENT_SCOPE =
    ":is(.pleading-export-content,.pleading-export-body,.pleading-export-clip-inner," +
    ".pleading-measure-body,.pleading-measure-inner)";

class PleadingStylesheet {
    constructor(spec) {
        this.spec = spec;
    }

    renderCssVariablesBlock() {
        const vars = this.spec.getCssVariables();
        const declarations = Object.entries(vars)
            .map(([name, value]) => `${name}:${value}`)
            .join(";");
        return `.pleading-export-root{${declarations}}`;
    }

    render() {
        return (
            "@page{size:letter portrait;margin:0;}" +
            "body{margin:0;background:#fff;}" +
            this.renderCssVariablesBlock() +
            this.renderPageRules() +
            this.renderMeasureRules() +
            this.renderExportRootRules()
        );
    }

    renderPageRules() {
        return (
            ".pleading-page{" +
            "width:var(--pleading-page-width);box-sizing:border-box;" +
            "padding:var(--pleading-margin-top) var(--pleading-margin-right) var(--pleading-margin-bottom) var(--pleading-margin-left);" +
            "display:flex;flex-direction:column;" +
            "font-family:var(--pleading-font-family);font-size:12pt;line-height:var(--pleading-line-height);color:#000;" +
            "}" +
            ".pleading-export-page{position:relative;height:var(--pleading-page-height);}" +
            ".pleading-export-page .pleading-page-footer{" +
            "position:absolute;left:0;right:0;bottom:var(--pleading-margin-bottom);" +
            "height:var(--pleading-footer-band);width:auto;" +
            "}" +
            ".pleading-page--editor{" +
            "width:100%;height:var(--pleading-editor-page-stride);" +
            "padding:0 var(--pleading-margin-right) 0 var(--pleading-margin-left);" +
            "justify-content:flex-start;" +
            "}" +
            ".pleading-line-block{" +
            "flex:0 0 auto;height:var(--pleading-line-block-height);" +
            "display:grid;" +
            "grid-template-columns:var(--pleading-line-number-column) var(--pleading-body-frame-width) minmax(0,1fr);" +
            "}" +
            ".pleading-line-numbers{margin:0;padding:0 var(--pleading-body-text-gap) 0 0;list-style:none;text-align:right;" +
            "color:var(--pleading-number-color);font-size:var(--pleading-line-number-size);line-height:var(--pleading-line-height);}" +
            ".pleading-line-numbers li{height:var(--pleading-line-height);}" +
            ".pleading-body-frame,.pleading-editor-layer{border:none;box-shadow:none;}" +
            ".pleading-body-frame{position:relative;width:var(--pleading-body-frame-width);min-width:var(--pleading-body-frame-width);height:100%;box-sizing:border-box;}" +
            ".pleading-rule-pair{position:absolute;top:0;bottom:0;width:var(--pleading-rule-pair-width);" +
            "pointer-events:none;z-index:1;}" +
            ".pleading-rule-pair--left{left:var(--pleading-rule-inset-left);" +
            "background:linear-gradient(to right,var(--pleading-rule-color) 0,var(--pleading-rule-color) var(--pleading-rule-stroke)," +
            "transparent var(--pleading-rule-stroke),transparent calc(var(--pleading-rule-stroke) + var(--pleading-rule-gap))," +
            "var(--pleading-rule-color) calc(var(--pleading-rule-stroke) + var(--pleading-rule-gap))," +
            "var(--pleading-rule-color) var(--pleading-rule-pair-width));}" +
            ".pleading-rule-pair--right{right:0;" +
            "background:linear-gradient(to left,var(--pleading-rule-color) 0,var(--pleading-rule-color) var(--pleading-rule-stroke)," +
            "transparent var(--pleading-rule-stroke),transparent calc(var(--pleading-rule-stroke) + var(--pleading-rule-gap))," +
            "var(--pleading-rule-color) calc(var(--pleading-rule-stroke) + var(--pleading-rule-gap))," +
            "var(--pleading-rule-color) var(--pleading-rule-pair-width));}" +
            ".pleading-export-body{height:100%;overflow:hidden;box-sizing:border-box;position:relative;z-index:0;}" +
            ".pleading-export-content{" +
            "font-family:var(--pleading-font-family);font-size:12pt;line-height:var(--pleading-line-height);" +
            "box-sizing:border-box;overflow:hidden;max-width:100%;" +
            "}" +
            ".pleading-measure-body,.pleading-measure-inner{" +
            "padding:0;box-sizing:border-box;" +
            "font-family:var(--pleading-font-family);font-size:12pt;line-height:var(--pleading-line-height);" +
            "}" +
            ".pleading-export-clip{height:100%;overflow:hidden;}" +
            ".pleading-export-clip-inner{" +
            "font-family:var(--pleading-font-family);font-size:12pt;line-height:var(--pleading-line-height);" +
            "box-sizing:border-box;max-width:100%;overflow-x:hidden;" +
            "}" +
            `${PLEADING_CONTENT_SCOPE} :is(p,li){line-height:var(--pleading-line-height);}` +
            `${PLEADING_CONTENT_SCOPE} > *{margin:0;}` +
            this.renderListRules() +
            ".pleading-page-footer{" +
            "flex:0 0 var(--pleading-footer-band);width:100%;" +
            "display:flex;align-items:center;justify-content:center;" +
            "text-align:center;" +
            "font-family:var(--pleading-font-family);font-size:12pt;color:#000;" +
            "}"
        );
    }

    renderListRules() {
        const s = (selector) => `${PLEADING_CONTENT_SCOPE} ${selector}`;
        const counterFormats = ["decimal", "lower-alpha", "lower-roman"];

        let css =
            `${s("ol")},${s("ul")}{padding-left:1.5em;margin:0;}` +
            `${s("ol > li")},${s("ul > li")}{list-style-type:none;}` +
            `${s("ul > li::before")}{content:"\\2022";}` +
            `${s("li::before")}{display:inline-block;white-space:nowrap;width:1.2em;line-height:var(--pleading-line-height);}` +
            `${s("li:not(.ql-direction-rtl)::before")}{margin-left:-1.5em;margin-right:0.3em;text-align:right;}` +
            `${s("ol li:not(.ql-direction-rtl)")},${s("ul li:not(.ql-direction-rtl)")}{padding-left:1.5em;}` +
            `${s("ol li")}{counter-reset:list-1 list-2 list-3 list-4 list-5 list-6 list-7 list-8 list-9;counter-increment:list-0;}` +
            `${s("ol li::before")}{content:counter(list-0,decimal) ". ";}`;

        for (let level = 1; level <= 9; level += 1) {
            const format = counterFormats[(level - 1) % 3];
            const resets = Array.from({ length: 9 - level }, (_, index) => `list-${level + 1 + index}`).join(" ");
            css += `${s(`ol li.ql-indent-${level}`)}{counter-increment:list-${level};}`;
            css += `${s(`ol li.ql-indent-${level}::before`)}{content:counter(list-${level},${format}) ". ";}`;
            if (resets) {
                css += `${s(`ol li.ql-indent-${level}`)}{counter-reset:${resets};}`;
            }
            css += `${s(`.ql-indent-${level}:not(.ql-direction-rtl)`)} {padding-left:${level * 3}em;}`;
            css += `${s(`li.ql-indent-${level}:not(.ql-direction-rtl)`)} {padding-left:${1.5 + level * 3}em;}`;
        }

        css += `${s("li > br:first-child")}{display:none;}`;
        return css;
    }

    renderMeasureRules() {
        return (
            ".pleading-measure-root{position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;}"
        );
    }

    renderExportRootRules() {
        return (
            ".pleading-export-root{background:#fff;}" +
            ".pleading-export-page{height:var(--pleading-page-height);page-break-after:always;}" +
            ".pleading-export-page:last-child{page-break-after:auto;}"
        );
    }
}
