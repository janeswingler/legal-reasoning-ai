const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer");

/**
 * Renders pleading HTML to a text-based PDF using headless Chrome.
 *
 * The client sends the same markup and CSS the editor renders on screen, so
 * layout is produced by the identical engine rather than re-implemented. Text
 * stays as text: the output is searchable, far smaller than a rasterised
 * export, and line/page positions match the editor exactly.
 *
 * A single page is kept warm for the process lifetime. Times New Roman is ~4MB
 * across its four faces, and Chrome re-parses it on every navigation - loading
 * it once and swapping only the content is the difference between ~4.4s and
 * ~70ms per PDF. Renders are serialised because they share that page.
 */

const FONT_FAMILY = "Times New Roman";
const CONTENT_ID = "pleading-content";

// Windows ships Times New Roman; Tinos is the metric-compatible libre stand-in
// for Linux deploys. Same metrics either way, so pagination does not shift.
const FONT_FACES = [
    { weight: "normal", style: "normal", candidates: ["times.ttf", "Tinos-Regular.ttf"] },
    { weight: "bold", style: "normal", candidates: ["timesbd.ttf", "Tinos-Bold.ttf"] },
    { weight: "normal", style: "italic", candidates: ["timesi.ttf", "Tinos-Italic.ttf"] },
    { weight: "bold", style: "italic", candidates: ["timesbi.ttf", "Tinos-BoldItalic.ttf"] },
];

let browserPromise = null;
let pagePromise = null;
let bootstrapDir = null;
let fontFaceCss = null;
let renderQueue = Promise.resolve();

function getFontDir() {
    const configured = process.env.PLEADING_FONT_DIR;
    if (configured) {
        return path.isAbsolute(configured)
            ? configured
            : path.join(process.cwd(), configured);
    }

    return path.join(__dirname, "..", "assets", "fonts");
}

function toFileUrl(filePath) {
    return `file:///${filePath.replace(/\\/g, "/").replace(/^\//, "")}`;
}

/**
 * Builds @font-face rules for whatever font files are present.
 *
 * Falls back to the system font when the directory is empty. That is correct on
 * Windows (Times New Roman is installed) but NOT on a stock Linux server, where
 * Chrome substitutes a different serif and line wrapping shifts silently.
 */
function buildFontFaceCss() {
    if (fontFaceCss !== null) {
        return fontFaceCss;
    }

    const fontDir = getFontDir();
    const rules = [];

    for (const face of FONT_FACES) {
        const found = face.candidates
            .map((name) => path.join(fontDir, name))
            .find((candidate) => fs.existsSync(candidate));

        if (!found) {
            continue;
        }

        rules.push(
            `@font-face{font-family:"${FONT_FAMILY}";` +
                `src:url("${toFileUrl(found)}") format("truetype");` +
                `font-weight:${face.weight};font-style:${face.style};font-display:block;}`
        );
    }

    if (!rules.length) {
        console.warn(
            `[pdf] No pleading fonts found in ${fontDir} - falling back to the ` +
                "system serif. On Linux this changes line wrapping. Add Times New " +
                "Roman or Tinos TTFs, or set PLEADING_FONT_DIR."
        );
    }

    fontFaceCss = rules.join("");
    return fontFaceCss;
}

function hasEmbeddedFonts() {
    return buildFontFaceCss().length > 0;
}

/**
 * Hidden text in all four faces, so document.fonts.ready actually waits for
 * them. Fonts are only fetched when something on the page uses them.
 */
function buildFontWarmupHtml() {
    const variants = [
        "font-weight:normal;font-style:normal",
        "font-weight:bold;font-style:normal",
        "font-weight:normal;font-style:italic",
        "font-weight:bold;font-style:italic",
    ];

    return (
        '<div aria-hidden="true" style="position:absolute;left:-10000px;top:0;' +
        `visibility:hidden;font-family:'${FONT_FAMILY}';">` +
        variants.map((style) => `<span style="${style}">Mg</span>`).join("") +
        "</div>"
    );
}

function buildBootstrapHtml() {
    return (
        '<!doctype html><html><head><meta charset="utf-8">' +
        // innerHTML never executes scripts, but block them at the page level too.
        '<meta http-equiv="Content-Security-Policy" ' +
        "content=\"script-src 'none'; object-src 'none'; base-uri 'none'\">" +
        `<style>${buildFontFaceCss()}html,body{margin:0;padding:0;background:#fff;}</style>` +
        "</head><body>" +
        buildFontWarmupHtml() +
        `<div id="${CONTENT_ID}"></div>` +
        "</body></html>"
    );
}

async function getBrowser() {
    if (!browserPromise) {
        browserPromise = puppeteer
            .launch({
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--allow-file-access-from-files",
                    "--font-render-hinting=none",
                ],
            })
            .catch((error) => {
                // Do not cache a failed launch, or every later request inherits it.
                browserPromise = null;
                throw error;
            });
    }

    return browserPromise;
}

