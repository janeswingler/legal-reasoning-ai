const UI_VERSION = "v2";

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT_COUNT = 20;

// Server rejects batches larger than this; keep the client below it.
const MAX_EVENTS_PER_BATCH = 200;

// Browsers refuse a keepalive request or a beacon whose body would push the
// in-flight total past 64 KiB, and the refusal is a thrown error rather than a
// failed response. A retry batch after an offline spell can hold 200 events
// of 300-450 bytes each, well over that, and it would then be retried forever
// while newer events fell off the end of the queue. So batches are capped by
// size as well as by count, with room to spare for the identity fields.
const MAX_BATCH_BYTES = 40000;

// If the network is down for a long stretch, stop the queue growing without
// bound. Oldest events are dropped first so the recent picture stays intact.
const MAX_QUEUE_LENGTH = 500;

// The sequence counter must keep climbing across reloads. A reload keeps the
// same sessionStorage session id, so restarting at 1 would collide with the
// rows already written and the server would discard the new events as
// duplicates - silent data loss for the rest of the sitting. Keyed by session
// id so a new sitting in the same tab starts back at 1.
const SEQ_STORAGE_KEY = `lrai_telemetrySeq:${config.studySessionId}`;

const telemetryQueue = [];
let sessionSeq = Number(sessionStorage.getItem(SEQ_STORAGE_KEY) || 0) || 0;
let flushTimer = null;
let flushInFlight = false;
let sessionClosed = false;
// Clipboard posts go out one at a time so a paste is never classified before
// the copy it came from has been recorded.
let clipboardChain = Promise.resolve();

function identityPayload() {
    return {
        participantID: config.participantID,
        // Wire and database still say assignmentId / assignment_id.
        assignmentId: config.memoId,
        studySessionId: config.studySessionId,
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
    // After the close beacon nothing can be delivered (the browser fires a
    // final visibilitychange after pagehide). Taking a sequence number for it
    // would leave a gap that looks like a lost event.
    if (sessionClosed) {
        return;
    }

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
        eventProps: { assignmentId: config.memoId, ...eventProps },
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

/** Takes the next batch off the queue, stopping at either cap. */
function takeBatch() {
    const batch = [];
    let bytes = 0;
    while (telemetryQueue.length > 0 && batch.length < MAX_EVENTS_PER_BATCH) {
        const size = JSON.stringify(telemetryQueue[0]).length + 1;
        if (batch.length > 0 && bytes + size > MAX_BATCH_BYTES) {
            break;
        }
        batch.push(telemetryQueue.shift());
        bytes += size;
    }
    return batch;
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
    const batch = takeBatch();

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
        // A backlog (typically after an offline spell) drains in consecutive
        // batches rather than one every five seconds.
        if (telemetryQueue.length >= FLUSH_AT_COUNT) {
            flushEvents();
        } else if (telemetryQueue.length > 0) {
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

    // Whatever is still queued goes out in size-capped beacons: earlier chunks
    // to the events endpoint, the final chunk together with the close itself.
    const chunks = [];
    while (telemetryQueue.length > 0) {
        chunks.push(takeBatch());
    }
    const lastChunk = chunks.pop() || [];

    for (const chunk of chunks) {
        sendBeaconJson("/api/telemetry/events", {
            ...identityPayload(),
            events: chunk,
        });
    }

    sendBeaconJson("/api/telemetry/session/end", {
        ...identityPayload(),
        events: lastChunk,
        endedAt: new Date().toISOString(),
        reason: reason || "pagehide",
    });
}

function sendBeaconJson(path, payload) {
    const body = new Blob([JSON.stringify(payload)], {
        type: "application/json",
    });

    if (!navigator.sendBeacon?.(path, body)) {
        postJson(path, payload).catch(() => {});
    }
}

/**
 * The page came back from the browser's back-forward cache after pagehide had
 * already closed the sitting. Reopen it so the rest of the visit is recorded.
 */
function reopenTelemetrySession() {
    if (!sessionClosed) {
        return Promise.resolve();
    }
    sessionClosed = false;
    return startTelemetrySession().then(() => {
        if (telemetryQueue.length > 0) {
            scheduleFlush();
        }
    });
}

function postClipboardEvent({ action, surface, content, chatThreadId = null }) {
    const payload = {
        ...identityPayload(),
        action,
        surface,
        content,
        chatThreadId,
        clientTs: new Date().toISOString(),
    };
    clipboardChain = clipboardChain
        .then(() => postJson("/api/telemetry/clipboard", payload))
        .catch(() => {});
    return clipboardChain;
}

function postEditorSnapshot({ contentHtml, reason, keystrokesSincePrev = null }) {
    return postJson("/api/telemetry/snapshot", {
        ...identityPayload(),
        contentHtml,
        reason,
        keystrokesSincePrev,
        clientTs: new Date().toISOString(),
    }).catch(() => {});
}
