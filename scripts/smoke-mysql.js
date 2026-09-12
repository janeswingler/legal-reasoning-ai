/**
 * Lightweight API smoke test against a running server + initialized DB.
 * Usage: node scripts/smoke-mysql.js
 *
 * Uses dummy participant 20 on a memo in their AI condition (the API only
 * accepts identities from the study mapping) and removes what it created.
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const PARTICIPANT = "20";
const ASSIGNMENT = "memo-05";

async function req(method, path, body) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`${method} ${path} -> ${response.status} ${data.error || ""}`);
    }
    return data;
}

async function expectStatus(method, path, body, status) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status !== status) {
        throw new Error(`${method} ${path} -> expected ${status}, got ${response.status}`);
    }
}

async function main() {
    await req("GET", "/api/health");

    const studySessionId = `session-${Date.now()}`;
    const identityQuery =
        `participantID=${encodeURIComponent(PARTICIPANT)}` +
        `&assignmentId=${encodeURIComponent(ASSIGNMENT)}`;

    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || "127.0.0.1",
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD || "",
        database: process.env.MYSQL_DATABASE,
        timezone: "Z",
    });

    const [existing] = await connection.query(
        `SELECT id FROM assignments WHERE participant_id = ? AND assignment_id = ?`,
        [PARTICIPANT, ASSIGNMENT]
    );
    if (existing.length) {
        await connection.end();
        throw new Error(
            `participant ${PARTICIPANT} already has ${ASSIGNMENT}; delete it first`
        );
    }

    let createdId = null;
    let chatThreadId = null;
    try {
        const created = await req("PUT", "/api/assignments/current", {
            participantID: PARTICIPANT,
            assignmentId: ASSIGNMENT,
            studySessionId,
            // Ignored: the server takes the condition from the study mapping.
            systemID: "1",
            title: "Smoke assignment",
            content: "<p>hello</p>",
        });
        if (!created._id) {
            throw new Error("assignment missing _id");
        }
        createdId = created._id;
        if (created.systemID !== "2") {
            throw new Error(`systemID should come from the mapping (got ${created.systemID})`);
        }

        const current = await req("GET", `/api/assignments/current?${identityQuery}`);
        if (String(current._id) !== String(created._id)) {
            throw new Error("assignment round-trip mismatch");
        }

        // A participant outside the mapping, or a memo not scheduled, is refused.
        await expectStatus(
            "GET",
            `/api/assignments/current?participantID=not-in-study&assignmentId=${ASSIGNMENT}`,
            null,
            403
        );
        // Participant 20's memo 6 is NoAI, so the chat API is closed for it.
        await expectStatus(
            "GET",
            `/api/chat/threads?participantID=${PARTICIPANT}&assignmentId=memo-06`,
            null,
            403
        );

        const { thread } = await req("POST", "/api/chat/threads", {
            participantID: PARTICIPANT,
            assignmentId: ASSIGNMENT,
            studySessionId,
        });
        if (!thread?._id) {
            throw new Error("thread missing _id");
        }
        chatThreadId = thread._id;

        const history = await req(
            "GET",
            `/api/chat/threads/${thread._id}/history?${identityQuery}`
        );
        if (!Array.isArray(history.exchanges)) {
            throw new Error("history missing exchanges");
        }

        console.log("smoke ok", { rowId: created._id, chatThreadId: thread._id });
    } finally {
        if (chatThreadId) {
            await connection.query(`DELETE FROM chat_threads WHERE id = ?`, [chatThreadId]);
        }
        if (createdId) {
            await connection.query(`DELETE FROM assignments WHERE id = ?`, [createdId]);
        }
        await connection.end();
    }
}

main().catch((error) => {
    console.error("smoke failed:", error.message);
    process.exit(1);
});
