const panelNotes = document.querySelector(".panel-notes"); // whole notes section, toggle is-pleading here
const notesEditor = document.getElementById("notesEditor"); // general note textarea
const pleadingBody = document.getElementById("pleadingBody"); // editable pleading area

const newNoteBtn = document.getElementById("newNoteBtn");
const newPleadingBtn = document.getElementById("newPleadingBtn");

const saveNoteBtn = document.getElementById("saveNoteBtn");
const openNoteBtn = document.getElementById("openNoteBtn");

const exportNoteBtn = document.getElementById("exportNoteBtn");



let currentNoteId = null;

const PARTICIPANT_ID = "demo-participant";
const SESSION_ID = "demo-session";
const SYSTEM_ID = "legal-reasoning-ai-v1";

function showPlainNote() {
    panelNotes.classList.remove("is-pleading");
    notesEditor.focus();
}

function showPleadingNote() {
    panelNotes.classList.add("is-pleading");
    pleadingBody.focus();
}

newNoteBtn.addEventListener("click", () => {
    logSystemInteraction({ eventType: "click", elementName: "New Note Button", page: "notes" });
    clearNote();
    showPlainNote();
});


newPleadingBtn.addEventListener("click", () => {
    logSystemInteraction({ eventType: "click", elementName: "New Pleading Note Button", page: "notes" });
    clearNote();
    showPleadingNote();
});

function isPleadingMode() {
    return panelNotes.classList.contains("is-pleading");
}

function getNoteContent() {
    return isPleadingMode() ? pleadingBody.innerHTML : notesEditor.value;
}

function setNoteContent(content) {
    notesEditor.value = content;
    pleadingBody.innerHTML = content;
}

function getNoteTitle() {
    const text = getNoteContent().replace(/<[^>]+>/g, "").trim();
    return text.slice(0, 40) || "Untitled";
}

function getNoteContentAsText() {
    const content = getNoteContent();
    const temp = document.createElement("div");
    temp.innerHTML = content;
    return temp.textContent || temp.innerText || "";
}

function clearNote() {
    currentNoteId = null;
    notesEditor.value = "";
    pleadingBody.innerHTML = "";
}

async function saveNote() {
    
    logSystemInteraction({
        eventType: "click",
        elementName: "Save Button",
        page: "notes",
        eventProps: { noteType: isPleadingMode() ? "pleading" : "plain" },
    });

    const payload = {
        participantID: PARTICIPANT_ID,
        sessionID: SESSION_ID,
        systemID: SYSTEM_ID,
        noteType: isPleadingMode() ? "pleading" : "plain",
        title: getNoteTitle(),
        content: getNoteContent(),
    };

    const url = currentNoteId ? `/api/notes/${currentNoteId}` : "/api/notes";
    const method = currentNoteId ? "PUT" : "POST";

    const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        alert("Save failed");
        return;
    }

    const saved = await response.json();
    currentNoteId = saved._id;
    alert(`Saved (v${saved.version})`);
}

async function openNote() {

    logSystemInteraction({ eventType: "click", elementName: "Open Button", page: "notes" });

    const response = await fetch(
        `/api/notes?participantID=${encodeURIComponent(PARTICIPANT_ID)}`
    );

    if (!response.ok) {
        alert("Could not load notes");
        return;
    }

    const notes = await response.json();

    if (notes.length === 0) {
        alert("No saved notes yet");
        return;
    }

    const listText = notes
        .map((note, index) => {
            const title = note.title || "Untitled";
            return `${index + 1}. ${title} (${note.noteType}, v${note.version})`;
        })
        .join("\n");

    const pick = prompt(`Enter note number:\n\n${listText}`);
    if (!pick) return;

    const index = Number(pick) - 1;
    if (Number.isNaN(index) || index < 0 || index >= notes.length) {
        alert("Invalid choice");
        return;
    }

    const note = notes[index];
    currentNoteId = note._id;

    if (note.noteType === "pleading") {
        showPleadingNote();
    } else {
        showPlainNote();
    }

    setNoteContent(note.content || "");
}

function exportNote() {

    logSystemInteraction({ eventType: "click", elementName: "Export Button", page: "notes" });

    const text = getNoteContentAsText().trim();
    if (!text) {
        alert("Nothing to export");
        return;
    }
    const safeTitle = getNoteTitle().replace(/[^\w\- ]/g, "").trim() || "note";
    const isPleading = isPleadingMode();
    const extension = isPleading ? "html" : "txt";
    const mimeType = isPleading ? "text/html" : "text/plain";
    const fileContent = isPleading ? getNoteContent() : text;
    const blob = new Blob([fileContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
}

saveNoteBtn.addEventListener("click", () => {
    saveNote();
});
openNoteBtn.addEventListener("click", () => {
    openNote();
});

exportNoteBtn.addEventListener("click", () => {
    exportNote();
});
