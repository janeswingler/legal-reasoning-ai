const { toMemoId } = require("./studyRouting.js");

/**
 * An assignment moves through three states, both stamps living on the
 * assignments row so the state survives a new browser or a new machine.
 *
 *   writing       - still editable
 *   questionnaire - writing submitted and locked, Qualtrics still outstanding
 *   complete      - both halves done
 */
const ASSIGNMENT_STATES = {
    WRITING: "writing",
    QUESTIONNAIRE: "questionnaire",
    COMPLETE: "complete",
};

function resolveAssignmentState(assignment) {
    if (!assignment?.submittedAt) {
        return ASSIGNMENT_STATES.WRITING;
    }
    if (!assignment.questionnaireCompletedAt) {
        return ASSIGNMENT_STATES.QUESTIONNAIRE;
    }
    return ASSIGNMENT_STATES.COMPLETE;
}

async function findAssignmentState(assignmentsDb, participantID, memoNumber) {
    const assignment = await assignmentsDb.findByParticipantAndAssignment(
        participantID,
        toMemoId(memoNumber)
    );
    return { assignment, state: resolveAssignmentState(assignment) };
}

function buildEditorUrl({ participantID, memoNumber, systemID }) {
    const params = new URLSearchParams({
        participantID,
        memoID: String(memoNumber),
        systemID,
    });
    return `/app.html?${params.toString()}`;
}

/**
 * The questionnaire is always entered through our own /questionnaire/start so
 * the Qualtrics address lives in one place on the server and the client never
 * needs to know it.
 */
function buildQuestionnaireStartUrl({ participantID, memoNumber }) {
    const params = new URLSearchParams({
        participantID,
        memoID: String(memoNumber),
    });
    return `/questionnaire/start?${params.toString()}`;
}

function buildAssignmentCompleteUrl({ participantID, memoNumber }) {
    const params = new URLSearchParams({
        participantID,
        memoID: String(memoNumber),
    });
    return `/complete.html?${params.toString()}`;
}

/** Where a participant belongs right now, given where they are in the flow. */
function buildStateRedirect({ state, participantID, memoNumber, systemID }) {
    if (state === ASSIGNMENT_STATES.QUESTIONNAIRE) {
        return buildQuestionnaireStartUrl({ participantID, memoNumber });
    }
    if (state === ASSIGNMENT_STATES.COMPLETE) {
        return buildAssignmentCompleteUrl({ participantID, memoNumber });
    }
    return buildEditorUrl({ participantID, memoNumber, systemID });
}

module.exports = {
    ASSIGNMENT_STATES,
    resolveAssignmentState,
    findAssignmentState,
    buildEditorUrl,
    buildQuestionnaireStartUrl,
    buildAssignmentCompleteUrl,
    buildStateRedirect,
};
