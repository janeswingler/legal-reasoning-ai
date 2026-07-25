function getPdfExportLibs() {
    const html2canvasFn = window.html2canvas;
    const jsPDF =
        window.jspdf?.jsPDF ||
        window.jsPDF ||
        (typeof window.jspdf === "function" ? window.jspdf : null);

    return { html2canvasFn, jsPDF };
}

function waitForLayoutFrames(count = 2) {
    return new Promise((resolve) => {
        let remaining = count;
        const step = () => {
            remaining -= 1;
            if (remaining <= 0) {
                resolve();
                return;
            }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}

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

function canvasToJpegDataUrl(canvas, quality = 0.85) {
    return canvas.toDataURL("image/jpeg", quality);
}

async function buildPleadingPdfDocument({ spec, contentHtml, pageHtmls = null }) {
    const { html2canvasFn, jsPDF: JsPDF } = getPdfExportLibs();
    if (typeof html2canvasFn !== "function" || typeof JsPDF !== "function") {
        throw new Error("PDF export libraries are unavailable");
    }

    const pleadingDoc = new PleadingDocument(spec, contentHtml, { pageHtmls });
    const exportRoot = pleadingDoc.renderExportRoot();
    exportRoot.style.cssText =
        "position:fixed;left:-10000px;top:0;pointer-events:none;";
    document.body.appendChild(exportRoot);

    try {
        await waitForLayoutFrames();

        const pageEls = exportRoot.querySelectorAll(".pleading-export-page");
        if (!pageEls.length) {
            throw new Error("No pages available to export");
        }

        const pdf = new JsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
        const pageWidthPt = pdf.internal.pageSize.getWidth();
        const pageHeightPt = pdf.internal.pageSize.getHeight();
        const pageWidthPx = spec.getLetterWidthPx();
        const pageHeightPx = spec.getLetterHeightPx();

        pageEls.forEach((pageEl) => {
            pageEl.style.width = `${pageWidthPx}px`;
            pageEl.style.height = `${pageHeightPx}px`;
        });

        await waitForLayoutFrames();

        for (let index = 0; index < pageEls.length; index += 1) {
            if (index > 0) {
                pdf.addPage();
            }

            // scale 1.5 keeps text sharp enough for grading while cutting ~44% of pixels vs 2x
            const canvas = await html2canvasFn(pageEls[index], {
                scale: 1.5,
                backgroundColor: "#ffffff",
                logging: false,
                useCORS: true,
            });

            pdf.addImage(
                canvasToJpegDataUrl(canvas, 0.85),
                "JPEG",
                0,
                0,
                pageWidthPt,
                pageHeightPt
            );
        }

        return pdf;
    } finally {
        exportRoot.remove();
    }
}

async function buildPleadingPdfBlob({ spec, contentHtml, pageHtmls = null }) {
    const pdf = await buildPleadingPdfDocument({ spec, contentHtml, pageHtmls });
    return pdf.output("blob");
}

async function exportPleadingPdf({ spec, contentHtml, pageHtmls = null, basename, blob = null }) {
    const filename = `${getSafePdfBasename(basename)}.pdf`;
    const pdfBlob =
        blob ||
        (await buildPleadingPdfBlob({ spec, contentHtml, pageHtmls }));

    triggerBrowserDownload(pdfBlob, filename);
}
