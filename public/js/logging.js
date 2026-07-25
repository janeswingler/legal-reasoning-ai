const UI_VERSION = "v1";

function logSystemInteraction({ eventType, elementName, page, eventProps = {} }) {
    fetch("/api/system-interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            participantID: config.participantID,
            assignmentId: config.assignmentId,
            sessionID: config.sessionID,
            systemID: config.systemID,
            eventType,
            elementName,
            eventProps: { assignmentId: config.assignmentId, ...eventProps },
            clientTs: new Date(),
            page,
            uiVersion: UI_VERSION,
        }),
    }).catch(() => {});
}