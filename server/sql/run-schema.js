require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function columnExists(connection, database, table, column) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [database, table, column]
    );
    return Number(rows[0]?.count || 0) > 0;
}

async function ensureColumn(connection, database, table, column, definition) {
    if (await columnExists(connection, database, table, column)) {
        return false;
    }
    await connection.query(
        `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`
    );
    console.log(`Added ${table}.${column}`);
    return true;
}

async function dropColumn(connection, database, table, column) {
    if (!(await columnExists(connection, database, table, column))) {
        return false;
    }
    await connection.query(
        `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``
    );
    console.log(`Dropped ${table}.${column}`);
    return true;
}

async function getColumn(connection, database, table, column) {
    const [rows] = await connection.query(
        `SELECT COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [database, table, column]
    );
    return rows[0] || null;
}

/**
 * CREATE TABLE IF NOT EXISTS never changes an existing column, so type and
 * nullability changes in schema.sql have to be applied here as well.
 */
async function ensureColumnType(
    connection,
    database,
    table,
    column,
    { type, nullable },
    definition
) {
    const current = await getColumn(connection, database, table, column);
    if (!current) {
        return false;
    }
    const typeMatches = current.columnType.toLowerCase().startsWith(type.toLowerCase());
    const nullMatches = (current.isNullable === "YES") === nullable;
    if (typeMatches && nullMatches) {
        return false;
    }
    await connection.query(
        `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`
    );
    console.log(`Changed ${table}.${column} to ${definition}`);
    return true;
}

async function indexExists(connection, database, table, index) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?
           AND INDEX_NAME = ?`,
        [database, table, index]
    );
    return Number(rows[0]?.count || 0) > 0;
}

async function ensureIndex(connection, database, table, index, definition) {
    if (await indexExists(connection, database, table, index)) {
        return false;
    }
    await connection.query(
        `ALTER TABLE \`${table}\` ADD ${definition}`
    );
    console.log(`Added index ${table}.${index}`);
    return true;
}

async function foreignKeyExists(connection, database, table, name) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?
           AND CONSTRAINT_NAME = ?
           AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [database, table, name]
    );
    return Number(rows[0]?.count || 0) > 0;
}

async function dropForeignKeyIfExists(connection, database, table, name) {
    if (!(await foreignKeyExists(connection, database, table, name))) {
        return false;
    }
    await connection.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``);
    console.log(`Dropped foreign key ${table}.${name}`);
    return true;
}

async function ensureForeignKey(connection, database, table, name, definition) {
    if (await foreignKeyExists(connection, database, table, name)) {
        return false;
    }
    await connection.query(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` ${definition}`
    );
    console.log(`Added foreign key ${table}.${name}`);
    return true;
}

async function renameColumnIfLegacy(connection, database, table, oldName, newName, definition) {
    if (!(await tableExists(connection, database, table))) {
        return false;
    }
    if (
        !(await columnExists(connection, database, table, oldName)) ||
        (await columnExists(connection, database, table, newName))
    ) {
        return false;
    }
    // CHANGE COLUMN rather than RENAME COLUMN: works on older MariaDB too.
    await connection.query(
        `ALTER TABLE \`${table}\` CHANGE COLUMN \`${oldName}\` \`${newName}\` ${definition}`
    );
    console.log(`Renamed ${table}.${oldName} -> ${newName}`);
    return true;
}

async function renameIndexIfLegacy(connection, database, table, oldName, newName, definition) {
    if (!(await tableExists(connection, database, table))) {
        return false;
    }
    if (await indexExists(connection, database, table, oldName)) {
        await connection.query(`ALTER TABLE \`${table}\` DROP INDEX \`${oldName}\``);
        console.log(`Dropped index ${table}.${oldName}`);
    }
    return ensureIndex(connection, database, table, newName, definition);
}

