const { query } = require("../config/db.js");
const { isValidId, toId, mapKeys } = require("./helpers.js");

const ASSIGNMENT_KEYS = {
    id: "id",
    participant_id: "participantID",
    session_id: "sessionID",
    system_id: "systemID",
    assignment_id: "assignmentId",
    title: "title",
    content: "content",
    version: "version",
    timestamp: "timestamp",
    submitted_at: "submittedAt",
    drive_file_id: "driveFileId",
    drive_file_name: "driveFileName",
    local_file_path: "localFilePath",
};

function mapAssignment(row) {
    const mapped = mapKeys(row, ASSIGNMENT_KEYS);
    if (!mapped) {
        return null;
    }
    if (mapped.version != null) {
        mapped.version = Number(mapped.version);
    }
    return mapped;
}

async function findByParticipant(participantID) {
    const rows = await query(
        `SELECT * FROM assignments
         WHERE participant_id = ?
         ORDER BY timestamp DESC`,
        [participantID]
    );
    return rows.map(mapAssignment);
}

async function findByParticipantAndAssignment(participantID, assignmentId) {
    const rows = await query(
        `SELECT * FROM assignments
         WHERE participant_id = ? AND assignment_id = ?
         LIMIT 1`,
        [participantID, assignmentId]
    );
    return mapAssignment(rows[0] || null);
}

async function findById(id) {
    if (!isValidId(id)) {
        return null;
    }
    const rows = await query(`SELECT * FROM assignments WHERE id = ? LIMIT 1`, [
        toId(id),
    ]);
    return mapAssignment(rows[0] || null);
}

async function create(data) {
    const result = await query(
        `INSERT INTO assignments (
            participant_id, session_id, system_id, assignment_id,
            title, content, version, timestamp,
            submitted_at, drive_file_id, drive_file_name, local_file_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.participantID ?? null,
            data.sessionID ?? null,
            data.systemID ?? null,
            data.assignmentId,
            data.title ?? null,
            data.content ?? null,
            data.version ?? 1,
            data.timestamp ? new Date(data.timestamp) : new Date(),
            data.submittedAt ? new Date(data.submittedAt) : null,
            data.driveFileId ?? null,
            data.driveFileName ?? null,
            data.localFilePath ?? null,
        ]
    );
    return findById(result.insertId);
}

async function updateById(id, fields) {
    const assignment = await findById(id);
    if (!assignment) {
        return null;
    }

    const next = {
        ...assignment,
        ...fields,
        version:
            fields.version !== undefined ? fields.version : assignment.version + 1,
        timestamp: fields.timestamp ? new Date(fields.timestamp) : new Date(),
    };

    await query(
        `UPDATE assignments SET
            participant_id = ?,
            session_id = ?,
            system_id = ?,
            assignment_id = ?,
            title = ?,
            content = ?,
            version = ?,
            timestamp = ?,
            submitted_at = ?,
            drive_file_id = ?,
            drive_file_name = ?,
            local_file_path = ?
         WHERE id = ?`,
        [
            next.participantID ?? null,
            next.sessionID ?? null,
            next.systemID ?? null,
            next.assignmentId,
            next.title ?? null,
            next.content ?? null,
            next.version,
            next.timestamp,
            next.submittedAt ? new Date(next.submittedAt) : null,
            next.driveFileId ?? null,
            next.driveFileName ?? null,
            next.localFilePath ?? null,
            toId(id),
        ]
    );

    return findById(id);
}

async function upsertCurrent(data) {
    const existing = await findByParticipantAndAssignment(
        data.participantID,
        data.assignmentId
    );

    if (existing) {
        return {
            assignment: await updateById(existing.id, {
                sessionID: data.sessionID,
                systemID: data.systemID,
                content: data.content,
                title: data.title,
            }),
            created: false,
        };
    }

    return {
        assignment: await create({
            participantID: data.participantID,
            assignmentId: data.assignmentId,
            sessionID: data.sessionID,
            systemID: data.systemID,
            content: data.content,
            title: data.title,
        }),
        created: true,
    };
}

module.exports = {
    findByParticipant,
    findByParticipantAndAssignment,
    findById,
    create,
    updateById,
    upsertCurrent,
};
