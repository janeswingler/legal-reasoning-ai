const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ChatSessionSchema = new Schema(
    {
        participantID: { type: String, required: true },
        assignmentId: { type: String, required: true },
        sessionID: { type: String },
        systemID: { type: String },
        title: { type: String, default: null },
    },
    { timestamps: true }
);

ChatSessionSchema.index({ participantID: 1, assignmentId: 1, updatedAt: -1 });

module.exports = mongoose.model("ChatSession", ChatSessionSchema);
