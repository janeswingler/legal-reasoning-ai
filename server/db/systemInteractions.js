const { query, getPool } = require("../config/db.js");
const { mapKeys, parseJson } = require("./helpers.js");

const INTERACTION_KEYS = {
    id: "id",
    participant_id: "participantID",
    assignment_id: "assignmentId",
    system_id: "systemID",
    session_id: "sessionID",
    session_seq: "sessionSeq",
    event_type: "eventType",
    element_name: "elementName",
    event_props: "eventProps",
    duration_ms: "durationMs",
    value_num: "valueNum",
    client_ts: "clientTs",
    page: "page",
    ui_version: "uiVersion",
    timestamp: "timestamp",
};

const INSERT_COLUMNS = `(
    participant_id, assignment_id, system_id, session_id, session_seq,
    event_type, element_name, event_props, duration_ms, value_num,
    client_ts, page, ui_version, timestamp
)`;

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

function toRow(data, identity = {}) {
    return [
        data.participantID ?? identity.participantID ?? null,
        data.assignmentId ?? identity.assignmentId ?? null,
        data.systemID ?? identity.systemID ?? null,
        data.sessionID ?? identity.sessionID ?? null,
        toNumber(data.sessionSeq),
        data.eventType ?? null,
        data.elementName ?? null,
        data.eventProps != null ? JSON.stringify(data.eventProps) : null,
        toNumber(data.durationMs),
        toNumber(data.valueNum),
        toDate(data.clientTs),
        data.page ?? null,
        data.uiVersion ?? null,
        toDate(data.timestamp, new Date()),
    ];
}

function mapInteraction(row) {
    if (!row) {
        return null;
    }
    const mapped = mapKeys(row, INTERACTION_KEYS);
    mapped.eventProps = parseJson(row.event_props, null);
    return mapped;
}

async function create(data) {
    const result = await query(
        `INSERT INTO system_interactions ${INSERT_COLUMNS}
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        toRow(data)
    );

    const rows = await query(
        `SELECT * FROM system_interactions WHERE id = ? LIMIT 1`,
        [result.insertId]
    );
    return mapInteraction(rows[0] || null);
}

/**
 * Bulk insert a batch of events from the client queue.
 *
 * ON DUPLICATE KEY UPDATE against uq_interactions_session_seq makes a retried
 * batch a no-op instead of a duplicate, so the client can resend freely after a
 * failed flush. Unlike INSERT IGNORE this only swallows duplicate-key errors,
 * leaving real problems (bad dates, oversized values) visible.
 */
async function createMany(events, identity = {}) {
    if (!Array.isArray(events) || events.length === 0) {
        return 0;
    }

    const values = events.map((event) => toRow(event, identity));

    // pool.query (not execute) so mysql2 expands the nested array into a
    // multi-row VALUES list; execute would need a fixed placeholder count.
    const [result] = await getPool().query(
        `INSERT INTO system_interactions ${INSERT_COLUMNS}
         VALUES ?
         ON DUPLICATE KEY UPDATE id = id`,
        [values]
    );

    return result.affectedRows;
}

module.exports = {
    create,
    createMany,
};
