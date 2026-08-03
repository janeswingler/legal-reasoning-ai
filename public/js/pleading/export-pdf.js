function getSafePdfBasename(basename) {
    const safeName =
        (basename || "assignment").replace(/[^\w\- ]/g, "").trim() || "assignment";
    return safeName.replace(/\s+/g, "-");
}

function triggerBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
    }, 2000);
}

/**
 * Builds the pleading PDF server-side.
 *
 * The export root is serialised and sent to headless Chrome, which lays it out
 * with the same engine that renders the editor. Nothing is rasterised here, so
 * the main thread never blocks and the PDF keeps real, selectable text.
 */
async function buildPleadingPdfBlob({ spec, contentHtml, pageHtmls = null }) {
    const pleadingDoc = new PleadingDocument(spec, contentHtml, { pageHtmls });

    // Never attached to the document - serialising it avoids an offscreen reflow.
    const exportRoot = pleadingDoc.renderExportRoot();

    const response = await fetch("/api/assignments/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: exportRoot.outerHTML }),
    });

    if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || "Could not create PDF");
    }

    return await response.blob();
}

async function exportPleadingPdf({ spec, contentHtml, pageHtmls = null, basename, blob = null }) {
    const filename = `${getSafePdfBasename(basename)}.pdf`;
    const pdfBlob =
        blob ||
        (await buildPleadingPdfBlob({ spec, contentHtml, pageHtmls }));

    triggerBrowserDownload(pdfBlob, filename);
}
