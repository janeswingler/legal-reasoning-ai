const form = document.getElementById("enterForm");
const errorEl = document.getElementById("enterError");
const submitBtn = document.getElementById("enterSubmitBtn");
const memoTitleEl = document.getElementById("enterMemoTitle");
const participantInput = document.getElementById("participantID");

const memoNumber = resolveMemoNumber(
    new URLSearchParams(window.location.search).get("memoID")
);

function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
}

/** Leaves them ready to try again rather than stranded on a dead end. */
function promptRetry(message) {
    showError(message);
    participantInput.select();
    participantInput.focus();
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
        promptRetry("Please enter your participant ID.");
        return;
    }

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
            // The condition mapping lives on the server, so it is the only
            // thing that can say whether this ID is in the study.
            promptRetry(
                data.error ||
                    "Could not continue. Check your participant ID and try again."
            );
            return;
        }

        window.location.assign(data.redirect);
    } catch {
        showError("Could not reach the server. Try again in a moment.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Continue";
    }
});
