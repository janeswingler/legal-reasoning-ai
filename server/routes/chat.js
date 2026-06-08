const express = require("express");
const mongoose = require("mongoose");
const ChatExchange = require("../models/ChatExchanges.js");
const ChatSession = require("../models/ChatSession.js");

const router = express.Router();

function requireParticipantAssignment(req, res) {
    const participantID = req.query.participantID || req.body.participantID;
    const assignmentId = req.query.assignmentId || req.body.assignmentId;

    if (!participantID || !assignmentId) {
        res.status(400).json({ error: "participantID and assignmentId required" });
        return null;
    }

    return { participantID, assignmentId };
}

router.get("/sessions", async (req, res) => {
    try {
        const ids = requireParticipantAssignment(req, res);
        if (!ids) return;

        const sessions = await ChatSession.find({
            participantID: ids.participantID,
            assignmentId: ids.assignmentId,
        }).sort({ updatedAt: -1 });

        res.json({ sessions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/sessions", async (req, res) => {
    try {
        const ids = requireParticipantAssignment(req, res);
        if (!ids) return;

        const { sessionID, systemID, title } = req.body;

        const session = await ChatSession.create({
            participantID: ids.participantID,
            assignmentId: ids.assignmentId,
            sessionID,
            systemID,
            title: title || null,
        });

        res.status(201).json({ session });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get("/sessions/:id/history", async (req, res) => {
    try {
        const ids = requireParticipantAssignment(req, res);
        if (!ids) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        const session = await ChatSession.findOne({
            _id: req.params.id,
            participantID: ids.participantID,
            assignmentId: ids.assignmentId,
        });

        if (!session) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        const exchanges = await ChatExchange.find({
            chatSessionId: session._id,
        }).sort({ timestamp: 1 });

        res.json({ session, exchanges });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/", async (req, res) => {
    try {
        const {
            participantID,
            sessionID,
            chatSessionId,
            assignmentId,
            systemID,
            userInput,
        } = req.body;

        if (!participantID || !sessionID || !chatSessionId || !assignmentId) {
            return res.status(400).json({
                error: "participantID, sessionID, chatSessionId, and assignmentId required",
            });
        }
        if (!userInput || !userInput.trim()) {
            return res.status(400).json({ error: "userInput required" });
        }
        if (!mongoose.Types.ObjectId.isValid(chatSessionId)) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        const chatSession = await ChatSession.findOne({
            _id: chatSessionId,
            participantID,
            assignmentId,
        });

        if (!chatSession) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        const botResponse = "Thanks, responses coming soon :) ";
        const exchange = await ChatExchange.create({
            participantID,
            sessionID,
            chatSessionId: chatSession._id,
            assignmentId,
            systemID,
            userInput: userInput.trim(),
            botResponse,
        });

        chatSession.updatedAt = new Date();
        await chatSession.save();

        res.status(201).json(exchange);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
