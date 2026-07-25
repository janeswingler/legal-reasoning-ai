/**
 * Lightweight API smoke test against a running server + initialized DB.
 * Usage: node scripts/smoke-mysql.js
 */
require("dotenv").config();

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";

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

async function main() {
    await req("GET", "/api/health");

    const participantID = `smoke-${Date.now()}`;
    const assignmentId = "week-01";
    const sessionID = `session-${Date.now()}`;

    const created = await req("PUT", "/api/assignments/current", {
        participantID,
        assignmentId,
        sessionID,
        systemID: "smoke",
        title: "Smoke assignment",
        content: "<p>hello</p>",
    });
    if (!created._id) {
        throw new Error("assignment missing _id");
    }

    const current = await req(
        "GET",
        `/api/assignments/current?participantID=${encodeURIComponent(participantID)}&assignmentId=${encodeURIComponent(assignmentId)}`
    );
    if (String(current._id) !== String(created._id)) {
        throw new Error("assignment round-trip mismatch");
    }

    const { session } = await req("POST", "/api/chat/sessions", {
        participantID,
        assignmentId,
        sessionID,
        systemID: "smoke",
    });
    if (!session?._id) {
        throw new Error("session missing _id");
    }

    const history = await req(
        "GET",
        `/api/chat/sessions/${session._id}/history?participantID=${encodeURIComponent(participantID)}&assignmentId=${encodeURIComponent(assignmentId)}`
    );
    if (!Array.isArray(history.exchanges)) {
        throw new Error("history missing exchanges");
    }

    await req("POST", "/api/system-interactions", {
        participantID,
        assignmentId,
        sessionID,
        systemID: "smoke",
        eventType: "smoke",
        elementName: "smoke-test",
        page: "smoke",
    });

    console.log("smoke ok", {
        rowId: created._id,
        sessionId: session._id,
    });
}

main().catch((error) => {
    console.error("smoke failed:", error.message);
    process.exit(1);
});
