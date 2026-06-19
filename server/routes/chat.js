const express = require("express");
const mongoose = require("mongoose");
const ChatExchange = require("../models/ChatExchanges.js");
const ChatSession = require("../models/ChatSession.js");
const { getChatCompletion, generateSessionTitle } = require("../services/openai.js");
const {
    retrieveWithMeta,
    formatRetrievedContext,
} = require("../services/retrieval.js");
const attachmentsRouter = require("./attachments.js");

const router = express.Router();
const HISTORY_LIMIT = 10;

router.use("/sessions/:chatSessionId/attachments", attachmentsRouter);

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

        const priorExchanges = await ChatExchange.find({
            chatSessionId: chatSession._id,
        })
            .sort({ timestamp: -1 })
            .limit(HISTORY_LIMIT);

        priorExchanges.reverse();

        let retrievedContext = "";
        let retrievalResult = { chunks: [], scores: [], ragVersion: null };
        try {
            retrievalResult = await retrieveWithMeta(
                chatSession._id,
                userInput.trim()
            );
            retrievedContext = formatRetrievedContext(retrievalResult.chunks);
        } catch (error) {
            console.error("Retrieval error:", error);
        }

        let botResponse;
        try {
            botResponse = await getChatCompletion(
                priorExchanges,
                assignmentId,
                userInput.trim(),
                retrievedContext
            );
        } catch (error) {
            if (error.message === "OPENAI_API_KEY is not configured") {
                return res.status(503).json({ error: "Chat service is not configured" });
            }
            console.error("OpenAI chat error:", error);
            return res.status(502).json({ error: "Could not generate a response" });
        }

        if (!botResponse) {
            return res.status(502).json({ error: "Could not generate a response" });
        }

        const exchange = await ChatExchange.create({
            participantID,
            sessionID,
            chatSessionId: chatSession._id,
            assignmentId,
            systemID,
            userInput: userInput.trim(),
            botResponse,
            retrievedChunkIds: retrievalResult.chunks.map((chunk) => chunk._id),
            retrievalMeta: {
                ragVersion: retrievalResult.ragVersion,
                chunkCount: retrievalResult.chunks.length,
                scores: retrievalResult.scores,
            },
        });

        const exchangeCount = priorExchanges.length + 1;
        if (exchangeCount === 1) {
            try {
                const newTitle = await generateSessionTitle(userInput.trim(), botResponse);
                if (newTitle) {
                    chatSession.title = newTitle.replace(/^["']|["']$/g, "");
                }
            } catch (error) {
                console.error("OpenAI title error:", error);
            }
        }

        chatSession.updatedAt = new Date();
        await chatSession.save();

        res.status(201).json({
            ...exchange.toObject(),
            sessionTitle: chatSession.title,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
