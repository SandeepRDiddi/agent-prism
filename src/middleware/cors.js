const rawOrigins = process.env.CORS_ALLOWED_ORIGINS || "";
const allowedOrigins = rawOrigins
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization, X-API-Key, x-api-key, X-Admin-Secret";
const MAX_AGE = "86400"; // 24 hours

/**
 * Apply CORS headers based on CORS_ALLOWED_ORIGINS env var.
 * Returns true if the request was a preflight and has been fully handled (caller should return).
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {boolean} true if preflight was handled and caller should stop processing
 */
export function applyCors(req, res) {
  const origin = req.headers.origin;

  // No origin header → same-origin request (e.g. curl, server-to-server) → no CORS headers needed
  if (!origin) {
    return handlePreflight(req, res, false);
  }

  const isAllowed = allowedOrigins.includes(origin);

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  return handlePreflight(req, res, isAllowed);
}

function handlePreflight(req, res, isAllowed) {
  if (req.method !== "OPTIONS") return false;

  if (!req.headers.origin) {
    // OPTIONS without Origin → not a CORS preflight, let it through
    return false;
  }

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    res.setHeader("Access-Control-Max-Age", MAX_AGE);
    res.writeHead(204);
    res.end();
  } else {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("CORS origin not allowed");
  }

  return true; // caller must return immediately
}
