class PleadingStylesheet {
    constructor(spec) {
        this.spec = spec;
    }

    renderCssVariablesBlock() {
        const vars = this.spec.getCssVariables();
        const declarations = Object.entries(vars)
            .map(([name, value]) => `${name}:${value}`)
            .join(";");
        return `:root{${declarations}}`;
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
            "grid-template-columns:var(--pleading-line-number-column) minmax(0,1fr);" +
            "}" +
            ".pleading-line-numbers{margin:0;padding:0 var(--pleading-body-text-gap) 0 0;list-style:none;text-align:right;" +
            "color:var(--pleading-number-color);font-size:var(--pleading-line-number-size);line-height:var(--pleading-line-height);}" +
            ".pleading-line-numbers li{height:var(--pleading-line-height);}" +
            ".pleading-body-frame,.pleading-editor-layer{border:none;box-shadow:none;}" +
            ".pleading-body-frame{position:relative;height:100%;box-sizing:border-box;}" +
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
            ".pleading-export-content p,.pleading-export-content li,.pleading-export-body p,.pleading-export-body li,.pleading-measure-body p,.pleading-measure-body li,.pleading-measure-inner p,.pleading-measure-inner li,.pleading-export-clip-inner p,.pleading-export-clip-inner li{line-height:var(--pleading-line-height);}" +
            ".pleading-export-content > *,.pleading-export-body > *,.pleading-measure-body > *,.pleading-measure-inner > *,.pleading-export-clip-inner > *{margin:0;}" +
            ".pleading-page-footer{" +
            "flex:0 0 var(--pleading-footer-band);width:100%;" +
            "display:flex;align-items:center;justify-content:center;" +
            "text-align:center;" +
            "font-family:var(--pleading-font-family);font-size:12pt;color:#000;" +
            "}"
        );
    }

    renderMeasureRules() {
        return (
            ".pleading-measure-root{position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;}"
        );
    }

    renderExportRootRules() {
        return (
            ".pleading-export-page{height:var(--pleading-page-height);page-break-after:always;}" +
            ".pleading-export-page:last-child{page-break-after:auto;}"
        );
    }
}
