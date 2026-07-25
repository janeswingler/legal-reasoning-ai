const express = require("express");
const chatSessionsDb = require("../db/chatSessions.js");
const chatExchangesDb = require("../db/chatExchanges.js");
const chatAttachmentsDb = require("../db/chatAttachments.js");
const { isValidId } = require("../db/helpers.js");
const { getChatCompletion, generateSessionTitle } = require("../services/anthropic.js");
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

async function populateAttachmentIds(exchanges) {
    const allIds = [
        ...new Set(
            exchanges.flatMap((exchange) =>
                Array.isArray(exchange.attachmentIds) ? exchange.attachmentIds : []
            )
        ),
    ];

    if (!allIds.length) {
        return exchanges.map((exchange) => ({
            ...exchange,
            attachmentIds: [],
        }));
    }

    const attachments = await chatAttachmentsDb.findByIds(allIds);
    const byId = new Map(
        attachments.map((attachment) => [
            String(attachment.id),
            {
                _id: attachment._id,
                id: attachment.id,
                originalFilename: attachment.originalFilename,
                status: attachment.status,
                chunkCount: attachment.chunkCount,
            },
        ])
    );

    return exchanges.map((exchange) => ({
        ...exchange,
        attachmentIds: (exchange.attachmentIds || [])
            .map((id) => byId.get(String(id)))
            .filter(Boolean),
    }));
}

router.get("/sessions", async (req, res) => {
    try {
        const ids = requireParticipantAssignment(req, res);
        if (!ids) return;

        const sessions = await chatSessionsDb.findByParticipantAndAssignment(
            ids.participantID,
            ids.assignmentId
        );

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

        const session = await chatSessionsDb.create({
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

        if (!isValidId(req.params.id)) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        const session = await chatSessionsDb.findOwned(
            req.params.id,
            ids.participantID,
            ids.assignmentId
        );

        if (!session) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        const exchanges = await chatExchangesDb.findBySessionId(session.id, {
            order: "ASC",
        });
        const populated = await populateAttachmentIds(exchanges);

        res.json({ session, exchanges: populated });
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
            attachmentIds = [],
        } = req.body;

        if (!participantID || !sessionID || !chatSessionId || !assignmentId) {
            return res.status(400).json({
                error: "participantID, sessionID, chatSessionId, and assignmentId required",
            });
        }
        if (!userInput || !userInput.trim()) {
            return res.status(400).json({ error: "userInput required" });
        }
        if (!isValidId(chatSessionId)) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        let chatSession = await chatSessionsDb.findOwned(
            chatSessionId,
            participantID,
            assignmentId
        );

        if (!chatSession) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        const priorExchanges = await chatExchangesDb.findBySessionId(
            chatSession.id,
            { limit: HISTORY_LIMIT, order: "DESC" }
        );
        priorExchanges.reverse();

        let linkedAttachmentIds = [];
        if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
            const uniqueIds = [...new Set(attachmentIds.map(String))];
            if (!uniqueIds.every(isValidId)) {
                return res.status(400).json({ error: "Invalid attachmentIds" });
            }

            const attachments = await chatAttachmentsDb.findUnlinkedByIds(
                uniqueIds,
                chatSession.id
            );

            if (attachments.length !== uniqueIds.length) {
                return res
                    .status(400)
                    .json({ error: "One or more attachments are invalid" });
            }

            linkedAttachmentIds = attachments.map((attachment) =>
                String(attachment.id)
            );
        }

        let retrievedContext = "";
        let retrievalResult = { chunks: [], scores: [], ragVersion: null };
        try {
            retrievalResult = await retrieveWithMeta(
                chatSession.id,
                userInput.trim()
            );
            retrievedContext = formatRetrievedContext(retrievalResult.chunks);
        } catch (error) {
            console.error("Retrieval error:", error);
        }

        const generationAbort = new AbortController();
        const onClientClose = () => {
            if (!res.writableEnded) {
                generationAbort.abort();
            }
        };
        req.on("close", onClientClose);

        let botResponse;
        try {
            botResponse = await getChatCompletion(
                priorExchanges,
                assignmentId,
                userInput.trim(),
                retrievedContext,
                { signal: generationAbort.signal }
            );
        } catch (error) {
            if (
                generationAbort.signal.aborted ||
                error?.name === "AbortError" ||
                error?.code === "ABORT_ERR"
            ) {
                return;
            }
            if (error.message === "ANTHROPIC_API_KEY is not configured") {
                return res.status(503).json({ error: "Chat service is not configured" });
            }
            console.error("OpenAI chat error:", error);
            return res.status(502).json({ error: "Could not generate a response" });
        } finally {
            req.removeListener("close", onClientClose);
        }

        if (!botResponse) {
            return res.status(502).json({ error: "Could not generate a response" });
        }

        const exchange = await chatExchangesDb.create({
            participantID,
            sessionID,
            chatSessionId: chatSession.id,
            assignmentId,
            systemID,
            userInput: userInput.trim(),
            botResponse,
            attachmentIds: linkedAttachmentIds,
            retrievedChunkIds: retrievalResult.chunks.map((chunk) =>
                String(chunk._id || chunk.id)
            ),
            retrievalMeta: {
                ragVersion: retrievalResult.ragVersion,
                chunkCount: retrievalResult.chunks.length,
                scores: retrievalResult.scores,
            },
        });

        if (linkedAttachmentIds.length > 0) {
            await chatAttachmentsDb.linkToExchange(
                linkedAttachmentIds,
                exchange.id
            );
        }

        const exchangeCount = priorExchanges.length + 1;
        if (exchangeCount === 1) {
            try {
                const newTitle = await generateSessionTitle(
                    userInput.trim(),
                    botResponse
                );
                if (newTitle) {
                    chatSession = await chatSessionsDb.update(chatSession.id, {
                        title: newTitle.replace(/^["']|["']$/g, ""),
                    });
                }
            } catch (error) {
                console.error("OpenAI title error:", error);
            }
        }

        chatSession = await chatSessionsDb.touch(chatSession.id);

        res.status(201).json({
            ...exchange,
            attachmentIds: linkedAttachmentIds,
            sessionTitle: chatSession.title,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
