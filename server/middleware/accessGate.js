const {
    ACCESS_COOKIE,
    isAccessGateEnabled,
    createAccessToken,
    verifyAccessToken,
} = require("../services/accessGate.js");

const PUBLIC_PATHS = new Set([
    "/",
    "/index.html",
    "/css/variables.css",
    "/css/reset.css",
    "/css/enter.css",
    "/js/enter.js",
]);

const PUBLIC_PREFIXES = ["/api/access", "/api/health"];

function isPublicPath(pathname) {
    if (PUBLIC_PATHS.has(pathname)) {
        return true;
    }
    return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function readAccessCookie(req) {
    const raw = req.headers.cookie || "";
    const match = raw.match(new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
}

function hasAccess(req) {
    if (!isAccessGateEnabled()) {
        return true;
    }
    return verifyAccessToken(readAccessCookie(req));
}

function accessGateMiddleware(req, res, next) {
    if (!isAccessGateEnabled() || isPublicPath(req.path) || hasAccess(req)) {
        return next();
    }

    if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "Access required" });
    }

    return res.redirect("/");
}

function setAccessCookie(req, res) {
    const token = createAccessToken();
    const secure =
        process.env.COOKIE_SECURE === "true" ||
        req.secure ||
        req.headers["x-forwarded-proto"] === "https";
    const maxAgeDays = Number(process.env.ACCESS_COOKIE_DAYS || 7);
    const maxAgeSec = maxAgeDays * 24 * 60 * 60;

    const parts = [
        `${ACCESS_COOKIE}=${encodeURIComponent(token)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAgeSec}`,
    ];
    if (secure) {
        parts.push("Secure");
    }

    res.setHeader("Set-Cookie", parts.join("; "));
}

module.exports = {
    accessGateMiddleware,
    setAccessCookie,
    hasAccess,
};
