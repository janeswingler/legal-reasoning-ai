const panelNotes = document.querySelector(".panel-notes"); // whole notes section, toggle is-pleading here
const notesEditor = document.getElementById("notesEditor"); // general note textarea
const pleadingBody = document.getElementById("pleadingBody"); // editable pleading area

const newNoteBtn = document.getElementById("newNoteBtn");
const newPleadingBtn = document.getElementById("newPleadingBtn");

function showPlainNote() {
    panelNotes.classList.remove("is-pleading");
    notesEditor.focus();
}

function showPleadingNote() {
    panelNotes.classList.add("is-pleading");
    pleadingBody.focus();
}

newNoteBtn.addEventListener("click", () => {
    showPlainNote();
});

newPleadingBtn.addEventListener("click", () => {
    showPleadingNote();
});
