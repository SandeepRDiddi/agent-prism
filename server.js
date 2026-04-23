import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardSnapshot, detectCostLeaks } from "./src/store.js";
import { config } from "./src/config.js";
import {
  normalizeClaudeRun,
  normalizeCopilotRun,
  normalizeGenericRun
} from "./src/connectors.js";
import {
  authenticateTenantApiKey,
  bootstrapSaas,
  createConnector,
  getBootstrapStatus,
  listTenantContext,
  resetTenantRuns,
  upsertTenantRuns,
  createSession,
  updateSession,
  listSessions,
  getActiveSessionCounts
} from "./src/saas-store.js";
import { pricing, isPricingStale } from "./src/pricing.js";
import { computeClaudeCost } from "./src/cost/claude.js";
import { computeCopilotCost } from "./src/cost/copilot.js";
import { computeGenericCost } from "./src/cost/generic.js";
import { computeRoi } from "./src/roi.js";
import { runSessionTimeout } from "./src/jobs/session-timeout.js";
import { verifyHmacSignature } from "./src/ingest/verify.js";
import { validateConfig } from "./src/startup.js";
import { setSecurityHeaders } from "./src/middleware/security-headers.js";
import { applyCors } from "./src/middleware/cors.js";
import { tenantLimiter, bootstrapLimiter } from "./src/middleware/rate-limiter.js";
import { validate, SCHEMAS } from "./src/validation.js";
import { logRequest, logError } from "./src/middleware/logger.js";
import { setupGracefulShutdown } from "./src/shutdown.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");
const { port, host, adminSecret, storageBackend } = config;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, { "Content-Type": contentTypes[".json"] });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, message) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function sendValidationError(res, errors) {
  sendJson(res, 422, {
    error: "validation_error",
    message: "Request body failed validation.",
    fields: errors
  });
}

const MAX_BODY_BYTES = parseInt(process.env.MAX_BODY_BYTES || "1048576", 10);

function parseBody(req, res) {
  return new Promise((resolve, reject) => {
    // Reject non-JSON bodies that have content
    const contentType = req.headers["content-type"] || "";
    const hasBody = parseInt(req.headers["content-length"] || "0", 10) > 0 ||
                    req.headers["transfer-encoding"];
    if (hasBody && !contentType.includes("application/json")) {
      sendJson(res, 415, { error: "unsupported_media_type", message: "Content-Type must be application/json" });
      req.resume(); // drain so connection can be reused
      resolve(null);
      return;
    }

    let bytes = 0;
    let data = "";
    let over = false;

    req.on("data", (chunk) => {
      if (over) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        over = true;
        sendJson(res, 413, {
          error: "payload_too_large",
          message: `Request body exceeds maximum allowed size of ${MAX_BODY_BYTES} bytes.`
        });
        req.socket?.destroy();
        resolve(null);
        return;
      }
      data += chunk;
    });

    req.on("end", () => {
      if (over) return;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        sendJson(res, 400, { error: "invalid_json", message: "Request body is not valid JSON." });
        resolve(null);
      }
    });

    req.on("error", reject);
  });
}

function normalizePayload(body) {
  const source = body.source || "generic";

  if (source === "copilot") {
    return normalizeCopilotRun(body.payload);
  }

  if (source === "claude") {
    return normalizeClaudeRun(body.payload);
  }

  return normalizeGenericRun(body.payload || body);
}

function getApiKey(req) {
  return req.headers["x-api-key"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
}

async function requireTenant(req, res, setTenantId) {
  const apiKey = getApiKey(req);
  const auth = await authenticateTenantApiKey(apiKey);

  if (!auth?.tenant) {
    sendJson(res, 401, {
      error: "unauthorized",
      message: "Missing or invalid tenant API key."
    });
    return null;
  }

  // Per-tenant rate limit on all authenticated endpoints
  if (!checkRateLimit(tenantLimiter, auth.tenant.id, res)) return null;

  if (typeof setTenantId === "function") setTenantId(auth.tenant.id);
  return auth;
}

function requireAdmin(req, res) {
  const provided = req.headers["x-admin-secret"];

  if (provided !== adminSecret) {
    sendJson(res, 401, {
      error: "unauthorized",
      message: "Missing or invalid admin secret."
    });
    return false;
  }

  return true;
}

function checkRateLimit(limiter, key, res) {
  const { allowed, retryAfter } = limiter.check(key);
  if (!allowed) {
    res.setHeader("Retry-After", String(retryAfter));
    sendJson(res, 429, {
      error: "rate_limit_exceeded",
      message: `Too many requests. Please retry after ${retryAfter} seconds.`
    });
    return false;
  }
  return true;
}

// Basic Auth gate for /dashboard routes
function requireBasicAuth(req, res) {
  const dashUser = process.env.DASHBOARD_USERNAME;
  const dashPass = process.env.DASHBOARD_PASSWORD;

  // If credentials are not configured, allow access (dev mode)
  if (!dashUser || !dashPass) return true;

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Basic ")) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Agent Prism Dashboard"',
      "Content-Type": "text/plain"
    });
    res.end("Unauthorized");
    return false;
  }

  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  const [user, ...passParts] = decoded.split(":");
  const pass = passParts.join(":");

  if (user !== dashUser || pass !== dashPass) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Agent Prism Dashboard"',
      "Content-Type": "text/plain"
    });
    res.end("Unauthorized");
    return false;
  }

  return true;
}

