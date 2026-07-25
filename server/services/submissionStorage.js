const fs = require("fs");
const path = require("path");

function sanitizePathSegment(value) {
    return String(value).replace(/[^\w\-]+/g, "-");
}

function buildSubmissionFilename(participantID, assignmentId) {
    const safeParticipant = sanitizePathSegment(participantID);
    const safeAssignment = sanitizePathSegment(assignmentId);
    return `${safeAssignment}__${safeParticipant}.pdf`;
}

function getSubmissionsRoot() {
    const configured = process.env.SUBMISSIONS_DIR;
    if (configured) {
        return path.isAbsolute(configured)
            ? configured
            : path.join(process.cwd(), configured);
    }

    return path.join(process.cwd(), "uploads", "submissions");
}

async function saveSubmissionLocally({ buffer, participantID, assignmentId }) {
    const root = getSubmissionsRoot();
    const assignmentDir = path.join(root, sanitizePathSegment(assignmentId));
    fs.mkdirSync(assignmentDir, { recursive: true });

    const fileName = buildSubmissionFilename(participantID, assignmentId);
    const filePath = path.join(assignmentDir, fileName);
    fs.writeFileSync(filePath, buffer);

    return {
        filePath,
        fileName,
    };
}

function getSubmissionStorageMode() {
    const mode = String(process.env.SUBMISSION_STORAGE || "drive").toLowerCase();
    if (mode === "local" || mode === "both") {
        return mode;
    }

    return "drive";
}

function isLocalSubmissionEnabled() {
    const mode = getSubmissionStorageMode();
    return mode === "local" || mode === "both";
}

function isDriveSubmissionEnabled() {
    const mode = getSubmissionStorageMode();
    return mode === "drive" || mode === "both";
}

module.exports = {
    buildSubmissionFilename,
    getSubmissionStorageMode,
    isLocalSubmissionEnabled,
    isDriveSubmissionEnabled,
    saveSubmissionLocally,
};
