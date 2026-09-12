/**
 * End-to-end check of the study telemetry pipeline against a running server.
 *
 *   node scripts/smoke-telemetry.js [baseUrl]
 *
 * Uses dummy participant 20 on memo 5 (the API only accepts identities from
 * the study mapping) and refuses to run if that pair already has telemetry.
 * Writes and then removes its own rows, so it is safe to run against a
 * development database. It will not touch real participant data.
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

const BASE = process.argv[2] || "http://localhost:3000";
const PARTICIPANT = "20";
const ASSIGNMENT = "memo-05";
const SESSION = `sess-${Date.now()}`;
const ORPHAN_SESSION = `sess-orphan-${Date.now()}`;
const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;

const identity = {
    participantID: PARTICIPANT,
    assignmentId: ASSIGNMENT,
    studySessionId: SESSION,
    // Deliberately wrong: the server must replace it from the mapping.
    systemID: "1",
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

function connect() {
    return mysql.createConnection({
        host: process.env.MYSQL_HOST || "127.0.0.1",
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD || "",
        database: process.env.MYSQL_DATABASE,
        timezone: "Z",
    });
}

async function countRows(connection, table) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS n FROM ${table} WHERE participant_id = ? AND assignment_id = ?`,
        [PARTICIPANT, ASSIGNMENT]
    );
    return Number(rows[0].n);
}

async function main() {
    console.log(`Target: ${BASE}\nParticipant: ${PARTICIPANT} / ${ASSIGNMENT}\n`);

    const connection = await connect();
    for (const table of ["study_sessions", "system_interactions", "editor_snapshots", "clipboard_events"]) {
        if (await countRows(connection, table)) {
            await connection.end();
            throw new Error(
                `${table} already has rows for participant ${PARTICIPANT} / ${ASSIGNMENT}; ` +
                    `clear them before running the smoke test`
            );
        }
    }

    try {
        // 0. Identity is checked against the study mapping
        const rejected = await post("/api/telemetry/session/start", {
            ...identity,
            participantID: "not-in-study",
        });
        check("unknown participant rejected", rejected.status === 403, `got ${rejected.status}`);

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
        check(
            "systemID taken from the mapping, not the request",
            start.json?.session?.systemID === "2",
            `systemID=${start.json?.session?.systemID}`
        );

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

        // 4. A bad row must not take the rest of its batch down with it
        const poisoned = await post("/api/telemetry/events", {
            ...identity,
            events: [
                event(7, "heartbeat", { durationMs: 30000, eventProps: { visible: false } }),
                // 40 days in ms overflows a 32-bit INT; must land intact in BIGINT.
                event(8, "tab_visible", { page: "window", durationMs: FORTY_DAYS_MS }),
                event(9, "x".repeat(300)),
            ],
        });
        check("poisoned batch still accepted", poisoned.status === 201, `got ${poisoned.status}`);
        check(
            "all rows survive (values clamped/truncated)",
            poisoned.json?.inserted === 3,
            `inserted=${poisoned.json?.inserted}`
        );

        // 5. Reload: the close beacon fires, then the same session starts again
        await post("/api/telemetry/session/end", { ...identity, reason: "pagehide" });
        const restart = await post("/api/telemetry/session/start", {
            ...identity,
            clientStartedAt: new Date().toISOString(),
        });
        check("session reopened after reload", restart.status === 201);
        check(
            "reload clears ended_at",
            restart.json?.session?.endedAt === null,
            `endedAt=${restart.json?.session?.endedAt}`
        );

        // 6. Events whose session/start was lost still open a sitting
        const orphan = await post("/api/telemetry/events", {
            ...identity,
            studySessionId: ORPHAN_SESSION,
            events: [event(1, "session_start")],
        });
        check("orphan events accepted", orphan.status === 201);

        // 7. Clipboard: copy from an assistant message, then paste into the
        //    editor with the whitespace the clipboard would have changed
        const aiText =
            "The elements of promissory estoppel are:\n- a clear and definite promise\n- reasonable reliance\n- injustice absent enforcement.";
        const copy = await post("/api/telemetry/clipboard", {
            ...identity,
            action: "copy",
            surface: "chat_message_assistant",
            content: aiText,
            chatThreadId: null,
            clientTs: new Date().toISOString(),
        });
        check("clipboard copy accepted", copy.status === 201, `got ${copy.status}`);

        const pasteInternal = await post("/api/telemetry/clipboard", {
            ...identity,
            action: "paste",
            surface: "editor",
            content: aiText.replace(/\n/g, "\r\n") + "\r\n",
            clientTs: new Date().toISOString(),
        });
        check(
            "paste of AI text classified as internal_chat_assistant despite line-break differences",
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

        // 8. Snapshots: plain text is derived from the HTML with line breaks
        const snapOne = await post("/api/telemetry/snapshot", {
            ...identity,
            contentHtml: "<p>First draft</p><p>of the memo.</p>",
            reason: "interval",
            keystrokesSincePrev: 37,
        });
        check("first snapshot stored", snapOne.status === 201 && snapOne.json?.skipped === false);
        check(
            "word count spans paragraphs",
            snapOne.json?.snapshot?.wordCount === 5,
            `got ${snapOne.json?.snapshot?.wordCount}`
        );

        const snapDupe = await post("/api/telemetry/snapshot", {
            ...identity,
            contentHtml: "<p>First draft</p><p>of the memo.</p>",
            reason: "interval",
        });
        check("identical snapshot skipped", snapDupe.json?.skipped === true);

        const snapTwo = await post("/api/telemetry/snapshot", {
            ...identity,
            contentHtml: "<p>Second draft of the memo,</p><p>now longer.</p>",
            reason: "submit",
        });
        check("changed snapshot stored", snapTwo.json?.skipped === false);

        // 9. Session end
        const end = await post("/api/telemetry/session/end", {
            ...identity,
            events: [event(10, "session_end", { eventProps: { reason: "pagehide" } })],
            reason: "pagehide",
        });
        check("session/end accepted", end.status === 200, `got ${end.status}`);

        // 10. Verify in the database
        const [events] = await connection.query(
            "SELECT COUNT(*) AS n FROM system_interactions WHERE study_session_id = ?",
            [SESSION]
        );
        check(
            "no duplicate rows from replay (10 unique events)",
            Number(events[0].n) === 10,
            `rows=${events[0].n}`
        );

        const [longDuration] = await connection.query(
            "SELECT duration_ms FROM system_interactions WHERE study_session_id = ? AND session_seq = 8",
            [SESSION]
        );
        check(
            "40-day duration stored without overflow",
            Number(longDuration[0]?.duration_ms) === FORTY_DAYS_MS,
            `duration_ms=${longDuration[0]?.duration_ms}`
        );

        const [session] = await connection.query(
            "SELECT ended_at, end_reason, last_seen_at FROM study_sessions WHERE id = ?",
            [SESSION]
        );
        check("session closed", Boolean(session[0]?.ended_at), `reason=${session[0]?.end_reason}`);

        const [orphanSession] = await connection.query(
            "SELECT id, assignment_id, system_id FROM study_sessions WHERE id = ?",
            [ORPHAN_SESSION]
        );
        check(
            "sitting opened from orphan events",
            orphanSession[0]?.assignment_id === ASSIGNMENT && orphanSession[0]?.system_id === "2"
        );

        const [snaps] = await connection.query(
            "SELECT plain_text FROM editor_snapshots WHERE study_session_id = ? ORDER BY id",
            [SESSION]
        );
        check("exactly two snapshots stored", snaps.length === 2, `rows=${snaps.length}`);
        check(
            "plain text keeps the paragraph break",
            snaps[0]?.plain_text === "First draft\nof the memo.",
            JSON.stringify(snaps[0]?.plain_text)
        );

        const [summary] = await connection.query(
            "SELECT * FROM v_participant_week WHERE participant_id = ? AND assignment_id = ?",
            [PARTICIPANT, ASSIGNMENT]
        );
        const row = summary[0];
        check("summary view returns a row", Boolean(row));

        if (row) {
            check("away time surfaced", Number(row.away_ms) === 42000, `away_ms=${row.away_ms}`);
            check("away episodes counted", Number(row.away_episodes) === 1, `n=${row.away_episodes}`);
            check("editor keystrokes summed", Number(row.editor_keystrokes) === 37, `n=${row.editor_keystrokes}`);
            check("backspaces extracted from JSON", Number(row.editor_backspaces) === 4, `n=${row.editor_backspaces}`);
            check("input-active time summed", Number(row.input_active_ms) === 30000, `ms=${row.input_active_ms}`);
            // prompts_sent comes from chat_exchanges, which this telemetry-only
            // script never writes; the chat_send event above is raw log only.
            check("prompts counted from exchanges, not events", Number(row.prompts_sent) === 0, `n=${row.prompts_sent}`);
            check("AI paste counted", Number(row.ai_pastes_into_editor) === 1, `n=${row.ai_pastes_into_editor}`);
            check("external paste counted", Number(row.external_pastes) === 1, `n=${row.external_pastes}`);
            check("final word count from newest snapshot", Number(row.final_word_count) === 7, `n=${row.final_word_count}`);
            check("both sittings counted", Number(row.session_count) === 2, `n=${row.session_count}`);
        }
    } finally {
        if (!process.argv.includes("--keep")) {
            for (const table of ["system_interactions", "editor_snapshots", "clipboard_events", "study_sessions"]) {
                await connection.query(
                    `DELETE FROM ${table} WHERE participant_id = ? AND assignment_id = ?`,
                    [PARTICIPANT, ASSIGNMENT]
                );
            }
            console.log("\nTest rows removed.");
        }
        await connection.end();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error("smoke:telemetry failed:", error);
    process.exit(1);
});
