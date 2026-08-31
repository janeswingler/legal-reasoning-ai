const MEMO_COUNT = 8;

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

function toMemoId(memoNumber) {
    return `memo-${String(memoNumber).padStart(2, "0")}`;
}

module.exports = {
    MEMO_COUNT,
    extractIdNumber,
    resolveMemoNumber,
    toMemoId,
};
