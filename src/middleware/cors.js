const rawOrigins = process.env.CORS_ALLOWED_ORIGINS || "";
const allowedOrigins = rawOrigins
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization, X-API-Key, x-api-key, X-Admin-Secret";
const MAX_AGE = "86400";

/**
 * Apply CORS headers. Enforces HTTPS-only origins in production.
 * Returns true if request was a preflight and has been fully handled.
 */
export function applyCors(req, res) {
  const origin = req.headers.origin;

  if (!origin) {
    return handlePreflight(req, res, false);
  }

  // Reject non-HTTPS origins in production — credentials must not be sent over HTTP
  if (IS_PRODUCTION && !origin.startsWith("https://")) {
    if (req.method === "OPTIONS") {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("CORS: only HTTPS origins allowed in production");
      return true;
    }
    return false;
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

  if (!req.headers.origin) return false;

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

  return true;
}
