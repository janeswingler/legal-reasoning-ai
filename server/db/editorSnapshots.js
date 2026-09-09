const crypto = require("crypto");
const { query } = require("../config/db.js");
const { mapKeys } = require("./helpers.js");

const SNAPSHOT_KEYS = {
    id: "id",
    study_session_id: "studySessionId",
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

const NAMED_ENTITIES = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
};

function decodeEntities(text) {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * The editor's plain text is derived here rather than trusted from the client:
 * the browser's textContent joins paragraphs with no separator, which merges
 * the last word of one line with the first of the next and drops every line
 * break from the exported text.
 */
function htmlToPlainText(html) {
    return decodeEntities(
        String(html || "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre|section)>/gi, "\n")
            .replace(/<[^>]+>/g, "")
    )
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t ]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
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
    const plainText = htmlToPlainText(contentHtml);
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
            study_session_id, participant_id, assignment_id, system_id,
            captured_at, client_ts, reason,
            content_html, plain_text, char_count, word_count,
            content_hash, keystrokes_since_prev
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.studySessionId ?? null,
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
        `SELECT id, study_session_id, participant_id, assignment_id, system_id,
                captured_at, client_ts, reason, char_count, word_count,
                content_hash, keystrokes_since_prev
         FROM editor_snapshots WHERE id = ? LIMIT 1`,
        [result.insertId]
    );

    return { skipped: false, snapshot: mapKeys(rows[0] || null, SNAPSHOT_KEYS) };
}

module.exports = {
    create,
    htmlToPlainText,
};
