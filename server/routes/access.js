const express = require("express");
const assignmentsDb = require("../db/assignments.js");
const { setAccessCookie } = require("../middleware/accessGate.js");
const { sanitizeId } = require("../services/studyIdentifiers.js");
const { resolveMemoNumber, MEMO_COUNT } = require("../services/studyRouting.js");
const {
    hasParticipant,
    getSystemId,
} = require("../services/participantConditions.js");
const {
    findAssignmentState,
    buildStateRedirect,
} = require("../services/assignmentState.js");

const router = express.Router();

const UNKNOWN_PARTICIPANT_MESSAGE =
    "That participant ID was not found. Please check it and enter it again.";

router.post("/verify", async (req, res) => {
    let participantID;
    let memoID;
    try {
        participantID = sanitizeId(req.body?.participantID, "Participant ID");
        memoID = sanitizeId(req.body?.memoID ?? req.body?.assignmentId, "Memo ID");
    } catch (error) {
        return res.status(400).json({ error: UNKNOWN_PARTICIPANT_MESSAGE });
    }

    const memoNumber = resolveMemoNumber(memoID);
    if (!memoNumber) {
        return res.status(400).json({
            error: `Memo ID must be a number from 1 to ${MEMO_COUNT}`,
        });
    }

    // An id outside the mapping is a typo or someone who is not in the study.
    // Either way there is no condition to assign, so they do not get in.
    if (!hasParticipant(participantID)) {
        return res.status(404).json({ error: UNKNOWN_PARTICIPANT_MESSAGE });
    }

    const systemID = getSystemId(participantID, memoNumber);
    if (!systemID) {
        return res.status(400).json({
            error: `Memo ${memoNumber} is not part of your assignment schedule.`,
        });
    }

    setAccessCookie(req, res);

    // Where they go depends on how far through the assignment they already are,
    // so returning after a submit does not drop them back into a locked editor.
    let state;
    try {
        ({ state } = await findAssignmentState(
            assignmentsDb,
            participantID,
            memoNumber
        ));
    } catch (error) {
        console.error("Access verify state lookup failed:", error);
        return res.status(500).json({
            error: "Could not open your assignment. Try again in a moment.",
        });
    }

    return res.json({
        ok: true,
        state,
        redirect: buildStateRedirect({
            state,
            participantID,
            memoNumber,
            systemID,
        }),
    });
});

module.exports = router;
