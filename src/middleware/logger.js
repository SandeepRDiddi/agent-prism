// Headers that must never appear in logs
const REDACTED_HEADERS = new Set(["x-api-key", "authorization", "x-admin-secret", "cookie"]);

// Patterns that indicate secrets embedded in strings (error messages, stack traces, URLs)
const SECRET_PATTERNS = [
  // Our tenant API keys
  { re: /acp_[A-Za-z0-9]{20,}/g,             mask: "[REDACTED_API_KEY]" },
  // Bearer tokens (any scheme)
  { re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,  mask: "Bearer [REDACTED]" },
  // OpenAI / OpenAI-compatible keys
  { re: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g,    mask: "[REDACTED_KEY]" },
  // Anthropic keys
  { re: /sk-ant-[A-Za-z0-9\-]{20,}/g,        mask: "[REDACTED_KEY]" },
  // Postgres connection strings with embedded credentials
  { re: /postgres(?:ql)?:\/\/[^:]+:[^@]+@/gi, mask: "postgres://[REDACTED]@" },
  // API keys in query strings (?api_key=xxx or ?apikey=xxx)
  { re: /([?&]api[_-]?key=)[A-Za-z0-9\-._~+/]+=*/gi, mask: "$1[REDACTED]" },
  // Header values if they appear as strings in error messages
  { re: /(x-api-key:\s*)\S+/gi,              mask: "$1[REDACTED]" },
  { re: /(authorization:\s*)\S+/gi,           mask: "$1[REDACTED]" }
];

/**
 * Remove secret values from a string before logging or sending to a client.
 * Applies all SECRET_PATTERNS. Returns the original value unchanged if not a string.
 */
export function scrubSecrets(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const { re, mask } of SECRET_PATTERNS) {
    out = out.replace(re, mask);
  }
  return out;
}

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
 * Secret values in message and stack are automatically redacted.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {Error} error
 * @param {string|null} tenantId
 */
export function logError(req, error, tenantId = null) {
  const entry = {
    ts: new Date().toISOString(),
    level: "error",
    message: scrubSecrets(error.message),
    stack: scrubSecrets(error.stack),
    method: req.method,
    path: getPath(req),
    tenant_id: tenantId
    // deliberately no headers — they may contain secrets
  };
  process.stderr.write(JSON.stringify(entry) + "\n");
}
