const express = require("express");
const SystemInteraction = require("../models/SystemInteractions.js");

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const { participantID, sessionID } = req.body;

        if (!participantID || !sessionID) {
            return res.status(400).json({ error: "participantID and sessionID required" });
        }

        const interaction = await SystemInteraction.create(req.body);
        res.status(201).json(interaction);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;