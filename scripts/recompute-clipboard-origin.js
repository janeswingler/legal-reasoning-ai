/**
 * Re-derive clipboard paste origins from the stored text.
 *
 *   npm run study:recompute-origins
 *
 * Replays every copy/cut/paste in arrival order and rewrites `origin` (and
 * `norm_hash`) from scratch. Run it once after upgrading, and again before any
 * analysis, so the AI-text attribution never depends on the order requests
 * happened to reach the server while the study was running.
 */
require("dotenv").config();
const { getPool } = require("../server/config/db.js");
const { recomputeOrigins } = require("../server/db/clipboardEvents.js");

async function main() {
    const result = await recomputeOrigins({ log: (message) => console.log(message) });
    console.log(
        `Done: ${result.scanned} rows scanned, ${result.hashesFilled} hashes filled, ` +
            `${result.originsChanged} origins changed.`
    );
    await getPool().end();
}

main().catch((error) => {
    console.error("study:recompute-origins failed:", error.message);
    process.exit(1);
});
