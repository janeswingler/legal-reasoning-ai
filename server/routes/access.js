const express = require("express");
const { checkPassword, isAccessGateEnabled } = require("../services/accessGate.js");
const { setAccessCookie } = require("../middleware/accessGate.js");

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
    const password = String(req.body?.password || "");
    if (isAccessGateEnabled() && !checkPassword(password)) {
        return res.status(401).json({ error: "Incorrect access password" });
    }

    let participantID;
    let assignmentId;
    try {
        participantID = sanitizeId(req.body?.participantID, "Participant ID");
        assignmentId = sanitizeId(req.body?.assignmentId, "Week");
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const systemID = req.body?.systemID === "1" ? "1" : "2";
    setAccessCookie(req, res);

    const params = new URLSearchParams({
        participantID,
        assignment: assignmentId,
        systemID,
    });

    return res.json({
        ok: true,
        redirect: `/app.html?${params.toString()}`,
    });
});

module.exports = router;
