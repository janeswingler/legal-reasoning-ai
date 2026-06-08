const express = require("express");
const ChatExchange = require("../models/ChatExchanges.js");

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const { participantID, sessionID, systemID, userInput } = req.body;

        if (!participantID || !sessionID) {
            return res.status(400).json({ error: "participantID and sessionID required" });
        }
        if (!userInput || !userInput.trim()) {
            return res.status(400).json({ error: "userInput required" });
        }
        const botResponse = "Thanks, responses coming soon :) ";
        const exchange = await ChatExchange.create({
            participantID,
            sessionID,
            systemID,
            userInput: userInput.trim(),
            botResponse,
        });
        res.status(201).json(exchange);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;