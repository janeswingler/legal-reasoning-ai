const MEMO_COUNT = 6;

function extractIdNumber(raw) {
    const digits = String(raw ?? "").match(/\d+/);
    if (!digits) {
        return null;
    }
    return parseInt(digits[0], 10);
}

function resolveMemoNumber(raw) {
    const memoNumber = extractIdNumber(raw);
    if (memoNumber === null || memoNumber < 1 || memoNumber > MEMO_COUNT) {
        return null;
    }
    return memoNumber;
}

function resolveParticipantNumber(raw) {
    return extractIdNumber(raw);
}

function toMemoId(memoNumber) {
    return `memo-${String(memoNumber).padStart(2, "0")}`;
}

/**
 * Same parity (both odd or both even) → system 1, no AI.
 * Different parity → system 2, AI.
 * Returns null when a number cannot be read from the participant ID.
 */
function resolveSystemIdFromParity(participantID, memoNumber) {
    const participantNumber = resolveParticipantNumber(participantID);
    if (participantNumber === null || memoNumber == null) {
        return null;
    }

    const sameParity = participantNumber % 2 === memoNumber % 2;
    return sameParity ? "1" : "2";
}

module.exports = {
    MEMO_COUNT,
    extractIdNumber,
    resolveMemoNumber,
    resolveParticipantNumber,
    resolveSystemIdFromParity,
    toMemoId,
};
