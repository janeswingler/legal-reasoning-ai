const express = require("express");
const systemInteractionsDb = require("../db/systemInteractions.js");
const studySessionsDb = require("../db/studySessions.js");
const editorSnapshotsDb = require("../db/editorSnapshots.js");
const clipboardEventsDb = require("../db/clipboardEvents.js");
const assignmentsDb = require("../db/assignments.js");

const router = express.Router();

const MAX_EVENTS_PER_BATCH = 200;
const IDENTITY_REQUIRED_MESSAGE = "participantID, assignmentId, and studySessionId required";

function readIdentity(req) {
    const body = req.body || {};
    return {
        participantID: req.study?.participantID ?? null,
        assignmentId: req.study?.memoId ?? null,
        studySessionId: body.studySessionId ?? null,
        // The condition is what the study mapping says, never what the page sent.
        systemID: req.study?.systemID ?? null,
    };
}

function requireIdentity(identity) {
    return Boolean(identity.participantID && identity.assignmentId && identity.studySessionId);
}

/**
 * Telemetry failures must be loud on the server: the browser deliberately
 * swallows them so a participant is never interrupted by logging.
 */
function fail(res, label, error) {
    console.error(`telemetry: ${label} failed:`, error);
    res.status(500).json({ error: `${label} failed` });
}

router.post("/session/start", async (req, res) => {
    try {
        const identity = readIdentity(req);
        if (!requireIdentity(identity)) {
            return res.status(400).json({ error: IDENTITY_REQUIRED_MESSAGE });
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
        fail(res, "session/start", error);
    }
});

router.post("/events", async (req, res) => {
    try {
        const identity = readIdentity(req);
        if (!requireIdentity(identity)) {
            return res.status(400).json({ error: IDENTITY_REQUIRED_MESSAGE });
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
        const touched = await studySessionsDb.touch(identity.studySessionId);

        // If the session/start request was lost (a network blip at page load),
        // the events still name the sitting. Open it from them rather than let
        // the memo disappear from the summary view.
        if (!touched) {
            await studySessionsDb.start({
                ...identity,
                userAgent: req.get("user-agent"),
            });
        }

        res.status(201).json({ inserted });
    } catch (error) {
        fail(res, "events", error);
    }
});

router.post("/session/end", async (req, res) => {
    try {
        const identity = readIdentity(req);
        if (!identity.studySessionId) {
            return res.status(400).json({ error: "studySessionId required" });
        }

        // A close beacon usually carries the final queued events alongside it.
        const events = Array.isArray(req.body?.events) ? req.body.events : [];
        if (events.length && requireIdentity(identity)) {
            await systemInteractionsDb.createMany(events, identity);
        }

        await studySessionsDb.end(identity.studySessionId, { reason: req.body?.reason });

        res.status(200).json({ ok: true });
    } catch (error) {
        fail(res, "session/end", error);
    }
});

router.post("/snapshot", async (req, res) => {
    try {
        const identity = readIdentity(req);
        if (!requireIdentity(identity)) {
            return res.status(400).json({ error: IDENTITY_REQUIRED_MESSAGE });
        }

        // The revision history ends at submission. A page that reaches the
        // editor afterwards (a cached copy on a Back navigation, say) must not
        // append an empty or stale revision that would become the "final" one.
        const assignment = await assignmentsDb.findByParticipantAndAssignment(
            identity.participantID,
            identity.assignmentId
        );
        if (assignment?.submittedAt) {
            return res.status(200).json({ skipped: true, reason: "submitted", snapshot: null });
        }

        const result = await editorSnapshotsDb.create({
            ...identity,
            contentHtml: req.body?.contentHtml,
            reason: req.body?.reason,
            clientTs: req.body?.clientTs,
            keystrokesSincePrev: req.body?.keystrokesSincePrev,
        });

        res.status(result.skipped ? 200 : 201).json(result);
    } catch (error) {
        fail(res, "snapshot", error);
    }
});

router.post("/clipboard", async (req, res) => {
    try {
        const identity = readIdentity(req);
        if (!requireIdentity(identity)) {
            return res.status(400).json({ error: IDENTITY_REQUIRED_MESSAGE });
        }

        const action = String(req.body?.action || "").toLowerCase();
        if (!["copy", "cut", "paste"].includes(action)) {
            return res.status(400).json({ error: "action must be copy, cut, or paste" });
        }

        const event = await clipboardEventsDb.create({
            ...identity,
            action,
            surface: req.body?.surface,
            content: req.body?.content,
            chatThreadId: req.body?.chatThreadId,
            clientTs: req.body?.clientTs,
        });

        res.status(201).json(event);
    } catch (error) {
        fail(res, "clipboard", error);
    }
});

module.exports = router;
