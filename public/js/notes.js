const exportMenu = document.getElementById("exportMenu");
const exportMenuBtn = document.getElementById("exportMenuBtn");
const exportMenuList = document.getElementById("exportMenuList");
const saveStatusEl = document.getElementById("saveStatus");
const assignmentLabelEl = document.getElementById("assignmentLabel");
const noteEditorEl = document.getElementById("noteEditor");
const pleadingBackdropEl = document.getElementById("pleadingBackdrop");
const pleadingScrollSurfaceEl = document.getElementById("pleadingScrollSurface");
const pleadingPaperEl = document.getElementById("pleadingPaper");

const pleadingSpec = PleadingLayoutSpec.default();
pleadingSpec.applyCssVariables(pleadingPaperEl);

let pleadingEditor = null;

const Font = Quill.import("formats/font");
Font.whitelist = ["times-new-roman"];
Quill.register(Font, true);

const SizeStyle = Quill.import("attributors/style/size");
SizeStyle.whitelist = ["12pt"];
Quill.register(SizeStyle, true);

let saveTimer = null;
let isInitializing = true;
let layoutFrameId = null;

assignmentLabelEl.textContent = config.assignmentId;

const quill = new Quill(noteEditorEl, {
    theme: "snow",
    modules: {
        toolbar: "#noteToolbar",
    },
    placeholder: "",
});

pleadingEditor = new PleadingEditorChrome(pleadingSpec, {
    backdropEl: pleadingBackdropEl,
    scrollSurfaceEl: pleadingScrollSurfaceEl,
    editorEl: quill.root,
});

function setSaveStatus(text) {
    saveStatusEl.textContent = text;
}

function getEditorHtml() {
    return quill.root.innerHTML;
}

function setEditorHtml(html) {
    quill.root.style.minHeight = "";
    pleadingScrollSurfaceEl.style.minHeight = "";
    quill.root.innerHTML = html || "<p><br></p>";
    quill.format("font", "times-new-roman", "silent");
    quill.format("size", "12pt", "silent");
    schedulePleadingLayout();
}

function isEmptyBlock(el) {
    const text = el.textContent.replace(/\u200b/gi, "").trim();
    return text === "" && !el.querySelector("img, table, ul, ol");
}

function normalizePleadingHtml(html) {
    const container = document.createElement("div");
    container.innerHTML = html || "<p><br></p>";

    const blocks = Array.from(container.children);
    if (blocks.length === 0) {
        return "<p><br></p>";
    }

    const hasText = container.textContent.replace(/\u200b/gi, "").trim().length > 0;
    if (!hasText && blocks.every(isEmptyBlock)) {
        return "<p><br></p>";
    }

    return container.innerHTML;
}

function parseNoteContent(raw) {
    if (!raw) {
        return "<p><br></p>";
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed.format === "pleading-pages-v1" && Array.isArray(parsed.pages)) {
            return normalizePleadingHtml(parsed.pages.join("") || "<p><br></p>");
        }
    } catch (error) {
        // Saved as plain HTML string.
    }

    return normalizePleadingHtml(raw || "<p><br></p>");
}

function getPlainText() {
    return quill.getText().trim();
}

function hasNoteContent() {
    if (getPlainText().length > 0) {
        return true;
    }

    return quill.getLength() > 1;
}

function getNoteTitle() {
    const text = getPlainText();
    return text.slice(0, 40) || `${config.assignmentId} note`;
}

function getSafeExportBasename() {
    return getNoteTitle().replace(/[^\w\- ]/g, "").trim() || "note";
}

function requireNoteContent() {
    return true;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

function logExport(eventName, format) {
    logSystemInteraction({
        eventType: "click",
        elementName: eventName,
        page: "notes",
        eventProps: { assignmentId: config.assignmentId, format },
    });
}

function createPleadingDocument() {
    return new PleadingDocument(pleadingSpec, getEditorHtml());
}

function updatePleadingLayout() {
    pleadingEditor.sync();
}

function schedulePleadingLayout() {
    if (layoutFrameId !== null) {
        return;
    }

    layoutFrameId = window.requestAnimationFrame(() => {
        layoutFrameId = null;
        updatePleadingLayout();
    });
}

function exportNoteHtml() {
    if (!requireNoteContent()) return;

    logExport("Export HTML", "html");
    downloadBlob(
        new Blob([createPleadingDocument().toHtmlDocument()], { type: "text/html" }),
        `${getSafeExportBasename()}.html`
    );
}

function getPdfExportLibs() {
    const html2canvasFn = window.html2canvas;
    const jsPDF =
        window.jspdf?.jsPDF ||
        window.jsPDF ||
        (typeof window.jspdf === "function" ? window.jspdf : null);

    return { html2canvasFn, jsPDF };
}

async function exportNotePdf() {
    if (!requireNoteContent()) return;

    const { html2canvasFn, jsPDF: JsPDF } = getPdfExportLibs();
    if (typeof html2canvasFn !== "function" || typeof JsPDF !== "function") {
        alert("PDF export is unavailable right now.");
        return;
    }

    logExport("Export PDF", "pdf");
    setSaveStatus("Creating PDF…");

    const pleadingDoc = createPleadingDocument();
    const exportRoot = pleadingDoc.renderExportRoot();
    document.body.appendChild(exportRoot);

    try {
        await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });

        const pageEls = exportRoot.querySelectorAll(".pleading-export-page");
        const pdf = new JsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
        const pageWidthPt = pdf.internal.pageSize.getWidth();
        const pageHeightPt = pdf.internal.pageSize.getHeight();
        const pageWidthPx = pleadingSpec.getLetterWidthPx();
        const pageHeightPx = pleadingSpec.getLetterHeightPx();

        pageEls.forEach((pageEl) => {
            pageEl.style.width = `${pageWidthPx}px`;
            pageEl.style.height = `${pageHeightPx}px`;
        });

        await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });

        for (let index = 0; index < pageEls.length; index += 1) {
            if (index > 0) {
                pdf.addPage();
            }

            const canvas = await html2canvasFn(pageEls[index], {
                scale: 2,
                backgroundColor: "#ffffff",
                logging: false,
                useCORS: true,
            });

            pdf.addImage(
                canvas.toDataURL("image/jpeg", 0.92),
                "JPEG",
                0,
                0,
                pageWidthPt,
                pageHeightPt
            );
        }

        pdf.save(`${getSafeExportBasename().replace(/\s+/g, "-")}.pdf`);
        setSaveStatus("PDF downloaded");
    } catch (error) {
        console.error("PDF export error:", error);
        alert("Could not create PDF.");
        setSaveStatus("PDF export failed");
    } finally {
        exportRoot.remove();
    }
}

