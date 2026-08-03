/**
 * End-to-end check for pleading PDF generation.
 *
 * Runs the real client-side layout classes in a browser to produce the export
 * root exactly as the editor would, renders it through the server pipeline, and
 * verifies the result is a text PDF whose pagination matches the editor's.
 *
 *   node scripts/pdf-fidelity-check.js
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const pdfParse = require("pdf-parse");
const {
    renderPleadingPdf,
    closeBrowser,
    hasEmbeddedFonts,
    getFontDir,
} = require("../server/services/pdfGenerator.js");

const PLEADING_JS = [
    "layout-spec.js",
    "page-view.js",
    "paginator.js",
    "stylesheet.js",
    "document.js",
].map((name) => path.join(__dirname, "..", "public", "js", "pleading", name));

const PARAGRAPH =
    "The plaintiff alleges that the defendant breached the implied covenant of " +
    "good faith and fair dealing by withholding material information during " +
    "negotiation of the settlement agreement, and further contends that such " +
    "conduct constitutes a separate and independent tort under California law.";

const MARKERS = {
    firstLine: "MARKER-ALPHA-FIRST-LINE",
    listItem: "MARKER-BRAVO-LIST-ITEM",
    nested: "MARKER-CHARLIE-NESTED",
    bold: "MARKER-DELTA-BOLD",
    italic: "MARKER-ECHO-ITALIC",
    centered: "MARKER-GOLF-CENTERED",
    rightAligned: "MARKER-HOTEL-RIGHT",
    indented: "MARKER-INDIA-INDENTED",
    lastLine: "MARKER-FOXTROT-LAST-LINE",
};

function buildFixtureHtml() {
    const body = [`<p>${MARKERS.firstLine}</p>`];

    // Block formatting a pleading actually uses: a centred caption, an
    // indented quotation, a right-aligned signature line, justified body.
    body.push(
        `<p data-check="center" style="text-align: center;">${MARKERS.centered} ` +
            "IN THE SUPERIOR COURT OF THE STATE OF CALIFORNIA</p>"
    );
    body.push(
        `<p data-check="indent" class="ql-indent-2">${MARKERS.indented} ${PARAGRAPH}</p>`
    );
    body.push(
        `<p data-check="right" style="text-align: right;">${MARKERS.rightAligned} DATED: July 31, 2026</p>`
    );
    body.push(`<p data-check="justify" style="text-align: justify;">${PARAGRAPH}</p>`);
    body.push(`<p data-check="plain">${PARAGRAPH}</p>`);

    for (let index = 0; index < 5; index += 1) {
        body.push(`<p>${index + 1}. ${PARAGRAPH}</p>`);
    }

    body.push(
        "<ol>" +
            `<li>${MARKERS.listItem} first numbered item</li>` +
            "<li>second numbered item</li>" +
            `<li class="ql-indent-1">${MARKERS.nested} nested item</li>` +
            "<li>third numbered item</li>" +
            "</ol>"
    );

    body.push(
        "<ul><li>bullet one</li><li>bullet two</li><li>bullet three</li></ul>"
    );

    body.push(
        `<p><strong>${MARKERS.bold}</strong> and <em>${MARKERS.italic}</em> ` +
            "inline formatting must survive the round trip, as does " +
            "<u>underline</u>, <s>strikethrough</s> and super<sup>script</sup>.</p>"
    );

    for (let index = 0; index < 6; index += 1) {
        body.push(`<p>${PARAGRAPH}</p>`);
    }

    body.push(`<p>${MARKERS.lastLine}</p>`);
    return body.join("");
}

/**
 * Measures the export root in a browser - the same layout Chrome performs when
 * printing it. Confirms block formatting reaches the page geometrically, not
 * just that the markup survived.
 */
async function measureExportGeometry(exportHtml) {
    const browser = await puppeteer.launch({ headless: true });

    try {
        const page = await browser.newPage();
        await page.setContent(
            `<!doctype html><html><body style="margin:0">${exportHtml}</body></html>`
        );

        return await page.evaluate(() => {
            const firstPage = document.querySelector(".pleading-export-page");
            const column = firstPage.querySelector(".pleading-export-content");
            const columnRect = column.getBoundingClientRect();

            const read = (name) => {
                const el = firstPage.querySelector(`[data-check="${name}"]`);
                if (!el) return null;
                const range = document.createRange();
                range.selectNodeContents(el);
                const rect = range.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return {
                    left: rect.left - columnRect.left,
                    right: columnRect.right - rect.right,
                    paddingLeft: parseFloat(cs.paddingLeft),
                    lineHeight: cs.lineHeight,
                };
            };

            // Sub-0.01px spread is float noise from resolving the same em
            // value on different elements, not a real grid difference.
            const lineHeights = [
                ...new Set(
                    [...firstPage.querySelectorAll("p, li")].map((el) =>
                        parseFloat(getComputedStyle(el).lineHeight).toFixed(2)
                    )
                ),
            ];

            return {
                columnWidth: columnRect.width,
                center: read("center"),
                indent: read("indent"),
                right: read("right"),
                justify: read("justify"),
                plain: read("plain"),
                distinctLineHeights: lineHeights,
            };
        });
    } finally {
        await browser.close();
    }
}

