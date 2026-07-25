const { query } = require("../config/db.js");
const { isValidId, toId, mapKeys, parseJson } = require("./helpers.js");

const CHUNK_KEYS = {
    id: "id",
    attachment_id: "attachmentId",
    chat_session_id: "chatSessionId",
    assignment_id: "assignmentId",
    participant_id: "participantID",
    system_id: "systemID",
    chunk_index: "chunkIndex",
    text: "text",
    source_filename: "sourceFilename",
    page_start: "pageStart",
    page_end: "pageEnd",
    embedding: "embedding",
    embedding_model: "embeddingModel",
    created_at: "createdAt",
    updated_at: "updatedAt",
};

function mapChunk(row) {
    if (!row) {
        return null;
    }
    const mapped = mapKeys(row, CHUNK_KEYS);
    if (mapped.attachmentId != null) {
        mapped.attachmentId = String(mapped.attachmentId);
    }
    if (mapped.chatSessionId != null) {
        mapped.chatSessionId = String(mapped.chatSessionId);
    }
    if (mapped.chunkIndex != null) {
        mapped.chunkIndex = Number(mapped.chunkIndex);
    }
    if (mapped.pageStart != null) {
        mapped.pageStart = Number(mapped.pageStart);
    }
    if (mapped.pageEnd != null) {
        mapped.pageEnd = Number(mapped.pageEnd);
    }
    mapped.embedding = parseJson(row.embedding, null);
    return mapped;
}

async function findBySessionId(chatSessionId) {
    if (!isValidId(chatSessionId)) {
        return [];
    }
    const rows = await query(
        `SELECT * FROM document_chunks
         WHERE chat_session_id = ?
         ORDER BY chunk_index ASC`,
        [toId(chatSessionId)]
    );
    return rows.map(mapChunk);
}

async function countBySessionId(chatSessionId) {
    if (!isValidId(chatSessionId)) {
        return 0;
    }
    const rows = await query(
        `SELECT COUNT(*) AS count FROM document_chunks WHERE chat_session_id = ?`,
        [toId(chatSessionId)]
    );
    return Number(rows[0]?.count || 0);
}

async function insertMany(chunks) {
    if (!chunks.length) {
        return [];
    }

    const inserted = [];
    for (const chunk of chunks) {
        const result = await query(
            `INSERT INTO document_chunks (
                attachment_id, chat_session_id, assignment_id, participant_id,
                system_id, chunk_index, text, source_filename, page_start, page_end,
                embedding, embedding_model
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                toId(chunk.attachmentId),
                toId(chunk.chatSessionId),
                chunk.assignmentId,
                chunk.participantID,
                chunk.systemID ?? null,
                chunk.chunkIndex,
                chunk.text,
                chunk.sourceFilename,
                chunk.pageStart ?? null,
                chunk.pageEnd ?? null,
                chunk.embedding ? JSON.stringify(chunk.embedding) : null,
                chunk.embeddingModel ?? null,
            ]
        );
        inserted.push(String(result.insertId));
    }
    return inserted;
}

async function deleteByAttachmentId(attachmentId) {
    if (!isValidId(attachmentId)) {
        return 0;
    }
    const result = await query(
        `DELETE FROM document_chunks WHERE attachment_id = ?`,
        [toId(attachmentId)]
    );
    return result.affectedRows;
}

module.exports = {
    findBySessionId,
    countBySessionId,
    insertMany,
    deleteByAttachmentId,
    mapChunk,
};
