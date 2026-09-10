const { sanitizeId } = require("../services/studyIdentifiers.js");
const { resolveMemoNumber, toMemoId } = require("../services/studyRouting.js");
const { getSystemId } = require("../services/participantConditions.js");
const { isMemoOpen } = require("../services/memoAssignedDates.js");

const IDENTITY_ERROR_MESSAGE =
    "Participant ID or memo is not recognized. Reopen your assignment link and try again.";

/**
 * Every API request names a participant and a memo. The condition they are in
 * is looked up from the study mapping here, on the server, so what gets logged
 * and what the chat API allows never depends on a value the browser sent.
 *
 * Throws when the participant is not in the study or the memo is not one of
 * theirs; callers turn that into a 403.
 */
function resolveStudyIdentity(rawParticipantID, rawAssignmentId) {
    const participantID = sanitizeId(rawParticipantID, "Participant ID");
    const memoNumber = resolveMemoNumber(rawAssignmentId);
    const memoId = memoNumber ? toMemoId(memoNumber) : null;

    // Only the canonical memo-NN form is accepted, so one memo can never be
    // stored under two different keys.
    if (!memoId || String(rawAssignmentId).trim() !== memoId) {
        throw new Error("Memo ID is not valid");
    }

    if (!isMemoOpen(memoNumber)) {
        throw new Error("This memo is not open yet");
    }

    const systemID = getSystemId(participantID, memoNumber);
    if (!systemID) {
        throw new Error("Participant is not in the study or the memo is not scheduled");
    }

    return { participantID, memoNumber, memoId, systemID };
}

function readRawIdentity(req) {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    return {
        participantID: body.participantID ?? req.query?.participantID,
        assignmentId: body.assignmentId ?? req.query?.assignmentId,
    };
}

/** Resolves from the request and stores the result on req.study. Throws on failure. */
function attachStudyIdentity(req) {
    const { participantID, assignmentId } = readRawIdentity(req);
    req.study = resolveStudyIdentity(participantID, assignmentId);
    if (req.body && typeof req.body === "object") {
        req.body.systemID = req.study.systemID;
    }
    return req.study;
}

function studyIdentityMiddleware(req, res, next) {
    // Multipart bodies are parsed later by multer; those handlers call
    // attachStudyIdentity themselves once the fields are available.
    if (req.is("multipart/form-data")) {
        return next();
    }

    const { participantID, assignmentId } = readRawIdentity(req);
    if (participantID == null && assignmentId == null) {
        // Routes that need an identity reject its absence themselves.
        return next();
    }

    try {
        attachStudyIdentity(req);
    } catch (error) {
        return res.status(403).json({ error: IDENTITY_ERROR_MESSAGE });
    }

    return next();
}

module.exports = {
    IDENTITY_ERROR_MESSAGE,
    resolveStudyIdentity,
    attachStudyIdentity,
    studyIdentityMiddleware,
};
