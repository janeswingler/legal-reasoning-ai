const { query } = require("../config/db.js");
const { isValidId, toId, mapKeys } = require("./helpers.js");

const ASSIGNMENT_KEYS = {
    id: "id",
    participant_id: "participantID",
    study_session_id: "studySessionId",
    system_id: "systemID",
    assignment_id: "assignmentId",
    title: "title",
    content: "content",
    version: "version",
    timestamp: "timestamp",
    submitted_at: "submittedAt",
    questionnaire_completed_at: "questionnaireCompletedAt",
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
            participant_id, study_session_id, system_id, assignment_id,
            title, content, version, timestamp,
            submitted_at, questionnaire_completed_at,
            drive_file_id, drive_file_name, local_file_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.participantID ?? null,
            data.studySessionId ?? null,
            data.systemID ?? null,
            data.assignmentId,
            data.title ?? null,
            data.content ?? null,
            data.version ?? 1,
            data.timestamp ? new Date(data.timestamp) : new Date(),
            data.submittedAt ? new Date(data.submittedAt) : null,
            data.questionnaireCompletedAt
                ? new Date(data.questionnaireCompletedAt)
                : null,
            data.driveFileId ?? null,
            data.driveFileName ?? null,
            data.localFilePath ?? null,
        ]
    );
    return findById(result.insertId);
}

const UPDATABLE_COLUMNS = {
    studySessionId: "study_session_id",
    systemID: "system_id",
    title: "title",
    content: "content",
    submittedAt: "submitted_at",
    questionnaireCompletedAt: "questionnaire_completed_at",
    driveFileId: "drive_file_id",
    driveFileName: "drive_file_name",
    localFilePath: "local_file_path",
};

const DATE_FIELDS = new Set(["submittedAt", "questionnaireCompletedAt"]);

/**
 * Only the supplied fields are written. Rewriting every column from an earlier
 * read would let a submit or questionnaire stamp silently put back a draft
 * that an autosave had replaced in the meantime.
 */
function buildSetClause(fields) {
    const assignments = [];
    const params = [];

    for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
        if (fields[field] === undefined) {
            continue;
        }
        let value = fields[field];
        if (DATE_FIELDS.has(field)) {
            value = value ? new Date(value) : null;
        }
        assignments.push(`${column} = ?`);
        params.push(value ?? null);
    }

    assignments.push("version = version + 1", "timestamp = ?");
    params.push(new Date());

    return { sql: assignments.join(", "), params };
}

async function updateById(id, fields) {
    if (!isValidId(id)) {
        return null;
    }

    const { sql, params } = buildSetClause(fields);
    await query(`UPDATE assignments SET ${sql} WHERE id = ?`, [...params, toId(id)]);

    return findById(id);
}

/**
 * Same write as updateById, but only applies if the row's version still
 * matches expectedVersion — the compare-and-swap that stops one autosave
 * from silently overwriting a newer save from another tab or device. A
 * submitted row is never touched, whatever the version says.
 */
async function updateWithVersionCheck(id, fields, expectedVersion) {
    if (!isValidId(id)) {
        return { ok: false, reason: "not_found" };
    }

    const { sql, params } = buildSetClause(fields);
    const result = await query(
        `UPDATE assignments SET ${sql}
         WHERE id = ? AND version = ? AND submitted_at IS NULL`,
        [...params, toId(id), Number(expectedVersion)]
    );

    if (result.affectedRows === 0) {
        return { ok: false, reason: "conflict" };
    }

    return { ok: true, assignment: await findById(id) };
}

async function upsertCurrent(data) {
    const existing = await findByParticipantAndAssignment(
        data.participantID,
        data.assignmentId
    );

    if (existing) {
        // No expectedVersion means the caller never loaded existing content
        // (shouldn't happen once the client is updated, but falls back to
        // the old unconditional write rather than refusing to save).
        if (data.expectedVersion == null) {
            return {
                assignment: await updateById(existing.id, {
                    studySessionId: data.studySessionId,
                    systemID: data.systemID,
                    content: data.content,
                    title: data.title,
                }),
                created: false,
                conflict: false,
            };
        }

        const result = await updateWithVersionCheck(
            existing.id,
            {
                studySessionId: data.studySessionId,
                systemID: data.systemID,
                content: data.content,
                title: data.title,
            },
            data.expectedVersion
        );

        if (!result.ok) {
            return { assignment: null, created: false, conflict: true };
        }

        return { assignment: result.assignment, created: false, conflict: false };
    }

    try {
        return {
            assignment: await create({
                participantID: data.participantID,
                assignmentId: data.assignmentId,
                studySessionId: data.studySessionId,
                systemID: data.systemID,
                content: data.content,
                title: data.title,
            }),
            created: true,
            conflict: false,
        };
    } catch (error) {
        // Two tabs opened a brand-new memo at once and both tried to create
        // the row. The loser has no version to check against, so it is told to
        // reload rather than overwrite whatever the winner wrote.
        if (error.code === "ER_DUP_ENTRY") {
            return { assignment: null, created: false, conflict: true };
        }
        throw error;
    }
}

module.exports = {
    findByParticipantAndAssignment,
    findById,
    create,
    updateById,
    upsertCurrent,
};
