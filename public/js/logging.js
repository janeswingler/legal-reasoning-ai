const PARTICIPANT_ID = "demo-participant";
const SESSION_ID = "demo-session";
const SYSTEM_ID = "legal-reasoning-ai-v1";
const UI_VERSION = "v1";

function logSystemInteraction({ eventType, elementName, page, eventProps = {} }) {
    fetch("/api/system-interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            participantID: PARTICIPANT_ID,
            sessionID: SESSION_ID,
            systemID: SYSTEM_ID,
            eventType,
            elementName,
            eventProps,
            clientTs: new Date(),
            page,
            uiVersion: UI_VERSION,
        }),
    }).catch(() => {});
}