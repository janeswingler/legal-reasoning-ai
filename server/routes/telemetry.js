const express = require("express");
const systemInteractionsDb = require("../db/systemInteractions.js");
const studySessionsDb = require("../db/studySessions.js");
const editorSnapshotsDb = require("../db/editorSnapshots.js");
const clipboardEventsDb = require("../db/clipboardEvents.js");

const router = express.Router();

const MAX_EVENTS_PER_BATCH = 200;

function readIdentity(body) {
    return {
        participantID: body?.participantID ?? null,
        assignmentId: body?.assignmentId ?? null,
        sessionID: body?.sessionID ?? null,
        systemID: body?.systemID ?? null,
    };
}

function requireIdentity(identity) {
    return Boolean(identity.participantID && identity.assignmentId && identity.sessionID);
}

router.post("/session/start", async (req, res) => {
    try {
        const identity = readIdentity(req.body);
        if (!requireIdentity(identity)) {
            return res.status(400).json({
                error: "participantID, assignmentId, and sessionID required",
            });
        }

        const { session, serverNow } = await studySessionsDb.start({
            ...identity,
            clientStartedAt: req.body?.clientStartedAt,
            userAgent: req.body?.userAgent || req.get("user-agent"),
            screenW: req.body?.screenW,
            screenH: req.body?.screenH,
            viewportW: req.body?.viewportW,
            viewportH: req.body?.viewportH,
            tzOffsetMin: req.body?.tzOffsetMin,
        });

        res.status(201).json({ session, serverNow: serverNow.toISOString() });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/events", async (req, res) => {
    try {
        const identity = readIdentity(req.body);
        if (!requireIdentity(identity)) {
            return res.status(400).json({
                error: "participantID, assignmentId, and sessionID required",
            });
        }

        const events = Array.isArray(req.body?.events) ? req.body.events : [];
        if (events.length > MAX_EVENTS_PER_BATCH) {
            return res
                .status(413)
                .json({ error: `batch exceeds ${MAX_EVENTS_PER_BATCH} events` });
        }

        const inserted = await systemInteractionsDb.createMany(events, identity);

        // Keeps last_seen_at fresh so a session whose close beacon is lost can
        // still be bounded during analysis.
        await studySessionsDb.touch(identity.sessionID);

        res.status(201).json({ inserted });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/session/end", async (req, res) => {
    try {
        const identity = readIdentity(req.body);
        if (!identity.sessionID) {
            return res.status(400).json({ error: "sessionID required" });
        }

        // A close beacon usually carries the final queued events alongside it.
        const events = Array.isArray(req.body?.events) ? req.body.events : [];
        if (events.length && requireIdentity(identity)) {
            await systemInteractionsDb.createMany(events, identity);
        }

        await studySessionsDb.end(identity.sessionID, {
            endedAt: req.body?.endedAt,
            reason: req.body?.reason,
        });

        res.status(200).json({ ok: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/snapshot", async (req, res) => {
    try {
        const identity = readIdentity(req.body);
        if (!requireIdentity(identity)) {
            return res.status(400).json({
                error: "participantID, assignmentId, and sessionID required",
            });
        }

        const result = await editorSnapshotsDb.create({
            ...identity,
            contentHtml: req.body?.contentHtml,
            plainText: req.body?.plainText,
            reason: req.body?.reason,
            clientTs: req.body?.clientTs,
            keystrokesSincePrev: req.body?.keystrokesSincePrev,
        });

        res.status(result.skipped ? 200 : 201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/clipboard", async (req, res) => {
    try {
        const identity = readIdentity(req.body);
        if (!requireIdentity(identity)) {
            return res.status(400).json({
                error: "participantID, assignmentId, and sessionID required",
            });
        }

        const event = await clipboardEventsDb.create({
            ...identity,
            action: req.body?.action,
            surface: req.body?.surface,
            content: req.body?.content,
            chatSessionId: req.body?.chatSessionId,
            clientTs: req.body?.clientTs,
        });

        res.status(201).json(event);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
