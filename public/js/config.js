const STORAGE_KEYS = {
    participantID: "lrai_participantID",
    memoId: "lrai_memoId",
};

const params = new URLSearchParams(window.location.search);

function readParam(name) {
    const value = params.get(name);
    return value && value.trim() ? value.trim() : null;
}

function createSessionId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const urlParticipant = readParam("participantID");

const participantID =
    urlParticipant ||
    localStorage.getItem(STORAGE_KEYS.participantID) ||
    "demo-participant";

const memoNumber =
    resolveMemoNumber(readParam("memoID")) ??
    // Older links used assignment=week-01. Keep reading them until those URLs retire.
    resolveMemoNumber(readParam("assignment")) ??
    resolveMemoNumber(localStorage.getItem(STORAGE_KEYS.memoId)) ??
    1;

const memoId = toMemoId(memoNumber);

// The server looks the condition up in the study mapping and rewrites the URL
// before this page is served, so the parameter is already checked by the time
// it is read here. A student editing it is redirected back to their own value.
const systemID = readParam("systemID") === "2" ? "2" : "1";
const isAiEnabled = systemID === "2";

// One study session = one sitting at one memo. sessionStorage is scoped to the
// tab and cleared when it closes, so a browser restart starts a new session
// while a reload keeps the current one. A localStorage id would never change
// and would make "closed the system and came back later" impossible to see.
// The memo is part of the key so a tab reused for a later memo starts a fresh
// sitting instead of extending the old one under the wrong memo.
const SESSION_STORAGE_KEY = `lrai_studySessionId:${memoId}`;

let studySessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
const isNewSession = !studySessionId;
if (isNewSession) {
    studySessionId = createSessionId();
    sessionStorage.setItem(SESSION_STORAGE_KEY, studySessionId);
}

localStorage.setItem(STORAGE_KEYS.participantID, participantID);
localStorage.setItem(STORAGE_KEYS.memoId, memoId);

const config = {
    participantID,
    memoNumber,
    memoId,
    studySessionId,
    systemID,
    isAiEnabled,
    isNewSession,
    memoTitle: `Memo ${memoNumber}`,
    // The server holds the Qualtrics address and records the return trip, so
    // the client only ever needs its own entry point.
    questionnaireUrl:
        `/questionnaire/start?participantID=${encodeURIComponent(participantID)}` +
        `&memoID=${encodeURIComponent(String(memoNumber))}`,
};

document.body.classList.remove("system-1", "system-2");
document.body.classList.add(isAiEnabled ? "system-2" : "system-1");

// System 1 has no chat sidebar, so both systems get their own memo heading.
document.querySelectorAll("[data-memo-title]").forEach((element) => {
    element.textContent = config.memoTitle;
});

// The due date mapping lives on the server so it has git history like the
// rest of the study design; the placeholder text stays put if the lookup
// fails or the memo has no due date on file.
fetch(
    `/api/assignments/due-date?participantID=${encodeURIComponent(participantID)}` +
        `&assignmentId=${encodeURIComponent(memoId)}`
)
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
        if (!data?.dueDate) {
            return;
        }
        document.querySelectorAll("[data-memo-due]").forEach((element) => {
            element.textContent = data.dueDate;
        });
    })
    .catch(() => {});
