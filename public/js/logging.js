const UI_VERSION = "v2";

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT_COUNT = 20;

// Server rejects batches larger than this; keep the client below it.
const MAX_EVENTS_PER_BATCH = 200;

// If the network is down for a long stretch, stop the queue growing without
// bound. Oldest events are dropped first so the recent picture stays intact.
const MAX_QUEUE_LENGTH = 500;

// The sequence counter must keep climbing across reloads. A reload keeps the
// same sessionStorage session id, so restarting at 1 would collide with the
// rows already written and the server would discard the new events as
// duplicates - silent data loss for the rest of the sitting.
const SEQ_STORAGE_KEY = "lrai_telemetrySeq";

const telemetryQueue = [];
let sessionSeq = Number(sessionStorage.getItem(SEQ_STORAGE_KEY) || 0) || 0;
let flushTimer = null;
let flushInFlight = false;
let sessionClosed = false;

function identityPayload() {
    return {
        participantID: config.participantID,
        assignmentId: config.assignmentId,
        sessionID: config.sessionID,
        systemID: config.systemID,
    };
}

function postJson(path, payload) {
    return fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
    });
}

/**
 * Queue an interaction. Nothing hits the network until a flush, so
 * high-frequency events (typing buckets, focus changes) cost one request per
 * batch rather than one each.
 */
function logEvent({
    eventType,
    elementName,
    page,
    valueNum = null,
    durationMs = null,
    eventProps = {},
}) {
    sessionSeq += 1;
    try {
        sessionStorage.setItem(SEQ_STORAGE_KEY, String(sessionSeq));
    } catch {
        // Private-browsing quota failures must not stop the event itself.
    }

    telemetryQueue.push({
        sessionSeq,
        eventType,
        elementName: elementName ?? null,
        page: page ?? null,
        valueNum,
        durationMs,
        eventProps: { assignmentId: config.assignmentId, ...eventProps },
        clientTs: new Date().toISOString(),
        uiVersion: UI_VERSION,
    });

    if (telemetryQueue.length > MAX_QUEUE_LENGTH) {
        telemetryQueue.splice(0, telemetryQueue.length - MAX_QUEUE_LENGTH);
    }

    if (telemetryQueue.length >= FLUSH_AT_COUNT) {
        flushEvents();
    } else {
        scheduleFlush();
    }
}

// Kept so any cached page or unconverted caller keeps working.
function logSystemInteraction({ eventType, elementName, page, eventProps = {} }) {
    logEvent({ eventType, elementName, page, eventProps });
}

function scheduleFlush() {
    if (flushTimer !== null || sessionClosed) {
        return;
    }
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushEvents();
    }, FLUSH_INTERVAL_MS);
}

async function flushEvents() {
    if (flushInFlight || sessionClosed || telemetryQueue.length === 0) {
        return;
    }

    if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    flushInFlight = true;
    const batch = telemetryQueue.splice(0, MAX_EVENTS_PER_BATCH);

    try {
        const response = await postJson("/api/telemetry/events", {
            ...identityPayload(),
            events: batch,
        });

        if (!response.ok) {
            throw new Error(`events flush failed: ${response.status}`);
        }
    } catch {
        // Put them back in order and let the next tick retry. Duplicate
        // sequence numbers are ignored server-side, so a partial success that
        // we treated as a failure cannot double-count.
        telemetryQueue.unshift(...batch);
        if (telemetryQueue.length > MAX_QUEUE_LENGTH) {
            telemetryQueue.splice(0, telemetryQueue.length - MAX_QUEUE_LENGTH);
        }
    } finally {
        flushInFlight = false;
        if (telemetryQueue.length > 0) {
            scheduleFlush();
        }
    }
}

async function startTelemetrySession() {
    try {
        await postJson("/api/telemetry/session/start", {
            ...identityPayload(),
            clientStartedAt: new Date().toISOString(),
            userAgent: navigator.userAgent,
            screenW: window.screen?.width ?? null,
            screenH: window.screen?.height ?? null,
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            tzOffsetMin: new Date().getTimezoneOffset(),
        });
    } catch {
        // A missing session row still leaves every event tagged with its id,
        // so analysis can reconstruct the sitting from the events alone.
    }
}

/**
 * Final write on page close. sendBeacon is the only transport the browser
 * guarantees to deliver during unload, and it carries whatever is still queued
 * so the last events of a sitting are not lost.
 */
function endTelemetrySession(reason) {
    if (sessionClosed) {
        return;
    }
    sessionClosed = true;

    if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    const payload = {
        ...identityPayload(),
        events: telemetryQueue.splice(0, MAX_EVENTS_PER_BATCH),
        endedAt: new Date().toISOString(),
        reason: reason || "pagehide",
    };

    const body = new Blob([JSON.stringify(payload)], {
        type: "application/json",
    });

    if (!navigator.sendBeacon?.("/api/telemetry/session/end", body)) {
        postJson("/api/telemetry/session/end", payload).catch(() => {});
    }
}

function postClipboardEvent({ action, surface, content, chatSessionId = null }) {
    postJson("/api/telemetry/clipboard", {
        ...identityPayload(),
        action,
        surface,
        content,
        chatSessionId,
        clientTs: new Date().toISOString(),
    }).catch(() => {});
}

function postEditorSnapshot({ contentHtml, plainText, reason, keystrokesSincePrev = null }) {
    return postJson("/api/telemetry/snapshot", {
        ...identityPayload(),
        contentHtml,
        plainText,
        reason,
        keystrokesSincePrev,
        clientTs: new Date().toISOString(),
    }).catch(() => {});
}
