/**
 * End-to-end check of the study telemetry pipeline against a running server.
 *
 *   node scripts/smoke-telemetry.js [baseUrl]
 *
 * Writes and then removes its own rows, so it is safe to run against a
 * development database. It will not touch real participant data.
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

const BASE = process.argv[2] || "http://localhost:3000";
const PARTICIPANT = `smoke-${Date.now()}`;
const ASSIGNMENT = "week-smoke";
const SESSION = `sess-${Date.now()}`;
const SYSTEM = "2";

const identity = {
    participantID: PARTICIPANT,
    assignmentId: ASSIGNMENT,
    sessionID: SESSION,
    systemID: SYSTEM,
};

let failures = 0;

function check(label, condition, detail = "") {
    const status = condition ? "PASS" : "FAIL";
    if (!condition) {
        failures += 1;
    }
    console.log(`${status}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function post(path, body) {
    const response = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = { raw: text };
    }
    return { status: response.status, json };
}

function event(seq, eventType, extra = {}) {
    return {
        sessionSeq: seq,
        eventType,
        elementName: extra.elementName ?? eventType,
        page: extra.page ?? "app",
        valueNum: extra.valueNum ?? null,
        durationMs: extra.durationMs ?? null,
        eventProps: extra.eventProps ?? {},
        clientTs: new Date().toISOString(),
        uiVersion: "smoke",
    };
}

async function main() {
    console.log(`Target: ${BASE}\nParticipant: ${PARTICIPANT}\n`);

    // 1. Session start
    const start = await post("/api/telemetry/session/start", {
        ...identity,
        clientStartedAt: new Date().toISOString(),
        userAgent: "smoke-test",
        screenW: 1920,
        screenH: 1080,
        viewportW: 1440,
        viewportH: 900,
        tzOffsetMin: 420,
    });
    check("session/start returns 201", start.status === 201, `got ${start.status}`);
    check("session row created", Boolean(start.json?.session?.id));
    check("clock skew recorded", start.json?.session?.clockSkewMs !== undefined);

    // 2. Event batch
    const batch = await post("/api/telemetry/events", {
        ...identity,
        events: [
            event(1, "session_start"),
            event(2, "window_blur", { page: "window", durationMs: 5000 }),
            event(3, "window_focus", { page: "window", durationMs: 42000 }),
            event(4, "typing_burst", {
                page: "editor",
                valueNum: 37,
                durationMs: 10000,
                eventProps: { chars: 31, backspaces: 4, deletes: 1, enters: 1, charDelta: 27 },
            }),
            event(5, "heartbeat", {
                durationMs: 30000,
                eventProps: { visible: true, windowFocused: true, hadInput: true },
            }),
            event(6, "chat_send", { page: "chat", valueNum: 120 }),
        ],
    });
    check("events batch accepted", batch.status === 201, `got ${batch.status}`);
    check("all six events inserted", batch.json?.inserted === 6, `inserted=${batch.json?.inserted}`);

    // 3. Idempotency: resending the same batch must not duplicate
    const replay = await post("/api/telemetry/events", {
        ...identity,
        events: [event(4, "typing_burst", { page: "editor", valueNum: 37 })],
    });
    check("replayed event accepted", replay.status === 201);

    // 4. Clipboard: copy from an assistant message, then paste into the editor
    const aiText =
        "The elements of promissory estoppel are a clear and definite promise, reasonable reliance, and injustice absent enforcement.";
    const copy = await post("/api/telemetry/clipboard", {
        ...identity,
        action: "copy",
        surface: "chat_message_assistant",
        content: aiText,
        chatSessionId: null,
        clientTs: new Date().toISOString(),
    });
    check("clipboard copy accepted", copy.status === 201, `got ${copy.status}`);

    const pasteInternal = await post("/api/telemetry/clipboard", {
        ...identity,
        action: "paste",
        surface: "editor",
        content: aiText,
        clientTs: new Date().toISOString(),
    });
    check(
        "paste of AI text classified as internal_chat_assistant",
        pasteInternal.json?.origin === "internal_chat_assistant",
        `origin=${pasteInternal.json?.origin}`
    );

    const pasteExternal = await post("/api/telemetry/clipboard", {
        ...identity,
        action: "paste",
        surface: "editor",
        content: "Text that was never copied anywhere inside this application at all.",
        clientTs: new Date().toISOString(),
    });
    check(
        "never-copied text classified as external",
        pasteExternal.json?.origin === "external",
        `origin=${pasteExternal.json?.origin}`
    );

    // 5. Snapshots: second identical capture must be skipped
    const snapOne = await post("/api/telemetry/snapshot", {
        ...identity,
        contentHtml: "<p>First draft of the memo.</p>",
        plainText: "First draft of the memo.",
        reason: "interval",
        keystrokesSincePrev: 37,
    });
    check("first snapshot stored", snapOne.status === 201 && snapOne.json?.skipped === false);
    check("word count computed", snapOne.json?.snapshot?.wordCount === 5, `got ${snapOne.json?.snapshot?.wordCount}`);

    const snapDupe = await post("/api/telemetry/snapshot", {
        ...identity,
        contentHtml: "<p>First draft of the memo.</p>",
        plainText: "First draft of the memo.",
        reason: "interval",
    });
    check("identical snapshot skipped", snapDupe.json?.skipped === true);

    const snapTwo = await post("/api/telemetry/snapshot", {
        ...identity,
        contentHtml: "<p>Second draft of the memo, now longer.</p>",
        plainText: "Second draft of the memo, now longer.",
        reason: "submit",
    });
    check("changed snapshot stored", snapTwo.json?.skipped === false);

    // 6. Session end
    const end = await post("/api/telemetry/session/end", {
        ...identity,
        events: [event(7, "session_end", { eventProps: { reason: "pagehide" } })],
        endedAt: new Date().toISOString(),
        reason: "pagehide",
    });
    check("session/end accepted", end.status === 200, `got ${end.status}`);

    // 7. Verify in the database
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || "127.0.0.1",
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD || "",
        database: process.env.MYSQL_DATABASE,
    });

    try {
        const [events] = await connection.query(
            "SELECT COUNT(*) AS n FROM system_interactions WHERE participant_id = ?",
            [PARTICIPANT]
        );
        check(
            "no duplicate rows from replay (7 unique events)",
            events[0].n === 7,
            `rows=${events[0].n}`
        );

        const [session] = await connection.query(
            "SELECT ended_at, end_reason, last_seen_at FROM study_sessions WHERE id = ?",
            [SESSION]
        );
        check("session closed", Boolean(session[0]?.ended_at), `reason=${session[0]?.end_reason}`);

        const [snaps] = await connection.query(
            "SELECT COUNT(*) AS n FROM editor_snapshots WHERE participant_id = ?",
            [PARTICIPANT]
        );
        check("exactly two snapshots stored", snaps[0].n === 2, `rows=${snaps[0].n}`);

        const [summary] = await connection.query(
            "SELECT * FROM v_participant_week WHERE participant_id = ?",
            [PARTICIPANT]
        );
        const row = summary[0];
        check("summary view returns a row", Boolean(row));

        if (row) {
            check("away time surfaced", Number(row.away_ms) === 42000, `away_ms=${row.away_ms}`);
            check("away episodes counted", Number(row.away_episodes) === 1, `n=${row.away_episodes}`);
            check("editor keystrokes summed", Number(row.editor_keystrokes) === 37, `n=${row.editor_keystrokes}`);
            check("backspaces extracted from JSON", Number(row.editor_backspaces) === 4, `n=${row.editor_backspaces}`);
            check("input-active time summed", Number(row.input_active_ms) === 30000, `ms=${row.input_active_ms}`);
            check("prompts counted", Number(row.prompts_sent) === 1, `n=${row.prompts_sent}`);
            check("AI paste counted", Number(row.ai_pastes_into_editor) === 1, `n=${row.ai_pastes_into_editor}`);
            check("AI chars counted", Number(row.ai_chars_into_editor) === aiText.length, `n=${row.ai_chars_into_editor}`);
            check("external paste counted", Number(row.external_pastes) === 1, `n=${row.external_pastes}`);
            check("final word count from newest snapshot", Number(row.final_word_count) === 7, `n=${row.final_word_count}`);
            check("session counted", Number(row.session_count) === 1, `n=${row.session_count}`);
        }

        if (!process.argv.includes("--keep")) {
            await connection.query("DELETE FROM system_interactions WHERE participant_id = ?", [PARTICIPANT]);
            await connection.query("DELETE FROM editor_snapshots WHERE participant_id = ?", [PARTICIPANT]);
            await connection.query("DELETE FROM clipboard_events WHERE participant_id = ?", [PARTICIPANT]);
            await connection.query("DELETE FROM study_sessions WHERE participant_id = ?", [PARTICIPANT]);
            console.log("\nTest rows removed.");
        }
    } finally {
        await connection.end();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error("smoke:telemetry failed:", error);
    process.exit(1);
});
