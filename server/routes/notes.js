const express = require("express");
const Note = require("../models/Notes.js");

const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const { participantID } = req.query;
        if (!participantID) {
            return res.status(400).json({ error: "participantID required" });
        }
        const notes = await Note.find({ participantID }).sort({ timestamp: -1 });
        res.json(notes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/current", async (req, res) => {
    try {
        const { participantID, assignmentId } = req.query;

        if (!participantID || !assignmentId) {
            return res.status(400).json({
                error: "participantID and assignmentId required",
            });
        }

        const note = await Note.findOne({ participantID, assignmentId });

        if (!note) {
            return res.status(404).json({ error: "Note not found" });
        }

        res.json(note);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) {
            return res.status(404).json({ error: "Note not found" });
        }
        res.json(note);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/", async (req, res) => {
    try {
        const note = await Note.create(req.body);
        res.status(201).json(note);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.put("/current", async (req, res) => {
    try {
        const {
            participantID,
            assignmentId,
            sessionID,
            systemID,
            content,
            title,
            noteType,
        } = req.body;

        if (!participantID || !assignmentId) {
            return res.status(400).json({
                error: "participantID and assignmentId required",
            });
        }

        let note = await Note.findOne({ participantID, assignmentId });

        if (note) {
            note.sessionID = sessionID;
            note.systemID = systemID;
            note.content = content;
            note.title = title;
            if (noteType !== undefined) note.noteType = noteType;
            note.version += 1;
            note.timestamp = new Date();
            await note.save();
            return res.json(note);
        }

        note = await Note.create({
            participantID,
            assignmentId,
            sessionID,
            systemID,
            content,
            title,
            noteType: noteType || "pleading",
        });

        res.status(201).json(note);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.put("/:id", async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) {
            return res.status(404).json({ error: "Note not found" });
        }
        const { title, content, noteType } = req.body;
        if (title !== undefined) note.title = title;
        if (content !== undefined) note.content = content;
        if (noteType !== undefined) note.noteType = noteType;
        note.version += 1;
        note.timestamp = new Date();
        await note.save();
        res.json(note);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
