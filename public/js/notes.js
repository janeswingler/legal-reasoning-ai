const noteToolbar = document.getElementById("noteToolbar");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const submitAssignmentBtn = document.getElementById("submitAssignmentBtn");
const noteEditorEl = document.getElementById("noteEditor");
const pleadingPaperEl = document.getElementById("pleadingPaper");
const pleadingScaleSizerEl = document.getElementById("pleadingScaleSizer");
const pleadingScaleFrameEl = document.getElementById("pleadingScaleFrame");
const pleadingBackdropEl = document.getElementById("pleadingBackdrop");
const pleadingScrollSurfaceEl = document.getElementById("pleadingScrollSurface");

const noteBusyStatus = document.getElementById("noteBusyStatus");
const noteBusyStatusText = document.getElementById("noteBusyStatusText");

const pleadingSpec = PleadingLayoutSpec.default();
let pleadingEditor = null;
let saveTimer = null;
let isInitializing = true;
let cachedPdf = null;
let lastPointer = {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2),
};

function setSaveStatus(_text) {
    // Autosave / load status stays quiet; busy work uses setBusyStatus.
}

function positionBusyNote(clientX, clientY) {
    if (!noteBusyStatus || noteBusyStatus.hidden) {
        return;
    }

    // Anchor on the spinner (left side), roughly where a cursor hotspot would be.
    const hotspotX = 8;
    const hotspotY = 12;
    noteBusyStatus.style.transform = `translate3d(${clientX - hotspotX}px, ${clientY - hotspotY}px, 0)`;
}

function setBusyStatus(text) {
    if (!noteBusyStatus) {
        return;
    }

    const message = String(text || "").trim();
    if (!message) {
        noteBusyStatus.hidden = true;
        if (noteBusyStatusText) {
            noteBusyStatusText.textContent = "";
        }
        noteBusyStatus.style.transform = "";
        return;
    }

    if (noteBusyStatusText) {
        noteBusyStatusText.textContent = message;
    }
    noteBusyStatus.hidden = false;
    positionBusyNote(lastPointer.x, lastPointer.y);
}

document.addEventListener(
    "pointermove",
    (event) => {
        lastPointer = { x: event.clientX, y: event.clientY };
        if (document.body.classList.contains("is-notes-busy")) {
            positionBusyNote(event.clientX, event.clientY);
        }
    },
    { passive: true }
);

function invalidatePdfCache() {
    cachedPdf = null;
}

function getPdfFingerprint() {
    return getEditorHtml();
}

async function getOrBuildPdfBlob() {
    const fingerprint = getPdfFingerprint();
    if (cachedPdf && cachedPdf.fingerprint === fingerprint) {
        return cachedPdf.blob;
    }

    const blob = await buildPleadingPdfBlob({
        spec: pleadingSpec,
        contentHtml: fingerprint,
        pageHtmls: pleadingEditor.getPageHtmls(),
    });

    cachedPdf = { fingerprint, blob };
    return blob;
}

function setNotesBusy(isBusy) {
    document.body.classList.toggle("is-notes-busy", Boolean(isBusy));
    document.body.setAttribute("aria-busy", isBusy ? "true" : "false");
}

/** Let the browser paint the wait cursor / status before heavy PDF work. */
function yieldForBusyPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        });
    });
}

async function beginNotesBusy(message) {
    setBusyStatus(message);
    setNotesBusy(true);
    await yieldForBusyPaint();
}

function endNotesBusy() {
    setNotesBusy(false);
    setBusyStatus("");
}

function normalizeNoteHtml(html) {
    const container = document.createElement("div");
    container.innerHTML = html || "<p><br></p>";

    const blocks = Array.from(container.children);
    if (blocks.length === 0) {
        return "<p><br></p>";
    }

    const hasText = container.textContent.replace(/\u200b/gi, "").trim().length > 0;
    const isEmptyBlock = (el) => {
        const text = el.textContent.replace(/\u200b/gi, "").trim();
        return text === "" && !el.querySelector("img, table, ul, ol");
    };

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
            return normalizeNoteHtml(parsed.pages.join("") || "<p><br></p>");
        }
    } catch (error) {
        // Saved as plain HTML string.
    }

    return normalizeNoteHtml(raw || "<p><br></p>");
}

function getEditorHtml() {
    return pleadingEditor.getHtml();
}

function setEditorHtml(html) {
    pleadingEditor.setHtml(html);
}

function getPlainText() {
    return pleadingEditor.getPlainText();
}

function getNoteTitle() {
    const text = getPlainText();
    return text.slice(0, 40) || `${config.assignmentId} note`;
}