async function buildExportRoot(contentHtml) {
    const browser = await puppeteer.launch({ headless: true });

    try {
        const page = await browser.newPage();
        await page.setContent("<!doctype html><html><body></body></html>");

        for (const file of PLEADING_JS) {
            await page.addScriptTag({ path: file });
        }

        return await page.evaluate((html) => {
            const spec = PleadingLayoutSpec.default();
            const doc = new PleadingDocument(spec, html);
            return {
                html: doc.renderExportRoot().outerHTML,
                editorPageCount: doc.pageCount,
                linesPerPage: spec.linesPerPage,
            };
        }, contentHtml);
    } finally {
        await browser.close();
    }
}

function check(label, passed, detail) {
    const mark = passed ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${label}${detail ? ` - ${detail}` : ""}`);
    return passed;
}

async function main() {
    console.log("\nPleading PDF fidelity check\n");
    console.log(
        `  fonts: ${hasEmbeddedFonts() ? "embedded from" : "MISSING in"} ${getFontDir()}\n`
    );

    const contentHtml = buildFixtureHtml();
    const { html, editorPageCount, linesPerPage } = await buildExportRoot(contentHtml);

    console.log(`  editor paginated to ${editorPageCount} page(s)`);
    console.log(`  export HTML payload: ${(html.length / 1024).toFixed(1)} KB`);

    const startedAt = Date.now();
    const pdf = await renderPleadingPdf(html);
    const warmStartedAt = Date.now();
    await renderPleadingPdf(html);
    const warmMs = Date.now() - warmStartedAt;

    console.log(`  render: ${Date.now() - startedAt - warmMs} ms cold, ${warmMs} ms warm`);
    console.log(`  PDF size: ${(pdf.length / 1024).toFixed(1)} KB\n`);

    const parsed = await pdfParse(Buffer.from(pdf));
    const text = parsed.text;
    const results = [];

    results.push(
        check(
            "PDF contains extractable text (not an image)",
            text.replace(/\s/g, "").length > 500,
            `${text.replace(/\s/g, "").length} non-space chars`
        )
    );

    results.push(
        check(
            "page count matches editor pagination",
            parsed.numpages === editorPageCount,
            `pdf=${parsed.numpages} editor=${editorPageCount}`
        )
    );

    for (const [name, marker] of Object.entries(MARKERS)) {
        results.push(check(`marker preserved: ${name}`, text.includes(marker)));
    }

    results.push(
        check(
            "content order preserved",
            text.indexOf(MARKERS.firstLine) < text.indexOf(MARKERS.lastLine),
            "first line precedes last line"
        )
    );

    const lineNumbers = Array.from({ length: linesPerPage }, (_, i) => String(i + 1));
    const missingLineNumbers = lineNumbers.filter((n) => !text.includes(n));
    results.push(
        check(
            `line numbers 1-${linesPerPage} present`,
            missingLineNumbers.length === 0,
            missingLineNumbers.length ? `missing ${missingLineNumbers.join(",")}` : ""
        )
    );

    results.push(
        check(
            "list numbering rendered",
            /\b1\.\s|\(1\)/.test(text),
            "ordered-list counters emitted"
        )
    );

    const geo = await measureExportGeometry(html);
    const TOL = 4;

    results.push(
        check(
            "centered block is centred in the column",
            Math.abs(geo.center.left - geo.center.right) < TOL,
            `left gap ${geo.center.left.toFixed(1)}px vs right gap ${geo.center.right.toFixed(1)}px`
        )
    );

    results.push(
        check(
            "right-aligned block sits at the right margin",
            geo.right.right < TOL && geo.right.left > TOL,
            `right gap ${geo.right.right.toFixed(1)}px`
        )
    );

    results.push(
        check(
            "indented block is inset from the margin",
            geo.indent.paddingLeft > 0 && geo.indent.left > geo.plain.left + TOL,
            `padding ${geo.indent.paddingLeft}px, text inset ${geo.indent.left.toFixed(1)}px`
        )
    );

    results.push(
        check(
            "justified block spans the full column",
            geo.justify.left < TOL && geo.justify.right < TOL,
            `gaps ${geo.justify.left.toFixed(1)}px / ${geo.justify.right.toFixed(1)}px`
        )
    );

    results.push(
        check(
            "plain block remains left aligned",
            geo.plain.left < TOL,
            `left gap ${geo.plain.left.toFixed(1)}px`
        )
    );

    // The line grid is what makes "page 3, line 12" citable. No formatting
    // option may alter vertical rhythm.
    results.push(
        check(
            "line height uniform across all formatting",
            geo.distinctLineHeights.length === 1,
            geo.distinctLineHeights.join(" | ")
        )
    );

    const outPath = path.join(__dirname, "..", "tmp-fidelity-sample.pdf");
    fs.writeFileSync(outPath, Buffer.from(pdf));
    console.log(`\n  sample written to ${outPath}`);

    const failed = results.filter((r) => !r).length;
    console.log(
        failed
            ? `\n${failed} check(s) FAILED\n`
            : `\nAll ${results.length} checks passed\n`
    );

    await closeBrowser();
    process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
    console.error("\nfidelity check crashed:", error);
    await closeBrowser();
    process.exit(1);
});
