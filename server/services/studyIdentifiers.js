/**
 * Participant and memo ids arrive from query strings and from Qualtrics
 * redirects, and they are concatenated into file names and Drive paths, so
 * they are validated in one place rather than at each entry point.
 */
function sanitizeId(value, fieldName) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        throw new Error(`${fieldName} is required`);
    }
    if (trimmed.length > 255) {
        throw new Error(`${fieldName} is too long`);
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
        throw new Error(
            `${fieldName} may only contain letters, numbers, dots, dashes, and underscores`
        );
    }
    return trimmed;
}

module.exports = { sanitizeId };