async function saveCurrentNote() {
    const payload = {
        participantID: config.participantID,
        assignmentId: config.assignmentId,
        sessionID: config.sessionID,
        systemID: config.systemID,
        title: getNoteTitle(),
        content: getEditorHtml(),
    };

    const response = await fetch("/api/assignments/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        setSaveStatus("Save failed");
        return;
    }

    await response.json();
    setSaveStatus("Saved");
}

function scheduleSave() {
    if (isInitializing) return;
    invalidatePdfCache();
    clearTimeout(saveTimer);
    setSaveStatus("Saving…");
    saveTimer = setTimeout(saveCurrentNote, 800);
}

function updateToolbarState() {
    noteToolbar.querySelectorAll("[data-command]").forEach((button) => {
        const command = button.dataset.command;
        let active = false;

        try {
            active = document.queryCommandState(command);
        } catch (error) {
            active = false;
        }

        button.classList.toggle("is-active", active);
    });

    const alignment = getActiveAlignment(noteEditorEl);
    noteToolbar.querySelectorAll("[data-align]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.align === alignment);
    });

    noteToolbar.querySelectorAll("[data-indent]").forEach((button) => {
        button.disabled = !canIndent(noteEditorEl, Number(button.dataset.indent));
    });
}

function getSafeExportBasename() {
    const title = getPlainText().slice(0, 40).trim() || config.assignmentTitle || config.assignmentId;
    return title.replace(/[^\w\- ]/g, "").trim() || "assignment";
}

function updateSubmitButtonState(note) {
    if (!submitAssignmentBtn) {
        return;
    }

    if (note?.submittedAt) {
        const submittedDate = new Date(note.submittedAt).toLocaleString();
        submitAssignmentBtn.textContent = "Resubmit";
        submitAssignmentBtn.classList.add("is-submitted");
        submitAssignmentBtn.title = `Last submitted ${submittedDate}. Click to submit again.`;
        return;
    }

    submitAssignmentBtn.textContent = "Submit";
    submitAssignmentBtn.classList.remove("is-submitted");
    submitAssignmentBtn.title = "Submit assignment to Google Drive";
}

