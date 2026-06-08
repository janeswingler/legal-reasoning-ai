const params = new URLSearchParams(window.location.search);

const config = {
  participantID: params.get("participantID") || "demo-participant",
  sessionID: params.get("sessionID") || crypto.randomUUID(),
  assignmentId: params.get("assignment") || "week-01",
  systemID: "legal-reasoning-ai-v1",
};