function exportNoteDocx() {
    if (!requireNoteContent()) return;

    if (typeof htmlDocx === "undefined") {
        alert("Word export is unavailable right now. Try HTML export instead.");
        return;
    }

    logExport("Export DOCX", "docx");

    try {
        const blob = htmlDocx.asBlob(createPleadingDocument().toHtmlDocument());
        downloadBlob(blob, `${getSafeExportBasename()}.docx`);
    } catch (error) {
        alert("Could not create Word document. Try HTML export instead.");
    }
}

function setExportMenuOpen(isOpen) {
    exportMenuBtn.setAttribute("aria-expanded", String(isOpen));
    exportMenuList.hidden = !isOpen;
}

function toggleExportMenu() {
    setExportMenuOpen(exportMenuList.hidden);
}

function closeExportMenu() {
    setExportMenuOpen(false);
}

function handleExportChoice(format) {
    closeExportMenu();

    if (format === "html") {
        exportNoteHtml();
        return;
    }

    if (format === "pdf") {
        exportNotePdf();
        return;
    }

    if (format === "docx") {
        exportNoteDocx();
    }
}

async function loadTemplateHtml() {
    const assignmentUrl = `./assets/${config.assignmentId}.html`;
    let response = await fetch(assignmentUrl);

    if (!response.ok) {
        response = await fetch("./assets/default.html");
    }

    if (!response.ok) {
        throw new Error("Could not load template");
    }

    return response.text();
}

async function saveCurrentNote() {
    const payload = {
        participantID: config.participantID,
        assignmentId: config.assignmentId,
        sessionID: config.sessionID,
        systemID: config.systemID,
        noteType: "pleading",
        title: getNoteTitle(),
        content: getEditorHtml(),
    };

    const response = await fetch("/api/notes/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        setSaveStatus("Save failed");
        return;
    }

    const saved = await response.json();
    setSaveStatus(`Saved (v${saved.version})`);
}

function scheduleSave() {
    if (isInitializing) return;
    clearTimeout(saveTimer);
    setSaveStatus("Saving…");
    saveTimer = setTimeout(saveCurrentNote, 800);
}

quill.on("text-change", (_delta, _oldDelta, source) => {
    if (source === "silent" || isInitializing) {
        return;
    }
    scheduleSave();
    schedulePleadingLayout();
});

quill.on("selection-change", (range) => {
    if (range && range.length > 0) {
        logSystemInteraction({
            eventType: "quill-highlight",
            elementName: "note-editor",
            page: "notes",
            eventProps: { assignmentId: config.assignmentId },
        });
    }
});

quill.root.addEventListener("paste", () => {
    logSystemInteraction({
        eventType: "paste",
        elementName: "note-editor",
        page: "notes",
        eventProps: { assignmentId: config.assignmentId },
    });
    schedulePleadingLayout();
});

quill.root.addEventListener("copy", () => {
    logSystemInteraction({
        eventType: "copy",
        elementName: "note-editor",
        page: "notes",
        eventProps: { assignmentId: config.assignmentId },
    });
});

async function initNote() {
    setSaveStatus("Loading…");

    const url =
        `/api/notes/current?participantID=${encodeURIComponent(config.participantID)}` +
        `&assignmentId=${encodeURIComponent(config.assignmentId)}`;

    try {
        const response = await fetch(url);

        if (response.ok) {
            const note = await response.json();
            const rawContent = note.content || "";
            const html = parseNoteContent(rawContent);
            setEditorHtml(html);
            setSaveStatus(`Loaded (v${note.version})`);
            if (html !== rawContent) {
                await saveCurrentNote();
            }
            return;
        }

        if (response.status === 404) {
            const html = await loadTemplateHtml();
            setEditorHtml(html);
            setSaveStatus("New document");
            await saveCurrentNote();
            return;
        }

        setSaveStatus("Load failed");
    } catch (error) {
        setSaveStatus("Load failed");
    } finally {
        isInitializing = false;
        updatePleadingLayout();
    }
}

exportMenuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleExportMenu();
});

exportMenuList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-export]");
    if (!item) return;
    handleExportChoice(item.dataset.export);
});

document.addEventListener("click", (event) => {
    if (!exportMenu.contains(event.target)) {
        closeExportMenu();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeExportMenu();
    }
});

window.addEventListener("resize", schedulePleadingLayout);

initNote();
