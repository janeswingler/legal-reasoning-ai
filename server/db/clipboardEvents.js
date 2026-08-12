const crypto = require("crypto");
const { query } = require("../config/db.js");
const { mapKeys } = require("./helpers.js");

const MAX_STORED_CHARS = 20000;

// Below this length a coincidental match against an earlier copy is likely
// (single words, short phrases), so origin is left unresolved rather than
// wrongly credited to the chat.
const MIN_CHARS_FOR_ORIGIN = 8;

const CLIPBOARD_KEYS = {
    id: "id",
    session_id: "sessionID",
    participant_id: "participantID",
    assignment_id: "assignmentId",
    system_id: "systemID",
    chat_session_id: "chatSessionId",
    action: "action",
    surface: "surface",
    char_count: "charCount",
    truncated: "truncated",
    content_hash: "contentHash",
    origin: "origin",
    client_ts: "clientTs",
    server_ts: "serverTs",
};

const ORIGIN_BY_SURFACE = {
    chat_message_assistant: "internal_chat_assistant",
    chat_message_user: "internal_chat_user",
    chat_message: "internal_chat_message",
    chat_input: "internal_chat_input",
    editor: "internal_editor",
};

/**
 * Hash the stored (possibly truncated) text together with its true length.
 * Copy and paste of the same text truncate identically so they still match,
 * while a short string can never collide with a truncated long one.
 */
function hashContent(storedContent, charCount) {
    return crypto
        .createHash("sha256")
        .update(`${charCount}:${storedContent}`, "utf8")
        .digest("hex");
}

function toDate(value) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toChatSessionId(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Classify where pasted text came from by looking for an earlier copy or cut of
 * the same text by the same participant. No match means the text entered the
 * study from outside the system — another tab, a document, or another AI tool.
 */
async function resolveOrigin({ participantID, contentHash, charCount }) {
    if (!participantID || charCount < MIN_CHARS_FOR_ORIGIN) {
        return "unknown";
    }

    const rows = await query(
        `SELECT surface
         FROM clipboard_events
         WHERE participant_id = ?
           AND content_hash = ?
           AND action IN ('copy', 'cut')
         ORDER BY id DESC
         LIMIT 1`,
        [participantID, contentHash]
    );

    if (!rows.length) {
        return "external";
    }

    return ORIGIN_BY_SURFACE[rows[0].surface] || "internal_unknown";
}

async function create(data) {
    const action = String(data.action || "").toLowerCase();
    if (!["copy", "cut", "paste"].includes(action)) {
        throw new Error("action must be copy, cut, or paste");
    }

    const fullText = String(data.content ?? "");
    const charCount = fullText.length;
    const truncated = charCount > MAX_STORED_CHARS;
    const storedContent = truncated ? fullText.slice(0, MAX_STORED_CHARS) : fullText;
    const contentHash = hashContent(storedContent, charCount);

    const origin =
        action === "paste"
            ? await resolveOrigin({
                  participantID: data.participantID,
                  contentHash,
                  charCount,
              })
            : null;

    const result = await query(
        `INSERT INTO clipboard_events (
            session_id, participant_id, assignment_id, system_id, chat_session_id,
            action, surface, content, char_count, truncated,
            content_hash, origin, client_ts, server_ts
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.sessionID ?? null,
            data.participantID ?? null,
            data.assignmentId ?? null,
            data.systemID ?? null,
            toChatSessionId(data.chatSessionId),
            action,
            data.surface ?? null,
            storedContent,
            charCount,
            truncated ? 1 : 0,
            contentHash,
            origin,
            toDate(data.clientTs),
            new Date(),
        ]
    );

    const rows = await query(
        `SELECT id, session_id, participant_id, assignment_id, system_id,
                chat_session_id, action, surface, char_count, truncated,
                content_hash, origin, client_ts, server_ts
         FROM clipboard_events WHERE id = ? LIMIT 1`,
        [result.insertId]
    );

    return mapKeys(rows[0] || null, CLIPBOARD_KEYS);
}

module.exports = {
    create,
    MAX_STORED_CHARS,
};
