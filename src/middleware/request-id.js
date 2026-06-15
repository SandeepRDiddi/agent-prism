import { randomBytes } from "node:crypto";

export function generateRequestId() {
  return randomBytes(12).toString("base64url");
}

/**
 * Attach a trace/request ID to req and set response header.
 * Uses caller-supplied X-Request-ID if present (propagation); generates one otherwise.
 */
export function attachRequestId(req, res) {
  const incoming = req.headers["x-request-id"] || req.headers["x-trace-id"];
  const id = incoming ? String(incoming).slice(0, 64) : generateRequestId();
  req.requestId = id;
  res.setHeader("X-Request-ID", id);
  return id;
}
