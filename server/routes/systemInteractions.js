const express = require("express");
const systemInteractionsDb = require("../db/systemInteractions.js");

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const { participantID, assignmentId, sessionID, systemID } = req.body;

        if (!participantID || !assignmentId || !sessionID || !systemID) {
            return res.status(400).json({
                error: "participantID, assignmentId, sessionID, and systemID required",
            });
        }

        const interaction = await systemInteractionsDb.create(req.body);
        res.status(201).json(interaction);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
