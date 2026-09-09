const { query } = require("../config/db.js");
const { mapKeys } = require("./helpers.js");

const STUDY_SESSION_KEYS = {
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
    const mapped = mapKeys(row, STUDY_SESSION_KEYS);
    // mapKeys assumes a numeric auto-increment id; this table is keyed by a
    // client-generated UUID, so restore the string form.
    mapped.id = row.id;
    mapped._id = String(row.id);
    return mapped;
}

/**
 * Open a sitting. The client generates the id, so a reload that re-sends the
 * same id must not create a second row or reset started_at.
 *
 * A reload also fires the close beacon first, so the row may already carry an
 * ended_at from the page that just went away. Clearing it here is what keeps
 * the sitting open across reloads and back-forward-cache restores; without it
 * every second of the sitting after the first reload is lost.
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
         ON DUPLICATE KEY UPDATE
            last_seen_at = VALUES(last_seen_at),
            ended_at = NULL,
            end_reason = NULL`,
        [
            data.studySessionId,
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
        [data.studySessionId]
    );
    return { session: mapSession(rows[0] || null), serverNow: startedAt };
}

/** Returns true when the session row exists (and so could be touched). */
async function touch(studySessionId, seenAt = new Date()) {
    if (!studySessionId) {
        return false;
    }
    const result = await query(
        `UPDATE study_sessions
         SET last_seen_at = GREATEST(COALESCE(last_seen_at, ?), ?)
         WHERE id = ?`,
        [seenAt, seenAt, studySessionId]
    );
    return result.affectedRows > 0;
}

/**
 * Close a sitting. Only the first end wins: a pagehide beacon followed by a
 * late-arriving event should not overwrite the real reason. Server time is
 * used so open_seconds never mixes the client's clock with started_at.
 */
async function end(studySessionId, { reason } = {}) {
    if (!studySessionId) {
        return;
    }
    const closedAt = new Date();
    await query(
        `UPDATE study_sessions
         SET ended_at = ?, end_reason = ?, last_seen_at = GREATEST(COALESCE(last_seen_at, ?), ?)
         WHERE id = ? AND ended_at IS NULL`,
        [closedAt, reason || "unknown", closedAt, closedAt, studySessionId]
    );
}

module.exports = {
    start,
    touch,
    end,
};
