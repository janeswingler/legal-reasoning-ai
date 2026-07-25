const form = document.getElementById("enterForm");
const errorEl = document.getElementById("enterError");
const submitBtn = document.getElementById("enterSubmitBtn");

function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
}

function buildAppUrl({ participantID, assignmentId, systemID }) {
    const params = new URLSearchParams({
        participantID,
        assignment: assignmentId,
        systemID,
    });
    return `/app.html?${params.toString()}`;
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");

    const password = form.password.value;
    const participantID = form.participantID.value.trim();
    const assignmentId = form.assignmentId.value.trim();
    const systemID = form.systemID.value === "1" ? "1" : "2";

    if (!password || !participantID || !assignmentId) {
        showError("Please fill in all fields.");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";

    try {
        const response = await fetch("/api/access/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                password,
                participantID,
                assignmentId,
                systemID,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            showError(data.error || "Access denied. Check your password and try again.");
            return;
        }

        window.location.assign(data.redirect || buildAppUrl({ participantID, assignmentId, systemID }));
    } catch {
        showError("Could not reach the server. Try again in a moment.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Continue to app";
    }
});
