const { query, getPool } = require("../config/db.js");

const INSERT_COLUMNS = `(
    participant_id, assignment_id, system_id, study_session_id, session_seq,
    event_type, element_name, event_props, duration_ms, value_num,
    client_ts, page, ui_version, timestamp
)`;

const INSERT_SQL = `INSERT INTO system_interactions ${INSERT_COLUMNS}
    VALUES ?
    ON DUPLICATE KEY UPDATE id = id`;

const INT_MAX = 2147483647;
// duration_ms is BIGINT, but nothing legitimate exceeds a year.
const MAX_DURATION_MS = 366 * 24 * 60 * 60 * 1000;

function toDate(value, fallback = null) {
    if (!value) {
        return fallback;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
    if (value === null) {
        return null;
    }
    return Math.min(max, Math.max(min, value));
}

function truncate(value, max) {
    if (value === null || value === undefined) {
        return null;
    }
    return String(value).slice(0, max);
}

function toRow(data, identity = {}) {
    return [
        truncate(data.participantID ?? identity.participantID, 255),
        truncate(data.assignmentId ?? identity.assignmentId, 255),
        truncate(data.systemID ?? identity.systemID, 255),
        truncate(data.studySessionId ?? identity.studySessionId, 255),
        clamp(toNumber(data.sessionSeq), 0, INT_MAX),
        truncate(data.eventType, 128),
        truncate(data.elementName, 255),
        data.eventProps != null ? JSON.stringify(data.eventProps) : null,
        clamp(toNumber(data.durationMs), 0, MAX_DURATION_MS),
        toNumber(data.valueNum),
        toDate(data.clientTs),
        truncate(data.page, 128),
        truncate(data.uiVersion, 64),
        toDate(data.timestamp, new Date()),
    ];
}

/**
 * Bulk insert a batch of events from the client queue.
 *
 * ON DUPLICATE KEY UPDATE against uq_interactions_session_seq makes a retried
 * batch a no-op instead of a duplicate, so the client can resend freely after a
 * failed flush.
 *
 * A multi-row INSERT is all-or-nothing, and the client would retry a rejected
 * batch until its queue overflowed, losing everything behind it. So when the
 * batch fails, each event is tried on its own and only the bad rows are
 * dropped — loudly, so the gap in session_seq has an explanation in the logs.
 */
async function createMany(events, identity = {}) {
    if (!Array.isArray(events) || events.length === 0) {
        return 0;
    }

    const values = events.map((event) => toRow(event, identity));

    try {
        // pool.query (not execute) so mysql2 expands the nested array into a
        // multi-row VALUES list; execute would need a fixed placeholder count.
        const [result] = await getPool().query(INSERT_SQL, [values]);
        return result.affectedRows;
    } catch (batchError) {
        console.error(
            `telemetry: batch of ${values.length} events rejected (${batchError.message}); retrying one by one`
        );
    }

    let inserted = 0;
    for (let index = 0; index < values.length; index += 1) {
        try {
            const [result] = await getPool().query(INSERT_SQL, [[values[index]]]);
            inserted += result.affectedRows;
        } catch (rowError) {
            const event = events[index] || {};
            console.error(
                `telemetry: dropped event session=${identity.studySessionId ?? event.studySessionId} ` +
                    `seq=${event.sessionSeq} type=${event.eventType}: ${rowError.message}`
            );
        }
    }
    return inserted;
}

module.exports = {
    createMany,
};
