const { query } = require("../config/db.js");
const { isValidId, toId, mapKeys, parseJson } = require("./helpers.js");

const EXCHANGE_KEYS = {
    id: "id",
    participant_id: "participantID",
    session_id: "sessionID",
    chat_session_id: "chatSessionId",
    assignment_id: "assignmentId",
    system_id: "systemID",
    user_input: "userInput",
    bot_response: "botResponse",
    attachment_ids: "attachmentIds",
    retrieved_chunk_ids: "retrievedChunkIds",
    retrieval_meta: "retrievalMeta",
    timestamp: "timestamp",
};

function mapExchange(row) {
    if (!row) {
        return null;
    }
    const mapped = mapKeys(row, EXCHANGE_KEYS);
    mapped.chatSessionId = mapped.chatSessionId != null
        ? String(mapped.chatSessionId)
        : mapped.chatSessionId;
    mapped.attachmentIds = (parseJson(row.attachment_ids, []) || []).map(String);
    mapped.retrievedChunkIds = (parseJson(row.retrieved_chunk_ids, []) || []).map(
        String
    );
    mapped.retrievalMeta = parseJson(row.retrieval_meta, {
        ragVersion: null,
        chunkCount: 0,
        scores: [],
    });
    return mapped;
}

async function findBySessionId(chatSessionId, { limit = null, order = "ASC" } = {}) {
    if (!isValidId(chatSessionId)) {
        return [];
    }

    const direction = order.toUpperCase() === "DESC" ? "DESC" : "ASC";
    let sql = `SELECT * FROM chat_exchanges
               WHERE chat_session_id = ?
               ORDER BY timestamp ${direction}`;
    const params = [toId(chatSessionId)];

    if (limit != null) {
        const safeLimit = Math.max(1, Math.min(Number(limit) || 1, 1000));
        sql += ` LIMIT ${safeLimit}`;
    }

    const rows = await query(sql, params);
    return rows.map(mapExchange);
}

async function findById(id) {
    if (!isValidId(id)) {
        return null;
    }
    const rows = await query(
        `SELECT * FROM chat_exchanges WHERE id = ? LIMIT 1`,
        [toId(id)]
    );
    return mapExchange(rows[0] || null);
}

async function create(data) {
    const attachmentIds = (data.attachmentIds || []).map(String);
    const retrievedChunkIds = (data.retrievedChunkIds || []).map(String);
    const retrievalMeta = data.retrievalMeta || {
        ragVersion: null,
        chunkCount: 0,
        scores: [],
    };

    const result = await query(
        `INSERT INTO chat_exchanges (
            participant_id, session_id, chat_session_id, assignment_id,
            system_id, user_input, bot_response, attachment_ids,
            retrieved_chunk_ids, retrieval_meta, timestamp
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.participantID ?? null,
            data.sessionID ?? null,
            toId(data.chatSessionId),
            data.assignmentId,
            data.systemID ?? null,
            data.userInput ?? null,
            data.botResponse ?? null,
            JSON.stringify(attachmentIds),
            JSON.stringify(retrievedChunkIds),
            JSON.stringify(retrievalMeta),
            data.timestamp ? new Date(data.timestamp) : new Date(),
        ]
    );

    return findById(result.insertId);
}

module.exports = {
    findBySessionId,
    findById,
    create,
    mapExchange,
};