function getWindowStart(window) {
  const now = new Date();
  if (window === "day") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  if (window === "week") {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString();
  }
  // default: 30d
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString();
}

function computeCostByPlatform(sessions) {
  return sessions.reduce((acc, s) => {
    acc[s.platform] = (acc[s.platform] || 0) + (s.costUsd || 0);
    return acc;
  }, {});
}

function getPlatformStatus() {
  return {
    claude: !!process.env.ANTHROPIC_API_KEY,
    copilot: !!process.env.GITHUB_TOKEN,
    generic: true
  };
}

const resolvedPublicDir = resolvePath(publicDir);

// In-flight request tracker for graceful shutdown
let inflightCount = 0;
const inflightTracker = { getInflight: () => inflightCount };

async function serveStatic(req, res) {
  // Strip query string and fragment before path resolution
  const rawPath = new URL(req.url, "http://localhost").pathname;
  const urlPath = rawPath === "/" ? "/index.html" : rawPath;
  const filePath = join(publicDir, urlPath);

  // Path traversal protection: resolved path must stay inside publicDir
  const resolvedFile = resolvePath(filePath);
  if (!resolvedFile.startsWith(resolvedPublicDir + "/") && resolvedFile !== resolvedPublicDir) {
    return sendText(res, 403, "Forbidden");
  }

  const extension = extname(resolvedFile);

  try {
    const file = await readFile(resolvedFile);
    setSecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream"
    });
    res.end(file);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  inflightCount++;
  const startTime = performance.now();
  let tenantId = null;

  // Log every completed response and decrement in-flight counter
  res.on("finish", () => {
    inflightCount--;
    logRequest(req, res, startTime, tenantId);
  });

  try {
    // CORS — handles preflight and sets headers; returns true if preflight was handled
    if (applyCors(req, res)) return;

    if (req.method === "GET" && req.url === "/api/health") {
      const bootstrap = await getBootstrapStatus();
      return sendJson(res, 200, {
        ok: true,
        service: "agent-prism",
        mode: "saas-foundation",
        storageBackend,
        bootstrapped: bootstrap.bootstrapped
      });
    }

    if (req.method === "GET" && req.url === "/api/bootstrap/status") {
      return sendJson(res, 200, await getBootstrapStatus());
    }

    if (req.method === "POST" && req.url === "/api/bootstrap") {
      if (!requireAdmin(req, res)) return;
      // Per-IP rate limit: max 5 bootstrap attempts per hour
      const ip = req.socket?.remoteAddress || "unknown";
      if (!checkRateLimit(bootstrapLimiter, ip, res)) return;

      const body = await parseBody(req, res);
      if (body === null) return;
      const errors = validate(SCHEMAS.bootstrap, body);
      if (errors) return sendValidationError(res, errors);
      const result = await bootstrapSaas(body);
      return sendJson(res, 201, result);
    }

    if (req.method === "GET" && req.url === "/api/dashboard") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      const snapshot = buildDashboardSnapshot(context.runs);
      return sendJson(res, 200, snapshot);
    }

    if (req.method === "GET" && req.url === "/api/runs") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      return sendJson(res, 200, { runs: context.runs });
    }

    if (req.method === "GET" && req.url === "/api/leaks") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      return sendJson(res, 200, { leaks: detectCostLeaks(context.runs) });
    }

    if (req.method === "GET" && req.url === "/api/tenant") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      return sendJson(res, 200, {
        tenant: context.tenant,
        users: context.users,
        connectors: context.connectors,
        runCount: context.runs.length
      });
    }

    if (req.method === "POST" && req.url === "/api/connectors") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const body = await parseBody(req, res);
      if (body === null) return;
      const errors = validate(SCHEMAS.createConnector, body);
      if (errors) return sendValidationError(res, errors);
      const connector = await createConnector(auth.tenant.id, body);
      return sendJson(res, 201, { connector });
    }

    if (req.method === "POST" && req.url === "/api/ingest") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const body = await parseBody(req, res);
      if (body === null) return;
      const ingestErrors = validate(SCHEMAS.ingest, body);
      if (ingestErrors) return sendValidationError(res, ingestErrors);
      const normalizedRun = normalizePayload(body);
      const updated = await upsertTenantRuns(auth.tenant.id, [normalizedRun]);
      return sendJson(res, 201, {
        status: "ingested",
        tenant: auth.tenant.slug,
        totalRuns: updated.length,
        normalizedRun
      });
    }

    if (req.method === "POST" && req.url === "/api/reset") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      await resetTenantRuns(auth.tenant.id);
      return sendJson(res, 200, { status: "reset", tenant: auth.tenant.slug });
    }

    // ── Session Registry ──────────────────────────────────────────────────────

    if (req.method === "POST" && req.url === "/api/sessions") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const sessErrors = validate(SCHEMAS.createSession, body);
      if (sessErrors) return sendValidationError(res, sessErrors);
      const session = await createSession(auth.tenant.id, {
        sessionId: body.session_id,
        platform: body.platform,
        startTime: body.start_time
      });
      return sendJson(res, 201, { session });
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/sessions/") && !req.url.endsWith("/active")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const sessionId = req.url.slice("/api/sessions/".length);
      const body = await parseBody(req, res);
      if (body === null) return;
      const patchErrors = validate(SCHEMAS.updateSession, body);
      if (patchErrors) return sendValidationError(res, patchErrors);
      const updated = await updateSession(sessionId, {
        status: body.status,
        lastSeen: new Date().toISOString(),
        endTime: ["completed", "error"].includes(body.status) ? new Date().toISOString() : undefined
      });
      if (!updated) {
        return sendJson(res, 404, { error: "not_found", message: "Session not found." });
      }
      return sendJson(res, 200, { session: updated });
    }

    if (req.method === "GET" && req.url === "/api/sessions/active") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      await runSessionTimeout();
      const counts = await getActiveSessionCounts(auth.tenant.id);
      return sendJson(res, 200, counts);
    }

    // ── Cost Metrics ──────────────────────────────────────────────────────────

    if (req.method === "GET" && req.url.startsWith("/api/metrics/cost")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      await runSessionTimeout();
      const url = new URL(req.url, "http://localhost");
      const window = url.searchParams.get("window") || "30d";
      const windowStart = getWindowStart(window);
      const sessions = await listSessions(auth.tenant.id, { windowStart });
      const byPlatform = computeCostByPlatform(sessions);
      const total = Object.values(byPlatform).reduce((s, v) => s + v, 0);
      return sendJson(res, 200, {
        window,
        windowStart,
        totalCostUsd: Number(total.toFixed(4)),
        byPlatform: Object.fromEntries(
          Object.entries(byPlatform).map(([k, v]) => [k, Number(v.toFixed(4))])
        )
      });
    }

    // ── Usage ingest (adds cost to session) ───────────────────────────────────

    if (req.method === "POST" && req.url === "/api/usage") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const usageErrors = validate(SCHEMAS.ingestUsage, body);
      if (usageErrors) return sendValidationError(res, usageErrors);
      const { session_id, platform, input_tokens, output_tokens, seat_hours, cost_usd } = body;
      let costDelta = 0;
      const p = (platform || "generic").toLowerCase();
      if (p === "claude") {
        costDelta = computeClaudeCost({ inputTokens: input_tokens || 0, outputTokens: output_tokens || 0 });
      } else if (p === "copilot") {
        costDelta = computeCopilotCost({ seatHours: seat_hours || 0 });
      } else {
        costDelta = computeGenericCost({ costUsd: cost_usd || 0 });
      }
      const updated = await updateSession(session_id, {
        lastSeen: new Date().toISOString(),
        costDelta
      });
      if (!updated) {
        return sendJson(res, 404, { error: "not_found", message: "Session not found." });
      }
      return sendJson(res, 200, { session_id, costDelta: Number(costDelta.toFixed(6)), sessionCostUsd: updated.costUsd });
    }

    // ── ROI ───────────────────────────────────────────────────────────────────

    if (req.method === "GET" && req.url.startsWith("/api/metrics/roi")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      await runSessionTimeout();
      const url = new URL(req.url, "http://localhost");
      const window = url.searchParams.get("window") || "30d";
      const windowStart = getWindowStart(window);
      const sessions = await listSessions(auth.tenant.id, { windowStart });
      const byPlatform = computeCostByPlatform(sessions);
      const agentCostUsd = Object.values(byPlatform).reduce((s, v) => s + v, 0);
      const roi = computeRoi({ sessions, agentCostUsd });
      return sendJson(res, 200, { window, windowStart, ...roi });
    }

    // ── Summary (dashboard polling endpoint) ──────────────────────────────────

    if (req.method === "GET" && req.url === "/api/metrics/summary") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      await runSessionTimeout();

      const [activeCount, daySessionsRaw, monthSessionsRaw] = await Promise.all([
        getActiveSessionCounts(auth.tenant.id),
        listSessions(auth.tenant.id, { windowStart: getWindowStart("day") }),
        listSessions(auth.tenant.id, { windowStart: getWindowStart("30d") })
      ]);

      const dayCostByPlatform = computeCostByPlatform(daySessionsRaw);
      const monthCostByPlatform = computeCostByPlatform(monthSessionsRaw);
      const dayCost = Object.values(dayCostByPlatform).reduce((s, v) => s + v, 0);
      const monthCost = Object.values(monthCostByPlatform).reduce((s, v) => s + v, 0);

      const dayRoi = computeRoi({ sessions: daySessionsRaw, agentCostUsd: dayCost });
      const monthRoi = computeRoi({ sessions: monthSessionsRaw, agentCostUsd: monthCost });

      return sendJson(res, 200, {
        activeAgents: activeCount,
        cost: {
          day: { totalUsd: Number(dayCost.toFixed(4)), byPlatform: dayCostByPlatform },
          month: { totalUsd: Number(monthCost.toFixed(4)), byPlatform: monthCostByPlatform }
        },
        roi: {
          day: dayRoi,
          month: monthRoi
        },
        meta: {
          pricingStale: isPricingStale(),
          pricingLastVerified: pricing.last_verified,
          platformStatus: getPlatformStatus()
        }
      });
    }

    // ── Platform-specific ingest webhooks ─────────────────────────────────────

    if (req.method === "POST" && req.url === "/api/ingest/claude") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const rawBody = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (c) => { data += c; });
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });
      const sig = req.headers["anthropic-signature"] || req.headers["x-webhook-signature"] || "";
      const secret = process.env.CLAUDE_WEBHOOK_SECRET || "";
      if (secret && !verifyHmacSignature({ secret, rawBody, signature: sig })) {
        return sendJson(res, 401, { error: "invalid_signature" });
      }
      const body = JSON.parse(rawBody || "{}");
      const run = normalizeClaudeRun(body);
      await upsertTenantRuns(auth.tenant.id, [run]);
      return sendJson(res, 201, { status: "ingested", source: "claude" });
    }

    if (req.method === "POST" && req.url === "/api/ingest/copilot") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const rawBody = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (c) => { data += c; });
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });
      const sig = req.headers["x-hub-signature-256"] || req.headers["x-webhook-signature"] || "";
      const secret = process.env.COPILOT_WEBHOOK_SECRET || "";
      if (secret && !verifyHmacSignature({ secret, rawBody, signature: sig })) {
        return sendJson(res, 401, { error: "invalid_signature" });
      }
      const body = JSON.parse(rawBody || "{}");
      const run = normalizeCopilotRun(body);
      await upsertTenantRuns(auth.tenant.id, [run]);
      return sendJson(res, 201, { status: "ingested", source: "copilot" });
    }

    if (req.method === "POST" && req.url === "/api/ingest/generic") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const run = normalizeGenericRun(body.payload || body);
      await upsertTenantRuns(auth.tenant.id, [run]);
      return sendJson(res, 201, { status: "ingested", source: "generic" });
    }

    // ── Dashboard page (Basic Auth gate) ─────────────────────────────────────

    if (req.url === "/dashboard" || req.url === "/dashboard.html") {
      if (!requireBasicAuth(req, res)) return;
      const filePath = join(publicDir, "dashboard.html");
      try {
        const file = await readFile(filePath);
        res.writeHead(200, { "Content-Type": contentTypes[".html"] });
        res.end(file);
      } catch {
        sendText(res, 404, "Dashboard not found");
      }
      return;
    }

    return serveStatic(req, res);
  } catch (error) {
    logError(req, error, tenantId);
    return sendJson(res, 500, {
      error: "server_error",
      message: error.message
    });
  }
});

validateConfig();

server.listen(port, host, () => {
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    message: `Agent Prism listening on http://${host}:${port}`,
    env: process.env.NODE_ENV || "development"
  }) + "\n");
});

setupGracefulShutdown(server, inflightTracker);