async function tableExists(connection, database, table) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?`,
        [database, table]
    );
    return Number(rows[0]?.count || 0) > 0;
}

/**
 * "session" used to mean both a sitting and a chat conversation. Databases
 * created before the split carry the old names; this moves them to
 * study_session_id / chat_threads / chat_thread_id. Must run before
 * schema.sql, or CREATE TABLE IF NOT EXISTS would add an empty chat_threads
 * beside the old chat_sessions.
 */
async function renameLegacySessionNames(connection, database) {
    if (
        (await tableExists(connection, database, "chat_sessions")) &&
        !(await tableExists(connection, database, "chat_threads"))
    ) {
        await connection.query(`RENAME TABLE chat_sessions TO chat_threads`);
        console.log("Renamed table chat_sessions -> chat_threads");
    }

    // Foreign keys must go before their column is renamed; they are re-added
    // under their new names at the end.
    const threadForeignKeys = [
        ["chat_exchanges", "fk_chat_exchanges_session", "fk_chat_exchanges_thread"],
        ["chat_attachments", "fk_chat_attachments_session", "fk_chat_attachments_thread"],
        ["document_chunks", "fk_document_chunks_session", "fk_document_chunks_thread"],
    ];
    for (const [table, oldFk] of threadForeignKeys) {
        if (await tableExists(connection, database, table)) {
            await dropForeignKeyIfExists(connection, database, table, oldFk);
        }
    }

    for (const [table, definition] of [
        ["chat_exchanges", "BIGINT UNSIGNED NOT NULL"],
        ["chat_attachments", "BIGINT UNSIGNED NOT NULL"],
        ["document_chunks", "BIGINT UNSIGNED NOT NULL"],
        ["clipboard_events", "BIGINT UNSIGNED NULL"],
    ]) {
        await renameColumnIfLegacy(connection, database, table, "chat_session_id", "chat_thread_id", definition);
    }

    for (const [table, definition] of [
        ["assignments", "VARCHAR(255) NULL"],
        ["chat_threads", "VARCHAR(255) NULL"],
        ["chat_exchanges", "VARCHAR(255) NULL"],
        ["system_interactions", "VARCHAR(255) NULL"],
        ["editor_snapshots", "VARCHAR(64) NULL"],
        ["clipboard_events", "VARCHAR(64) NULL"],
    ]) {
        await renameColumnIfLegacy(connection, database, table, "session_id", "study_session_id", definition);
    }

    const indexRenames = [
        ["chat_threads", "idx_chat_sessions_participant_assignment_updated", "idx_chat_threads_participant_assignment_updated",
            "KEY idx_chat_threads_participant_assignment_updated (participant_id, assignment_id, updated_at)"],
        ["chat_exchanges", "idx_chat_exchanges_session_timestamp", "idx_chat_exchanges_thread_timestamp",
            "KEY idx_chat_exchanges_thread_timestamp (chat_thread_id, timestamp)"],
        ["chat_attachments", "idx_chat_attachments_session_created", "idx_chat_attachments_thread_created",
            "KEY idx_chat_attachments_thread_created (chat_thread_id, created_at)"],
        ["document_chunks", "idx_document_chunks_session_index", "idx_document_chunks_thread_index",
            "KEY idx_document_chunks_thread_index (chat_thread_id, chunk_index)"],
        ["editor_snapshots", "idx_snapshots_session", "idx_snapshots_study_session",
            "KEY idx_snapshots_study_session (study_session_id, captured_at)"],
        ["system_interactions", "uq_interactions_session_seq", "uq_interactions_study_session_seq",
            "UNIQUE KEY uq_interactions_study_session_seq (study_session_id, session_seq)"],
    ];
    for (const [table, oldName, newName, definition] of indexRenames) {
        await renameIndexIfLegacy(connection, database, table, oldName, newName, definition);
    }

    for (const [table, , newFk] of threadForeignKeys) {
        if (await tableExists(connection, database, table)) {
            await ensureForeignKey(
                connection,
                database,
                table,
                newFk,
                "FOREIGN KEY (chat_thread_id) REFERENCES chat_threads (id) ON DELETE CASCADE"
            );
        }
    }

    if (await tableExists(connection, database, "system_interactions")) {
        await connection.query(
            `UPDATE system_interactions
             SET event_type = 'chat_thread_switch'
             WHERE event_type = 'chat_session_switch'`
        );
    }
}

async function ensureIdentityColumns(connection, database) {
    await dropColumn(connection, database, "assignments", "note_type");
    await dropColumn(connection, database, "notes", "note_type");

    await ensureColumn(
        connection,
        database,
        "assignments",
        "questionnaire_completed_at",
        "DATETIME(3) NULL AFTER submitted_at"
    );

    await ensureColumn(
        connection,
        database,
        "chat_attachments",
        "system_id",
        "VARCHAR(255) NULL AFTER assignment_id"
    );
    await ensureColumn(
        connection,
        database,
        "document_chunks",
        "system_id",
        "VARCHAR(255) NULL AFTER participant_id"
    );
    await ensureColumn(
        connection,
        database,
        "system_interactions",
        "assignment_id",
        "VARCHAR(255) NULL AFTER participant_id"
    );

    // Telemetry columns promoted out of event_props for the HCI study.
    await ensureColumn(
        connection,
        database,
        "system_interactions",
        "session_seq",
        "INT NULL AFTER study_session_id"
    );
    await ensureColumn(
        connection,
        database,
        "system_interactions",
        "duration_ms",
        "INT NULL AFTER event_props"
    );
    await ensureColumn(
        connection,
        database,
        "system_interactions",
        "value_num",
        "DOUBLE NULL AFTER duration_ms"
    );

    await ensureIndex(
        connection,
        database,
        "system_interactions",
        "uq_interactions_study_session_seq",
        "UNIQUE KEY uq_interactions_study_session_seq (study_session_id, session_seq)"
    );
    await ensureIndex(
        connection,
        database,
        "system_interactions",
        "idx_interactions_participant_assignment_ts",
        "KEY idx_interactions_participant_assignment_ts (participant_id, assignment_id, client_ts)"
    );
    await ensureIndex(
        connection,
        database,
        "system_interactions",
        "idx_interactions_event_type_ts",
        "KEY idx_interactions_event_type_ts (event_type, client_ts)"
    );

    // Millisecond durations overflow a 32-bit INT after ~24 days; a tab left
    // asleep that long would have poisoned its whole event batch.
    await ensureColumnType(
        connection,
        database,
        "system_interactions",
        "duration_ms",
        { type: "bigint", nullable: true },
        "BIGINT NULL"
    );
    await ensureColumnType(
        connection,
        database,
        "study_sessions",
        "clock_skew_ms",
        { type: "bigint", nullable: true },
        "BIGINT NULL"
    );

    await ensureColumn(
        connection,
        database,
        "clipboard_events",
        "norm_hash",
        "CHAR(64) NULL AFTER content_hash"
    );

    // Per-exchange model and cost, for the methods section.
    await ensureColumn(connection, database, "chat_exchanges", "model", "VARCHAR(64) NULL AFTER bot_response");
    await ensureColumn(connection, database, "chat_exchanges", "stop_reason", "VARCHAR(32) NULL AFTER model");
    await ensureColumn(connection, database, "chat_exchanges", "input_tokens", "INT NULL AFTER stop_reason");
    await ensureColumn(connection, database, "chat_exchanges", "output_tokens", "INT NULL AFTER input_tokens");
    await ensureColumn(connection, database, "chat_exchanges", "response_ms", "INT NULL AFTER output_tokens");
    await connection.query(
        `UPDATE chat_exchanges
         SET stop_reason = JSON_UNQUOTE(JSON_EXTRACT(retrieval_meta, '$.stopReason'))
         WHERE stop_reason IS NULL
           AND retrieval_meta IS NOT NULL
           AND JSON_EXTRACT(retrieval_meta, '$.stopReason') IS NOT NULL`
    );
    await ensureIndex(
        connection,
        database,
        "clipboard_events",
        "idx_clipboard_norm_hash_lookup",
        "KEY idx_clipboard_norm_hash_lookup (participant_id, norm_hash, action)"
    );

    // participant_id is half of the unique key; NULLs there never collide, so
    // the row could be duplicated. Refuse rather than delete if any exist.
    const [orphanRows] = await connection.query(
        `SELECT COUNT(*) AS count FROM assignments WHERE participant_id IS NULL`
    );
    const orphanCount = Number(orphanRows[0]?.count || 0);
    if (orphanCount > 0) {
        console.warn(
            `assignments has ${orphanCount} row(s) with no participant_id; ` +
                `leaving the column nullable. Fix or remove those rows and rerun db:init.`
        );
    } else {
        await ensureColumnType(
            connection,
            database,
            "assignments",
            "participant_id",
            { type: "varchar(255)", nullable: false },
            "VARCHAR(255) NOT NULL"
        );
    }

    // Backfill assignment_id from legacy event_props JSON when present.
    await connection.query(
        `UPDATE system_interactions
         SET assignment_id = JSON_UNQUOTE(JSON_EXTRACT(event_props, '$.assignmentId'))
         WHERE (assignment_id IS NULL OR assignment_id = '')
           AND event_props IS NOT NULL
           AND JSON_EXTRACT(event_props, '$.assignmentId') IS NOT NULL`
    );

    // Backfill system_id onto attachments/chunks from their chat session when missing.
    await connection.query(
        `UPDATE chat_attachments a
         INNER JOIN chat_threads s ON s.id = a.chat_thread_id
         SET a.system_id = s.system_id
         WHERE (a.system_id IS NULL OR a.system_id = '')
           AND s.system_id IS NOT NULL
           AND s.system_id <> ''`
    );
    await connection.query(
        `UPDATE document_chunks c
         INNER JOIN chat_threads s ON s.id = c.chat_thread_id
         SET c.system_id = s.system_id
         WHERE (c.system_id IS NULL OR c.system_id = '')
           AND s.system_id IS NOT NULL
           AND s.system_id <> ''`
    );
}

async function main() {
    const host = process.env.MYSQL_HOST || "127.0.0.1";
    const port = Number(process.env.MYSQL_PORT || 3306);
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD || "";
    const database = process.env.MYSQL_DATABASE;

    if (!user || !database) {
        console.error(
            "Set MYSQL_USER and MYSQL_DATABASE in .env before running db:init."
        );
        process.exit(1);
    }

    const schemaPath = path.join(__dirname, "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf8");
    const viewsPath = path.join(__dirname, "views.sql");
    const viewsSql = fs.readFileSync(viewsPath, "utf8");

    const connection = await mysql.createConnection({
        host,
        port,
        user,
        password,
        database,
        multipleStatements: true,
        timezone: "Z",
    });

    try {
        // Rename legacy notes table before CREATE TABLE assignments.
        if (
            (await tableExists(connection, database, "notes")) &&
            !(await tableExists(connection, database, "assignments"))
        ) {
            await connection.query(`RENAME TABLE notes TO assignments`);
            console.log("Renamed table notes -> assignments");
        } else if (
            (await tableExists(connection, database, "notes")) &&
            (await tableExists(connection, database, "assignments"))
        ) {
            await connection.query(
                `INSERT IGNORE INTO assignments
                 SELECT * FROM notes`
            );
            await connection.query(`DROP TABLE notes`);
            console.log("Merged notes into assignments and dropped notes");
        }

        await renameLegacySessionNames(connection, database);
        await connection.query(sql);
        await ensureIdentityColumns(connection, database);

        // Views come last: they read columns the ALTERs above may have added.
        await connection.query(viewsSql);

        console.log(`Schema applied to ${database} @ ${host}:${port}`);
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error("db:init failed:", error.message);
    process.exit(1);
});
