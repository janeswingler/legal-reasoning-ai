require("dotenv").config();
const express = require("express");
const path = require("path");
const { connectDB } = require("./server/config/db.js");

const assignmentsRoutes = require("./server/routes/assignments.js");
const chatRoutes = require("./server/routes/chat.js");
const systemInteractionRoutes = require("./server/routes/systemInteractions.js");
const googleAuthRoutes = require("./server/routes/googleAuth.js");

const app = express();
const PORT = process.env.PORT || 3000

app.use(express.json());

app.use("/api/assignments", assignmentsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/system-interactions", systemInteractionRoutes);
app.use("/api/auth/google", googleAuthRoutes);

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
    res.json({ok: true});
});

async function start() {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

start();