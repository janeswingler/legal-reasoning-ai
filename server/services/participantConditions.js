const fs = require("fs");
const path = require("path");

/**
 * Which system each participant sees for each memo, read from a CSV exported
 * from the study design spreadsheet.
 *
 * The file is the single source of truth and never reaches the browser: a
 * student who could read the table would know their whole condition sequence
 * in advance, and one who could edit it could change conditions.
 *
 * Study vocabulary is AI / NoAI so the file matches the spreadsheet it comes
 * from. The internal system ids are the translation of that.
 */
const CONDITION_TO_SYSTEM_ID = {
    ai: "2",
    noai: "1",
};

const DEFAULT_MAPPING_PATH = path.join(
    __dirname,
    "..",
    "data",
    "participant-conditions.csv"
);

function getMappingPath() {
    const configured = String(process.env.PARTICIPANT_CONDITIONS_FILE || "").trim();
    if (!configured) {
        return DEFAULT_MAPPING_PATH;
    }
    return path.isAbsolute(configured)
        ? configured
        : path.join(process.cwd(), configured);
}

function splitCsvLines(text) {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

function parseHeader(headerLine, filePath) {
    const columns = headerLine.split(",").map((value) => value.trim());
    const [idColumn, ...memoColumns] = columns;

    if (!/^participant\s*id$/i.test(idColumn)) {
        throw new Error(
            `${filePath}: first column must be participantID, found "${idColumn}"`
        );
    }

    if (memoColumns.length === 0) {
        throw new Error(`${filePath}: no memo columns found`);
    }

    // Column order decides which memo a value belongs to, so a missing or
    // reordered heading has to be an error rather than a silent shift.
    memoColumns.forEach((column, index) => {
        const expected = `memo${index + 1}`;
        if (column.toLowerCase() !== expected) {
            throw new Error(
                `${filePath}: expected column ${index + 2} to be "${expected}", found "${column}"`
            );
        }
    });

    return memoColumns.length;
}

function parseRow(line, lineNumber, memoCount, filePath) {
    const cells = line.split(",").map((value) => value.trim());

    if (cells.length !== memoCount + 1) {
        throw new Error(
            `${filePath} line ${lineNumber}: expected ${memoCount + 1} values, found ${cells.length}`
        );
    }

    const [participantID, ...conditions] = cells;

    if (!participantID) {
        throw new Error(`${filePath} line ${lineNumber}: participant ID is empty`);
    }

    const systemsByMemo = new Map();

    conditions.forEach((condition, index) => {
        const systemID = CONDITION_TO_SYSTEM_ID[condition.toLowerCase()];
        if (!systemID) {
            throw new Error(
                `${filePath} line ${lineNumber}: memo${index + 1} is "${condition}", expected AI or NoAI`
            );
        }
        systemsByMemo.set(index + 1, systemID);
    });

    return { participantID, systemsByMemo };
}

function parseMapping(text, filePath) {
    const lines = splitCsvLines(text);

    if (lines.length < 2) {
        throw new Error(`${filePath}: needs a header row and at least one participant`);
    }

    const memoCount = parseHeader(lines[0], filePath);
    const participants = new Map();

    for (let index = 1; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const { participantID, systemsByMemo } = parseRow(
            lines[index],
            lineNumber,
            memoCount,
            filePath
        );

        if (participants.has(participantID)) {
            throw new Error(
                `${filePath} line ${lineNumber}: participant ${participantID} appears more than once`
            );
        }

        participants.set(participantID, systemsByMemo);
    }

    return { memoCount, participants };
}

let cached = null;

/**
 * Reads and validates the mapping. Called once at startup so a malformed file
 * stops the server rather than misrouting a participant halfway through the
 * study.
 */
function loadParticipantConditions({ force = false } = {}) {
    if (cached && !force) {
        return cached;
    }

    const filePath = getMappingPath();

    let text;
    try {
        text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
        throw new Error(
            `Could not read the participant condition mapping at ${filePath}: ${error.message}`
        );
    }

    cached = { ...parseMapping(text, filePath), filePath };
    return cached;
}

function getMapping() {
    return cached || loadParticipantConditions();
}

function hasParticipant(participantID) {
    return getMapping().participants.has(String(participantID ?? "").trim());
}

/**
 * The system a participant sees for one memo, or null when the participant is
 * not in the study or the memo is out of range. Callers treat null as "do not
 * let them in" rather than falling back to a default condition.
 */
function getSystemId(participantID, memoNumber) {
    const systemsByMemo = getMapping().participants.get(
        String(participantID ?? "").trim()
    );
    if (!systemsByMemo) {
        return null;
    }
    return systemsByMemo.get(Number(memoNumber)) || null;
}

function getMemoCount() {
    return getMapping().memoCount;
}

function getParticipantCount() {
    return getMapping().participants.size;
}

module.exports = {
    loadParticipantConditions,
    hasParticipant,
    getSystemId,
    getMemoCount,
    getParticipantCount,
};
