const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ChatAttachmentSchema = new Schema(
    {
        participantID: { type: String, required: true },
        assignmentId: { type: String, required: true },
        chatSessionId: { type: Schema.Types.ObjectId, ref: "ChatSession", required: true },
        originalFilename: { type: String, required: true },
        storedFilename: { type: String, required: true },
        mimeType: { type: String, required: true },
        sizeBytes: { type: Number, required: true },
        status: {
            type: String,
            enum: ["processing", "ready", "failed"],
            default: "processing",
        },
        errorMessage: { type: String, default: null },
        chunkCount: { type: Number, default: 0 },
    },
    { timestamps: true }
);

ChatAttachmentSchema.index({ chatSessionId: 1, createdAt: -1 });

module.exports = mongoose.model("ChatAttachment", ChatAttachmentSchema);
