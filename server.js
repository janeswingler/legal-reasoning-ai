require("dotenv").config();
const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { connectDB } = require("./server/config/db.js");
const { accessGateMiddleware } = require("./server/middleware/accessGate.js");
const { closeBrowser, warmUp } = require("./server/services/pdfGenerator.js");

const accessRoutes = require("./server/routes/access.js");
const assignmentsRoutes = require("./server/routes/assignments.js");
const chatRoutes = require("./server/routes/chat.js");
const systemInteractionRoutes = require("./server/routes/systemInteractions.js");
const googleAuthRoutes = require("./server/routes/googleAuth.js");

const app = express();
const PORT = process.env.HTTPS_PORT || process.env.PORT || 3000;

// Pleading HTML posted to /api/assignments/pdf exceeds the 100kb default.
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (req, res) => {
    res.json({ ok: true });
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

    // Fire and forget: don't hold up listen, but have Chrome ready before the
    // first submit so nobody pays the cold start.
    warmUp().then((ok) => {
        if (ok) {
            console.log("PDF renderer warm");
        }
    });

    const certsDir = path.join(__dirname, "certs");
    const keyPath = path.join(certsDir, "cst.key");
    const certPath = path.join(certsDir, "fullchain.pem");

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        const options = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
        };
        https.createServer(options, app).listen(PORT, () => {
            console.log(`HTTPS server listening on https://localhost:${PORT}`);
        });
    } else {
        http.createServer(app).listen(PORT, () => {
            console.log(
                `HTTP server listening on http://localhost:${PORT} (no certs in ./certs)`
            );
        });
    }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
        await closeBrowser();
        process.exit(0);
    });
}

start();
