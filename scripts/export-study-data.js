/**
 * Export the study database to CSV for analysis in R, SPSS or Excel.
 *
 *   npm run study:export              -> ./exports/<timestamp>/
 *   npm run study:export -- --out dir -> custom directory
 *
 * One file per table plus the per-participant-per-week summary, which is the
 * file most analyses will start from.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const EXPORTS = [
    // Summaries: one row per participant-memo, then one row per sitting.
    { name: "participant_week_summary", sql: "SELECT * FROM v_participant_week ORDER BY participant_id, assignment_id" },
    { name: "session_summary", sql: "SELECT * FROM v_session_summary ORDER BY participant_id, assignment_id, started_at" },
    // Event families with their details as plain columns.
    { name: "typing_bursts", sql: "SELECT * FROM v_typing_bursts ORDER BY participant_id, assignment_id, client_ts, session_seq" },
    { name: "heartbeats", sql: "SELECT * FROM v_heartbeats ORDER BY participant_id, assignment_id, client_ts, session_seq" },
    { name: "attention", sql: "SELECT * FROM v_attention ORDER BY participant_id, assignment_id, client_ts, session_seq" },
    { name: "chat_turns", sql: "SELECT * FROM v_chat_turns ORDER BY participant_id, assignment_id, timestamp" },
    // Raw tables.
    { name: "study_sessions", sql: "SELECT * FROM study_sessions ORDER BY participant_id, started_at" },
    { name: "events", sql: "SELECT * FROM system_interactions ORDER BY participant_id, client_ts, session_seq" },
    { name: "clipboard_events", sql: "SELECT * FROM clipboard_events ORDER BY participant_id, client_ts" },
    { name: "assignments", sql: "SELECT * FROM assignments ORDER BY participant_id, assignment_id" },
    { name: "chat_threads", sql: "SELECT * FROM chat_threads ORDER BY participant_id, created_at" },
    { name: "chat_exchanges", sql: "SELECT * FROM chat_exchanges ORDER BY participant_id, timestamp" },
    { name: "chat_attachments", sql: "SELECT * FROM chat_attachments ORDER BY participant_id, created_at" },
    // Snapshot bodies are large; the HTML is dropped and the plain text kept.
    {
        name: "editor_snapshots",
        sql: `SELECT id, study_session_id, participant_id, assignment_id, system_id,
                     captured_at, client_ts, reason, char_count, word_count,
                     content_hash, keystrokes_since_prev, plain_text
              FROM editor_snapshots
              ORDER BY participant_id, assignment_id, captured_at`,
    },
];

// Every participant is in California, so the export shows Pacific time (with
// the UTC offset attached so the value stays unambiguous across the DST change).
const EXPORT_TIME_ZONE = "America/Los_Angeles";

const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: EXPORT_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

function formatLocalTimestamp(date) {
    const p = Object.fromEntries(
        localParts.formatToParts(date).map((part) => [part.type, part.value])
    );
    const ms = date.getMilliseconds();
    const wallClockAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const offsetMin = Math.round((wallClockAsUtc - (date.getTime() - ms)) / 60000);
    const sign = offsetMin < 0 ? "-" : "+";
    const abs = Math.abs(offsetMin);
    const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${String(ms).padStart(3, "0")}${offset}`;
}

function toCsvValue(value) {
    if (value === null || value === undefined) {
        return "";
    }
    if (value instanceof Date) {
        return formatLocalTimestamp(value);
    }
    if (typeof value === "object") {
        return escapeCsv(JSON.stringify(value));
    }
    return escapeCsv(String(value));
}

function escapeCsv(text) {
    // Strip control characters that break naive CSV readers, keeping the text
    // itself intact for qualitative coding.
    const cleaned = text.replace(/\r\n/g, "\n");
    if (/[",\n]/.test(cleaned)) {
        return `"${cleaned.replace(/"/g, '""')}"`;
    }
    return cleaned;
}

function toCsv(rows) {
    if (!rows.length) {
        return "";
    }
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(",")];
    for (const row of rows) {
        lines.push(headers.map((header) => toCsvValue(row[header])).join(","));
    }
    return `${lines.join("\n")}\n`;
}

function resolveOutDir() {
    const flagIndex = process.argv.indexOf("--out");
    if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
        return path.resolve(process.argv[flagIndex + 1]);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return path.resolve(process.cwd(), "exports", stamp);
}

async function main() {
    const user = process.env.MYSQL_USER;
    const database = process.env.MYSQL_DATABASE;

    if (!user || !database) {
        console.error("Set MYSQL_USER and MYSQL_DATABASE in .env before exporting.");
        process.exit(1);
    }

    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || "127.0.0.1",
        port: Number(process.env.MYSQL_PORT || 3306),
        user,
        password: process.env.MYSQL_PASSWORD || "",
        database,
        // The app writes every timestamp as UTC; read them back the same way so
        // the export does not shift with the time zone of the exporting machine.
        timezone: "Z",
    });

    const outDir = resolveOutDir();
    fs.mkdirSync(outDir, { recursive: true });

    try {
        for (const item of EXPORTS) {
            try {
                const [rows] = await connection.query(item.sql);
                const file = path.join(outDir, `${item.name}.csv`);
                fs.writeFileSync(file, toCsv(rows), "utf8");
                console.log(`${item.name}: ${rows.length} rows`);
            } catch (error) {
                console.error(`${item.name}: skipped (${error.message})`);
            }
        }
        console.log(`\nExported to ${outDir}`);
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error("study:export failed:", error.message);
    process.exit(1);
});
