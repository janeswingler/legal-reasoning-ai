const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SystemInteractionSchema = new Schema({
    participantID: { type: String },
    systemID: { type: String },
    sessionID: { type: String },
    eventType: { type: String },
    elementName: { type: String },
    eventProps: { type: Schema.Types.Mixed },
    clientTs: { type: Date },
    page: { type: String },
    uiVersion: { type: String },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("SystemInteraction", SystemInteractionSchema);