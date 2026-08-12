const { query } = require("../config/db.js");
const { mapKeys } = require("./helpers.js");

const SESSION_KEYS = {
    id: "id",
    participant_id: "participantID",
    assignment_id: "assignmentId",
    system_id: "systemID",
    started_at: "startedAt",
    client_started_at: "clientStartedAt",
    last_seen_at: "lastSeenAt",
    ended_at: "endedAt",
    end_reason: "endReason",
    user_agent: "userAgent",
    screen_w: "screenW",
    screen_h: "screenH",
    viewport_w: "viewportW",
    viewport_h: "viewportH",
    tz_offset_min: "tzOffsetMin",
    clock_skew_ms: "clockSkewMs",
};

function toDate(value) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toInt(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : null;
}

function mapSession(row) {
    if (!row) {
        return null;
    }
    const mapped = mapKeys(row, SESSION_KEYS);
    // mapKeys assumes a numeric auto-increment id; this table is keyed by a
    // client-generated UUID, so restore the string form.
    mapped.id = row.id;
    mapped._id = String(row.id);
    return mapped;
}

/**
 * Open a sitting. The client generates the id, so a reload that re-sends the
 * same id must not create a second row or reset started_at.
 */
async function start(data) {
    const startedAt = new Date();
    const clientStartedAt = toDate(data.clientStartedAt);

    // Positive skew means the client clock is behind the server.
    const clockSkewMs = clientStartedAt
        ? startedAt.getTime() - clientStartedAt.getTime()
        : null;

    await query(
        `INSERT INTO study_sessions (
            id, participant_id, assignment_id, system_id,
            started_at, client_started_at, last_seen_at,
            user_agent, screen_w, screen_h, viewport_w, viewport_h,
            tz_offset_min, clock_skew_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)`,
        [
            data.sessionID,
            data.participantID ?? null,
            data.assignmentId ?? null,
            data.systemID ?? null,
            startedAt,
            clientStartedAt,
            startedAt,
            (data.userAgent ?? "").slice(0, 512) || null,
            toInt(data.screenW),
            toInt(data.screenH),
            toInt(data.viewportW),
            toInt(data.viewportH),
            toInt(data.tzOffsetMin),
            clockSkewMs,
        ]
    );

    const rows = await query(
        `SELECT * FROM study_sessions WHERE id = ? LIMIT 1`,
        [data.sessionID]
    );
    return { session: mapSession(rows[0] || null), serverNow: startedAt };
}

async function touch(sessionID, seenAt = new Date()) {
    if (!sessionID) {
        return;
    }
    await query(
        `UPDATE study_sessions
         SET last_seen_at = ?
         WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)`,
        [seenAt, sessionID, seenAt]
    );
}

/**
 * Close a sitting. Only the first end wins: a pagehide beacon followed by a
 * late-arriving event should not overwrite the real reason.
 */
async function end(sessionID, { endedAt, reason } = {}) {
    if (!sessionID) {
        return;
    }
    const closedAt = toDate(endedAt) || new Date();
    await query(
        `UPDATE study_sessions
         SET ended_at = ?, end_reason = ?, last_seen_at = GREATEST(COALESCE(last_seen_at, ?), ?)
         WHERE id = ? AND ended_at IS NULL`,
        [closedAt, reason || "unknown", closedAt, closedAt, sessionID]
    );
}

module.exports = {
    start,
    touch,
    end,
};
