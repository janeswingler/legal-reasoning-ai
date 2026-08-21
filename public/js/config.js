const STORAGE_KEYS = {
    participantID: "lrai_participantID",
    memoId: "lrai_memoId",
};

// One study session = one sitting. sessionStorage is scoped to the tab and is
// cleared when the tab closes, so a browser restart starts a new session while
// a reload keeps the current one. A localStorage id would never change and
// would make "closed the system and came back later" impossible to see.
const SESSION_STORAGE_KEY = "lrai_studySessionId";

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

// Same parity → system 1 (no AI). Different parity → system 2 (AI).
// URL systemID is ignored so a student cannot switch conditions.
const systemID = resolveSystemIdFromParity(participantID, memoNumber) || "1";
const isAiEnabled = systemID === "2";

let sessionID = sessionStorage.getItem(SESSION_STORAGE_KEY);
const isNewSession = !sessionID;
if (isNewSession) {
    sessionID = createSessionId();
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionID);
}

localStorage.setItem(STORAGE_KEYS.participantID, participantID);
localStorage.setItem(STORAGE_KEYS.memoId, memoId);

const config = {
    participantID,
    memoNumber,
    memoId,
    sessionID,
    systemID,
    isAiEnabled,
    isNewSession,
    memoTitle: `Memo ${memoNumber}`,
    // Placeholder until the study Qualtrics survey is ready.
    qualtricsUrl: "https://myusf.usfca.edu/ets/educational-technologies/qualtrics",
};

document.body.classList.remove("system-1", "system-2");
document.body.classList.add(isAiEnabled ? "system-2" : "system-1");

// System 1 has no chat sidebar, so both systems get their own memo heading.
document.querySelectorAll("[data-memo-title]").forEach((element) => {
    element.textContent = config.memoTitle;
});
