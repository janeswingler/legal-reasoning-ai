require("dotenv").config();
const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { connectDB } = require("./server/config/db.js");
const { accessGateMiddleware } = require("./server/middleware/accessGate.js");
const { closeBrowser, warmUp } = require("./server/services/pdfGenerator.js");
const assignmentsDb = require("./server/db/assignments.js");
const { sanitizeId } = require("./server/services/studyIdentifiers.js");
const { resolveMemoNumber } = require("./server/services/studyRouting.js");
const {
    loadParticipantConditions,
    getSystemId,
    getParticipantCount,
    getMemoCount,
} = require("./server/services/participantConditions.js");
const {
    ASSIGNMENT_STATES,
    findAssignmentState,
    buildStateRedirect,
    buildEditorUrl,
} = require("./server/services/assignmentState.js");

const accessRoutes = require("./server/routes/access.js");
const assignmentsRoutes = require("./server/routes/assignments.js");
const questionnaireRoutes = require("./server/routes/questionnaire.js");
const chatRoutes = require("./server/routes/chat.js");
const systemInteractionRoutes = require("./server/routes/systemInteractions.js");
const telemetryRoutes = require("./server/routes/telemetry.js");
const googleAuthRoutes = require("./server/routes/googleAuth.js");

const app = express();
const PORT = process.env.HTTPS_PORT || process.env.PORT || 3000;

// Pleading HTML posted to /api/assignments/pdf exceeds the 100kb default.
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

// Canvas links may be written as /memoID=1. Send them to the landing page query.
app.use((req, res, next) => {
    const match = req.path.replace(/\/+/g, "/").match(/^\/memoID=(\d+)$/i);
    if (!match) {
        return next();
    }
    return res.redirect(302, `/?memoID=${match[1]}`);
});

app.use("/api/access", accessRoutes);

// Outside the access gate: participants come back from Qualtrics on whatever
// machine they took the survey on, which may never have held the cookie.
app.use("/questionnaire", questionnaireRoutes);

app.use(accessGateMiddleware);

/**
 * Everything the editor page trusts is settled here, before it is served.
 *
 * The browser reads its condition straight from the URL, so this route is what
 * makes that safe: an unknown participant, an out-of-range memo, or a hand
 * edited systemID never reaches the page.
 */
app.get("/app.html", async (req, res, next) => {
    let participantID;
    try {
        participantID = sanitizeId(req.query.participantID, "Participant ID");
    } catch (error) {
        return res.redirect(302, "/");
    }

    const memoNumber = resolveMemoNumber(req.query.memoID ?? req.query.assignment);
    if (!memoNumber) {
        return res.redirect(302, "/");
    }

    const systemID = getSystemId(participantID, memoNumber);
    if (!systemID) {
        return res.redirect(302, "/");
    }

    try {
        const { state } = await findAssignmentState(
            assignmentsDb,
            participantID,
            memoNumber
        );

        if (state !== ASSIGNMENT_STATES.WRITING) {
            return res.redirect(
                302,
                buildStateRedirect({ state, participantID, memoNumber, systemID })
            );
        }
    } catch (error) {
        // A lookup failure should not lock anyone out of their own writing.
        console.error("Editor state check failed:", error);
    }

    // Rewrite rather than reject: a stale or edited link still lands the
    // participant in their assigned condition.
    if (req.query.systemID !== systemID) {
        return res.redirect(
            302,
            buildEditorUrl({ participantID, memoNumber, systemID })
        );
    }

    return next();
});

app.use("/api/assignments", assignmentsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/system-interactions", systemInteractionRoutes);
app.use("/api/telemetry", telemetryRoutes);
app.use("/api/auth/google", googleAuthRoutes);

app.use(express.static(path.join(__dirname, "public")));

async function start() {
    // Before anything else: a broken mapping would route participants into the
    // wrong condition, which is worse than not starting at all.
    const conditions = loadParticipantConditions();
    console.log(
        `Loaded condition mapping for ${getParticipantCount()} participants ` +
            `across ${getMemoCount()} memos (${conditions.filePath})`
    );

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
