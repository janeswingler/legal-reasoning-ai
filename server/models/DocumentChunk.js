const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const DocumentChunkSchema = new Schema(
    {
        attachmentId: { type: Schema.Types.ObjectId, ref: "ChatAttachment", required: true },
        chatSessionId: { type: Schema.Types.ObjectId, ref: "ChatSession", required: true },
        assignmentId: { type: String, required: true },
        participantID: { type: String, required: true },
        chunkIndex: { type: Number, required: true },
        text: { type: String, required: true },
        sourceFilename: { type: String, required: true },
        pageStart: { type: Number, default: null },
        pageEnd: { type: Number, default: null },
        embedding: { type: [Number], default: null },
        embeddingModel: { type: String, default: null },
    },
    { timestamps: true }
);

DocumentChunkSchema.index({ chatSessionId: 1, chunkIndex: 1 });
DocumentChunkSchema.index({ attachmentId: 1, chunkIndex: 1 });

module.exports = mongoose.model("DocumentChunk", DocumentChunkSchema);
