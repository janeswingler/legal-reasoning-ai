const form = document.getElementById("enterForm");
const errorEl = document.getElementById("enterError");
const submitBtn = document.getElementById("enterSubmitBtn");
const memoTitleEl = document.getElementById("enterMemoTitle");

const memoNumber = resolveMemoNumber(
    new URLSearchParams(window.location.search).get("memoID")
);

function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
}

function buildAppUrl({ participantID, memoID, systemID }) {
    const params = new URLSearchParams({
        participantID,
        memoID,
        systemID,
    });
    return `/app.html?${params.toString()}`;
}

if (memoNumber) {
    memoTitleEl.textContent = `Memo ${memoNumber}`;
} else {
    memoTitleEl.hidden = true;
    submitBtn.disabled = true;
    showError(
        "Open this page from your Canvas memo link, for example /?memoID=1."
    );
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");

    if (!memoNumber) {
        showError(
            "Open this page from your Canvas memo link, for example /?memoID=1."
        );
        return;
    }

    const participantID = form.participantID.value.trim();

    if (!participantID) {
        showError("Please enter your participant ID.");
        return;
    }

    if (resolveParticipantNumber(participantID) === null) {
        showError("Participant ID must include a number, for example 33.");
        return;
    }

    const systemID = resolveSystemIdFromParity(participantID, memoNumber);

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";

    try {
        const response = await fetch("/api/access/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                participantID,
                memoID: String(memoNumber),
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            showError(data.error || "Could not continue. Check your participant ID and try again.");
            return;
        }

        window.location.assign(
            data.redirect ||
                buildAppUrl({
                    participantID,
                    memoID: String(memoNumber),
                    systemID,
                })
        );
    } catch {
        showError("Could not reach the server. Try again in a moment.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Continue";
    }
});
