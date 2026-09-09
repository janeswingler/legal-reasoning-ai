const express = require("express");
const chatThreadsDb = require("../db/chatThreads.js");
const chatExchangesDb = require("../db/chatExchanges.js");
const chatAttachmentsDb = require("../db/chatAttachments.js");
const { isValidId } = require("../db/helpers.js");
const { MODEL, getChatCompletion, generateThreadTitle } = require("../services/anthropic.js");
const {
    retrieveWithMeta,
    formatRetrievedContext,
} = require("../services/retrieval.js");
const attachmentsRouter = require("./attachments.js");

const router = express.Router();
const HISTORY_LIMIT = 10;
const CHAT_UNAVAILABLE_MESSAGE = "Chat is not available for this memo.";

// The page only shows the chat pane in the AI condition. This is the server
// side of that rule, so the condition holds even for a request made by hand.
// Multipart uploads are checked in the attachments router once parsed.
router.use((req, res, next) => {
    if (req.is("multipart/form-data")) {
        return next();
    }
    if (!req.study) {
        return res.status(400).json({ error: "participantID and assignmentId required" });
    }
    if (req.study.systemID !== "2") {
        return res.status(403).json({ error: CHAT_UNAVAILABLE_MESSAGE });
    }
    return next();
});

router.use("/threads/:chatThreadId/attachments", attachmentsRouter);

function studyIds(req) {
    return { participantID: req.study.participantID, assignmentId: req.study.memoId };
}

/**
 * A prompt is study data whether or not a reply came back. Stopped and failed
 * generations are kept with no bot_response so "prompts sent" and "prompts
 * answered" can both be counted from the exchanges table.
 */
