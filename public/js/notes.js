const exportMenu = document.getElementById("exportMenu");
const exportMenuBtn = document.getElementById("exportMenuBtn");
const exportMenuList = document.getElementById("exportMenuList");
const saveStatusEl = document.getElementById("saveStatus");
const assignmentLabelEl = document.getElementById("assignmentLabel");
const pleadingLineNumbersEl = document.getElementById("pleadingLineNumbers");

const PLEADING_LINE_HEIGHT = 32;
const MIN_PLEADING_LINES = 28;

const Font = Quill.import("formats/font");
Font.whitelist = ["times-new-roman", "arial", "courier"];
Quill.register(Font, true);

const SizeStyle = Quill.import("attributors/style/size");
SizeStyle.whitelist = ["10pt", "12pt", "14pt"];
Quill.register(SizeStyle, true);

let saveTimer = null;
let lineNumberTimer = null;
let isInitializing = true;

const pleadingQuill = new Quill("#pleadingEditor", {
    theme: "snow",
    modules: {
        toolbar: "#pleadingToolbar",
    },
    placeholder: "",
});

function updateLineNumbers() {
    const editor = pleadingQuill.root;
    const lineCount = Math.max(
        MIN_PLEADING_LINES,
        Math.ceil(editor.scrollHeight / PLEADING_LINE_HEIGHT)
    );

    pleadingLineNumbersEl.innerHTML = "";
    for (let i = 1; i <= lineCount; i++) {
        const li = document.createElement("li");
        li.textContent = String(i);
        pleadingLineNumbersEl.appendChild(li);
    }
}

function scheduleLineNumberUpdate() {
    clearTimeout(lineNumberTimer);
    lineNumberTimer = setTimeout(updateLineNumbers, 50);
}

assignmentLabelEl.textContent = config.assignmentId;

function setSaveStatus(text) {
    saveStatusEl.textContent = text;
}

function getNoteContent() {
    return pleadingQuill.root.innerHTML;
}

function trimLeadingEmptyParagraphs(html) {
    const div = document.createElement("div");
    div.innerHTML = html;

    while (div.firstElementChild) {
        const first = div.firstElementChild;
        const isEmptyParagraph =
            first.tagName === "P" &&
            !first.textContent.trim() &&
            (first.innerHTML === "<br>" || first.innerHTML === "");

        if (!isEmptyParagraph) break;
        if (div.children.length === 1) break;
        first.remove();
    }

    return div.innerHTML || "<p><br></p>";
}

function setNoteContent(content) {
    pleadingQuill.root.innerHTML = trimLeadingEmptyParagraphs(content || "<p><br></p>");
    scheduleLineNumberUpdate();
}

function getNoteTitle() {
    const text = pleadingQuill.getText().trim();
    return text.slice(0, 40) || `${config.assignmentId} note`;
}

function getSafeExportBasename() {
    return getNoteTitle().replace(/[^\w\- ]/g, "").trim() || "note";
}

function hasNoteContent() {
    return Boolean(pleadingQuill.getText().trim());
}

function requireNoteContent() {
    if (hasNoteContent()) return true;
    alert("Nothing to export");
    return false;
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

function prepareHtmlForDocx(html) {
    const container = document.createElement("div");
    container.innerHTML = html;

    const fontMap = {
        "ql-font-times-new-roman": '"Times New Roman", Times, serif',
        "ql-font-arial": "Arial, Helvetica, sans-serif",
        "ql-font-courier": '"Courier New", Courier, monospace',
    };

    container.querySelectorAll("[class*='ql-font-']").forEach((el) => {
        for (const cls of el.classList) {
            if (fontMap[cls]) {
                el.style.fontFamily = fontMap[cls];
            }
        }
    });

    container.querySelectorAll("p, li").forEach((el) => {
        el.style.margin = "0";
        el.style.lineHeight = "1.33";
        if (!el.style.fontFamily) {
            el.style.fontFamily = '"Times New Roman", Times, serif';
        }
    });

    return container.innerHTML;
}

function exportNoteHtml() {
    if (!requireNoteContent()) return;

    logExport("Export HTML", "html");
    downloadBlob(
        new Blob([getNoteContent()], { type: "text/html" }),
        `${getSafeExportBasename()}.html`
    );
}

function exportNotePdf() {
    if (!requireNoteContent()) return;

    logExport("Export Print PDF", "pdf");
    window.print();
}

function exportNoteDocx() {
    if (!requireNoteContent()) return;

    if (typeof htmlDocx === "undefined") {
        alert("Word export is unavailable right now. Try HTML export instead.");
        return;
    }

    logExport("Export DOCX", "docx");

    const bodyHtml = prepareHtmlForDocx(getNoteContent());
    const documentHtml =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        bodyHtml +
        "</body></html>";

    try {
        const blob = htmlDocx.asBlob(documentHtml);
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
        content: getNoteContent(),
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

async function initNote() {
    setSaveStatus("Loading…");

    const url =
        `/api/notes/current?participantID=${encodeURIComponent(config.participantID)}` +
        `&assignmentId=${encodeURIComponent(config.assignmentId)}`;

    try {
        const response = await fetch(url);

        if (response.ok) {
            const note = await response.json();
            setNoteContent(note.content || "");
            setSaveStatus(`Loaded (v${note.version})`);
            return;
        }

        if (response.status === 404) {
            const html = await loadTemplateHtml();
            setNoteContent(html);
            setSaveStatus("New document");
            await saveCurrentNote();
            return;
        }

        setSaveStatus("Load failed");
    } catch (error) {
        setSaveStatus("Load failed");
    } finally {
        isInitializing = false;
        updateLineNumbers();
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

initNote();

pleadingQuill.on("text-change", () => {
    scheduleSave();
    scheduleLineNumberUpdate();
});

updateLineNumbers();

pleadingQuill.on("selection-change", (range) => {
    if (range && range.length > 0) {
        logSystemInteraction({
            eventType: "quill-highlight",
            elementName: "pleading-editor",
            page: "notes",
            eventProps: { assignmentId: config.assignmentId },
        });
    }
});

pleadingQuill.root.addEventListener("paste", () => {
    logSystemInteraction({
        eventType: "paste",
        elementName: "pleading-editor",
        page: "notes",
        eventProps: { assignmentId: config.assignmentId },
    });
});

pleadingQuill.root.addEventListener("copy", () => {
    logSystemInteraction({
        eventType: "copy",
        elementName: "pleading-editor",
        page: "notes",
        eventProps: { assignmentId: config.assignmentId },
    });
});
