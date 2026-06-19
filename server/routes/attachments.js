const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const ChatSession = require("../models/ChatSession.js");
const ChatAttachment = require("../models/ChatAttachment.js");
const DocumentChunk = require("../models/DocumentChunk.js");
const { extractPdfPages } = require("../services/pdf.js");
const { chunkPages } = require("../services/chunking.js");
const { embedTexts } = require("../services/openai.js");
const { EMBEDDING_MODEL } = require("../config/rag.js");

const router = express.Router({ mergeParams: true });

const UPLOAD_ROOT = path.join(__dirname, "../../uploads");
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_MB = MAX_BYTES / (1024 * 1024);

function requireParticipantAssignment(req, res) {
    const participantID = req.query.participantID || req.body.participantID;
    const assignmentId = req.query.assignmentId || req.body.assignmentId;

    if (!participantID || !assignmentId) {
        res.status(400).json({ error: "participantID and assignmentId required" });
        return null;
    }

    return { participantID, assignmentId };
}

async function findOwnedSession(chatSessionId, participantID, assignmentId) {
    if (!mongoose.Types.ObjectId.isValid(chatSessionId)) {
        return null;
    }

    return ChatSession.findOne({
        _id: chatSessionId,
        participantID,
        assignmentId,
    });
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const participantID = req.body.participantID || "unknown";
        const chatSessionId = req.params.chatSessionId;
        const dir = path.join(UPLOAD_ROOT, participantID, chatSessionId);
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
            attachment.status = "failed";
            attachment.errorMessage = "No readable text found in PDF";
            await attachment.save();
            return;
        }

        const existingCount = await DocumentChunk.countDocuments({
            chatSessionId: attachment.chatSessionId,
        });

        let embeddings = [];
        try {
            embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
        } catch (error) {
            console.error("Chunk embedding error:", error);
        }

        const chunkDocs = chunks.map((chunk, index) => ({
            attachmentId: attachment._id,
            chatSessionId: attachment.chatSessionId,
            assignmentId: attachment.assignmentId,
            participantID: attachment.participantID,
            chunkIndex: existingCount + index,
            text: chunk.text,
            sourceFilename: chunk.sourceFilename,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            embedding: embeddings[index] || null,
            embeddingModel: embeddings[index] ? EMBEDDING_MODEL : null,
        }));

        await DocumentChunk.insertMany(chunkDocs);

        attachment.status = "ready";
        attachment.chunkCount = chunks.length;
        attachment.errorMessage = null;
        await attachment.save();
    } catch (error) {
        attachment.status = "failed";
        attachment.errorMessage = error.message || "Could not process PDF";
        await attachment.save();
    }
}

router.get("/", async (req, res) => {
    try {
        const ids = requireParticipantAssignment(req, res);
        if (!ids) return;

        const session = await findOwnedSession(
            req.params.chatSessionId,
            ids.participantID,
            ids.assignmentId
        );

        if (!session) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        const attachments = await ChatAttachment.find({
            chatSessionId: session._id,
        }).sort({ createdAt: -1 });

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

        const session = await findOwnedSession(
            req.params.chatSessionId,
            ids.participantID,
            ids.assignmentId
        );

        if (!session) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: "Chat session not found" });
        }

        const attachment = await ChatAttachment.create({
            participantID: ids.participantID,
            assignmentId: ids.assignmentId,
            chatSessionId: session._id,
            originalFilename: req.file.originalname,
            storedFilename: req.file.filename,
            mimeType: req.file.mimetype,
            sizeBytes: req.file.size,
            status: "processing",
        });

        await processAttachment(attachment, req.file.path);

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

        if (!mongoose.Types.ObjectId.isValid(req.params.attachmentId)) {
            return res.status(404).json({ error: "Attachment not found" });
        }

        const session = await findOwnedSession(
            req.params.chatSessionId,
            ids.participantID,
            ids.assignmentId
        );

        if (!session) {
            return res.status(404).json({ error: "Chat session not found" });
        }

        const attachment = await ChatAttachment.findOne({
            _id: req.params.attachmentId,
            chatSessionId: session._id,
        });

        if (!attachment) {
            return res.status(404).json({ error: "Attachment not found" });
        }

        const filePath = path.join(
            UPLOAD_ROOT,
            attachment.participantID,
            String(attachment.chatSessionId),
            attachment.storedFilename
        );

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await DocumentChunk.deleteMany({ attachmentId: attachment._id });
        await attachment.deleteOne();

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
