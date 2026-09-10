const fs = require("fs");
const path = require("path");

/**
 * Per-memo due dates, checked in so the mapping has git history like the rest
 * of the study design. A memo missing from the file (or the file itself
 * missing) just has no due date shown.
 */
const MAPPING_PATH = path.join(__dirname, "..", "data", "memo-due-dates.json");

let cached = null;

function loadMemoDueDates() {
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
        throw new Error(`${MAPPING_PATH} must be a JSON object mapping memo number to due date`);
    }

    cached = parsed;
    return cached;
}

function getDueDateForMemo(memoNumber) {
    return loadMemoDueDates()[String(memoNumber)] || null;
}

module.exports = { getDueDateForMemo };
