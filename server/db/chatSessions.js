const { query } = require("../config/db.js");
const { isValidId, toId, mapKeys } = require("./helpers.js");

const SESSION_KEYS = {
    id: "id",
    participant_id: "participantID",
    assignment_id: "assignmentId",
    session_id: "sessionID",
    system_id: "systemID",
    title: "title",
    created_at: "createdAt",
    updated_at: "updatedAt",
};

function mapSession(row) {
    return mapKeys(row, SESSION_KEYS);
}

async function findByParticipantAndAssignment(participantID, assignmentId) {
    const rows = await query(
        `SELECT * FROM chat_sessions
         WHERE participant_id = ? AND assignment_id = ?
         ORDER BY updated_at DESC`,
        [participantID, assignmentId]
    );
    return rows.map(mapSession);
}

async function findOwned(id, participantID, assignmentId) {
    if (!isValidId(id)) {
        return null;
    }
    const rows = await query(
        `SELECT * FROM chat_sessions
         WHERE id = ? AND participant_id = ? AND assignment_id = ?
         LIMIT 1`,
        [toId(id), participantID, assignmentId]
    );
    return mapSession(rows[0] || null);
}

async function findById(id) {
    if (!isValidId(id)) {
        return null;
    }
    const rows = await query(
        `SELECT * FROM chat_sessions WHERE id = ? LIMIT 1`,
        [toId(id)]
    );
    return mapSession(rows[0] || null);
}

async function create(data) {
    const result = await query(
        `INSERT INTO chat_sessions (
            participant_id, assignment_id, session_id, system_id, title
         ) VALUES (?, ?, ?, ?, ?)`,
        [
            data.participantID,
            data.assignmentId,
            data.sessionID ?? null,
            data.systemID ?? null,
            data.title ?? null,
        ]
    );
    return findById(result.insertId);
}

async function update(id, fields) {
    const session = await findById(id);
    if (!session) {
        return null;
    }

    const title =
        fields.title !== undefined ? fields.title : session.title;

    await query(
        `UPDATE chat_sessions
         SET title = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [title ?? null, toId(id)]
    );

    return findById(id);
}

async function touch(id) {
    if (!isValidId(id)) {
        return null;
    }
    await query(
        `UPDATE chat_sessions
         SET updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [toId(id)]
    );
    return findById(id);
}

module.exports = {
    findByParticipantAndAssignment,
    findOwned,
    findById,
    create,
    update,
    touch,
};
