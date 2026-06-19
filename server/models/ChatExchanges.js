const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ChatExchangeSchema = new Schema({
    participantID: { type: String },
    sessionID: { type: String },
    chatSessionId: { type: Schema.Types.ObjectId, ref: "ChatSession", required: true },
    assignmentId: { type: String, required: true },
    systemID: { type: String },
    userInput: { type: String },
    botResponse: { type: String },
    retrievedChunkIds: [{ type: Schema.Types.ObjectId, ref: "DocumentChunk" }],
    retrievalMeta: {
        ragVersion: { type: String, default: null },
        chunkCount: { type: Number, default: 0 },
        scores: [
            {
                chunkId: { type: Schema.Types.ObjectId, ref: "DocumentChunk" },
                bm25Score: { type: Number, default: null },
                denseScore: { type: Number, default: null },
                combinedScore: { type: Number, default: null },
            },
        ],
    },
    timestamp: { type: Date, default: Date.now },
});

ChatExchangeSchema.index({ chatSessionId: 1, timestamp: 1 });

module.exports = mongoose.model("ChatExchange", ChatExchangeSchema);
