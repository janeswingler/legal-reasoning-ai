const { query } = require("../config/db.js");
const { isValidId, toId, mapKeys } = require("./helpers.js");

const ATTACHMENT_KEYS = {
    id: "id",
    participant_id: "participantID",
    assignment_id: "assignmentId",
    system_id: "systemID",
    chat_session_id: "chatSessionId",
    exchange_id: "exchangeId",
    original_filename: "originalFilename",
    stored_filename: "storedFilename",
    mime_type: "mimeType",
    size_bytes: "sizeBytes",
    status: "status",
    error_message: "errorMessage",
    chunk_count: "chunkCount",
    created_at: "createdAt",
    updated_at: "updatedAt",
};

function mapAttachment(row) {
    if (!row) {
        return null;
    }
    const mapped = mapKeys(row, ATTACHMENT_KEYS);
    if (mapped.chatSessionId != null) {
        mapped.chatSessionId = String(mapped.chatSessionId);
    }
    if (mapped.exchangeId != null) {
        mapped.exchangeId = String(mapped.exchangeId);
    }
    if (mapped.sizeBytes != null) {
        mapped.sizeBytes = Number(mapped.sizeBytes);
    }
    if (mapped.chunkCount != null) {
        mapped.chunkCount = Number(mapped.chunkCount);
    }
    return mapped;
}

async function findById(id) {
    if (!isValidId(id)) {
        return null;
    }
    const rows = await query(
        `SELECT * FROM chat_attachments WHERE id = ? LIMIT 1`,
        [toId(id)]
    );
    return mapAttachment(rows[0] || null);
}

async function findPendingBySession(chatSessionId) {
    if (!isValidId(chatSessionId)) {
        return [];
    }
    const rows = await query(
        `SELECT * FROM chat_attachments
         WHERE chat_session_id = ? AND exchange_id IS NULL
         ORDER BY created_at ASC`,
        [toId(chatSessionId)]
    );
    return rows.map(mapAttachment);
}

async function findUnlinkedByIds(ids, chatSessionId) {
    const validIds = [...new Set(ids.map(String))].filter(isValidId).map(toId);
    if (!validIds.length || !isValidId(chatSessionId)) {
        return [];
    }

    const placeholders = validIds.map(() => "?").join(", ");
    const rows = await query(
        `SELECT * FROM chat_attachments
         WHERE id IN (${placeholders})
           AND chat_session_id = ?
           AND exchange_id IS NULL`,
        [...validIds, toId(chatSessionId)]
    );
    return rows.map(mapAttachment);
}

async function findByIds(ids) {
    const validIds = [...new Set(ids.map(String))].filter(isValidId).map(toId);
    if (!validIds.length) {
        return [];
    }
    const placeholders = validIds.map(() => "?").join(", ");
    const rows = await query(
        `SELECT * FROM chat_attachments WHERE id IN (${placeholders})`,
        validIds
    );
    return rows.map(mapAttachment);
}

async function create(data) {
    const result = await query(
        `INSERT INTO chat_attachments (
            participant_id, assignment_id, system_id, chat_session_id, exchange_id,
            original_filename, stored_filename, mime_type, size_bytes,
            status, error_message, chunk_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.participantID,
            data.assignmentId,
            data.systemID ?? null,
            toId(data.chatSessionId),
            data.exchangeId ? toId(data.exchangeId) : null,
            data.originalFilename,
            data.storedFilename,
            data.mimeType,
            data.sizeBytes,
            data.status || "processing",
            data.errorMessage ?? null,
            data.chunkCount ?? 0,
        ]
    );
    return findById(result.insertId);
}

async function update(id, fields) {
    const attachment = await findById(id);
    if (!attachment) {
        return null;
    }

    const next = { ...attachment, ...fields };

    await query(
        `UPDATE chat_attachments SET
            exchange_id = ?,
            status = ?,
            error_message = ?,
            chunk_count = ?
         WHERE id = ?`,
        [
            next.exchangeId ? toId(next.exchangeId) : null,
            next.status || "processing",
            next.errorMessage ?? null,
            next.chunkCount ?? 0,
            toId(id),
        ]
    );

    return findById(id);
}

async function linkToExchange(attachmentIds, exchangeId) {
    const validIds = [...new Set(attachmentIds.map(String))]
        .filter(isValidId)
        .map(toId);
    if (!validIds.length || !isValidId(exchangeId)) {
        return;
    }

    const placeholders = validIds.map(() => "?").join(", ");
    await query(
        `UPDATE chat_attachments
         SET exchange_id = ?
         WHERE id IN (${placeholders})`,
        [toId(exchangeId), ...validIds]
    );
}

async function remove(id) {
    if (!isValidId(id)) {
        return false;
    }
    const result = await query(`DELETE FROM chat_attachments WHERE id = ?`, [
        toId(id),
    ]);
    return result.affectedRows > 0;
}

module.exports = {
    findById,
    findPendingBySession,
    findUnlinkedByIds,
    findByIds,
    create,
    update,
    linkToExchange,
    remove,
    mapAttachment,
};