async function createPage() {
    const browser = await getBrowser();
    const page = await browser.newPage();

    // The HTML comes from a student's contenteditable, so it must not be able
    // to make the server fetch anything on its behalf.
    await page.setRequestInterception(true);
    page.on("request", (request) => {
        const url = request.url();
        if (url.startsWith("file://") || url.startsWith("data:")) {
            request.continue();
            return;
        }
        request.abort();
    });

    bootstrapDir = fs.mkdtempSync(path.join(os.tmpdir(), "pleading-pdf-"));
    const bootstrapPath = path.join(bootstrapDir, "bootstrap.html");
    fs.writeFileSync(bootstrapPath, buildBootstrapHtml(), "utf8");

    await page.goto(toFileUrl(bootstrapPath), { waitUntil: "load" });

    if (hasEmbeddedFonts()) {
        await page.evaluate(() => document.fonts.ready);
    }

    return page;
}

async function getPage() {
    if (!pagePromise) {
        pagePromise = createPage().catch((error) => {
            pagePromise = null;
            throw error;
        });
    }

    const page = await pagePromise;

    // Recover if the tab died between renders.
    if (page.isClosed()) {
        pagePromise = null;
        return getPage();
    }

    return page;
}

async function renderOnWarmPage(bodyHtml) {
    const page = await getPage();

    try {
        await page.evaluate(
            (html, contentId) => {
                document.getElementById(contentId).innerHTML = html;
            },
            bodyHtml,
            CONTENT_ID
        );

        return await page.pdf({
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });
    } finally {
        await page
            .evaluate((contentId) => {
                document.getElementById(contentId).innerHTML = "";
            }, CONTENT_ID)
            .catch(() => {});
    }
}

async function renderPleadingPdf(bodyHtml) {
    if (!bodyHtml || !String(bodyHtml).trim()) {
        throw new Error("No pleading content to render");
    }

    // Serialise: every render shares the one warm page.
    const result = renderQueue.then(
        () => renderOnWarmPage(bodyHtml),
        () => renderOnWarmPage(bodyHtml)
    );

    renderQueue = result.catch(() => {});
    return result;
}

async function closeBrowser() {
    const pendingPage = pagePromise;
    const pendingBrowser = browserPromise;
    pagePromise = null;
    browserPromise = null;

    try {
        if (pendingPage) {
            const page = await pendingPage;
            await page.close();
        }
    } catch (error) {
        // Already gone.
    }

    try {
        if (pendingBrowser) {
            const browser = await pendingBrowser;
            await browser.close();
        }
    } catch (error) {
        // Already gone, or never launched.
    }

    if (bootstrapDir) {
        fs.rmSync(bootstrapDir, { recursive: true, force: true });
        bootstrapDir = null;
    }
}

/**
 * Stand-in for a real pleading page.
 *
 * Chrome pays a one-off ~4.5s initialising paged media the first time it
 * prints a document with a custom @page size, CSS counters and a sized page
 * box. A trivial div does NOT trigger it, so the warm-up has to mirror the
 * real export root closely enough to hit the same paths.
 */
function buildWarmupHtml() {
    const lineNumbers = Array.from({ length: 28 }, (_, i) => `<li>${i + 1}</li>`).join("");

    return (
        "<style>@page{size:letter portrait;margin:0;}" +
        ".warm-page{width:8.5in;height:11in;box-sizing:border-box;display:flex;" +
        "flex-direction:column;page-break-after:always;" +
        `font-family:"${FONT_FAMILY}";font-size:12pt;}` +
        ".warm-block{flex:0 0 auto;display:grid;grid-template-columns:0.35in 6in minmax(0,1fr);}" +
        ".warm-numbers{margin:0;padding:0;list-style:none;text-align:right;}" +
        ".warm-rule{position:relative;background:linear-gradient(to right,#b8b2a8 0,#b8b2a8 1px," +
        "transparent 1px,transparent 4px,#b8b2a8 4px,#b8b2a8 6px);}" +
        ".warm-list li{list-style-type:none;counter-increment:warm-0;}" +
        '.warm-list li::before{content:counter(warm-0,decimal) ". ";}' +
        "</style>" +
        '<div class="warm-page"><div class="warm-block">' +
        `<ol class="warm-numbers">${lineNumbers}</ol>` +
        '<div class="warm-rule">' +
        "<p>Mg</p><p><strong>Mg</strong></p><p><em>Mg</em></p>" +
        "<p><strong><em>Mg</em></strong></p>" +
        '<ol class="warm-list"><li>Mg</li><li>Mg</li></ol>' +
        "<ul><li>Mg</li></ul>" +
        "</div><div></div></div></div>"
    );
}

/**
 * Launches Chrome, loads the fonts, and renders one representative PDF ahead of
 * the first request, so no student pays the cold start.
 */
async function warmUp() {
    try {
        await renderPleadingPdf(buildWarmupHtml());
        return true;
    } catch (error) {
        console.error("[pdf] warm-up failed:", error.message);
        return false;
    }
}

module.exports = {
    renderPleadingPdf,
    warmUp,
    closeBrowser,
    hasEmbeddedFonts,
    getFontDir,
};
