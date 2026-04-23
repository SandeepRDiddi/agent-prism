// Headers that must never appear in logs
const REDACTED_HEADERS = new Set(["x-api-key", "authorization", "x-admin-secret", "cookie"]);

function getPath(req) {
  try {
    return new URL(req.url, "http://localhost").pathname;
  } catch {
    return req.url || "/";
  }
}

function getKeyPrefix(req) {
  const raw = req.headers["x-api-key"] || req.headers.authorization || "";
  if (!raw) return null;
  // Return only the first 12 characters (non-secret prefix) for correlation
  const stripped = raw.replace(/^Bearer\s+/i, "");
  return stripped.length > 12 ? stripped.slice(0, 12) + "…" : stripped.slice(0, 12);
}

/**
 * Write a JSON structured request log line to stdout.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {number} startTime - performance.now() value at request start
 * @param {string|null} tenantId
 */
export function logRequest(req, res, startTime, tenantId = null) {
  const latencyMs = Math.round(performance.now() - startTime);
  const entry = {
    ts: new Date().toISOString(),
    level: "info",
    method: req.method,
    path: getPath(req),
    status: res.statusCode,
    latency_ms: latencyMs,
    tenant_id: tenantId,
    key_prefix: getKeyPrefix(req)
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
}

/**
 * Write a JSON structured error log line to stderr.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {Error} error
 * @param {string|null} tenantId
 */
export function logError(req, error, tenantId = null) {
  const entry = {
    ts: new Date().toISOString(),
    level: "error",
    message: error.message,
    stack: error.stack,
    method: req.method,
    path: getPath(req),
    tenant_id: tenantId
    // deliberately no headers — they may contain secrets
  };
  process.stderr.write(JSON.stringify(entry) + "\n");
}
