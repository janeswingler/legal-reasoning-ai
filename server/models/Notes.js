const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const NoteSchema = new Schema({
    participantID: { type: String },
    sessionID: { type: String },
    systemID: { type: String },
    assignmentId: { type: String, required: true },
    noteType: { type: String },
    title: { type: String },
    content: { type: String },
    version: { type: Number, default: 1 },
    timestamp: { type: Date, default: Date.now },
});

NoteSchema.index({ participantID: 1, assignmentId: 1 }, { unique: true });

module.exports = mongoose.model("Note", NoteSchema);