async function submitAssignment() {
    if (!pleadingEditor || submitAssignmentBtn.disabled) {
        return;
    }

    const plainText = getPlainText();
    if (!plainText) {
        alert("Your assignment is empty. Add text before submitting.");
        return;
    }

    const isResubmit = submitAssignmentBtn.classList.contains("is-submitted");
    if (isResubmit) {
        const confirmed = window.confirm(
            "Are you sure you want to resubmit?\n\nThis will replace any previously submitted version."
        );
        if (!confirmed) {
            return;
        }
    }

    logSystemInteraction({
        eventType: "click",
        elementName: isResubmit ? "Resubmit Assignment" : "Submit Assignment",
        page: "assignment",
        eventProps: { assignmentId: config.assignmentId, format: "pdf" },
    });

    submitAssignmentBtn.disabled = true;
    exportPdfBtn.disabled = true;
    await beginNotesBusy("Please wait for submission confirmation…");

    try {
        const [, pdfBlob] = await Promise.all([
            saveCurrentNote(),
            getOrBuildPdfBlob(),
        ]);

        const formData = new FormData();
        formData.append("pdf", pdfBlob, `${getSafeExportBasename()}.pdf`);
        formData.append("participantID", config.participantID);
        formData.append("assignmentId", config.assignmentId);
        formData.append("sessionID", config.sessionID);
        formData.append("systemID", config.systemID);
        formData.append("title", getNoteTitle());

        const response = await fetch("/api/assignments/submit", {
            method: "POST",
            body: formData,
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(result.error || "Submission failed");
        }

        updateSubmitButtonState({
            submittedAt: result.submittedAt,
        });

        if (result.warning) {
            alert(
                `Your assignment was saved on the server.\n\n${result.warning}`
            );
            return;
        }

        const destination =
            result.storage === "local" ? "the server" : "Google Drive";
        alert(`Your assignment was submitted successfully to ${destination}.`);
    } catch (error) {
        console.error("Submission error:", error);
        alert(error.message || "Could not submit assignment. Please try again.");
    } finally {
        submitAssignmentBtn.disabled = false;
        exportPdfBtn.disabled = false;
        endNotesBusy();
    }
}

async function exportNotePdf() {
    if (!pleadingEditor || exportPdfBtn.disabled) {
        return;
    }

    logSystemInteraction({
        eventType: "click",
        elementName: "Export PDF",
        page: "assignment",
        eventProps: { assignmentId: config.assignmentId, format: "pdf" },
    });

    exportPdfBtn.disabled = true;
    submitAssignmentBtn.disabled = true;
    await beginNotesBusy("Creating your PDF. Please wait…");

    try {
        const [, pdfBlob] = await Promise.all([
            saveCurrentNote(),
            getOrBuildPdfBlob(),
        ]);

        await exportPleadingPdf({
            basename: getSafeExportBasename(),
            blob: pdfBlob,
        });
    } catch (error) {
        console.error("PDF export error:", error);
        alert(
            error?.message
                ? `Could not create PDF: ${error.message}`
                : "Could not create PDF. Please try again."
        );
    } finally {
        exportPdfBtn.disabled = false;
        submitAssignmentBtn.disabled = false;
        endNotesBusy();
    }
}

/** Keeps focus in the editor so the selection survives the toolbar click. */
function bindToolbarButton(button, handler) {
    button.addEventListener("mousedown", (event) => {
        event.preventDefault();
    });

    button.addEventListener("click", (event) => {
        event.preventDefault();
        handler();
        pleadingEditor.focus();
        updateToolbarState();
        scheduleSave();
    });
}

function bindToolbar() {
    noteToolbar.querySelectorAll("[data-command]").forEach((button) => {
        bindToolbarButton(button, () => {
            const command = button.dataset.command;
            document.execCommand(command, false, null);

            // execCommand only clears inline marks; leaving text centred or
            // indented after "clear formatting" would be surprising.
            if (command === "removeFormat") {
                applyBlockAlignment(noteEditorEl, "left");
                changeBlockIndent(noteEditorEl, -PLEADING_MAX_INDENT);
                pleadingEditor.syncLayout();
            }
        });
    });

    noteToolbar.querySelectorAll("[data-align]").forEach((button) => {
        bindToolbarButton(button, () => {
            applyBlockAlignment(noteEditorEl, button.dataset.align);
        });
    });

    noteToolbar.querySelectorAll("[data-indent]").forEach((button) => {
        bindToolbarButton(button, () => {
            if (changeBlockIndent(noteEditorEl, Number(button.dataset.indent))) {
                // Indent narrows the column, so lines rewrap and the page
                // breaks have to be recomputed.
                pleadingEditor.syncLayout();
            }
        });
    });

    noteToolbar.querySelectorAll("[data-insert]").forEach((button) => {
        bindToolbarButton(button, () => {
            pleadingEditor.focus();
            document.execCommand("insertText", false, button.dataset.insert);
        });
    });

    document.addEventListener("selectionchange", () => {
        if (!noteEditorEl.contains(document.getSelection()?.anchorNode)) {
            return;
        }
        updateToolbarState();
    });

    exportPdfBtn.addEventListener("click", (event) => {
        event.preventDefault();
        exportNotePdf();
    });

    submitAssignmentBtn.addEventListener("click", (event) => {
        event.preventDefault();
        submitAssignment();
    });
}

noteEditorEl.addEventListener("copy", () => {
    logSystemInteraction({
        eventType: "copy",
        elementName: "note-editor",
        page: "assignment",
        eventProps: { assignmentId: config.assignmentId },
    });
});

noteEditorEl.addEventListener("paste", () => {
    logSystemInteraction({
        eventType: "paste",
        elementName: "note-editor",
        page: "assignment",
        eventProps: { assignmentId: config.assignmentId },
    });
});

async function initNote() {
    pleadingEditor = new PleadingEditor({
        spec: pleadingSpec,
        paperEl: pleadingPaperEl,
        scaleSizerEl: pleadingScaleSizerEl,
        scaleFrameEl: pleadingScaleFrameEl,
        backdropEl: pleadingBackdropEl,
        scrollSurfaceEl: pleadingScrollSurfaceEl,
        editorEl: noteEditorEl,
        onChange: scheduleSave,
    });

    bindToolbar();
    setSaveStatus("Loading…");

    const url =
        `/api/assignments/current?participantID=${encodeURIComponent(config.participantID)}` +
        `&assignmentId=${encodeURIComponent(config.assignmentId)}`;

    try {
        const response = await fetch(url);

        if (response.ok) {
            const note = await response.json();
            setEditorHtml(parseNoteContent(note.content || ""));
            invalidatePdfCache();
            updateSubmitButtonState(note);
            setSaveStatus("Loaded");
            return;
        }

        if (response.status === 404) {
            setEditorHtml("<p><br></p>");
            setSaveStatus("New note");
            await saveCurrentNote();
            return;
        }

        setSaveStatus("Load failed");
    } catch (error) {
        setSaveStatus("Load failed");
    } finally {
        isInitializing = false;
    }
}

initNote();


