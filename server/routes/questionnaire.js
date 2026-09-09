const express = require("express");
const assignmentsDb = require("../db/assignments.js");
const { setAccessCookie } = require("../middleware/accessGate.js");
const { sanitizeId } = require("../services/studyIdentifiers.js");
const { resolveMemoNumber, MEMO_COUNT } = require("../services/studyRouting.js");
const { getSystemId } = require("../services/participantConditions.js");
const { getQualtricsUrlForMemo } = require("../services/qualtricsUrls.js");
const {
    ASSIGNMENT_STATES,
    findAssignmentState,
    buildEditorUrl,
    buildAssignmentCompleteUrl,
} = require("../services/assignmentState.js");

const router = express.Router();

const DEFAULT_QUALTRICS_URL =
    "https://myusf.usfca.edu/ets/educational-technologies/qualtrics";

/**
 * Each memo can have its own survey, looked up from server/data/qualtrics-urls.json.
 * QUALTRICS_URL is the fallback for a memo missing from that file.
 */
function getQualtricsUrl(memoNumber) {
    return (
        getQualtricsUrlForMemo(memoNumber) ||
        process.env.QUALTRICS_URL ||
        DEFAULT_QUALTRICS_URL
    );
}

/**
 * Reads the participant and memo a questionnaire hop is about. Both the outward
 * trip and the Qualtrics return carry them in the query string.
 */
function readIdentity(req) {
    const participantID = sanitizeId(req.query.participantID, "Participant ID");
    const memoNumber = resolveMemoNumber(req.query.memoID);
    if (!memoNumber) {
        throw new Error(`Memo ID must be a number from 1 to ${MEMO_COUNT}`);
    }
    return { participantID, memoNumber };
}

function editorUrlFor(participantID, memoNumber) {
    return buildEditorUrl({
        participantID,
        memoNumber,
        systemID: getSystemId(participantID, memoNumber) || "1",
    });
}

/**
 * Sends the participant to Qualtrics, passing participantID, memoID, and
 * systemID so the survey can store them as embedded data. The return redirect
 * only needs participantID and memoID to stamp completion.
 */
router.get("/start", async (req, res) => {
    let identity;
    try {
        identity = readIdentity(req);
    } catch (error) {
        return res.redirect(302, "/");
    }

    const { participantID, memoNumber } = identity;

    try {
        const { state } = await findAssignmentState(
            assignmentsDb,
            participantID,
            memoNumber
        );

        // The questionnaire only exists once the writing is in, and a finished
        // participant should not be able to take it twice.
        if (state === ASSIGNMENT_STATES.WRITING) {
            return res.redirect(302, editorUrlFor(participantID, memoNumber));
        }
        if (state === ASSIGNMENT_STATES.COMPLETE) {
            return res.redirect(
                302,
                buildAssignmentCompleteUrl({ participantID, memoNumber })
            );
        }
    } catch (error) {
        console.error("Questionnaire start error:", error);
        return res.redirect(302, editorUrlFor(participantID, memoNumber));
    }

    const target = new URL(getQualtricsUrl(memoNumber));
    target.searchParams.set("participantID", participantID);
    target.searchParams.set("memoID", String(memoNumber));
    target.searchParams.set(
        "systemID",
        getSystemId(participantID, memoNumber) || "1"
    );

    return res.redirect(302, target.toString());
});

/**
 * Where Qualtrics sends the participant after the last question. Stamping the
 * completion here is what makes "questionnaire done" outlive their browser.
 */
router.get("/complete", async (req, res) => {
    let identity;
    try {
        identity = readIdentity(req);
    } catch (error) {
        return res.redirect(302, "/");
    }

    const { participantID, memoNumber } = identity;

    try {
        const { assignment, state } = await findAssignmentState(
            assignmentsDb,
            participantID,
            memoNumber
        );

        // Nothing to complete if the writing was never submitted, so treat this
        // as a stray link rather than creating a half-finished record.
        if (state === ASSIGNMENT_STATES.WRITING) {
            return res.redirect(302, editorUrlFor(participantID, memoNumber));
        }

        if (state === ASSIGNMENT_STATES.QUESTIONNAIRE) {
            await assignmentsDb.updateById(assignment.id, {
                questionnaireCompletedAt: new Date(),
            });
        }
    } catch (error) {
        console.error("Questionnaire completion error:", error);
        return res.redirect(302, editorUrlFor(participantID, memoNumber));
    }

    // They may be arriving from Qualtrics on a machine that never had the
    // cookie, so re-issue it before handing them the completion page.
    setAccessCookie(req, res);

    return res.redirect(
        302,
        buildAssignmentCompleteUrl({ participantID, memoNumber })
    );
});

module.exports = router;
