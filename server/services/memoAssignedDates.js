const fs = require("fs");
const path = require("path");

/**
 * Per-memo release dates, checked in so the mapping has git history like the
 * rest of the study design. A memo with no entry here opens immediately --
 * only memo 2 onward need to stay locked until their assigned moment, since
 * memo 1 is open from the start of the study.
 *
 * Values are ISO timestamps with an explicit offset so the instant they name
 * is unambiguous (California crosses the PDT/PST line partway through the
 * semester) and comparisons don't depend on the server's own timezone.
 */
const MAPPING_PATH = path.join(__dirname, "..", "data", "memo-assigned-dates.json");

const PACIFIC_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
});

let cached = null;

function loadMemoAssignedDates() {
    if (cached) {
        return cached;
    }

    if (!fs.existsSync(MAPPING_PATH)) {
        cached = {};
        return cached;
    }

    let text;
    try {
        text = fs.readFileSync(MAPPING_PATH, "utf8");
    } catch (error) {
        throw new Error(`Could not read ${MAPPING_PATH}: ${error.message}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`${MAPPING_PATH} is not valid JSON: ${error.message}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(
            `${MAPPING_PATH} must be a JSON object mapping memo number to an ISO release date`
        );
    }

    const dates = {};
    for (const [memoNumber, value] of Object.entries(parsed)) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            throw new Error(
                `${MAPPING_PATH}: memo ${memoNumber} has an unparseable date "${value}"`
            );
        }
        dates[memoNumber] = date;
    }

    cached = dates;
    return cached;
}

/** Null when the memo has no release date on file (open from the start). */
function getAssignedDateForMemo(memoNumber) {
    return loadMemoAssignedDates()[String(memoNumber)] || null;
}

/** True once `now` has reached the memo's release date, or if it has none. */
function isMemoOpen(memoNumber, now = new Date()) {
    const assignedDate = getAssignedDateForMemo(memoNumber);
    return !assignedDate || now.getTime() >= assignedDate.getTime();
}

/** Human-readable Pacific time for the "not open yet" message, or null. */
function getAssignedDateDisplay(memoNumber) {
    const assignedDate = getAssignedDateForMemo(memoNumber);
    return assignedDate ? `${PACIFIC_FORMATTER.format(assignedDate)} PT` : null;
}

module.exports = { getAssignedDateForMemo, isMemoOpen, getAssignedDateDisplay };
