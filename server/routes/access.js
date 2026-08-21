const express = require("express");
const { setAccessCookie } = require("../middleware/accessGate.js");
const {
    resolveMemoNumber,
    resolveSystemIdFromParity,
} = require("../services/studyRouting.js");

const router = express.Router();

function sanitizeId(value, fieldName) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        throw new Error(`${fieldName} is required`);
    }
    if (trimmed.length > 255) {
        throw new Error(`${fieldName} is too long`);
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
        throw new Error(`${fieldName} may only contain letters, numbers, dots, dashes, and underscores`);
    }
    return trimmed;
}

router.post("/verify", (req, res) => {
    let participantID;
    let memoID;
    try {
        participantID = sanitizeId(req.body?.participantID, "Participant ID");
        memoID = sanitizeId(req.body?.memoID ?? req.body?.assignmentId, "Memo ID");
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const memoNumber = resolveMemoNumber(memoID);
    if (!memoNumber) {
        return res.status(400).json({ error: "Memo ID must be a number from 1 to 6" });
    }

    const systemID = resolveSystemIdFromParity(participantID, memoNumber);
    if (!systemID) {
        return res.status(400).json({
            error: "Participant ID must include a number, for example 33",
        });
    }

    setAccessCookie(req, res);

    const params = new URLSearchParams({
        participantID,
        memoID: String(memoNumber),
        systemID,
    });

    return res.json({
        ok: true,
        redirect: `/app.html?${params.toString()}`,
    });
});

module.exports = router;
