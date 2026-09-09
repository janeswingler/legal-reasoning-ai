const { query } = require("../config/db.js");
const { isValidId, toId, mapKeys } = require("./helpers.js");

const CHAT_THREAD_KEYS = {
    id: "id",
    participant_id: "participantID",
    assignment_id: "assignmentId",
    study_session_id: "studySessionId",
    system_id: "systemID",
    title: "title",
    created_at: "createdAt",
    updated_at: "updatedAt",
};

function mapThread(row) {
    return mapKeys(row, CHAT_THREAD_KEYS);
}

async function findByParticipantAndAssignment(participantID, assignmentId) {
    const rows = await query(
        `SELECT * FROM chat_threads
         WHERE participant_id = ? AND assignment_id = ?
         ORDER BY updated_at DESC`,
        [participantID, assignmentId]
    );
    return rows.map(mapThread);
}

async function findOwned(id, participantID, assignmentId) {
    if (!isValidId(id)) {
        return null;
    }
    const rows = await query(
        `SELECT * FROM chat_threads
         WHERE id = ? AND participant_id = ? AND assignment_id = ?
         LIMIT 1`,
        [toId(id), participantID, assignmentId]
    );
    return mapThread(rows[0] || null);
}

async function findById(id) {
    if (!isValidId(id)) {
        return null;
    }
    const rows = await query(
        `SELECT * FROM chat_threads WHERE id = ? LIMIT 1`,
        [toId(id)]
    );
    return mapThread(rows[0] || null);
}

async function create(data) {
    const result = await query(
        `INSERT INTO chat_threads (
            participant_id, assignment_id, study_session_id, system_id, title
         ) VALUES (?, ?, ?, ?, ?)`,
        [
            data.participantID,
            data.assignmentId,
            data.studySessionId ?? null,
            data.systemID ?? null,
            data.title ?? null,
        ]
    );
    return findById(result.insertId);
}

async function update(id, fields) {
    const thread = await findById(id);
    if (!thread) {
        return null;
    }

    const title =
        fields.title !== undefined ? fields.title : thread.title;

    await query(
        `UPDATE chat_threads
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
        `UPDATE chat_threads
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
