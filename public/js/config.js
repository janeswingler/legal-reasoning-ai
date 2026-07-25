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

function formatAssignmentTitle(assignmentId) {
    const weekMatch = assignmentId.match(/^week-(\d+)$/i);
    if (weekMatch) {
        const weekNum = parseInt(weekMatch[1], 10);
        return `Week ${weekNum} Assignment`;
    }

    const label = assignmentId
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
    return `${label} Assignment`;
}

/**
 * Study modes (pass in the student URL):
 *   systemID=1 — Assignment Editor only (no AI chat)
 *   systemID=2 — AI chat + Assignment Editor (default if missing/invalid)
 * Examples:
 *   /app.html?participantID=abc&assignment=week-01&systemID=1
 *   /app.html?participantID=abc&assignment=week-01&systemID=2
 */
function resolveSystemId(raw) {
    return raw === "1" ? "1" : "2";
}

const urlParticipant = readParam("participantID");
const urlAssignment = readParam("assignment");
const systemID = resolveSystemId(readParam("systemID"));
const isAiEnabled = systemID === "2";

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
    systemID,
    isAiEnabled,
    assignmentTitle: formatAssignmentTitle(assignmentId),
};

document.body.classList.remove("system-1", "system-2");
document.body.classList.add(isAiEnabled ? "system-2" : "system-1");

const assignmentTitleEl = document.getElementById("assignmentTitle");
if (assignmentTitleEl) {
    assignmentTitleEl.textContent = config.assignmentTitle;
}
