const noteToolbar = document.getElementById("noteToolbar");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const submitMemoBtn = document.getElementById("submitMemoBtn");
const memoSubmitStatus = document.getElementById("memoSubmitStatus");
const submitConfirmOverlay = document.getElementById("submitConfirmOverlay");
const submitConfirmCancel = document.getElementById("submitConfirmCancel");
const submitConfirmAccept = document.getElementById("submitConfirmAccept");
const submitCompleteOverlay = document.getElementById("submitCompleteOverlay");
const submitCompleteBack = document.getElementById("submitCompleteBack");
const submitCompleteContinue = document.getElementById("submitCompleteContinue");
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
// Mirrors assignments.submitted_at / questionnaire_completed_at on the server,
// which is the only durable record of how far through the assignment they are.
let assignmentState = "writing";
let lastPointer = {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2),
};

function setSaveStatus(_text) {
    // Autosave / load status stays quiet; busy work uses setBusyStatus.
}

// The download control is commented out of app.html, so every export button
// touch has to tolerate a missing element.
function setExportPdfDisabled(disabled) {
    if (exportPdfBtn) {
        exportPdfBtn.disabled = disabled;
    }
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
    return text.slice(0, 40) || `${config.memoId} draft`;
}

async function saveCurrentNote() {
    if (isWritingLocked()) {
        return;
    }

    const payload = {
        participantID: config.participantID,
        // The API and the assignment_id database column still use the old
        // name; only the participant-facing vocabulary moved to "memo".
        assignmentId: config.memoId,
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

    if (response.status === 409) {
        // Submitted elsewhere while this tab was open. Stop trying to save.
        const result = await response.json().catch(() => ({}));
        applyAssignmentState(result.state || "questionnaire");
        setSaveStatus("Submitted");
        return;
    }

    if (!response.ok) {
        setSaveStatus("Save failed");
        return;
    }

    await response.json();
    setSaveStatus("Saved");
}

function scheduleSave() {
    if (isInitializing || isWritingLocked()) return;
    // Catches changes with no keystroke behind them: pastes, toolbar
    // formatting, and list operations.
    window.markEditorDirty?.();
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
    const title = getPlainText().slice(0, 40).trim() || config.memoTitle || config.memoId;
    return title.replace(/[^\w\- ]/g, "").trim() || "memo";
}

const SUBMIT_STATUS_TEXT = {
    writing: "Not submitted",
    questionnaire: "Submitted",
    complete: "Complete",
};

function isWritingLocked() {
    return assignmentState !== "writing";
}

/**
 * Makes the writing permanently read-only.
 *
 * The server refuses edits once submitted_at is set; this keeps the interface
 * honest so nobody types into a draft that can no longer be saved.
 */
function lockWriting() {
    clearTimeout(saveTimer);

    noteEditorEl?.setAttribute("contenteditable", "false");
    document.body.classList.add("is-writing-locked");

    noteToolbar?.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
    });

    if (submitMemoBtn) {
        submitMemoBtn.disabled = true;
    }
}

function applyAssignmentState(state) {
    assignmentState = SUBMIT_STATUS_TEXT[state] ? state : "writing";

    if (memoSubmitStatus) {
        memoSubmitStatus.textContent = SUBMIT_STATUS_TEXT[assignmentState];
        memoSubmitStatus.parentElement?.classList.toggle(
            "is-submitted",
            isWritingLocked()
        );
    }

    if (isWritingLocked()) {
        lockWriting();
    }
}

function openSubmitConfirm() {
    if (!submitConfirmOverlay) {
        return;
    }

    submitConfirmOverlay.hidden = false;
    document.body.classList.add("is-submit-complete");
    submitConfirmAccept?.focus();
}

function closeSubmitConfirm() {
    if (!submitConfirmOverlay) {
        return;
    }

    submitConfirmOverlay.hidden = true;
    document.body.classList.remove("is-submit-complete");
    submitMemoBtn?.focus();
}

function openSubmitComplete() {
    if (!submitCompleteOverlay) {
        return;
    }

    submitCompleteOverlay.hidden = false;
    document.body.classList.add("is-submit-complete");
    submitCompleteContinue?.focus();
}

function closeSubmitComplete() {
    if (!submitCompleteOverlay) {
        return;
    }

    submitCompleteOverlay.hidden = true;
    document.body.classList.remove("is-submit-complete");
}

function continueToQuestionnaire() {
    logEvent({
        eventType: "qualtrics_continue",
        elementName: "Continue to Questionnaire",
        page: "assignment",
        eventProps: { memoId: config.memoId },
    });
    // The server owns the Qualtrics address and stamps the completion when the
    // survey redirects back.
    window.location.assign(config.questionnaireUrl);
}

/**
 * Runs instrumentation without letting it break the action it records.
 *
 * Submit and export previously called logEvent/captureEditorSnapshot outside
 * their try block, so a throw there aborted the whole handler before any
 * request was made - silently, since the click handlers did not catch.
 */
function recordQuietly(record) {
    try {
        record();
    } catch (error) {
        console.error("Instrumentation error:", error);
    }
}

/**
 * Asks before anything is sent. Submission is the point of no return, so the
 * confirmation has to come first rather than after the upload.
 */
function requestSubmit() {
    if (!pleadingEditor || isWritingLocked() || submitMemoBtn?.disabled) {
        return;
    }

    if (!getPlainText()) {
        alert("Your memo is empty. Add text before submitting.");
        return;
    }

    logEvent({
        eventType: "submit_confirm_open",
        elementName: "Submit Memo",
        page: "assignment",
        eventProps: { memoId: config.memoId },
    });

    openSubmitConfirm();
}

