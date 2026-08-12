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

async function ensureIdentityColumns(connection, database) {
    await dropColumn(connection, database, "assignments", "note_type");
    await dropColumn(connection, database, "notes", "note_type");

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
        "INT NULL AFTER session_id"
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
        "uq_interactions_session_seq",
        "UNIQUE KEY uq_interactions_session_seq (session_id, session_seq)"
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
         INNER JOIN chat_sessions s ON s.id = a.chat_session_id
         SET a.system_id = s.system_id
         WHERE (a.system_id IS NULL OR a.system_id = '')
           AND s.system_id IS NOT NULL
           AND s.system_id <> ''`
    );
    await connection.query(
        `UPDATE document_chunks c
         INNER JOIN chat_sessions s ON s.id = c.chat_session_id
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
