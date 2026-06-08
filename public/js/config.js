const STORAGE_KEYS = {
    participantID: "lrai_participantID",
    assignmentId: "lrai_assignmentId",
    sessionID: "lrai_sessionID",
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
const urlAssignment = readParam("assignment");

const participantID =
    urlParticipant ||
    localStorage.getItem(STORAGE_KEYS.participantID) ||
    "demo-participant";

const assignmentId =
    urlAssignment ||
    localStorage.getItem(STORAGE_KEYS.assignmentId) ||
    "week-01";

let sessionID = localStorage.getItem(STORAGE_KEYS.sessionID);
if (!sessionID) {
    sessionID = createSessionId();
}

localStorage.setItem(STORAGE_KEYS.participantID, participantID);
localStorage.setItem(STORAGE_KEYS.assignmentId, assignmentId);
localStorage.setItem(STORAGE_KEYS.sessionID, sessionID);

const config = {
    participantID,
    assignmentId,
    sessionID,
    systemID: "legal-reasoning-ai-v1",
};