async function recordUnansweredExchange(
    fields,
    stopReason,
    { responseMs = null, errorMessage = null } = {}
) {
    try {
        await chatExchangesDb.create({
            ...fields,
            botResponse: null,
            model: MODEL,
            stopReason,
            responseMs,
            retrievalMeta: {
                ...fields.retrievalMeta,
                error: errorMessage ? String(errorMessage).slice(0, 500) : null,
            },
        });
    } catch (dbError) {
        console.error("Could not record unanswered chat exchange:", dbError);
    }
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

router.get("/threads", async (req, res) => {
    try {
        const ids = studyIds(req);

        const threads = await chatThreadsDb.findByParticipantAndAssignment(
            ids.participantID,
            ids.assignmentId
        );

        res.json({ threads });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/threads", async (req, res) => {
    try {
        const ids = studyIds(req);
        const { studySessionId, title } = req.body;

        const thread = await chatThreadsDb.create({
            participantID: ids.participantID,
            assignmentId: ids.assignmentId,
            studySessionId,
            systemID: req.study.systemID,
            title: title || null,
        });

        res.status(201).json({ thread });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get("/threads/:id/history", async (req, res) => {
    try {
        const ids = studyIds(req);

        if (!isValidId(req.params.id)) {
            return res.status(404).json({ error: "Chat thread not found" });
        }

        const thread = await chatThreadsDb.findOwned(
            req.params.id,
            ids.participantID,
            ids.assignmentId
        );

        if (!thread) {
            return res.status(404).json({ error: "Chat thread not found" });
        }

        const exchanges = await chatExchangesDb.findByThreadId(thread.id, {
            order: "ASC",
        });
        const populated = await populateAttachmentIds(exchanges);

        res.json({ thread, exchanges: populated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/", async (req, res) => {
    try {
        const { studySessionId, chatThreadId, userInput, attachmentIds = [] } = req.body;
        const { participantID, assignmentId } = studyIds(req);
        const systemID = req.study.systemID;

        if (!studySessionId || !chatThreadId) {
            return res.status(400).json({
                error: "studySessionId and chatThreadId required",
            });
        }
        if (!userInput || !userInput.trim()) {
            return res.status(400).json({ error: "userInput required" });
        }
        if (!isValidId(chatThreadId)) {
            return res.status(404).json({ error: "Chat thread not found" });
        }

        let chatThread = await chatThreadsDb.findOwned(
            chatThreadId,
            participantID,
            assignmentId
        );

        if (!chatThread) {
            return res.status(404).json({ error: "Chat thread not found" });
        }

        const priorExchanges = (
            await chatExchangesDb.findByThreadId(chatThread.id, {
                limit: HISTORY_LIMIT,
                order: "DESC",
            })
        )
            // Stopped or failed prompts have no reply to show the model.
            .filter((exchange) => exchange.botResponse)
            .reverse();

        let linkedAttachmentIds = [];
        if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
            const uniqueIds = [...new Set(attachmentIds.map(String))];
            if (!uniqueIds.every(isValidId)) {
                return res.status(400).json({ error: "Invalid attachmentIds" });
            }

            const attachments = await chatAttachmentsDb.findUnlinkedByIds(
                uniqueIds,
                chatThread.id
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
                chatThread.id,
                userInput.trim()
            );
            retrievedContext = formatRetrievedContext(retrievalResult.chunks);
        } catch (error) {
            console.error("Retrieval error:", error);
        }

        const exchangeFields = {
            participantID,
            studySessionId,
            chatThreadId: chatThread.id,
            assignmentId,
            systemID,
            userInput: userInput.trim(),
            attachmentIds: linkedAttachmentIds,
            retrievedChunkIds: retrievalResult.chunks.map((chunk) =>
                String(chunk._id || chunk.id)
            ),
            retrievalMeta: {
                ragVersion: retrievalResult.ragVersion,
                chunkCount: retrievalResult.chunks.length,
                scores: retrievalResult.scores,
            },
        };

        const generationAbort = new AbortController();
        const onClientClose = () => {
            if (!res.writableEnded) {
                generationAbort.abort();
            }
        };
        req.on("close", onClientClose);

        const generationStartedAt = Date.now();
        let completion;
        try {
            completion = await getChatCompletion(
                priorExchanges,
                assignmentId,
                userInput.trim(),
                retrievedContext,
                { signal: generationAbort.signal }
            );
        } catch (error) {
            const responseMs = Date.now() - generationStartedAt;
            if (
                generationAbort.signal.aborted ||
                error?.name === "AbortError" ||
                error?.code === "ABORT_ERR"
            ) {
                await recordUnansweredExchange(exchangeFields, "aborted", { responseMs });
                return;
            }
            await recordUnansweredExchange(exchangeFields, "error", {
                responseMs,
                errorMessage: error.message,
            });
            if (error.message === "ANTHROPIC_API_KEY is not configured") {
                return res.status(503).json({ error: "Chat service is not configured" });
            }
            console.error("Chat completion error:", error);
            return res.status(502).json({ error: "Could not generate a response" });
        } finally {
            req.removeListener("close", onClientClose);
        }
        const responseMs = Date.now() - generationStartedAt;

        const botResponse = completion?.text;
        if (!botResponse) {
            await recordUnansweredExchange(exchangeFields, "empty", { responseMs });
            return res.status(502).json({ error: "Could not generate a response" });
        }

        const exchange = await chatExchangesDb.create({
            ...exchangeFields,
            botResponse,
            model: completion.model,
            stopReason: completion.stopReason,
            inputTokens: completion.inputTokens,
            outputTokens: completion.outputTokens,
            responseMs,
        });

        if (linkedAttachmentIds.length > 0) {
            await chatAttachmentsDb.linkToExchange(
                linkedAttachmentIds,
                exchange.id
            );
        }

        if (priorExchanges.length === 0) {
            try {
                const newTitle = await generateThreadTitle(
                    userInput.trim(),
                    botResponse
                );
                if (newTitle) {
                    chatThread = await chatThreadsDb.update(chatThread.id, {
                        title: newTitle.replace(/^["']|["']$/g, ""),
                    });
                }
            } catch (error) {
                console.error("Chat title error:", error);
            }
        }

        chatThread = await chatThreadsDb.touch(chatThread.id);

        res.status(201).json({
            ...exchange,
            attachmentIds: linkedAttachmentIds,
            threadTitle: chatThread.title,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
