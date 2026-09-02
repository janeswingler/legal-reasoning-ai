/*
 * Memo parsing shared by the landing page, the editor, and the completion page.
 *
 * Which system a participant sees is decided only on the server, from the
 * condition mapping, and reaches the browser as a validated systemID in the
 * URL. Nothing here computes it.
 */
const MEMO_COUNT = 8;

function resolveMemoNumber(raw) {
    const digits = String(raw ?? "").match(/\d+/);
    if (!digits) {
        return null;
    }

    const memoNumber = parseInt(digits[0], 10);
    if (memoNumber < 1 || memoNumber > MEMO_COUNT) {
        return null;
    }
    return memoNumber;
}

function toMemoId(memoNumber) {
    return `memo-${String(memoNumber).padStart(2, "0")}`;
}