async function submitMemo() {
    if (!pleadingEditor || isWritingLocked()) {
        return;
    }

    const plainText = getPlainText();
    if (!plainText) {
        alert("Your memo is empty. Add text before submitting.");
        return;
    }

    recordQuietly(() => {
        logEvent({
            eventType: "submit",
            elementName: "Submit Memo",
            page: "assignment",
            valueNum: plainText.length,
            eventProps: { format: "pdf", charCount: plainText.length },
        });

        // Pin the exact text that was submitted, independent of the 30s cadence.
        window.captureEditorSnapshot?.("submit", { force: true });
    });

    try {
        // Inside the try so a failure here cannot leave the button permanently
        // disabled, which would make every later click a silent no-op.
        submitMemoBtn.disabled = true;
        setExportPdfDisabled(true);
        await beginNotesBusy("Please wait for submission confirmation…");

        const [, pdfBlob] = await Promise.all([
            saveCurrentNote(),
            getOrBuildPdfBlob(),
        ]);

        const formData = new FormData();
        formData.append("pdf", pdfBlob, `${getSafeExportBasename()}.pdf`);
        formData.append("participantID", config.participantID);
        // Wire field name is unchanged; see saveCurrentNote.
        formData.append("assignmentId", config.memoId);
        formData.append("sessionID", config.sessionID);
        formData.append("systemID", config.systemID);
        formData.append("title", getNoteTitle());

        const response = await fetch("/api/assignments/submit", {
            method: "POST",
            body: formData,
        });

        const result = await response.json().catch(() => ({}));

        // Already submitted in another tab or sitting: show them where they
        // actually are rather than an error about a memo that did go in.
        if (response.status === 409) {
            applyAssignmentState(result.state || "questionnaire");
            openSubmitComplete();
            return;
        }

        if (!response.ok) {
            throw new Error(result.error || "Submission failed");
        }

        if (result.warning) {
            console.warn(result.warning);
        }

        applyAssignmentState(result.state || "questionnaire");
        openSubmitComplete();
    } catch (error) {
        console.error("Submission error:", error);
        alert(error.message || "Could not submit memo. Please try again.");
        // Only reopen the editor if the writing is genuinely still unlocked.
        if (!isWritingLocked()) {
            submitMemoBtn.disabled = false;
        }
    } finally {
        setExportPdfDisabled(false);
        endNotesBusy();
    }
}

async function exportNotePdf() {
    if (!pleadingEditor || exportPdfBtn?.disabled) {
        return;
    }

    recordQuietly(() =>
        logEvent({
            eventType: "export_pdf",
            elementName: "Export PDF",
            page: "assignment",
            eventProps: { format: "pdf" },
        })
    );

    try {
        setExportPdfDisabled(true);
        if (submitMemoBtn) {
            submitMemoBtn.disabled = true;
        }
        await beginNotesBusy("Creating your PDF. Please wait…");

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
        setExportPdfDisabled(false);
        if (submitMemoBtn) {
            submitMemoBtn.disabled = false;
        }
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

    // Both handlers are fire-and-forget, so an unhandled rejection would leave
    // the student staring at a button that did nothing. Surface it instead.
    const reportUnexpected = (label) => (error) => {
        console.error(`${label} failed:`, error);
        alert(
            `${label} could not be completed. Please try again.` +
                (error?.message ? `\n\n${error.message}` : "")
        );
        setExportPdfDisabled(false);
        if (submitMemoBtn) {
            submitMemoBtn.disabled = false;
        }
        endNotesBusy();
    };

    exportPdfBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        exportNotePdf().catch(reportUnexpected("PDF export"));
    });

    submitMemoBtn.addEventListener("click", (event) => {
        event.preventDefault();
        requestSubmit();
    });

    submitConfirmCancel?.addEventListener("click", () => {
        logEvent({
            eventType: "submit_confirm_cancel",
            elementName: "Keep Editing",
            page: "assignment",
            eventProps: { memoId: config.memoId },
        });
        closeSubmitConfirm();
    });

    submitConfirmAccept?.addEventListener("click", () => {
        closeSubmitConfirm();
        submitMemo().catch(reportUnexpected("Submission"));
    });

    submitCompleteBack?.addEventListener("click", () => {
        logEvent({
            eventType: "qualtrics_defer",
            elementName: "Questionnaire Later",
            page: "assignment",
            eventProps: { memoId: config.memoId },
        });
        closeSubmitComplete();
    });

    submitCompleteContinue?.addEventListener("click", () => {
        continueToQuestionnaire();
    });

    // Escape backs out of the pre-submit question only. The post-submit screen
    // has its own two choices and nothing behind it to return to.
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || submitConfirmOverlay?.hidden) {
            return;
        }
        event.preventDefault();
        closeSubmitConfirm();
    });
}

// Copy and paste are captured with their text by instrumentation.js, which
// records the content itself rather than only the location.

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

    // split-pane.js changes the editor's available width and asks it to rescale.
    window.pleadingEditor = pleadingEditor;

    bindToolbar();
    setSaveStatus("Loading…");

    const url =
        `/api/assignments/current?participantID=${encodeURIComponent(config.participantID)}` +
        `&assignmentId=${encodeURIComponent(config.memoId)}`;

    try {
        const response = await fetch(url);

        if (response.ok) {
            const note = await response.json();
            setEditorHtml(parseNoteContent(note.content || ""));
            invalidatePdfCache();
            applyAssignmentState(note.state || "writing");
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
        // Baseline revision for this sitting. Deduped server-side, so reopening
        // without editing does not add a row.
        window.captureEditorSnapshot?.("load", { force: true });
    }
}

initNote();


