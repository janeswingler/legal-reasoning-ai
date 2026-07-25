const crypto = require("crypto");

const ACCESS_COOKIE = "aillr_access";

function getAccessPassword() {
    return String(process.env.ACCESS_PASSWORD || "").trim();
}

function isAccessGateEnabled() {
    return getAccessPassword().length > 0;
}

function getSigningSecret() {
    return process.env.ACCESS_COOKIE_SECRET || getAccessPassword();
}

function checkPassword(input) {
    const expected = getAccessPassword();
    if (!expected || !input) {
        return false;
    }

    const digestA = crypto.createHash("sha256").update(String(input)).digest();
    const digestB = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(digestA, digestB);
}

function createAccessToken() {
    const expiresAt = Date.now() + Number(process.env.ACCESS_COOKIE_DAYS || 7) * 24 * 60 * 60 * 1000;
    const payload = String(expiresAt);
    const signature = crypto
        .createHmac("sha256", getSigningSecret())
        .update(payload)
        .digest("hex");
    return `${payload}.${signature}`;
}

function verifyAccessToken(token) {
    if (!token || typeof token !== "string") {
        return false;
    }

    const [payload, signature] = token.split(".");
    if (!payload || !signature) {
        return false;
    }

    const expiresAt = Number(payload);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return false;
    }

    const expected = crypto
        .createHmac("sha256", getSigningSecret())
        .update(payload)
        .digest("hex");

    try {
        return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
    } catch {
        return false;
    }
}

module.exports = {
    ACCESS_COOKIE,
    checkPassword,
    createAccessToken,
    isAccessGateEnabled,
    verifyAccessToken,
};
