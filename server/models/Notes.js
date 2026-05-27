const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const NoteSchema = new Schema({
    participantID: { type: String },
    sessionID: { type: String },
    systemID: { type: String }, // necessary since we only have baseline?
    noteType: { type: String },   // "plain" or "pleading"
    title: { type: String },
    content: { type: String },
    version: { type: Number, default: 1 },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Note", NoteSchema)