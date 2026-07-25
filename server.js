require("dotenv").config();
const express = require("express");
const path = require("path");
const { connectDB } = require("./server/config/db.js");
const { accessGateMiddleware } = require("./server/middleware/accessGate.js");

const accessRoutes = require("./server/routes/access.js");
const assignmentsRoutes = require("./server/routes/assignments.js");
const chatRoutes = require("./server/routes/chat.js");
const systemInteractionRoutes = require("./server/routes/systemInteractions.js");
const googleAuthRoutes = require("./server/routes/googleAuth.js");

const app = express();
const PORT = process.env.PORT || 3000

app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({ok: true});
});

app.use("/api/access", accessRoutes);
app.use(accessGateMiddleware);

app.use("/api/assignments", assignmentsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/system-interactions", systemInteractionRoutes);
app.use("/api/auth/google", googleAuthRoutes);

app.use(express.static(path.join(__dirname, "public")));

async function start() {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

start();