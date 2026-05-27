require("dotenv").config(); // loads MONGODB_URI from .env into process.env
const mongoose = require("mongoose"); // Node.js library for communicating with MongoDB

// Connection function
async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("MongoDB connected");
    } catch (error) {
        console.error("MongoDB connection error:", error.message);
        process.exit(1);
    }
}

module.exports = connectDB;

