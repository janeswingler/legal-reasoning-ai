const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const chatThreadsDb = require("../db/chatThreads.js");
const chatAttachmentsDb = require("../db/chatAttachments.js");
const documentChunksDb = require("../db/documentChunks.js");
const { isValidId } = require("../db/helpers.js");
const { extractPdfPages } = require("../services/pdf.js");
const { chunkPages } = require("../services/chunking.js");
const { embedTexts, EMBEDDING_MODEL } = require("../services/embeddings.js");
const {
    attachStudyIdentity,
    IDENTITY_ERROR_MESSAGE,
} = require("../middleware/studyIdentity.js");

const router = express.Router({ mergeParams: true });

const UPLOAD_ROOT = path.join(__dirname, "../../uploads");
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_MB = MAX_BYTES / (1024 * 1024);

/**
 * Multipart requests reach here without req.study because their fields are
 * only parsed by multer; resolve the identity now and apply the same AI-only
 * rule the chat router applies to JSON requests.
 */
function requireParticipantAssignment(req, res) {
    if (!req.study) {
        try {
            attachStudyIdentity(req);
        } catch (error) {
            res.status(403).json({ error: IDENTITY_ERROR_MESSAGE });
            return null;
        }
    }

    if (req.study.systemID !== "2") {
        res.status(403).json({ error: "Chat is not available for this memo." });
        return null;
    }

    return {
        participantID: req.study.participantID,
        assignmentId: req.study.memoId,
        systemID: req.study.systemID,
    };
}

async function findOwnedThread(chatThreadId, participantID, assignmentId) {
    return chatThreadsDb.findOwned(chatThreadId, participantID, assignmentId);
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const participantID = req.body.participantID || "unknown";
        const chatThreadId = req.params.chatThreadId;
        const dir = path.join(UPLOAD_ROOT, participantID, chatThreadId);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename(req, file, cb) {
        cb(null, `${crypto.randomUUID()}.pdf`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_BYTES },
    fileFilter(req, file, cb) {
        const isPdf =
            file.mimetype === "application/pdf" ||
            file.originalname.toLowerCase().endsWith(".pdf");

        if (isPdf) {
            cb(null, true);
            return;
        }

        cb(new Error("Only PDF files are allowed"));
    },
});

function handleUpload(req, res, next) {
    upload.single("file")(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        if (error.code === "LIMIT_FILE_SIZE") {
            res.status(400).json({ error: `PDF must be ${MAX_MB} MB or smaller` });
            return;
        }

        if (error.message === "Only PDF files are allowed") {
            res.status(400).json({ error: error.message });
            return;
        }

        next(error);
    });
}

async function processAttachment(attachment, filePath) {
    try {
        const pages = await extractPdfPages(filePath);
        const chunks = chunkPages(pages, attachment.originalFilename);

        if (!chunks.length) {
            await chatAttachmentsDb.update(attachment.id, {
                status: "failed",
                errorMessage: "No readable text found in PDF",
            });
            return;
        }

        const existingCount = await documentChunksDb.countByThreadId(
            attachment.chatThreadId
        );

        let embeddings = [];
        try {
            embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
        } catch (error) {
            console.error("Chunk embedding error:", error);
        }

        const chunkDocs = chunks.map((chunk, index) => ({
            attachmentId: attachment.id,
            chatThreadId: attachment.chatThreadId,
            assignmentId: attachment.assignmentId,
            participantID: attachment.participantID,
            systemID: attachment.systemID,
            chunkIndex: existingCount + index,
            text: chunk.text,
            sourceFilename: chunk.sourceFilename,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            embedding: embeddings[index] || null,
            embeddingModel: embeddings[index] ? EMBEDDING_MODEL : null,
        }));

        await documentChunksDb.insertMany(chunkDocs);

        await chatAttachmentsDb.update(attachment.id, {
            status: "ready",
            chunkCount: chunks.length,
            errorMessage: null,
        });
    } catch (error) {
        await chatAttachmentsDb.update(attachment.id, {
            status: "failed",
            errorMessage: error.message || "Could not process PDF",
        });
    }
}

router.get("/", async (req, res) => {
    try {
        const ids = requireParticipantAssignment(req, res);
        if (!ids) return;

        const thread = await findOwnedThread(
            req.params.chatThreadId,
            ids.participantID,
            ids.assignmentId
        );

        if (!thread) {
            return res.status(404).json({ error: "Chat thread not found" });
        }

        const attachments = await chatAttachmentsDb.findPendingByThread(
            thread.id
        );

        res.json({ attachments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/", handleUpload, async (req, res) => {
    try {
        const ids = requireParticipantAssignment(req, res);
        if (!ids) return;

        if (!req.file) {
            return res.status(400).json({ error: "PDF file required" });
        }

        const thread = await findOwnedThread(
            req.params.chatThreadId,
            ids.participantID,
            ids.assignmentId
        );

        if (!thread) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: "Chat thread not found" });
        }

        let attachment = await chatAttachmentsDb.create({
            participantID: ids.participantID,
            assignmentId: ids.assignmentId,
            systemID: ids.systemID,
            chatThreadId: thread.id,
            originalFilename: req.file.originalname,
            storedFilename: req.file.filename,
            mimeType: req.file.mimetype,
            sizeBytes: req.file.size,
            status: "processing",
        });

        await processAttachment(attachment, req.file.path);
        attachment = await chatAttachmentsDb.findById(attachment.id);

        res.status(201).json({ attachment });
    } catch (error) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        if (error.message === "Only PDF files are allowed") {
            return res.status(400).json({ error: error.message });
        }

        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: `PDF must be ${MAX_MB} MB or smaller` });
        }

        res.status(400).json({ error: error.message });
    }
});

router.delete("/:attachmentId", async (req, res) => {
    try {
        const ids = requireParticipantAssignment(req, res);
        if (!ids) return;

        if (!isValidId(req.params.attachmentId)) {
            return res.status(404).json({ error: "Attachment not found" });
        }

        const thread = await findOwnedThread(
            req.params.chatThreadId,
            ids.participantID,
            ids.assignmentId
        );

        if (!thread) {
            return res.status(404).json({ error: "Chat thread not found" });
        }

        const attachment = await chatAttachmentsDb.findById(
            req.params.attachmentId
        );

        if (
            !attachment ||
            String(attachment.chatThreadId) !== String(thread.id) ||
            attachment.exchangeId
        ) {
            return res.status(404).json({ error: "Attachment not found" });
        }

        const filePath = path.join(
            UPLOAD_ROOT,
            attachment.participantID,
            String(attachment.chatThreadId),
            attachment.storedFilename
        );

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await documentChunksDb.deleteByAttachmentId(attachment.id);
        await chatAttachmentsDb.remove(attachment.id);

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
