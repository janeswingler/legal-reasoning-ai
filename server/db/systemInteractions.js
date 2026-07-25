const { query } = require("../config/db.js");
const { mapKeys, parseJson } = require("./helpers.js");

const INTERACTION_KEYS = {
    id: "id",
    participant_id: "participantID",
    assignment_id: "assignmentId",
    system_id: "systemID",
    session_id: "sessionID",
    event_type: "eventType",
    element_name: "elementName",
    event_props: "eventProps",
    client_ts: "clientTs",
    page: "page",
    ui_version: "uiVersion",
    timestamp: "timestamp",
};

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
        `INSERT INTO system_interactions (
            participant_id, assignment_id, system_id, session_id, event_type, element_name,
            event_props, client_ts, page, ui_version, timestamp
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.participantID ?? null,
            data.assignmentId ?? null,
            data.systemID ?? null,
            data.sessionID ?? null,
            data.eventType ?? null,
            data.elementName ?? null,
            data.eventProps != null ? JSON.stringify(data.eventProps) : null,
            data.clientTs ? new Date(data.clientTs) : null,
            data.page ?? null,
            data.uiVersion ?? null,
            data.timestamp ? new Date(data.timestamp) : new Date(),
        ]
    );

    const rows = await query(
        `SELECT * FROM system_interactions WHERE id = ? LIMIT 1`,
        [result.insertId]
    );
    return mapInteraction(rows[0] || null);
}

module.exports = {
    create,
};
