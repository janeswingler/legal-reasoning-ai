const crypto = require("crypto");
const { query } = require("../config/db.js");
const { mapKeys } = require("./helpers.js");

const SNAPSHOT_KEYS = {
    id: "id",
    session_id: "sessionID",
    participant_id: "participantID",
    assignment_id: "assignmentId",
    system_id: "systemID",
    captured_at: "capturedAt",
    client_ts: "clientTs",
    reason: "reason",
    char_count: "charCount",
    word_count: "wordCount",
    content_hash: "contentHash",
    keystrokes_since_prev: "keystrokesSincePrev",
};

function sha256(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function countWords(text) {
    const trimmed = String(text || "").trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

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

/**
 * Store a revision of the assignment, skipping content identical to the
 * previous snapshot so idle time costs nothing. Dedupe is per participant and
 * assignment rather than per session, so reopening the app without editing
 * does not add a row.
 */
async function create(data) {
    const contentHtml = String(data.contentHtml ?? "");
    const plainText = String(data.plainText ?? "");
    const contentHash = sha256(contentHtml);

    const previous = await query(
        `SELECT content_hash
         FROM editor_snapshots
         WHERE participant_id = ? AND assignment_id = ?
         ORDER BY captured_at DESC, id DESC
         LIMIT 1`,
        [data.participantID ?? null, data.assignmentId ?? null]
    );

    if (previous[0]?.content_hash === contentHash) {
        return { skipped: true, snapshot: null };
    }

    const result = await query(
        `INSERT INTO editor_snapshots (
            session_id, participant_id, assignment_id, system_id,
            captured_at, client_ts, reason,
            content_html, plain_text, char_count, word_count,
            content_hash, keystrokes_since_prev
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.sessionID ?? null,
            data.participantID ?? null,
            data.assignmentId ?? null,
            data.systemID ?? null,
            new Date(),
            toDate(data.clientTs),
            data.reason ?? null,
            contentHtml,
            plainText,
            plainText.length,
            countWords(plainText),
            contentHash,
            toInt(data.keystrokesSincePrev),
        ]
    );

    const rows = await query(
        `SELECT id, session_id, participant_id, assignment_id, system_id,
                captured_at, client_ts, reason, char_count, word_count,
                content_hash, keystrokes_since_prev
         FROM editor_snapshots WHERE id = ? LIMIT 1`,
        [result.insertId]
    );

    return { skipped: false, snapshot: mapKeys(rows[0] || null, SNAPSHOT_KEYS) };
}

module.exports = {
    create,
};
