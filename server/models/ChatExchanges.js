const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ChatExchangeSchema = new Schema({
    participantID: { type: String },
    systemID: { type: String },
    sessionID: { type: String },
    userInput: { type: String },
    botResponse: { type: String },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("ChatExchange", ChatExchangeSchema);