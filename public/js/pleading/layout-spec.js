class PleadingLayoutSpec {
    constructor(overrides = {}) {
        this.pageWidthIn = 8.5;
        this.pageHeightIn = 11;
        this.fontSizePt = 12;
        this.lineSpacing = 1.7;
        this.linesPerPage = 28;
        this.marginLeftIn = 0.25;
        this.marginRightIn = 0.25;
        this.marginTopIn = 0.57;
        this.footerBandIn = 0.25;
        this.marginBottomIn = 0.5;
        this.lineNumberColumnIn = 0.35;
        this.bodyPaddingIn = 0;
        this.charsPerLine = 54;
        this.referenceCharsPerLineAtFullWidth = 60;
        this.minMarginIn = 0.25;
        this.ruleColor = "#b8b2a8";
        this.ruleLinePx = 1;
        this.ruleGapPx = 3;
        this.ruleInsetLeftPx = 6;
        this.bodyTextRuleGapEm = 0.2;
        this.exportPdfRightInsetPx = 8;
        this.numberColor = "#a8a196";
        this.footerColor = "#a8a196";
        this.lineNumberSizePt = 12;
        this.fontFamily = '"Times New Roman", Times, serif';
        this.screenDpi = 96;

        Object.assign(this, overrides);

        this._lineHeightPx = null;
        this._bodyContentWidthPx = null;
        this._bodyTextPaddingStyles = null;
        this._exportContentLayout = null;
        this._bodyTextLineWidthPx = null;
        this._marginsResolvedForChars = false;
    }

    static default() {
        return new PleadingLayoutSpec();
    }

    inToPx(inches) {
        return Math.round(inches * this.screenDpi);
    }

    getLineHeightIn() {
        const printableIn =
            this.pageHeightIn -
            this.marginTopIn -
            this.marginBottomIn -
            this.footerBandIn;
        return printableIn / this.linesPerPage;
    }

    getLineHeightCss() {
        return `${this.getLineHeightIn()}in`;
    }

    getLineBlockHeightIn() {
        return this.getLineHeightIn() * this.linesPerPage;
    }

    getLineHeightPx() {
        if (this._lineHeightPx !== null) {
            return this._lineHeightPx;
        }

        const probe = document.createElement("div");
        probe.style.cssText =
            "position:absolute;visibility:hidden;" +
            `font-family:Times New Roman,Times,serif;font-size:${this.fontSizePt}pt;` +
            `line-height:${this.getLineHeightCss()};`;
        probe.textContent = "X";
        document.body.appendChild(probe);
        this._lineHeightPx = probe.getBoundingClientRect().height || 27.2;
        probe.remove();
        return this._lineHeightPx;
    }

    getLineBlockHeightPx() {
        return this.getLineHeightPx() * this.linesPerPage;
    }

    getLetterWidthPx() {
        return this.inToPx(this.pageWidthIn);
    }

    getLetterHeightPx() {
        return this.inToPx(this.pageHeightIn);
    }

    getFooterBandPx() {
        return this.inToPx(this.footerBandIn);
    }

    getEditorPageStridePx() {
        return this.getLineBlockHeightPx() + this.getFooterBandPx();
    }

    getPageCount(contentHeightPx) {
        const lineBlockHeightPx = this.getLineBlockHeightPx();
        if (contentHeightPx <= lineBlockHeightPx + 1) {
            return 1;
        }
        return Math.ceil((contentHeightPx - 1) / lineBlockHeightPx);
    }

    getReferenceLineSample() {
        return "012345678901234567890123456789012345678901234567890123456".slice(
            0,
            this.charsPerLine
        );
    }

    measureBodyTextLineWidthPx() {
        if (this._bodyTextLineWidthPx !== null) {
            return this._bodyTextLineWidthPx;
        }

        const available = this.getAvailableBodyTextWidthPx();
        this._bodyTextLineWidthPx = Math.round(
            available * (this.charsPerLine / this.referenceCharsPerLineAtFullWidth)
        );
        return this._bodyTextLineWidthPx;
    }

    getBodyFrameWidthPx() {
        const pad = this.getBodyTextPaddingStyles();
        return Math.ceil(
            this.measureBodyTextLineWidthPx() +
                parseFloat(pad.left) +
                parseFloat(pad.right)
        );
    }

    getEditorPageWidthPx() {
        return (
            this.inToPx(this.marginLeftIn) +
            this.inToPx(this.lineNumberColumnIn) +
            this.getBodyFrameWidthPx() +
            this.inToPx(this.marginRightIn)
        );
    }

    getAvailableBodyTextWidthPx() {
        const pad = this.getBodyTextPaddingStyles();
        return (
            this.inToPx(this.pageWidthIn) -
            this.inToPx(this.marginLeftIn) -
            this.inToPx(this.marginRightIn) -
            this.inToPx(this.lineNumberColumnIn) -
            parseFloat(pad.left) -
            parseFloat(pad.right)
        );
    }

    ensureCharsPerLineFit() {
        if (this._marginsResolvedForChars) {
            return;
        }

        this._marginsResolvedForChars = true;
        const requiredTextPx = this.measureBodyTextLineWidthPx();
        let availableTextPx = this.getAvailableBodyTextWidthPx();

        if (availableTextPx >= requiredTextPx) {
            return;
        }

        let deficitPx = requiredTextPx - availableTextPx;
        const minMarginPx = this.inToPx(this.minMarginIn);
        const rightMarginPx = this.inToPx(this.marginRightIn);
        const shrinkRightPx = Math.max(0, rightMarginPx - minMarginPx);
        const rightReductionPx = Math.min(deficitPx, shrinkRightPx);

        this.marginRightIn -= rightReductionPx / this.screenDpi;
        deficitPx -= rightReductionPx;

        if (deficitPx > 0) {
            const leftMarginPx = this.inToPx(this.marginLeftIn);
            const shrinkLeftPx = Math.max(0, leftMarginPx - minMarginPx);
            const leftReductionPx = Math.min(deficitPx, shrinkLeftPx);
            this.marginLeftIn -= leftReductionPx / this.screenDpi;
        }

        this._exportContentLayout = null;
        this._bodyContentWidthPx = null;
        this._bodyTextLineWidthPx = null;
    }

    getCssVariables() {
        this.ensureCharsPerLineFit();
        const lineHeight = this.getLineHeightCss();
        const lineBlockHeight = `${this.getLineBlockHeightIn()}in`;

        return {
            "--pleading-page-width": `${this.pageWidthIn}in`,
            "--pleading-page-height": `${this.pageHeightIn}in`,
            "--pleading-editor-page-width": `${this.getEditorPageWidthPx()}px`,
            "--pleading-margin-left": `${this.marginLeftIn}in`,
            "--pleading-margin-right": `${this.marginRightIn}in`,
            "--pleading-margin-top": `${this.marginTopIn}in`,
            "--pleading-margin-bottom": `${this.marginBottomIn}in`,
            "--pleading-footer-band": `${this.footerBandIn}in`,
            "--pleading-line-number-column": `${this.lineNumberColumnIn}in`,
            "--pleading-body-padding": `${this.bodyPaddingIn}in`,
            "--pleading-line-height": lineHeight,
            "--pleading-line-block-height": lineBlockHeight,
            "--pleading-editor-page-stride": `calc(${lineBlockHeight} + ${this.footerBandIn}in)`,
            "--pleading-rule-color": this.ruleColor,
            "--pleading-rule-stroke": `${this.ruleLinePx}px`,
            "--pleading-rule-gap": `${this.ruleGapPx}px`,
            "--pleading-rule-inset-left": `${this.ruleInsetLeftPx}px`,
            "--pleading-rule-pair-width": `calc(${this.ruleLinePx}px * 2 + ${this.ruleGapPx}px)`,
            "--pleading-body-text-gap": `${this.bodyTextRuleGapEm}em`,
            "--pleading-body-text-padding-left":
                `calc(${this.ruleInsetLeftPx}px + ${this.ruleLinePx}px * 2 + ${this.ruleGapPx}px + ${this.ruleInsetLeftPx}px + ${this.bodyTextRuleGapEm}em)`,
            "--pleading-body-text-padding-right":
                `calc(${this.ruleLinePx}px * 2 + ${this.ruleGapPx}px + ${this.ruleInsetLeftPx}px + ${this.bodyTextRuleGapEm}em)`,
            "--pleading-font-family": this.fontFamily,
            "--pleading-font-size": `${this.fontSizePt}pt`,
            "--pleading-body-text-width": `${this.measureBodyTextLineWidthPx()}px`,
            "--pleading-body-frame-width": `${this.getBodyFrameWidthPx()}px`,
            "--pleading-number-color": this.numberColor,
            "--pleading-footer-color": this.footerColor,
            "--pleading-line-number-size": `${this.lineNumberSizePt}pt`,
            "--pleading-editor-inset-left": `calc(${this.marginLeftIn}in + ${this.lineNumberColumnIn}in)`,
            "--pleading-editor-inset-right": `${this.marginRightIn}in`,
        };
    }

    applyCssVariables(rootEl) {
        const vars = this.getCssVariables();
        Object.entries(vars).forEach(([name, value]) => {
            rootEl.style.setProperty(name, value);
        });
    }

    measureBodyTextGapPx() {
        const probe = document.createElement("span");
        probe.style.cssText =
            "position:absolute;visibility:hidden;" +
            `font-family:Times New Roman,Times,serif;font-size:${this.fontSizePt}pt;`;
        document.body.appendChild(probe);
        const fontSizePx = parseFloat(window.getComputedStyle(probe).fontSize);
        probe.remove();
        return fontSizePx * this.bodyTextRuleGapEm;
    }

    getBodyTextPaddingStyles() {
        if (this._bodyTextPaddingStyles !== null) {
            return this._bodyTextPaddingStyles;
        }

        const rulePairWidth = this.ruleLinePx * 2 + this.ruleGapPx;
        const gapPx = this.measureBodyTextGapPx();
        const leftPx = this.ruleInsetLeftPx + rulePairWidth + this.ruleInsetLeftPx + gapPx;
        const rightPx = rulePairWidth + this.ruleInsetLeftPx + gapPx;

        this._bodyTextPaddingStyles = {
            left: `${leftPx}px`,
            right: `${rightPx}px`,
        };
        return this._bodyTextPaddingStyles;
    }

    getExportContentLayout() {
        if (this._exportContentLayout !== null) {
            return this._exportContentLayout;
        }

        const pad = this.getBodyTextPaddingStyles();
        const marginLeftPx = parseFloat(pad.left);
        const marginRightPx = parseFloat(pad.right) + this.exportPdfRightInsetPx;

        this._exportContentLayout = {
            marginLeft: `${marginLeftPx}px`,
            marginRight: `${marginRightPx}px`,
            contentWidthPx: Math.floor(this.measureBodyTextLineWidthPx()),
        };
        return this._exportContentLayout;
    }

    getBodyContentWidthPx() {
        if (this._bodyContentWidthPx !== null) {
            return this._bodyContentWidthPx;
        }

        this._bodyContentWidthPx = Math.floor(this.measureBodyTextLineWidthPx());
        return this._bodyContentWidthPx;
    }
}
