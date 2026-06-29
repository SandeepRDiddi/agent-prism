import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { exec } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import os from "node:os";
import { dirname, extname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);
import { buildDashboardSnapshot, detectCostLeaks, detectModelMismatches } from "./src/store.js";
import { classifyTask, getModelRecommendation, scrubPii } from "./src/model-classifier.js";
import { config } from "./src/config.js";
import { generateAiAdvisor, callLlm } from "./src/ai-advisor.js";
import { createId } from "./src/auth.js";
import {
  normalizeClaudeRun,
  normalizeCopilotRun,
  normalizeGenericRun
} from "./src/connectors.js";
import {
  authenticateTenantApiKey,
  bootstrapSaas,
  createTenantApiKey,
  listTenantApiKeys,
  revokeTenantApiKey,
  deleteTenantApiKey,
  deleteAllTenantApiKeys,
  authenticateUser,
  createDashboardSession,
  authenticateDashboardSession,
  revokeDashboardSession,
  setUserPassword,
  ensureDemoUser,
  createConnector,
  getBootstrapStatus,
  listTenantContext,
  resetTenantRuns,
  resetPromptCaptures,
  applyDataRetention,
  upsertTenantRuns,
  createSession,
  updateSession,
  listSessions,
  getActiveSessionCounts,
  logAuditEvent,
  listAuditLogs,
  getPromptAnalysis,
  savePromptAnalysis,
  savePromptCapture,
  listPromptCaptures,
  getModelFitnessStats,
  updateTenantPlan,
  pingDb,
  getApiKeyStatus,
  checkAndSetIdempotencyKey,
  pruneIdempotencyKeys,
  saveFailedIngest,
  listPendingFailedIngests,
  markFailedIngestAttempt,
  createRefreshToken,
  verifyAndRotateRefreshToken,
  revokeAllRefreshTokens,
  setApiKeyIpAllowlist,
  upsertSsoUser,
  ensureSchemaPatches,
  provisionTenant,
  listTenants,
  listAgentDefinitions,
  getAgentDefinition,
  getAgentRunsForCert,
  saveCertification,
  getCertification,
  listCertifications,
  revokeCertification,
  createPromotion
} from "./src/saas-store.js";
import { evaluateAgent } from "./src/certification/certifier.js";
import { pricing, isPricingStale } from "./src/pricing.js";
import { computeClaudeCost } from "./src/cost/claude.js";
import { computeCopilotCost } from "./src/cost/copilot.js";
import { computeGenericCost } from "./src/cost/generic.js";
import { computeRoi } from "./src/roi.js";
import { runSessionTimeout } from "./src/jobs/session-timeout.js";
import { verifyHmacSignature } from "./src/ingest/verify.js";
import { validateConfig } from "./src/startup.js";
import { breakers } from "./src/circuit-breaker.js";
import { setSecurityHeaders } from "./src/middleware/security-headers.js";
import { applyCors } from "./src/middleware/cors.js";
import { tenantLimiter, bootstrapLimiter, keyRpmLimiter, keyTpmLimiter, loginLimiter } from "./src/middleware/rate-limiter.js";
import { checkIngestAllowed, checkGatewayAllowed, getPlan, computeUsage } from "./src/plans.js";
import { validate, SCHEMAS } from "./src/validation.js";
import { logRequest, logError, scrubSecrets } from "./src/middleware/logger.js";
import { incCounter, recordLatency, getMetricsText } from "./src/middleware/metrics.js";
import { setupGracefulShutdown } from "./src/shutdown.js";
import { attachRequestId } from "./src/middleware/request-id.js";
import { generateCspNonce } from "./src/middleware/security-headers.js";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");
const { port, host, adminSecret, storageBackend } = config;
const SESSION_COOKIE = "aps_session";

// ── OIDC / SSO ────────────────────────────────────────────────────────────────
const oidcStates = new Map(); // state hex → { createdAt }
const OIDC_STATE_TTL_MS = 10 * 60 * 1000;
let _oidcDiscovery = null;
async function getOidcDiscovery() {
  if (_oidcDiscovery) return _oidcDiscovery;
  const issuer = process.env.OIDC_ISSUER;
  if (!issuer) throw new Error("OIDC_ISSUER not set");
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
  _oidcDiscovery = await res.json();
  return _oidcDiscovery;
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

// Timeout for upstream LLM/provider calls. Configurable per provider.
const GATEWAY_TIMEOUT_MS = parseInt(process.env.GATEWAY_TIMEOUT_MS || "30000", 10);
const GATEWAY_TIMEOUT_ANTHROPIC_MS = parseInt(process.env.GATEWAY_TIMEOUT_ANTHROPIC_MS || String(GATEWAY_TIMEOUT_MS), 10);
const GATEWAY_TIMEOUT_OPENAI_MS = parseInt(process.env.GATEWAY_TIMEOUT_OPENAI_MS || String(GATEWAY_TIMEOUT_MS), 10);
const GATEWAY_TIMEOUT_AZURE_MS = parseInt(process.env.GATEWAY_TIMEOUT_AZURE_MS || String(GATEWAY_TIMEOUT_MS), 10);

/**
 * fetch() wrapper with AbortController timeout.
 * Throws an error with err.isTimeout = true on timeout so callers can return 504.
 */
async function gatewayFetch(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Upstream request timed out after ${timeoutMs}ms`);
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function sendJson(res, statusCode, payload) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, { "Content-Type": contentTypes[".json"] });
  res.end(JSON.stringify(payload, null, 2));
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 7}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
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

// ── Production certification gate ─────────────────────────────────────────────
// Returns true (pass) or sends 403 and returns false (blocked).
async function enforceProductionCertGate(tenantId, agentName, environment, res) {
  if (environment !== "production") return true;

  let cert = null;
  try { cert = await getCertification(tenantId, agentName, "production"); } catch (_) {}

  if (!cert || cert.certStatus !== "certified") {
    sendJson(res, 403, {
      error: "agent_not_certified",
      message: `Agent "${agentName}" is not certified for production. ` +
               `POST /api/agents/${encodeURIComponent(agentName)}/certify then /promote to certify.`,
      certStatus: cert?.certStatus || "uncertified",
      failures: cert?.failureReasons || []
    });
    return false;
  }

  if (cert.expiresAt && new Date(cert.expiresAt) < new Date()) {
    sendJson(res, 403, {
      error: "cert_expired",
      message: `Production cert for "${agentName}" expired at ${cert.expiresAt}. Re-certify.`,
      certStatus: "expired",
      expiredAt: cert.expiresAt
    });
    return false;
  }

  return true;
}

// Auto-revoke if a prod run introduces new high-danger tools not seen at cert time.
async function checkAutoRevoke(tenantId, run, ip) {
  if (run.environment !== "production") return;
  if (!run.toolManifest || run.toolManifest.length === 0) return;

  let cert = null;
  try { cert = await getCertification(tenantId, run.agentName, "production"); } catch (_) {}
  if (!cert || cert.certStatus !== "certified") return;

  const certifiedNames = new Set((cert.dangerFlags || []).map((t) => t.name || t.tool).filter(Boolean));
  const newHigh = run.toolManifest.filter((t) => t.dangerLevel >= 3 && !certifiedNames.has(t.name));

  if (newHigh.length === 0) return;

  const reason = `New high-risk tool(s) in production run: ${newHigh.map((t) => `${t.name} (${t.dangerCategory}, level ${t.dangerLevel})`).join(", ")}`;
  try {
    await revokeCertification(tenantId, run.agentName, "production", reason, "system");
    await logAuditEvent(tenantId, {
      actor: "System (Auto-Revoke)",
      action: "Agent Cert Auto-Revoked",
      resource: run.agentName,
      details: { reason, newTools: newHigh.map((t) => t.name), runId: run.id },
      ip: ip || "system"
    });
  } catch (_) {}
}

// ---------------------------------------------------------
// ALERTING ENGINE (Mock Webhook Dispatcher)
// ---------------------------------------------------------
async function dispatchBudgetAlert(tenantId, run) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const message = `🚨 *Agent Budget Violation Detected!*\n*Tenant:* ${tenantId}\n*Agent:* ${run.agentName}\n*Cost:* $${run.costUsd.toFixed(4)} (Budget: $${run.budgetUsd.toFixed(4)})\n*Task:* ${run.taskType}`;
  
  if (webhookUrl) {
    try {
      await gatewayFetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message })
      }, 5000);
      process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: "info", event: "budget_alert_sent", tenantId, runId: run.id }) + "\n");
    } catch (err) {
      process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event: "budget_alert_failed", error: scrubSecrets(err.message) }) + "\n");
    }
  } else {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: "info", event: "budget_alert_simulated", tenantId, runId: run.id, message }) + "\n");
  }
}


function getApiKey(req) {
  return req.headers["x-api-key"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
}

async function requireTenant(req, res, setTenantId) {
  const token = getApiKey(req);
  let auth = null;

  if (token && token.split('.').length === 3) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || adminSecret, { algorithms: ["HS256"] });
      if (decoded.type === "access_token") {
        // JWT revocation check: reject if the issuing API key was revoked/deleted
        if (decoded.keyId) {
          const keyStatus = await getApiKeyStatus(decoded.keyId);
          if (keyStatus !== "active") {
            sendJson(res, 401, { error: "unauthorized", message: "Token has been revoked." });
            return null;
          }
        }
        const context = await listTenantContext(decoded.tenantId);
        if (context?.tenant) {
          auth = { tenant: context.tenant, apiKey: { id: decoded.keyId, prefix: "JWT Auth" } };
        }
      }
    } catch (e) {
      // Invalid JWT falls through to API key auth
    }
  }

  if (!auth) {
    auth = await authenticateTenantApiKey(token);
  }

  if (!auth) {
    const sessionToken = parseCookies(req)[SESSION_COOKIE];
    const sessionAuth = await authenticateDashboardSession(sessionToken);
    if (sessionAuth?.tenant) {
      auth = {
        tenant: sessionAuth.tenant,
        user: sessionAuth.user,
        session: sessionAuth.session,
        apiKey: { id: "dashboard-session", prefix: `User ${sessionAuth.user.email}` }
      };
    }
  }

  if (!auth?.tenant) {
    sendJson(res, 401, {
      error: "unauthorized",
      message: "Missing or invalid tenant API key."
    });
    return null;
  }

  // IP allowlist check — only enforced when a non-null allowlist is configured
  if (auth.apiKey?.id && auth.apiKey.id !== "dashboard-session") {
    const clientIp = req.socket?.remoteAddress || req.headers["x-forwarded-for"]?.split(",")[0].trim() || "";
    const allowlist = auth.apiKey._ipAllowlist; // populated by authenticateTenantApiKey if stored
    if (Array.isArray(allowlist) && allowlist.length > 0) {
      if (!allowlist.some((allowed) => clientIp === allowed || clientIp.startsWith(allowed))) {
        sendJson(res, 403, { error: "ip_not_allowed", message: "Client IP not in key allowlist." });
        return null;
      }
    }
  }

  // Per-tenant rate limit — enforces plan-based RPM
  const plan = getPlan(auth.tenant.plan);
  const planRpm = plan.maxRequestsPerMinute === Infinity ? undefined : plan.maxRequestsPerMinute;
  if (!checkRateLimit(tenantLimiter, auth.tenant.id, res, planRpm)) return null;

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

function checkRateLimit(limiter, key, res, maxOverride) {
  const { allowed, retryAfter } = limiter.check(key, maxOverride);
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
    openai: !!process.env.OPENAI_API_KEY,
    copilot: !!process.env.GITHUB_TOKEN,
    generic: true
  };
}

function estimateOpenAiCost({ inputTokens = 0, outputTokens = 0 }) {
  const inputPerMillion = Number(process.env.OPENAI_INPUT_USD_PER_1M_TOKENS || 0);
  const outputPerMillion = Number(process.env.OPENAI_OUTPUT_USD_PER_1M_TOKENS || 0);
  return (inputTokens * inputPerMillion / 1000000) + (outputTokens * outputPerMillion / 1000000);
}

const connectorCatalog = [
  {
    provider: "openai",
    name: "OpenAI",
    category: "Gateway",
    setup: "Paste an OpenAI API key once, then route Responses API traffic through Agent Prism.",
    mode: "gateway",
    requiresSecret: true,
    endpoint: "/v1/responses"
  },
  {
    provider: "anthropic",
    name: "Claude",
    category: "Gateway",
    setup: "Paste an Anthropic API key once, then route Messages API traffic through Agent Prism.",
    mode: "gateway",
    requiresSecret: true,
    endpoint: "/v1/messages"
  },
  {
    provider: "azure_openai",
    name: "Azure OpenAI",
    category: "Gateway",
    setup: "Paste your Azure OpenAI endpoint, API key, and deployment name. Route chat completions through Agent Prism for spend control and governance.",
    mode: "gateway",
    requiresSecret: true,
    endpoint: "/v1/azure/chat/completions",
    configFields: ["endpoint", "apiKey", "deployment", "apiVersion"]
  },
  {
    provider: "github-copilot",
    name: "GitHub Copilot",
    category: "Business Agent",
    setup: "Track Copilot coding agents through demo telemetry, GitHub events, or enterprise usage sync.",
    mode: "webhook",
    requiresSecret: false,
    endpoint: "/api/ingest/copilot"
  },
  {
    provider: "litellm",
    name: "LiteLLM",
    category: "Gateway Logs",
    setup: "Send LiteLLM spend and request logs into Agent Prism for workflow-level governance.",
    mode: "webhook",
    requiresSecret: false,
    endpoint: "/api/ingest/generic"
  },
  {
    provider: "langchain",
    name: "LangChain / LangGraph",
    category: "Framework",
    setup: "Use a callback handler to capture chain, graph, tool, token, and retry telemetry.",
    mode: "adapter",
    requiresSecret: false,
    endpoint: "/api/ingest/generic"
  },
  {
    provider: "crewai",
    name: "CrewAI",
    category: "Framework",
    setup: "Attach Agent Prism to crew and task lifecycle events for business workflow reporting.",
    mode: "adapter",
    requiresSecret: false,
    endpoint: "/api/ingest/generic"
  },
  {
    provider: "openai-agents",
    name: "OpenAI Agents SDK",
    category: "Framework",
    setup: "Export agent traces into Agent Prism for run quality, token use, and governance.",
    mode: "adapter",
    requiresSecret: false,
    endpoint: "/api/ingest/generic"
  },
  {
    provider: "generic-webhook",
    name: "Generic Webhook",
    category: "Universal",
    setup: "Use one tenant webhook for any custom agent, automation, or internal workflow.",
    mode: "webhook",
    requiresSecret: false,
    endpoint: "/api/ingest"
  }
];

function sanitizeConnector(connector) {
  return {
    id: connector.id,
    tenantId: connector.tenantId,
    provider: connector.provider,
    name: connector.name,
    mode: connector.mode || "webhook",
    status: connector.status,
    createdAt: connector.createdAt,
    hasSecret: !!connector.config?.apiKey
  };
}

function sampleRunForProvider(provider) {
  const startedAt = new Date(Date.now() - 18000).toISOString();
  const completedAt = new Date().toISOString();
  const normalizedProvider = String(provider || "generic-webhook").toLowerCase();
  const display = connectorCatalog.find((item) => item.provider === normalizedProvider)?.name || "Custom Agent";

  if (normalizedProvider === "github-copilot") {
    return normalizeCopilotRun({
      session_id: `test_copilot_${Date.now()}`,
      agent_name: "GitHub Copilot Business Agent",
      model_name: "copilot-gpt-4.1",
      intent: "business-agent-build",
      outcome: "success",
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: 18000,
      prompt_tokens: 7200,
      completion_tokens: 1600,
      estimated_cost_usd: 0.1056,
      budget_usd: 0.25,
      autonomy_level: 4,
      retry_count: 1,
      tool_invocations: 5,
      policy_alerts: 0,
      user_score: 4,
      environment: "demo",
      workflow: "copilot-agent-onboarding",
      team: "business-operations",
      labels: ["copilot", "connector-test"],
      trace: ["connected Copilot source", "captured business agent run", "sent telemetry to Agent Prism"],
      summary: "Copilot agent test event created from the connector marketplace."
    });
  }

  return normalizeGenericRun({
    id: `test_${normalizedProvider}_${Date.now()}`,
    source: normalizedProvider,
    agentName: `${display} Agent`,
    provider: display,
    model: normalizedProvider === "litellm" ? "routed-model" : "framework-adapter",
    taskType: "connector-test",
    status: "success",
    startTime: startedAt,
    endTime: completedAt,
    latencyMs: 18000,
    tokensIn: 4200,
    tokensOut: 900,
    costUsd: 0.0612,
    budgetUsd: 0.2,
    autonomyLevel: 3,
    retryCount: normalizedProvider === "litellm" ? 1 : 0,
    toolCalls: 3,
    policyViolations: 0,
    userSatisfaction: 4,
    environment: "demo",
    workflow: `${normalizedProvider}-connector-test`,
    team: "business-operations",
    tags: [normalizedProvider, "connector-test"],
    breadcrumbs: ["connector selected", "sample event generated", "telemetry normalized", "dashboard updated"],
    notes: `${display} connector test event created without custom code.`
  });
}

function csvCell(value) {
  const text = value === undefined || value === null
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function sendCsv(res, filename, rows) {
  setSecurityHeaders(res);
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`
  });
  res.end(rows.map((row) => row.map(csvCell).join(",")).join("\n"));
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

// ── Fleet session store (in-memory; collector daemons POST snapshots here) ────
// Map<tenantId, Map<machineId, { snapshot, receivedAt }>>
const fleetStore = new Map();

function upsertFleetSnapshot(tenantId, machineId, snapshot) {
  if (!fleetStore.has(tenantId)) fleetStore.set(tenantId, new Map());
  fleetStore.get(tenantId).set(machineId, { snapshot, receivedAt: Date.now() });
}

function getFleetSnapshots(tenantId) {
  const machines = fleetStore.get(tenantId);
  if (!machines) return [];
  const now = Date.now();
  const stale = 5 * 60 * 1000; // 5min — machine is "offline" after this
  return Array.from(machines.entries()).map(([machineId, { snapshot, receivedAt }]) => ({
    machineId,
    hostname: snapshot.hostname || machineId,
    developer: snapshot.developer || null,
    sessions: snapshot.sessions || [],
    processes: snapshot.processes || [],
    ports: snapshot.ports || [],
    rateLimit: snapshot.rateLimit || null,
    receivedAt,
    online: (now - receivedAt) < stale,
    ageSec: Math.round((now - receivedAt) / 1000)
  }));
}

// ── Rate limit state capture (in-memory, updated on each proxy call) ─────────

const rateLimitState = {
  anthropic: null,
  openai: null,
  updatedAt: null
};

function captureAnthropicRateLimits(headers) {
  const h = (name) => headers.get(name);
  const n = (name) => { const v = h(name); return v != null ? parseInt(v) : null; };
  const state = {
    requestsLimit: n("anthropic-ratelimit-requests-limit"),
    requestsRemaining: n("anthropic-ratelimit-requests-remaining"),
    requestsReset: h("anthropic-ratelimit-requests-reset"),
    tokensLimit: n("anthropic-ratelimit-tokens-limit"),
    tokensRemaining: n("anthropic-ratelimit-tokens-remaining"),
    tokensReset: h("anthropic-ratelimit-tokens-reset"),
    inputTokensLimit: n("anthropic-ratelimit-input-tokens-limit"),
    inputTokensRemaining: n("anthropic-ratelimit-input-tokens-remaining"),
    inputTokensReset: h("anthropic-ratelimit-input-tokens-reset"),
    outputTokensLimit: n("anthropic-ratelimit-output-tokens-limit"),
    outputTokensRemaining: n("anthropic-ratelimit-output-tokens-remaining"),
    outputTokensReset: h("anthropic-ratelimit-output-tokens-reset"),
    retryAfter: h("retry-after"),
    capturedAt: Date.now()
  };
  if (state.requestsLimit != null || state.tokensLimit != null) {
    rateLimitState.anthropic = state;
    rateLimitState.updatedAt = Date.now();
  }
}

// ── Local session / process scanning helpers ──────────────────────────────────

const MODEL_CONTEXT_WINDOWS = {
  "claude-sonnet-4-6": 200000,
  "claude-opus-4-8": 200000,
  "claude-haiku-4-5": 200000,
  "claude-opus-4-5": 200000,
  "claude-3-5-sonnet": 200000,
  "claude-3-5-haiku": 200000,
  "claude-3-opus": 200000,
};

function getContextWindow(model) {
  if (!model) return 200000;
  for (const [key, val] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.includes(key)) return val;
  }
  return 200000;
}

async function scanLocalSessions() {
  const claudeDir = join(os.homedir(), ".claude", "projects");
  const sessions = [];
  const now = Date.now();
  const cutoff = now - 48 * 60 * 60 * 1000;

  try {
    const projectDirs = await readdir(claudeDir);
    for (const projectDir of projectDirs) {
      const projectPath = join(claudeDir, projectDir);
      const projectStat = await stat(projectPath).catch(() => null);
      if (!projectStat?.isDirectory()) continue;

      const files = await readdir(projectPath).catch(() => []);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

      for (const file of jsonlFiles) {
        const filePath = join(projectPath, file);
        const fileStat = await stat(filePath).catch(() => null);
        if (!fileStat || fileStat.mtimeMs < cutoff) continue;

        const content = await readFile(filePath, "utf-8").catch(() => "");
        const lines = content.trim().split("\n").filter(Boolean);

        const session = {
          sessionId: file.replace(".jsonl", ""),
          projectDir,
          model: null,
          version: null,
          gitBranch: null,
          cwd: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheRead: 0,
          lastContextTokens: 0,
          turnCount: 0,
          lastActivity: null,
          summary: null,
          agentType: "Claude Code",
          status: "idle",
          fileSizeKb: Math.round(fileStat.size / 1024),
        };

        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.cwd && !session.cwd) session.cwd = msg.cwd;
            if (msg.gitBranch && !session.gitBranch) session.gitBranch = msg.gitBranch;
            if (msg.version && !session.version) session.version = msg.version;

            if (msg.type === "assistant" && msg.message?.usage) {
              const u = msg.message.usage;
              session.totalInputTokens += u.input_tokens || 0;
              session.totalOutputTokens += u.output_tokens || 0;
              session.totalCacheRead += u.cache_read_input_tokens || 0;
              session.lastContextTokens =
                (u.cache_read_input_tokens || 0) +
                (u.input_tokens || 0) +
                (u.cache_creation_input_tokens || 0);
              if (!session.model && msg.message.model) session.model = msg.message.model;
            }

            if (msg.type === "user" && msg.message?.role === "user") {
              session.turnCount++;
              if (!session.summary) {
                const c = msg.message.content;
                const text = typeof c === "string" ? c : (Array.isArray(c) ? (c.find((x) => x.type === "text")?.text || "") : "");
                if (text.length > 3) session.summary = text.slice(0, 72);
              }
            }

            if (msg.timestamp) {
              const ts = new Date(msg.timestamp).getTime();
              if (!session.lastActivity || ts > session.lastActivity) session.lastActivity = ts;
            }
          } catch {}
        }

        if (session.lastActivity) {
          const ageMins = (now - session.lastActivity) / 60000;
          session.status = ageMins < 5 ? "active" : ageMins < 60 ? "recent" : "idle";
        }

        const contextWindow = getContextWindow(session.model);
        session.contextPct = session.lastContextTokens
          ? Math.min(100, Math.round((session.lastContextTokens / contextWindow) * 100))
          : 0;

        sessions.push(session);
      }
    }
  } catch {}

  return sessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
}

async function scanProcesses() {
  const agentPatterns = [
    { match: /\bclaude\b/i, type: "Claude Code" },
    { match: /\bcodex\b/i, type: "Codex CLI" },
    { match: /\bopencode\b/i, type: "OpenCode" },
    { match: /\baider\b/i, type: "Aider" },
    { match: /\bcontinue\b/i, type: "Continue" },
  ];

  try {
    const { stdout } = await execAsync("ps aux | grep -E '(claude|codex|opencode|aider)' | grep -v grep 2>/dev/null", { timeout: 5000 });
    return stdout.trim().split("\n").filter(Boolean).map((line) => {
      const parts = line.trim().split(/\s+/);
      const cmd = parts.slice(10).join(" ");
      let type = "Unknown";
      for (const p of agentPatterns) {
        if (p.match.test(cmd)) { type = p.type; break; }
      }
      return { pid: parts[1], cpu: parseFloat(parts[2]), mem: parseFloat(parts[3]), cmd: cmd.slice(0, 80), type };
    });
  } catch {
    return [];
  }
}

async function scanPorts() {
  const agentProcPatterns = ["node", "claude", "codex", "opencode", "python", "python3", "deno", "bun", "ollama", "aider"];
  try {
    const { stdout } = await execAsync("lsof -i -P -n 2>/dev/null | grep LISTEN", { timeout: 5000 });
    const seen = new Set();
    return stdout.trim().split("\n").filter(Boolean).flatMap((line) => {
      const parts = line.trim().split(/\s+/);
      const portMatch = (parts[8] || "").match(/:(\d+)$/);
      if (!portMatch) return [];
      const port = parseInt(portMatch[1]);
      if (port < 1024 || seen.has(port)) return [];
      seen.add(port);
      const proc = parts[0].toLowerCase();
      const isAgentPort = agentProcPatterns.some((p) => proc.includes(p));
      return [{ port, pid: parts[1], process: parts[0], isAgentPort }];
    });
  } catch {
    return [];
  }
}

async function killPort(port) {
  const { stdout } = await execAsync(`lsof -ti:${parseInt(port)} 2>/dev/null`, { timeout: 5000 });
  const pids = stdout.trim().split("\n").filter(Boolean);
  for (const pid of pids) {
    await execAsync(`kill -9 ${parseInt(pid)}`).catch(() => {});
  }
  return pids;
}

// ─────────────────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  inflightCount++;
  const startTime = performance.now();
  let tenantId = null;

  // Attach trace ID early — available for all logs in this request lifecycle
  attachRequestId(req, res);

  // Log every completed response and decrement in-flight counter
  res.on("finish", () => {
    inflightCount--;
    logRequest(req, res, startTime, tenantId);
    incCounter("http_requests_total");
    recordLatency("http_request_duration_ms", Math.round(performance.now() - startTime));
    if (res.statusCode >= 500) incCounter("http_errors_total");
  });

  try {
    // CORS — handles preflight and sets headers; returns true if preflight was handled
    if (applyCors(req, res)) return;

    if (req.method === "GET" && req.url === "/api/health") {
      const [bootstrap, db] = await Promise.all([
        getBootstrapStatus(),
        pingDb()
      ]);
      const circuitStatuses = Object.values(breakers).map((b) => b.getStatus());
      const anyCircuitOpen = circuitStatuses.some((s) => s.state === "OPEN");
      const healthy = db.ok && !anyCircuitOpen;
      return sendJson(res, healthy ? 200 : 503, {
        ok: healthy,
        service: "agent-prism",
        storageBackend,
        bootstrapped: bootstrap.bootstrapped,
        db: {
          ok: db.ok,
          latencyMs: db.latencyMs,
          ...(db.error ? { error: db.error } : {}),
          ...(db.note ? { note: db.note } : {})
        },
        circuits: circuitStatuses,
        uptime: Math.floor(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        pid: process.pid
      });
    }

    // Liveness probe — is the process alive? No dependency checks.
    if (req.method === "GET" && req.url === "/api/health/live") {
      return sendJson(res, 200, { ok: true, pid: process.pid, uptime: Math.floor(process.uptime()) });
    }

    // Readiness probe — are all dependencies healthy?
    // Returns 503 if DB is down or any circuit is OPEN (provider unavailable).
    if (req.method === "GET" && req.url === "/api/health/ready") {
      const [bootstrap, db] = await Promise.all([getBootstrapStatus(), pingDb()]);
      const circuitStatuses = Object.values(breakers).map((b) => b.getStatus());
      const anyCircuitOpen = circuitStatuses.some((s) => s.state === "OPEN");
      const ready = db.ok && !anyCircuitOpen;
      return sendJson(res, ready ? 200 : 503, {
        ready,
        db: { ok: db.ok, latencyMs: db.latencyMs, ...(db.error ? { error: db.error } : {}) },
        circuits: circuitStatuses,
        bootstrapped: bootstrap.bootstrapped
      });
    }

    if (req.method === "GET" && req.url === "/metrics") {
      if (!requireAdmin(req, res)) return;
      const mem = process.memoryUsage();
      const gauges = {
        process_uptime_seconds: Math.floor(process.uptime()),
        process_memory_rss_bytes: mem.rss,
        process_memory_heap_used_bytes: mem.heapUsed,
        nodejs_active_handles: process._getActiveHandles?.()?.length ?? 0,
        rate_limiter_tenant_buckets: tenantLimiter.size,
        rate_limiter_key_rpm_buckets: keyRpmLimiter.size,
        rate_limiter_key_tpm_buckets: keyTpmLimiter.size,
        ...Object.fromEntries(
          Object.values(breakers).map((b) => {
            const s = b.getStatus();
            return [`circuit_breaker_${s.name}_open`, s.state === "OPEN" ? 1 : 0];
          })
        )
      };
      setSecurityHeaders(res);
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(getMetricsText(gauges));
      return;
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
      
      await logAuditEvent(result.tenant.id, {
        actor: "System Setup",
        action: "Tenant Bootstrapped",
        resource: "Tenant",
        details: { companyName: body.companyName },
        ip
      });

      if (body.adminPassword && result.user?.id) {
        const session = await createDashboardSession(result.tenant.id, result.user.id);
        setSessionCookie(res, session.token);
      }
      
      return sendJson(res, 201, result);
    }

    if (req.method === "POST" && req.url === "/api/auth/login") {
      if (!checkRateLimit(loginLimiter, ip, res)) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const errors = validate(SCHEMAS.login, body);
      if (errors) return sendValidationError(res, errors);

      const auth = await authenticateUser(body.email, body.password);
      if (!auth?.tenant || !auth?.user) {
        return sendJson(res, 401, {
          error: "unauthorized",
          message: "Invalid email or password."
        });
      }

      const session = await createDashboardSession(auth.tenant.id, auth.user.id);
      setSessionCookie(res, session.token);
      await logAuditEvent(auth.tenant.id, {
        actor: auth.user.email,
        action: "Dashboard Login",
        resource: "Dashboard Session",
        ip: req.socket?.remoteAddress || "unknown"
      });

      return sendJson(res, 200, {
        tenant: auth.tenant,
        user: auth.user,
        session: { id: session.session.id, expiresAt: session.session.expiresAt }
      });
    }

    if (req.method === "POST" && req.url === "/api/auth/logout") {
      const token = parseCookies(req)[SESSION_COOKIE];
      const sessionAuth = await authenticateDashboardSession(token);
      await revokeDashboardSession(token);
      clearSessionCookie(res);
      if (sessionAuth?.tenant) {
        await logAuditEvent(sessionAuth.tenant.id, {
          actor: sessionAuth.user.email,
          action: "Dashboard Logout",
          resource: "Dashboard Session",
          ip: req.socket?.remoteAddress || "unknown"
        });
      }
      return sendJson(res, 200, { ok: true });
    }

    // ── SSO: initiate OIDC flow ──────────────────────────────────────────────
    if (req.method === "GET" && req.url === "/auth/sso/login") {
      try {
        const oidc = await getOidcDiscovery();
        const state = randomBytes(16).toString("hex");
        oidcStates.set(state, { createdAt: Date.now() });
        for (const [k, v] of oidcStates) {
          if (Date.now() - v.createdAt > OIDC_STATE_TTL_MS) oidcStates.delete(k);
        }
        const params = new URLSearchParams({
          client_id: process.env.OIDC_CLIENT_ID || "",
          redirect_uri: process.env.OIDC_REDIRECT_URI || "",
          response_type: "code",
          scope: "openid email profile",
          state
        });
        res.writeHead(302, { Location: `${oidc.authorization_endpoint}?${params}` });
        return res.end();
      } catch (err) {
        logError("SSO login init failed", err);
        return sendJson(res, 503, { error: "sso_unavailable", message: err.message });
      }
    }

    // ── SSO: OIDC callback ───────────────────────────────────────────────────
    if (req.method === "GET" && req.url.startsWith("/auth/sso/callback")) {
      const redirect = (errCode) => {
        res.writeHead(302, { Location: `/?sso_error=${encodeURIComponent(errCode)}` });
        res.end();
      };
      try {
        const cbUrl = new URL(req.url, `http://${req.headers.host}`);
        const code = cbUrl.searchParams.get("code");
        const state = cbUrl.searchParams.get("state");
        const idpError = cbUrl.searchParams.get("error");

        if (idpError) return redirect(idpError);
        if (!state || !oidcStates.has(state)) return redirect("invalid_state");
        oidcStates.delete(state);
        if (!code) return redirect("missing_code");

        const oidc = await getOidcDiscovery();
        const tokenRes = await fetch(oidc.token_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: process.env.OIDC_REDIRECT_URI || "",
            client_id: process.env.OIDC_CLIENT_ID || "",
            client_secret: process.env.OIDC_CLIENT_SECRET || ""
          })
        });
        if (!tokenRes.ok) {
          logError("SSO token exchange failed", { status: tokenRes.status });
          return redirect("token_exchange_failed");
        }
        const tokens = await tokenRes.json();

        // Decode id_token payload (trust exchanged directly with IDP — no sig verify needed here)
        const [, b64Payload] = (tokens.id_token || "").split(".");
        if (!b64Payload) return redirect("missing_id_token");
        const claims = JSON.parse(Buffer.from(b64Payload, "base64url").toString("utf8"));
        const email = claims.email || claims.preferred_username;
        const name = claims.name || claims.given_name || email;
        if (!email) return redirect("no_email_claim");

        const auth = await upsertSsoUser({ email, name });
        if (!auth) return redirect("user_not_provisioned");

        const session = await createDashboardSession(auth.tenant.id, auth.user.id);
        setSessionCookie(res, session.token);
        await logAuditEvent(auth.tenant.id, {
          actor: email,
          action: "SSO Login",
          resource: "Dashboard Session",
          details: { issuer: process.env.OIDC_ISSUER },
          ip: req.socket?.remoteAddress || "unknown"
        });
        res.writeHead(302, { Location: "/" });
        return res.end();
      } catch (err) {
        logError("SSO callback error", err);
        return redirect(encodeURIComponent(err.message));
      }
    }

    if (req.method === "GET" && req.url === "/api/login-config") {
      return sendJson(res, 200, {
        ssoEnabled:    !!process.env.OIDC_ISSUER,
        ssoOnly:       process.env.SSO_ONLY === "true",
        demoEmail:     process.env.DEMO_EMAIL    || null,
        demoPassword:  process.env.DEMO_PASSWORD || null
      });
    }

    if (req.method === "GET" && req.url === "/api/me") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      return sendJson(res, 200, {
        tenant: auth.tenant,
        user: auth.user || null,
        authType: auth.user ? "session" : "api_key"
      });
    }

    if (req.method === "POST" && req.url === "/api/admin/api-keys") {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const result = await createTenantApiKey({
        tenantId: body.tenantId,
        name: body.name
      });

      await logAuditEvent(result.tenant.id, {
        actor: "Admin",
        action: "Tenant API Key Created",
        resource: result.key.prefix,
        details: { name: result.key.name },
        ip: req.socket?.remoteAddress || "unknown"
      });

      return sendJson(res, 201, result);
    }

    if (req.method === "POST" && req.url === "/api/admin/tenant/plan") {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const { tenantId: targetTenantId, plan } = body;
      const validPlans = ["free", "starter", "pro", "enterprise", "enterprise-trial"];
      if (!targetTenantId || !plan) return sendJson(res, 400, { error: "bad_request", message: "tenantId and plan required" });
      if (!validPlans.includes(plan)) return sendJson(res, 400, { error: "bad_request", message: `plan must be one of: ${validPlans.join(", ")}` });
      const updated = await updateTenantPlan(targetTenantId, plan);
      if (!updated) return sendJson(res, 404, { error: "not_found", message: "Tenant not found" });
      return sendJson(res, 200, { ok: true, tenant: updated });
    }

    if (req.method === "POST" && req.url === "/api/admin/users/password") {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const errors = validate(SCHEMAS.setUserPassword, body);
      if (errors) return sendValidationError(res, errors);
      const user = await setUserPassword({
        tenantId: body.tenantId,
        email: body.email,
        password: body.password
      });
      if (!user) {
        return sendJson(res, 404, { error: "not_found", message: "User not found." });
      }
      await logAuditEvent(user.tenantId, {
        actor: "Admin",
        action: "User Password Set",
        resource: user.email,
        ip: req.socket?.remoteAddress || "unknown"
      });
      return sendJson(res, 200, { user });
    }

    // ── Admin: list all tenants ───────────────────────────────────────────────
    if (req.method === "GET" && req.url === "/api/admin/tenants") {
      if (!requireAdmin(req, res)) return;
      const tenants = await listTenants();
      return sendJson(res, 200, { tenants });
    }

    // ── Admin: provision new tenant workspace ─────────────────────────────────
    if (req.method === "POST" && req.url === "/api/admin/tenants") {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const { companyName, adminEmail, adminName, adminPassword, plan } = body;
      if (!companyName || !adminEmail) {
        return sendJson(res, 400, { error: "bad_request", message: "companyName and adminEmail are required" });
      }
      const result = await provisionTenant({ companyName, adminEmail, adminName, adminPassword, plan });
      await logAuditEvent(result.tenant.id, {
        actor: "Admin",
        action: "Tenant Provisioned",
        resource: result.tenant.id,
        details: { companyName, adminEmail, plan: plan || "enterprise-trial" },
        ip: req.socket?.remoteAddress || "unknown"
      });
      return sendJson(res, 201, result);
    }

    if (req.method === "GET" && req.url === "/api/connectors/catalog") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const host = req.headers.host || "localhost";
      const proto = req.headers["x-forwarded-proto"] || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
      return sendJson(res, 200, {
        connectors: connectorCatalog.map((item) => ({
          ...item,
          webhookUrl: `${proto}://${host}${item.endpoint}`
        }))
      });
    }

    if (req.method === "POST" && req.url === "/api/connectors/test") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const provider = body.provider || "generic-webhook";
      const run = sampleRunForProvider(provider);
      const updated = await upsertTenantRuns(auth.tenant.id, [run]);

      await logAuditEvent(auth.tenant.id, {
        actor: `Admin (via ${auth.apiKey.prefix})`,
        action: "Connector Test Event Sent",
        resource: provider,
        details: { runId: run.id, agentName: run.agentName },
        ip: req.socket?.remoteAddress || "unknown"
      });

      return sendJson(res, 201, {
        status: "test_event_created",
        totalRuns: updated.length,
        normalizedRun: run
      });
    }

    if (req.method === "POST" && req.url === "/api/connectors") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;

      const body = await parseBody(req, res);
      if (body === null) return;
      const { provider, name, apiKey, mode } = body;
      if (!provider || !name) return sendJson(res, 400, { error: "bad_request", message: "Missing provider or name" });

      const connectorConfig = {
        apiKey,
        setupMethod: body.setupMethod || "connector-marketplace"
      };
      if (body.monthlyBudgetUsd !== undefined) {
        connectorConfig.monthlyBudgetUsd = parseFloat(body.monthlyBudgetUsd) || 0;
      }

      const result = await createConnector(auth.tenant.id, {
        provider,
        name,
        mode: mode || "webhook",
        config: connectorConfig
      });
      
      await logAuditEvent(auth.tenant.id, {
        actor: auth.apiKey.prefix,
        action: "Connector Created",
        resource: provider,
        ip: req.socket?.remoteAddress || "127.0.0.1"
      });

      return sendJson(res, 201, { message: "Connector created", connector: sanitizeConnector(result) });
    }

    if (req.method === "POST" && req.url === "/api/oauth/token") {
      if (!checkRateLimit(loginLimiter, ip, res)) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      
      const { client_id, client_secret, grant_type } = body;

      if (grant_type !== "client_credentials") {
        return sendJson(res, 400, { error: "unsupported_grant_type", message: "Only client_credentials is supported" });
      }

      const auth = await authenticateTenantApiKey(client_secret);
      if (!auth) {
        return sendJson(res, 401, { error: "invalid_client", message: "Invalid client secret" });
      }

      const token = jwt.sign({
        tenantId: auth.tenant.id,
        keyId: auth.apiKey.id,
        type: "access_token",
        scopes: auth.apiKey.scopes || ["*"]
      }, process.env.JWT_SECRET || adminSecret, { algorithm: "HS256", expiresIn: '1h' });

      const refreshResult = await createRefreshToken(auth.tenant.id, auth.apiKey.id).catch(() => null);

      await logAuditEvent(auth.tenant.id, {
        actor: auth.apiKey.prefix,
        action: "OAuth Token Issued",
        resource: "JWT Token (1h)",
        ip: req.socket?.remoteAddress || "127.0.0.1"
      });

      return sendJson(res, 200, {
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refreshResult?.plainToken,
        refresh_expires_in: 30 * 24 * 3600
      });
    }

    // ── OAuth refresh token endpoint ───────────────────────────────────────────
    if (req.method === "POST" && req.url === "/api/oauth/refresh") {
      const body = await parseBody(req, res);
      if (body === null) return;
      const { refresh_token } = body;
      if (!refresh_token) {
        return sendJson(res, 400, { error: "invalid_request", message: "refresh_token is required" });
      }
      const rotated = await verifyAndRotateRefreshToken(refresh_token);
      if (!rotated) {
        return sendJson(res, 401, { error: "invalid_grant", message: "Refresh token is invalid, expired, or revoked" });
      }
      const newAccessToken = jwt.sign({
        tenantId: rotated.tenantId,
        keyId: rotated.apiKeyId,
        type: "access_token",
        scopes: ["*"]
      }, process.env.JWT_SECRET || adminSecret, { algorithm: "HS256", expiresIn: "1h" });
      return sendJson(res, 200, {
        access_token: newAccessToken,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: rotated.newRefreshToken,
        refresh_expires_in: 30 * 24 * 3600
      });
    }

    // ---------------------------------------------------------
    // THE GATEWAY PROXY
    // ---------------------------------------------------------
    if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
      // 1. Authenticate the developer via the CLI token (x-api-key)
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;

      // Per-key RPM + TPM enforcement
      const keyId = auth.apiKey?.id || auth.tenant.id;
      const rpmCheck = keyRpmLimiter.check(keyId);
      if (!rpmCheck.allowed) {
        res.setHeader("Retry-After", String(rpmCheck.retryAfter));
        return sendJson(res, 429, { error: "rate_limit_exceeded", message: `Per-key RPM limit reached. Retry after ${rpmCheck.retryAfter}s.`, retryAfter: rpmCheck.retryAfter });
      }
      const tpmCheck = keyTpmLimiter.check(keyId);
      if (!tpmCheck.allowed) {
        res.setHeader("Retry-After", String(tpmCheck.retryAfter));
        return sendJson(res, 429, { error: "rate_limit_exceeded", message: `Per-key TPM limit reached. Retry after ${tpmCheck.retryAfter}s.`, retryAfter: tpmCheck.retryAfter });
      }

      // 2. Read the body (Anthropic payload)
      const body = await parseBody(req, res);
      if (body === null) return;

      // 3. Find the Anthropic Connector for this tenant
      const context = await listTenantContext(auth.tenant.id);
      const anthropicConnector = context.connectors.find(c => c.provider === "anthropic" && c.config?.apiKey);

      if (!anthropicConnector) {
        return sendJson(res, 403, {
          error: "forbidden",
          message: "No Anthropic API Key configured in your Agent Prism Dashboard."
        });
      }

      // Plan guard — gateway proxy is a paid feature
      const gatewayCheck = checkGatewayAllowed(auth.tenant);
      if (!gatewayCheck.allowed) {
        return sendJson(res, 402, { error: gatewayCheck.code, message: gatewayCheck.reason, upgrade: gatewayCheck.upgrade });
      }

      // Plan guard — agent limit
      const ingestAgentName = body.agentName || "Gateway Proxy Agent";
      const planCheck = checkIngestAllowed(auth.tenant, context.runs, ingestAgentName);
      if (!planCheck.allowed) {
        return sendJson(res, 402, { error: planCheck.code, message: planCheck.reason, usage: planCheck.usage, upgrade: planCheck.upgrade });
      }

      // 4. Budget enforcement — reject before any upstream spend
      const _rawBudget = parseFloat(
        anthropicConnector.config.monthlyBudgetUsd ||
        process.env.GATEWAY_MONTHLY_BUDGET_USD ||
        "0"
      );
      const monthlyBudgetUsd = Number.isFinite(_rawBudget) ? _rawBudget : 0;
      if (monthlyBudgetUsd > 0) {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);
        const monthStartIso = monthStart.toISOString();
        const monthSpend = context.runs
          .filter(r => r.source === "claude" && (r.startTime || "") >= monthStartIso)
          .reduce((sum, r) => sum + (r.costUsd || 0), 0);
        if (monthSpend >= monthlyBudgetUsd) {
          return sendJson(res, 402, {
            error: "budget_exceeded",
            message: `Monthly gateway budget of $${monthlyBudgetUsd.toFixed(2)} reached (spent $${monthSpend.toFixed(4)}). Increase GATEWAY_MONTHLY_BUDGET_USD or wait until next month.`,
            spentUsd: Number(monthSpend.toFixed(4)),
            budgetUsd: monthlyBudgetUsd
          });
        }
      }

      // 4b. Pre-flight: classify task type and advise on model fitness
      const messages = body.messages || [];
      const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
      const taskType = classifyTask(messages, { toolCount });
      const { fitness, penalty, recommendedModel } = getModelRecommendation(body.model || "unknown", taskType, "anthropic");

      // 5. Forward the request to Anthropic securely
      const startTime = Date.now();
      try {
        const anthropicRes = await breakers.anthropic.execute(() =>
          gatewayFetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicConnector.config.apiKey,
              "anthropic-version": req.headers["anthropic-version"] || "2023-06-01"
            },
            body: JSON.stringify(body)
          }, GATEWAY_TIMEOUT_ANTHROPIC_MS)
        );

        const anthropicData = await anthropicRes.json();
        const endTime = Date.now();
        const latencyMs = endTime - startTime;

        captureAnthropicRateLimits(anthropicRes.headers);

        // 6. Automatically log the telemetry if successful
        if (anthropicRes.ok) {
          const runId = createId("run");
          const inputTokens = anthropicData.usage?.input_tokens || 0;
          const outputTokens = anthropicData.usage?.output_tokens || 0;
          const costUsd = (inputTokens * 0.25 / 1000000) + (outputTokens * 1.25 / 1000000);
          // Record token usage against per-key TPM counter
          keyTpmLimiter.record(keyId, inputTokens + outputTokens);

          const run = {
            id: runId,
            source: "claude",
            agentName: "Gateway Proxy Agent",
            provider: "anthropic",
            model: body.model || "unknown",
            taskType,
            status: "success",
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            latencyMs,
            tokensIn: inputTokens,
            tokensOut: outputTokens,
            costUsd,
            budgetUsd: 0.05,
            autonomyLevel: 0,
            retryCount: 0,
            toolCalls: toolCount,
            policyViolations: 0,
            userSatisfaction: 0,
            environment: "production",
            workflow: "gateway",
            team: "engineering"
          };

          await upsertTenantRuns(auth.tenant.id, [run]);

          // Async prompt capture — non-blocking, errors swallowed to never affect gateway latency
          const captureEnabled = process.env.PROMPT_CAPTURE_ENABLED !== "false";
          const scrub = process.env.PROMPT_CAPTURE_SCRUB_PII !== "false";
          if (captureEnabled) {
            const samplingRate = parseFloat(process.env.PROMPT_CAPTURE_SAMPLING_RATE || "1.0");
            if (Math.random() <= samplingRate) {
              const capturedMessages = scrub ? scrubPii(messages) : messages;
              savePromptCapture(auth.tenant.id, {
                id: createId("cap"),
                runId,
                provider: "anthropic",
                model: body.model || "unknown",
                taskType,
                messages: capturedMessages,
                response: { content: anthropicData.content, usage: anthropicData.usage },
                tokensIn: inputTokens,
                tokensOut: outputTokens,
                costUsd,
                latencyMs,
                modelFitness: fitness,
                recommendedModel,
                piiScrubbed: scrub,
                createdAt: new Date().toISOString()
              }).catch((err) => logError(req, err, tenantId));
            }
          }
        }

        // 7. Return the exact response with model advisory headers
        setSecurityHeaders(res);
        res.setHeader("X-Agent-Prism-Task-Type", taskType);
        res.setHeader("X-Agent-Prism-Model-Fitness", fitness);
        if (fitness === "mismatch" || fitness === "suboptimal") {
          res.setHeader("X-Agent-Prism-Recommended-Model", recommendedModel);
          res.setHeader("X-Agent-Prism-Fitness-Penalty", String(penalty));
        }
        res.writeHead(anthropicRes.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(anthropicData));
        return;
      } catch (err) {
        logError(req, err, tenantId);
        if (err.isCircuitOpen) return sendJson(res, 503, { error: "provider_unavailable", message: scrubSecrets(err.message) });
        if (err.isTimeout) return sendJson(res, 504, { error: "gateway_timeout", message: scrubSecrets(err.message) });
        return sendJson(res, 502, { error: "bad_gateway", message: scrubSecrets(err.message) });
      }
    }

    if (req.method === "POST" && req.url.startsWith("/v1/responses")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;

      // Per-key RPM + TPM enforcement
      const oaiKeyId = auth.apiKey?.id || auth.tenant.id;
      const oaiRpmCheck = keyRpmLimiter.check(oaiKeyId);
      if (!oaiRpmCheck.allowed) {
        res.setHeader("Retry-After", String(oaiRpmCheck.retryAfter));
        return sendJson(res, 429, { error: "rate_limit_exceeded", message: `Per-key RPM limit reached. Retry after ${oaiRpmCheck.retryAfter}s.`, retryAfter: oaiRpmCheck.retryAfter });
      }
      const oaiTpmCheck = keyTpmLimiter.check(oaiKeyId);
      if (!oaiTpmCheck.allowed) {
        res.setHeader("Retry-After", String(oaiTpmCheck.retryAfter));
        return sendJson(res, 429, { error: "rate_limit_exceeded", message: `Per-key TPM limit reached. Retry after ${oaiTpmCheck.retryAfter}s.`, retryAfter: oaiTpmCheck.retryAfter });
      }

      const body = await parseBody(req, res);
      if (body === null) return;

      const context = await listTenantContext(auth.tenant.id);
      const openAiConnector = context.connectors.find((c) => c.provider === "openai" && c.config?.apiKey);

      if (!openAiConnector?.config?.apiKey) {
        return sendJson(res, 403, {
          error: "forbidden",
          message: "No OpenAI API key configured in your Agent Prism Dashboard."
        });
      }

      // Plan guard
      const oaiGatewayCheck = checkGatewayAllowed(auth.tenant);
      if (!oaiGatewayCheck.allowed) {
        return sendJson(res, 402, { error: oaiGatewayCheck.code, message: oaiGatewayCheck.reason, upgrade: oaiGatewayCheck.upgrade });
      }
      const oaiAgentName = body.agentName || "OpenAI Reasoning Agent";
      const oaiPlanCheck = checkIngestAllowed(auth.tenant, context.runs, oaiAgentName);
      if (!oaiPlanCheck.allowed) {
        return sendJson(res, 402, { error: oaiPlanCheck.code, message: oaiPlanCheck.reason, usage: oaiPlanCheck.usage, upgrade: oaiPlanCheck.upgrade });
      }

      // Budget enforcement for OpenAI gateway
      const _oaiRawBudget = parseFloat(
        openAiConnector.config.monthlyBudgetUsd ||
        process.env.GATEWAY_MONTHLY_BUDGET_USD ||
        "0"
      );
      const oaiMonthlyBudgetUsd = Number.isFinite(_oaiRawBudget) ? _oaiRawBudget : 0;
      if (oaiMonthlyBudgetUsd > 0) {
        const oaiMonthStart = new Date();
        oaiMonthStart.setUTCDate(1);
        oaiMonthStart.setUTCHours(0, 0, 0, 0);
        const oaiMonthStartIso = oaiMonthStart.toISOString();
        const oaiMonthSpend = context.runs
          .filter(r => r.source === "openai" && (r.startTime || "") >= oaiMonthStartIso)
          .reduce((sum, r) => sum + (r.costUsd || 0), 0);
        if (oaiMonthSpend >= oaiMonthlyBudgetUsd) {
          return sendJson(res, 402, {
            error: "budget_exceeded",
            message: `Monthly gateway budget of $${oaiMonthlyBudgetUsd.toFixed(2)} reached (spent $${oaiMonthSpend.toFixed(4)}). Increase GATEWAY_MONTHLY_BUDGET_USD or wait until next month.`,
            spentUsd: Number(oaiMonthSpend.toFixed(4)),
            budgetUsd: oaiMonthlyBudgetUsd
          });
        }
      }

      const oaiRespMessages = Array.isArray(body.input) ? body.input : (body.messages || []);
      const oaiRespToolCount = Array.isArray(body.tools) ? body.tools.length : 0;
      const oaiRespTaskType = classifyTask(oaiRespMessages, { toolCount: oaiRespToolCount });
      const oaiRespFitness = getModelRecommendation(body.model || "unknown", oaiRespTaskType, "openai");

      const startTime = Date.now();
      try {
        const openAiRes = await breakers.openai.execute(() =>
          gatewayFetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openAiConnector.config.apiKey}`
            },
            body: JSON.stringify(body)
          }, GATEWAY_TIMEOUT_OPENAI_MS)
        );

        const openAiData = await openAiRes.json();
        const endTime = Date.now();
        const latencyMs = endTime - startTime;

        if (openAiRes.ok) {
          const inputTokens = openAiData.usage?.input_tokens || 0;
          const outputTokens = openAiData.usage?.output_tokens || 0;
          const costUsd = estimateOpenAiCost({ inputTokens, outputTokens });
          keyTpmLimiter.record(oaiKeyId, inputTokens + outputTokens);
          const runId = createId("run");
          const run = {
            id: runId,
            source: "openai",
            agentName: "OpenAI Reasoning Agent",
            provider: "OpenAI",
            model: body.model || openAiData.model || "unknown",
            taskType: oaiRespTaskType,
            status: "success",
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            latencyMs,
            tokensIn: inputTokens,
            tokensOut: outputTokens,
            costUsd,
            budgetUsd: Number(process.env.OPENAI_DEMO_BUDGET_USD || 0.05),
            autonomyLevel: 4,
            retryCount: 0,
            toolCalls: oaiRespToolCount,
            policyViolations: 0,
            userSatisfaction: 4,
            environment: "production",
            workflow: "github-actions-ci",
            team: "engineering",
            tags: ["openai", "security", "review"],
            breadcrumbs: ["received PR diff", "ran OpenAI response", "captured usage", "recorded telemetry"],
            notes: "OpenAI PR review processed through the Agent Prism gateway."
          };

          await upsertTenantRuns(auth.tenant.id, [run]);

          const captureEnabled = process.env.PROMPT_CAPTURE_ENABLED !== "false";
          if (captureEnabled) {
            const samplingRate = parseFloat(process.env.PROMPT_CAPTURE_SAMPLING_RATE || "1.0");
            if (Math.random() <= samplingRate) {
              const scrub = process.env.PROMPT_CAPTURE_SCRUB_PII !== "false";
              savePromptCapture(auth.tenant.id, {
                id: createId("cap"),
                runId,
                provider: "openai",
                model: body.model || openAiData.model || "unknown",
                taskType: oaiRespTaskType,
                messages: scrub ? scrubPii(oaiRespMessages) : oaiRespMessages,
                response: { output: openAiData.output, usage: openAiData.usage },
                tokensIn: inputTokens,
                tokensOut: outputTokens,
                costUsd,
                latencyMs,
                modelFitness: oaiRespFitness.fitness,
                recommendedModel: oaiRespFitness.recommendedModel,
                piiScrubbed: scrub !== false,
                createdAt: new Date().toISOString()
              }).catch((err) => logError(req, err, tenantId));
            }
          }
        }

        setSecurityHeaders(res);
        res.setHeader("X-Agent-Prism-Task-Type", oaiRespTaskType);
        res.setHeader("X-Agent-Prism-Model-Fitness", oaiRespFitness.fitness);
        if (oaiRespFitness.fitness === "mismatch" || oaiRespFitness.fitness === "suboptimal") {
          res.setHeader("X-Agent-Prism-Recommended-Model", oaiRespFitness.recommendedModel);
        }
        res.writeHead(openAiRes.status, { "Content-Type": contentTypes[".json"] });
        res.end(JSON.stringify(openAiData));
        return;
      } catch (err) {
        logError(req, err, tenantId);
        if (err.isCircuitOpen) return sendJson(res, 503, { error: "provider_unavailable", message: scrubSecrets(err.message) });
        if (err.isTimeout) return sendJson(res, 504, { error: "gateway_timeout", message: scrubSecrets(err.message) });
        return sendJson(res, 502, { error: "bad_gateway", message: scrubSecrets(err.message) });
      }
    }

    // OpenAI Chat Completions proxy (/v1/chat/completions — standard OpenAI SDK endpoint)
    if (req.method === "POST" && req.url.startsWith("/v1/chat/completions")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;

      const body = await parseBody(req, res);
      if (body === null) return;

      const context = await listTenantContext(auth.tenant.id);
      const openAiConnector = context.connectors.find((c) => c.provider === "openai" && c.config?.apiKey);

      if (!openAiConnector?.config?.apiKey) {
        return sendJson(res, 403, {
          error: "forbidden",
          message: "No OpenAI API key configured in your Agent Prism Dashboard."
        });
      }

      const chatMessages = body.messages || [];
      const chatToolCount = Array.isArray(body.tools) ? body.tools.length : 0;
      const chatTaskType = classifyTask(chatMessages, { toolCount: chatToolCount });
      const chatFitness = getModelRecommendation(body.model || "unknown", chatTaskType, "openai");

      const startTime = Date.now();
      try {
        const openAiRes = await breakers.openai.execute(() =>
          gatewayFetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openAiConnector.config.apiKey}`
            },
            body: JSON.stringify(body)
          }, GATEWAY_TIMEOUT_OPENAI_MS)
        );

        const openAiData = await openAiRes.json();
        const endTime = Date.now();
        const latencyMs = endTime - startTime;

        if (openAiRes.ok) {
          const inputTokens = openAiData.usage?.prompt_tokens || 0;
          const outputTokens = openAiData.usage?.completion_tokens || 0;
          const costUsd = estimateOpenAiCost({ inputTokens, outputTokens });
          const runId = createId("run");
          const run = {
            id: runId,
            source: "openai",
            agentName: "OpenAI Chat Agent",
            provider: "OpenAI",
            model: body.model || openAiData.model || "unknown",
            taskType: chatTaskType,
            status: "success",
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            latencyMs,
            tokensIn: inputTokens,
            tokensOut: outputTokens,
            costUsd,
            budgetUsd: Number(process.env.OPENAI_DEMO_BUDGET_USD || 0.05),
            autonomyLevel: 3,
            retryCount: 0,
            toolCalls: chatToolCount,
            policyViolations: 0,
            userSatisfaction: 4,
            environment: "production",
            workflow: "chat-completions",
            team: "engineering"
          };
          await upsertTenantRuns(auth.tenant.id, [run]);

          const captureEnabled = process.env.PROMPT_CAPTURE_ENABLED !== "false";
          if (captureEnabled) {
            const samplingRate = parseFloat(process.env.PROMPT_CAPTURE_SAMPLING_RATE || "1.0");
            if (Math.random() <= samplingRate) {
              const scrub = process.env.PROMPT_CAPTURE_SCRUB_PII !== "false";
              savePromptCapture(auth.tenant.id, {
                id: createId("cap"),
                runId,
                provider: "openai",
                model: body.model || openAiData.model || "unknown",
                taskType: chatTaskType,
                messages: scrub ? scrubPii(chatMessages) : chatMessages,
                response: { choices: openAiData.choices, usage: openAiData.usage },
                tokensIn: inputTokens,
                tokensOut: outputTokens,
                costUsd,
                latencyMs,
                modelFitness: chatFitness.fitness,
                recommendedModel: chatFitness.recommendedModel,
                piiScrubbed: scrub !== false,
                createdAt: new Date().toISOString()
              }).catch((err) => logError(req, err, tenantId));
            }
          }
        }

        setSecurityHeaders(res);
        res.setHeader("X-Agent-Prism-Task-Type", chatTaskType);
        res.setHeader("X-Agent-Prism-Model-Fitness", chatFitness.fitness);
        if (chatFitness.fitness === "mismatch" || chatFitness.fitness === "suboptimal") {
          res.setHeader("X-Agent-Prism-Recommended-Model", chatFitness.recommendedModel);
        }
        res.writeHead(openAiRes.status, { "Content-Type": contentTypes[".json"] });
        res.end(JSON.stringify(openAiData));
        return;
      } catch (err) {
        logError(req, err, tenantId);
        if (err.isCircuitOpen) return sendJson(res, 503, { error: "provider_unavailable", message: scrubSecrets(err.message) });
        if (err.isTimeout) return sendJson(res, 504, { error: "gateway_timeout", message: scrubSecrets(err.message) });
        return sendJson(res, 502, { error: "bad_gateway", message: scrubSecrets(err.message) });
      }
    }

    // ── Azure OpenAI proxy ──────────────────────────────────────────────────────
    // Route: POST /v1/azure/chat/completions
    // Connector: provider="azure_openai" with config.apiKey, config.endpoint, config.apiVersion
    // Endpoint pattern: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version={version}
    if (req.method === "POST" && req.url.startsWith("/v1/azure/")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;

      const azKeyId = auth.apiKey?.id || auth.tenant.id;
      const azRpmCheck = keyRpmLimiter.check(azKeyId);
      if (!azRpmCheck.allowed) {
        res.setHeader("Retry-After", String(azRpmCheck.retryAfter));
        return sendJson(res, 429, { error: "rate_limit_exceeded", message: `Per-key RPM limit reached. Retry after ${azRpmCheck.retryAfter}s.`, retryAfter: azRpmCheck.retryAfter });
      }

      const body = await parseBody(req, res);
      if (body === null) return;

      const context = await listTenantContext(auth.tenant.id);
      const azConnector = context.connectors.find((c) => c.provider === "azure_openai" && c.config?.apiKey);

      if (!azConnector) {
        return sendJson(res, 403, {
          error: "forbidden",
          message: "No Azure OpenAI connector configured. Add one in the Dashboard with provider=azure_openai, including endpoint, apiKey, and apiVersion."
        });
      }

      const { apiKey, endpoint, apiVersion = "2024-02-01", deployment } = azConnector.config;
      const deploy = deployment || body.model || "gpt-4o";
      const azureUrl = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deploy}/chat/completions?api-version=${apiVersion}`;

      // Budget enforcement
      const _azRawBudget = parseFloat(azConnector.config.monthlyBudgetUsd || process.env.GATEWAY_MONTHLY_BUDGET_USD || "0");
      const azBudgetUsd = Number.isFinite(_azRawBudget) ? _azRawBudget : 0;
      if (azBudgetUsd > 0) {
        const azMonthStart = new Date(); azMonthStart.setUTCDate(1); azMonthStart.setUTCHours(0, 0, 0, 0);
        const azSpend = context.runs
          .filter(r => r.source === "azure_openai" && (r.startTime || "") >= azMonthStart.toISOString())
          .reduce((s, r) => s + (r.costUsd || 0), 0);
        if (azSpend >= azBudgetUsd) {
          return sendJson(res, 402, { error: "budget_exceeded", message: `Monthly Azure gateway budget of $${azBudgetUsd.toFixed(2)} reached.`, spentUsd: Number(azSpend.toFixed(4)), budgetUsd: azBudgetUsd });
        }
      }

      const azMessages = body.messages || [];
      const azToolCount = Array.isArray(body.tools) ? body.tools.length : 0;
      const azTaskType = classifyTask(azMessages, { toolCount: azToolCount });
      const startTime = Date.now();

      try {
        const azRes = await breakers.azure.execute(() =>
          gatewayFetch(azureUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "api-key": apiKey
            },
            body: JSON.stringify(body)
          }, GATEWAY_TIMEOUT_AZURE_MS)
        );

        const azData = await azRes.json();
        const endTime = Date.now();
        const latencyMs = endTime - startTime;

        if (azRes.ok) {
          const inputTokens = azData.usage?.prompt_tokens || 0;
          const outputTokens = azData.usage?.completion_tokens || 0;
          const costUsd = estimateOpenAiCost({ inputTokens, outputTokens });
          keyTpmLimiter.record(azKeyId, inputTokens + outputTokens);

          await upsertTenantRuns(auth.tenant.id, [{
            id: createId("run"),
            source: "azure_openai",
            agentName: body.agentName || `Azure/${deploy}`,
            provider: "Azure OpenAI",
            model: deploy,
            taskType: azTaskType,
            status: "success",
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            latencyMs,
            tokensIn: inputTokens,
            tokensOut: outputTokens,
            costUsd,
            budgetUsd: azBudgetUsd || 0.05,
            autonomyLevel: 0,
            retryCount: 0,
            toolCalls: azToolCount,
            policyViolations: 0,
            userSatisfaction: 0,
            environment: "production",
            workflow: body.workflow || "azure-gateway",
            team: body.team || "engineering"
          }]);
        }

        setSecurityHeaders(res);
        res.setHeader("X-Agent-Prism-Task-Type", azTaskType);
        res.writeHead(azRes.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(azData));
        return;
      } catch (err) {
        logError(req, err, tenantId);
        if (err.isCircuitOpen) return sendJson(res, 503, { error: "provider_unavailable", message: scrubSecrets(err.message) });
        if (err.isTimeout) return sendJson(res, 504, { error: "gateway_timeout", message: scrubSecrets(err.message) });
        return sendJson(res, 502, { error: "bad_gateway", message: scrubSecrets(err.message) });
      }
    }

    if (req.method === "GET" && req.url === "/api/dashboard") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      const snapshot = buildDashboardSnapshot(context.runs);
      const modelMismatches = detectModelMismatches(context.runs);
      return sendJson(res, 200, {
        ...snapshot,
        tenant: context.tenant,
        runs: context.runs,
        modelMismatches
      });
    }

    if (req.method === "GET" && req.url === "/api/ai-advisor") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      const snapshot = buildDashboardSnapshot(context.runs);
      const advisor = await generateAiAdvisor({
        tenant: context.tenant,
        snapshot,
        runs: context.runs
      });
      return sendJson(res, 200, advisor);
    }

    if (req.method === "GET" && req.url === "/api/runs") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      return sendJson(res, 200, { runs: context.runs });
    }

    if (req.method === "POST" && req.url === "/api/advisor") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const { prompt, runId } = body;
      if (!prompt) return sendJson(res, 400, { error: "prompt required" });
      // content-addressed cache: same prompt text = same analysis
      const { createHash } = await import("node:crypto");
      const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);
      if (runId) {
        const cached = await getPromptAnalysis(auth.tenant.id, runId);
        if (cached && cached.promptHash === promptHash) {
          return sendJson(res, 200, { ...cached, cached: true });
        }
      }
      try {
        const llmPrompt = `You are a prompt engineering expert. Evaluate the following AI prompt and return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{"score":7,"weakness":"one concise sentence about what is weak","rewrite":"the improved prompt text","tokenSavingsPct":25}

Score 1-10 where 10 is perfect. Weakness: what is missing or vague. Rewrite: make it specific, context-rich, output-directing so the model needs fewer tokens to respond well. tokenSavingsPct: integer 0-60 estimating how many fewer input tokens the rewrite needs vs the original (tighter phrasing = higher savings).

Prompt to evaluate:
${prompt}`;
        let text = (await callLlm(llmPrompt) || "{}").trim();
        text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) text = jsonMatch[0];
        let result;
        try { result = JSON.parse(text); }
        catch { result = { score: 0, weakness: "Could not parse advisor response: " + text.slice(0, 120), rewrite: "" }; }
        // persist so repeat visits are instant
        if (runId) await savePromptAnalysis(auth.tenant.id, runId, promptHash, result).catch((err) => logError(req, err, tenantId));
        return sendJson(res, 200, result);
      } catch (err) {
        logError(req, err, tenantId);
        return sendJson(res, 502, { error: "advisor_error", message: scrubSecrets(err.message) });
      }
    }

    if (req.method === "POST" && req.url === "/api/advisor/apply") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const { runId, originalPrompt, rewrite, tokensIn, runsPerMonth, tokenSavingsPct, costUsdPerRun } = body;
      const savingsPct = Math.min(Math.max(Number(tokenSavingsPct) || 0, 0), 60);
      const monthlyRuns = Math.max(Number(runsPerMonth) || 1, 1);
      const tokensSavedPerRun = Math.round((Number(tokensIn) || 0) * savingsPct / 100);
      const costPerToken = (Number(costUsdPerRun) || 0) / Math.max(Number(tokensIn) || 1, 1);
      const estimatedMonthlySavingsUsd = parseFloat((tokensSavedPerRun * costPerToken * monthlyRuns).toFixed(4));
      const COMMISSION_RATE = 0.15;
      const commissionUsd = parseFloat((estimatedMonthlySavingsUsd * COMMISSION_RATE).toFixed(4));
      await logAuditEvent(auth.tenant.id, {
        actor: auth.tenant.name || auth.tenant.id,
        action: "Advisor Rewrite Applied",
        resource: "Run",
        details: {
          runId,
          tokenSavingsPct: savingsPct,
          tokensSavedPerRun,
          estimatedMonthlySavingsUsd,
          commissionUsd,
          commissionRate: COMMISSION_RATE,
          originalPromptLength: (originalPrompt || "").length,
          rewriteLength: (rewrite || "").length
        },
        ip
      });
      return sendJson(res, 200, { status: "applied", estimatedMonthlySavingsUsd });
    }

    if (req.method === "GET" && req.url === "/api/leaks") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      return sendJson(res, 200, { leaks: detectCostLeaks(context.runs) });
    }

    if (req.method === "GET" && req.url.startsWith("/api/captures")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;

      const url = new URL(req.url, "http://localhost");
      const format = url.searchParams.get("format") || "json";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 1000);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const taskType = url.searchParams.get("task_type") || undefined;
      const model = url.searchParams.get("model") || undefined;

      const result = await listPromptCaptures(auth.tenant.id, { limit, offset, taskType, model });

      if (format === "jsonl") {
        setSecurityHeaders(res);
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": 'attachment; filename="captures.jsonl"'
        });
        for (const capture of result.captures) {
          res.write(JSON.stringify({
            id: capture.id,
            model: capture.model,
            task_type: capture.taskType,
            messages: capture.messages,
            response: capture.response,
            tokens_in: capture.tokensIn,
            tokens_out: capture.tokensOut,
            model_fitness: capture.modelFitness,
            created_at: capture.createdAt
          }) + "\n");
        }
        res.end();
        return;
      }

      return sendJson(res, 200, { captures: result.captures, total: result.total, limit, offset });
    }

    if (req.method === "GET" && req.url === "/api/model-fitness") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;

      const stats = await getModelFitnessStats(auth.tenant.id);
      return sendJson(res, 200, stats);
    }

    if (req.method === "GET" && req.url === "/api/tenant") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      const planDef = getPlan(auth.tenant.plan);
      const usage = computeUsage(context.runs);
      return sendJson(res, 200, {
        tenant: context.tenant,
        users: context.users,
        connectors: context.connectors.map(sanitizeConnector),
        runCount: context.runs.length,
        plan: {
          name: planDef.name,
          slug: auth.tenant.plan,
          limits: {
            maxAgents: planDef.maxAgents === Infinity ? null : planDef.maxAgents,
            maxRunsPerMonth: planDef.maxRunsPerMonth === Infinity ? null : planDef.maxRunsPerMonth,
            gatewayAccess: planDef.gatewayAccess,
            aiAdvisor: planDef.aiAdvisor,
            promptCapture: planDef.promptCapture,
            teamMembers: planDef.teamMembers === Infinity ? null : planDef.teamMembers,
            dataRetentionDays: planDef.dataRetentionDays === Infinity ? null : planDef.dataRetentionDays
          },
          usage: {
            agents: usage.agentCount,
            agentNames: usage.uniqueAgents,
            monthlyRuns: usage.monthlyRuns
          },
          upgradeUrl: process.env.UPGRADE_URL || "https://agentprism.io/pricing"
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/tenant/api-keys") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const keys = await listTenantApiKeys(auth.tenant.id);
      return sendJson(res, 200, { keys });
    }

    // bulk delete — exact URL match first so /permanent and /:id routes don't interfere
    if (req.method === "DELETE" && req.url === "/api/tenant/api-keys") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const excludeId = auth.apiKey.id;
      const deleted = await deleteAllTenantApiKeys(auth.tenant.id, excludeId);
      await logAuditEvent(auth.tenant.id, {
        actor: `Admin (via ${auth.apiKey.prefix})`,
        action: "All API Keys Deleted",
        resource: "api_keys",
        details: { count: deleted.length },
        ip: req.socket?.remoteAddress || "unknown"
      });
      return sendJson(res, 200, { deleted: deleted.length });
    }

    if (req.method === "POST" && req.url === "/api/tenant/api-keys") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const result = await createTenantApiKey({
        tenantId: auth.tenant.id,
        name: body.name || "Tenant API key"
      });

      await logAuditEvent(auth.tenant.id, {
        actor: `Admin (via ${auth.apiKey.prefix})`,
        action: "Tenant API Key Created",
        resource: result.key.prefix,
        details: { name: result.key.name },
        ip: req.socket?.remoteAddress || "unknown"
      });

      return sendJson(res, 201, result);
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/tenant/api-keys/") && req.url.endsWith("/permanent")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const keyId = decodeURIComponent(req.url.slice("/api/tenant/api-keys/".length, -"/permanent".length));

      if (keyId === auth.apiKey.id) {
        return sendJson(res, 400, { error: "bad_request", message: "Cannot delete the API key used for this request." });
      }

      const deleted = await deleteTenantApiKey(auth.tenant.id, keyId);
      if (!deleted) {
        return sendJson(res, 404, { error: "not_found", message: "API key not found." });
      }

      await logAuditEvent(auth.tenant.id, {
        actor: `Admin (via ${auth.apiKey.prefix})`,
        action: "Tenant API Key Deleted",
        resource: deleted.prefix,
        details: { name: deleted.name },
        ip: req.socket?.remoteAddress || "unknown"
      });

      return sendJson(res, 200, { deleted });
    }

    // revoke (soft-delete) — must come AFTER /permanent route
    if (req.method === "DELETE" && req.url.startsWith("/api/tenant/api-keys/")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const keyId = decodeURIComponent(req.url.slice("/api/tenant/api-keys/".length));

      if (keyId === auth.apiKey.id) {
        return sendJson(res, 400, {
          error: "bad_request",
          message: "You cannot revoke the API key used for this request."
        });
      }

      const revoked = await revokeTenantApiKey(auth.tenant.id, keyId);
      if (!revoked) {
        return sendJson(res, 404, { error: "not_found", message: "API key not found." });
      }

      await logAuditEvent(auth.tenant.id, {
        actor: `Admin (via ${auth.apiKey.prefix})`,
        action: "Tenant API Key Revoked",
        resource: revoked.prefix,
        details: { name: revoked.name },
        ip: req.socket?.remoteAddress || "unknown"
      });

      return sendJson(res, 200, { key: revoked });
    }

    // ── IP allowlist management ─────────────────────────────────────────────────
    if (req.method === "PUT" && req.url.match(/^\/api\/tenant\/api-keys\/[^/]+\/ip-allowlist$/)) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const keyId = decodeURIComponent(req.url.slice("/api/tenant/api-keys/".length, -"/ip-allowlist".length));
      const body = await parseBody(req, res);
      if (body === null) return;
      const ipList = Array.isArray(body.ip_allowlist) ? body.ip_allowlist.map(String) : null;
      const updated = await setApiKeyIpAllowlist(auth.tenant.id, keyId, ipList);
      if (!updated) return sendJson(res, 404, { error: "not_found", message: "API key not found." });
      await logAuditEvent(auth.tenant.id, {
        actor: auth.apiKey.prefix,
        action: "API Key IP Allowlist Updated",
        resource: keyId,
        details: { ipCount: ipList ? ipList.length : 0 },
        ip: req.socket?.remoteAddress || "unknown"
      });
      return sendJson(res, 200, { id: keyId, ip_allowlist: ipList });
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
      
      const ip = req.socket?.remoteAddress || "unknown";
      await logAuditEvent(auth.tenant.id, {
        actor: `Admin (via ${auth.apiKey.prefix})`,
        action: "Connector Created",
        resource: connector.provider,
        details: { mode: body.mode },
        ip
      });

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

      // Idempotency check — deduplicate webhook retries using Idempotency-Key header or run ID
      const idempotencyKey = req.headers["idempotency-key"] || normalizedRun.id;
      const idempResult = await checkAndSetIdempotencyKey(auth.tenant.id, idempotencyKey, normalizedRun.id);
      if (idempResult.isDuplicate) {
        return sendJson(res, 200, { status: "duplicate", runId: idempResult.runId });
      }

      // Plan guard
      const ingestCtx = await listTenantContext(auth.tenant.id);
      const ingestPlanCheck = checkIngestAllowed(auth.tenant, ingestCtx.runs, normalizedRun.agentName);
      if (!ingestPlanCheck.allowed) {
        return sendJson(res, 402, { error: ingestPlanCheck.code, message: ingestPlanCheck.reason, usage: ingestPlanCheck.usage, upgrade: ingestPlanCheck.upgrade });
      }

      // Production certification gate
      const certPass = await enforceProductionCertGate(auth.tenant.id, normalizedRun.agentName, normalizedRun.environment, res);
      if (!certPass) return;

      let updated;
      try {
        updated = await upsertTenantRuns(auth.tenant.id, [normalizedRun]);
      } catch (dlqErr) {
        await saveFailedIngest(auth.tenant.id, "generic", body, dlqErr.message).catch(() => {});
        logError(req, dlqErr, tenantId);
        return sendJson(res, 202, { status: "queued", message: "Run accepted but could not persist immediately. Will retry." });
      }

      const ip = req.socket?.remoteAddress || "unknown";
      await logAuditEvent(auth.tenant.id, {
        actor: `API Key (${auth.apiKey.prefix})`,
        action: "Telemetry Ingested",
        resource: normalizedRun.id,
        details: { agentName: normalizedRun.agentName, costUsd: normalizedRun.costUsd },
        ip
      });

      // Auto-revoke if prod run introduces new high-danger tools
      await checkAutoRevoke(auth.tenant.id, normalizedRun, ip);

      if (normalizedRun.costUsd > normalizedRun.budgetUsd) {
        await dispatchBudgetAlert(auth.tenant.id, normalizedRun);
      }

      return sendJson(res, 201, {
        status: "ingested",
        tenant: auth.tenant.slug,
        totalRuns: updated.length,
        normalizedRun
      });
    }

    if (req.method === "GET" && req.url === "/api/audit") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const logs = await listAuditLogs(auth.tenant.id);
      return sendJson(res, 200, { auditLogs: logs });
    }

    if (req.method === "GET" && req.url === "/api/audit/export") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const logs = await listAuditLogs(auth.tenant.id);
      const rows = [
        ["timestamp", "actor", "action", "resource", "ip", "details", "hash", "prevHash"],
        ...logs.map((log) => [
          log.timestamp,
          log.actor,
          log.action,
          log.resource,
          log.ip,
          log.details || {},
          log.hash || "",
          log.prevHash || ""
        ])
      ];
      return sendCsv(res, `agent-prism-audit-${auth.tenant.slug}.csv`, rows);
    }

    // ── GDPR / Data Subject Rights ────────────────────────────────────────────

    if (req.method === "GET" && req.url.startsWith("/api/gdpr/export")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const searchParams = new URL(req.url, "http://localhost").searchParams;
      const pageSize = Math.min(parseInt(searchParams.get("limit") || "1000", 10), 5000);
      const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);

      const [ctx, auditLogs, promptData] = await Promise.all([
        listTenantContext(auth.tenant.id),
        listAuditLogs(auth.tenant.id),
        listPromptCaptures(auth.tenant.id, { limit: pageSize, offset })
      ]);
      const connectors = (ctx.connectors || []).map(({ config: _cfg, ...rest }) => ({
        ...rest,
        config: Object.keys(_cfg || {}).reduce((acc, k) => ({ ...acc, [k]: "[REDACTED]" }), {})
      }));
      // Paginated: return page of runs matching offset/pageSize
      const allRuns = ctx.runs || [];
      const runsPage = allRuns.slice(offset, offset + pageSize);
      return sendJson(res, 200, {
        exportedAt: new Date().toISOString(),
        tenant: ctx.tenant,
        users: (ctx.users || []).map(({ id, email, name, role, createdAt }) => ({ id, email, name, role, createdAt })),
        connectors,
        runs: runsPage,
        runsTotal: allRuns.length,
        runsOffset: offset,
        runsLimit: pageSize,
        auditLogs,
        promptCaptures: promptData.captures || [],
        promptCapturesTotal: promptData.total || 0
      });
    }

    if (req.method === "DELETE" && req.url === "/api/gdpr/data") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      await Promise.all([
        resetTenantRuns(auth.tenant.id),
        resetPromptCaptures(auth.tenant.id)
      ]);
      await logAuditEvent(auth.tenant.id, {
        actor: auth.apiKey?.prefix || "tenant",
        action: "GDPR_DATA_ERASURE",
        resource: `tenant:${auth.tenant.id}`,
        details: { erasedAt: new Date().toISOString() },
        ip: req.socket?.remoteAddress || "unknown"
      });
      return sendJson(res, 200, { status: "erased", tenant: auth.tenant.slug, erasedAt: new Date().toISOString() });
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
      const claudeIngestCtx = await listTenantContext(auth.tenant.id);
      const claudePlanCheck = checkIngestAllowed(auth.tenant, claudeIngestCtx.runs, run.agentName);
      if (!claudePlanCheck.allowed) {
        return sendJson(res, 402, { error: claudePlanCheck.code, message: claudePlanCheck.reason, usage: claudePlanCheck.usage, upgrade: claudePlanCheck.upgrade });
      }
      if (!await enforceProductionCertGate(auth.tenant.id, run.agentName, run.environment, res)) return;
      await upsertTenantRuns(auth.tenant.id, [run]);
      await checkAutoRevoke(auth.tenant.id, run, req.socket?.remoteAddress || "unknown");
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
      const copilotIngestCtx = await listTenantContext(auth.tenant.id);
      const copilotPlanCheck = checkIngestAllowed(auth.tenant, copilotIngestCtx.runs, run.agentName);
      if (!copilotPlanCheck.allowed) {
        return sendJson(res, 402, { error: copilotPlanCheck.code, message: copilotPlanCheck.reason, usage: copilotPlanCheck.usage, upgrade: copilotPlanCheck.upgrade });
      }
      if (!await enforceProductionCertGate(auth.tenant.id, run.agentName, run.environment, res)) return;
      await upsertTenantRuns(auth.tenant.id, [run]);
      await checkAutoRevoke(auth.tenant.id, run, req.socket?.remoteAddress || "unknown");
      return sendJson(res, 201, { status: "ingested", source: "copilot" });
    }

    if (req.method === "POST" && req.url === "/api/ingest/generic") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const run = normalizeGenericRun(body.payload || body);
      const genericIngestCtx = await listTenantContext(auth.tenant.id);
      const genericPlanCheck = checkIngestAllowed(auth.tenant, genericIngestCtx.runs, run.agentName);
      if (!genericPlanCheck.allowed) {
        return sendJson(res, 402, { error: genericPlanCheck.code, message: genericPlanCheck.reason, usage: genericPlanCheck.usage, upgrade: genericPlanCheck.upgrade });
      }
      if (!await enforceProductionCertGate(auth.tenant.id, run.agentName, run.environment, res)) return;
      await upsertTenantRuns(auth.tenant.id, [run]);
      await checkAutoRevoke(auth.tenant.id, run, req.socket?.remoteAddress || "unknown");
      return sendJson(res, 201, { status: "ingested", source: "generic" });
    }

    // ── Fleet session ingest (tenant auth — collector daemons post here) ────────

    if (req.method === "POST" && req.url === "/api/fleet/ingest") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const body = await parseBody(req, res);
      if (body === null) return;
      const machineId = body.machineId || body.hostname || "unknown";
      if (!machineId) return sendJson(res, 400, { error: "machineId required" });
      upsertFleetSnapshot(auth.tenant.id, machineId, body);
      return sendJson(res, 200, { ok: true, machineId, tenantId: auth.tenant.id });
    }

    if (req.method === "GET" && req.url === "/api/fleet/sessions") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const machines = getFleetSnapshots(auth.tenant.id);
      const totalSessions = machines.reduce((n, m) => n + m.sessions.length, 0);
      const totalTokens = machines.reduce((n, m) =>
        n + m.sessions.reduce((s, sess) => s + (sess.totalInputTokens || 0) + (sess.totalOutputTokens || 0), 0), 0);
      const activeSessions = machines.reduce((n, m) =>
        n + m.sessions.filter((s) => s.status === "active").length, 0);
      return sendJson(res, 200, {
        machines,
        summary: { totalMachines: machines.length, onlineMachines: machines.filter((m) => m.online).length, totalSessions, activeSessions, totalTokens }
      });
    }

    // ── Rate limits (no auth — local observability) ───────────────────────────

    if (req.method === "GET" && req.url === "/api/rate-limits") {
      return sendJson(res, 200, {
        anthropic: rateLimitState.anthropic,
        openai: rateLimitState.openai,
        updatedAt: rateLimitState.updatedAt
      });
    }

    // ── Local sessions (no auth — local machine only) ─────────────────────────

    if (req.method === "GET" && req.url === "/api/local-sessions") {
      const [sessions, processes, ports] = await Promise.all([
        scanLocalSessions(),
        scanProcesses(),
        scanPorts(),
      ]);
      return sendJson(res, 200, { sessions, processes, ports, ts: Date.now() });
    }

    if (req.method === "POST" && req.url.startsWith("/api/local-sessions/kill-port/")) {
      const rawPort = req.url.slice("/api/local-sessions/kill-port/".length);
      const port = parseInt(rawPort);
      if (!port || isNaN(port) || port < 1024 || port > 65535) {
        return sendJson(res, 400, { error: "invalid_port" });
      }
      const pids = await killPort(port).catch((err) => { throw new Error(`kill failed: ${err.message}`); });
      return sendJson(res, 200, { killed: pids, port });
    }

    // ── Agent Certification ───────────────────────────────────────────────────

    // List all registered agents with tier + cert status
    if (req.method === "GET" && req.url === "/api/agents") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const agents = await listAgentDefinitions(auth.tenant.id);
      return sendJson(res, 200, { agents });
    }

    // Tenant-wide cert summary — must come before /api/agents/:name
    if (req.method === "GET" && req.url === "/api/agents/certifications") {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const certs = await listCertifications(auth.tenant.id);
      return sendJson(res, 200, { certifications: certs });
    }

    // Single agent detail
    if (req.method === "GET" && req.url.startsWith("/api/agents/") && !req.url.includes("/cert") && !req.url.includes("/certify") && !req.url.includes("/promote") && !req.url.includes("/revoke")) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const agentName = decodeURIComponent(req.url.slice("/api/agents/".length));
      const agent = await getAgentDefinition(auth.tenant.id, agentName);
      if (!agent) return sendJson(res, 404, { error: "not_found", message: `Agent "${agentName}" not registered.` });
      return sendJson(res, 200, { agent });
    }

    // Get current cert for an agent
    if (req.method === "GET" && req.url.match(/^\/api\/agents\/[^/]+\/cert$/)) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const urlObj = new URL(req.url, "http://localhost");
      const agentName = decodeURIComponent(req.url.slice("/api/agents/".length, req.url.lastIndexOf("/cert")));
      const environment = urlObj.searchParams.get("env") || "production";
      const cert = await getCertification(auth.tenant.id, agentName, environment);
      if (!cert) return sendJson(res, 200, { cert: { agentName, environment, certStatus: "uncertified" } });
      return sendJson(res, 200, { cert });
    }

    // Trigger cert evaluation
    if (req.method === "POST" && req.url.match(/^\/api\/agents\/[^/]+\/certify$/)) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const agentName = decodeURIComponent(req.url.slice("/api/agents/".length, req.url.lastIndexOf("/certify")));
      const body = await parseBody(req, res);
      if (body === null) return;
      const environment = body.environment || "staging";

      const agentRuns = await getAgentRunsForCert(auth.tenant.id, agentName);
      const evalResult = evaluateAgent(agentName, agentRuns, environment);

      let cert;
      try {
        cert = await saveCertification(
          auth.tenant.id, agentName, environment, evalResult,
          auth.user?.email || auth.apiKey?.prefix || "system"
        );
      } catch (err) {
        return sendJson(res, 404, { error: "not_found", message: err.message });
      }

      const actor = auth.user?.email || auth.apiKey?.prefix || "system";
      await logAuditEvent(auth.tenant.id, {
        actor,
        action: evalResult.status === "certified" ? "Agent Certified" : "Agent Certification Failed",
        resource: agentName,
        details: { environment, status: evalResult.status, tier: evalResult.effectiveTier, failures: evalResult.failureReasons.length },
        ip: req.socket?.remoteAddress || "unknown"
      });

      return sendJson(res, 200, { cert, evaluation: evalResult });
    }

    // Promote agent from staging to production
    if (req.method === "POST" && req.url.match(/^\/api\/agents\/[^/]+\/promote$/)) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const agentName = decodeURIComponent(req.url.slice("/api/agents/".length, req.url.lastIndexOf("/promote")));

      // Run production cert evaluation
      const agentRuns = await getAgentRunsForCert(auth.tenant.id, agentName);
      const evalResult = evaluateAgent(agentName, agentRuns, "production");

      const actor = auth.user?.email || auth.apiKey?.prefix || "system";

      let cert;
      try {
        cert = await saveCertification(auth.tenant.id, agentName, "production", evalResult, actor);
      } catch (err) {
        return sendJson(res, 404, { error: "not_found", message: err.message });
      }

      const promotion = await createPromotion(auth.tenant.id, agentName, {
        fromEnv: "staging",
        toEnv: "production",
        requestedBy: actor,
        certSnapshot: cert,
        blockingChecks: evalResult.failureReasons
      }).catch(() => null);

      await logAuditEvent(auth.tenant.id, {
        actor,
        action: evalResult.status === "certified" ? "Agent Promoted to Production" : "Agent Promotion Blocked",
        resource: agentName,
        details: { status: evalResult.status, tier: evalResult.effectiveTier, failures: evalResult.failureReasons },
        ip: req.socket?.remoteAddress || "unknown"
      });

      if (evalResult.status !== "certified") {
        return sendJson(res, 422, {
          error: "certification_failed",
          message: `Agent "${agentName}" cannot be promoted — ${evalResult.failureReasons.length} blocking check(s) failed.`,
          failures: evalResult.failureReasons,
          evaluation: evalResult
        });
      }

      return sendJson(res, 200, { status: "promoted", cert, promotion, evaluation: evalResult });
    }

    // Revoke cert (tenant auth — caller must own the agent)
    if (req.method === "POST" && req.url.match(/^\/api\/agents\/[^/]+\/revoke$/)) {
      const auth = await requireTenant(req, res, (id) => { tenantId = id; });
      if (!auth) return;
      const agentName = decodeURIComponent(req.url.slice("/api/agents/".length, req.url.lastIndexOf("/revoke")));
      const body = await parseBody(req, res);
      if (body === null) return;
      const environment = body.environment || "production";
      const reason = body.reason || "Manually revoked";
      const actor = auth.user?.email || auth.apiKey?.prefix || "system";

      const revoked = await revokeCertification(auth.tenant.id, agentName, environment, reason, actor);
      if (!revoked) return sendJson(res, 404, { error: "not_found", message: `No cert found for "${agentName}" in ${environment}.` });

      await logAuditEvent(auth.tenant.id, {
        actor,
        action: "Agent Cert Revoked",
        resource: agentName,
        details: { environment, reason },
        ip: req.socket?.remoteAddress || "unknown"
      });

      return sendJson(res, 200, { status: "revoked", agentName, environment, reason });
    }

    // ── Dashboard page (Basic Auth gate) ─────────────────────────────────────

    if (req.url === "/admin" || req.url === "/admin.html") {
      const filePath = join(publicDir, "admin.html");
      try {
        const fileBytes = await readFile(filePath, "utf-8");
        const nonce = generateCspNonce();
        const injected = fileBytes.replace(/<script(?!\s+src=)/g, `<script nonce="${nonce}"`);
        setSecurityHeaders(res, nonce);
        res.writeHead(200, { "Content-Type": contentTypes[".html"] });
        res.end(injected);
      } catch {
        sendText(res, 404, "Admin panel not found");
      }
      return;
    }

    if (req.url === "/dashboard" || req.url === "/dashboard.html") {
      if (!requireBasicAuth(req, res)) return;
      const filePath = join(publicDir, "dashboard.html");
      try {
        const fileBytes = await readFile(filePath, "utf-8");
        const nonce = generateCspNonce();
        // Inject nonce into all inline <script> tags so CSP doesn't need unsafe-inline
        const injected = fileBytes.replace(/<script(?!\s+src=)/g, `<script nonce="${nonce}"`);
        setSecurityHeaders(res, nonce);
        res.writeHead(200, { "Content-Type": contentTypes[".html"] });
        res.end(injected);
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
      message: process.env.NODE_ENV === "production"
        ? "Internal server error"
        : scrubSecrets(error.message)
    });
  }
});

validateConfig();

// ── Schema patches — run at startup for Postgres, no external file dependency ─
if (process.env.DATABASE_URL && config.storageBackend === "postgres") {
  ensureSchemaPatches().catch((err) => {
    process.stderr.write(`[schema] Startup patch error: ${err.message}\n`);
  });
}

// ── Auto-migration (opt-in via RUN_MIGRATIONS_ON_STARTUP=true) ──────────────
if (process.env.RUN_MIGRATIONS_ON_STARTUP === "true" && process.env.DATABASE_URL) {
  import("./db/migrate.js").then(({ runMigrations }) =>
    import("pg").then(({ Pool }) => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      return runMigrations(pool).then((r) => {
        process.stderr.write(`[migrate] Startup: applied ${r.applied}/${r.total}\n`);
        return pool.end();
      });
    })
  ).catch((err) => {
    process.stderr.write(`[migrate] Startup error: ${err.message}\n`);
  });
}

// ── Demo user seed (DEMO_EMAIL + DEMO_PASSWORD env vars) ─────────────────────
// Upserts a demo user on every startup. Creates if not found (in first tenant).
if (process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD) {
  ensureDemoUser({ email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD })
    .then((u) => {
      if (u) process.stderr.write(`[demo] Demo user ready: ${process.env.DEMO_EMAIL}\n`);
      else    process.stderr.write(`[demo] Demo user skipped (no active tenant yet)\n`);
    })
    .catch((err) => process.stderr.write(`[demo] Demo user seed failed: ${err.message}\n`));
}

// ── Data retention (DATA_RETENTION_DAYS=90 deletes runs/captures older than N days) ──
const RETENTION_DAYS = Number(process.env.DATA_RETENTION_DAYS || 0);
if (RETENTION_DAYS > 0) {
  const runRetention = () =>
    applyDataRetention(RETENTION_DAYS)
      .then((r) => {
        if (r.deletedRuns > 0 || r.deletedCaptures > 0) {
          process.stderr.write(
            JSON.stringify({ ts: new Date().toISOString(), level: "info",
              message: `[retention] deleted ${r.deletedRuns} runs, ${r.deletedCaptures} captures older than ${RETENTION_DAYS}d` }) + "\n"
          );
        }
      })
      .catch((err) => process.stderr.write(`[retention] error: ${err.message}\n`));

  // Run once at startup, then every 24h
  runRetention();
  setInterval(runRetention, 24 * 60 * 60 * 1000).unref();
}

// ── Rate-limiter GC — evict expired buckets every 60 s to prevent unbounded growth ──
setInterval(() => {
  tenantLimiter.gc();
  keyRpmLimiter.gc();
  keyTpmLimiter.gc();
  bootstrapLimiter.gc();
}, 60_000).unref();

// ── Idempotency key cleanup — prune keys older than 24h every hour ──
setInterval(() => {
  pruneIdempotencyKeys().catch((err) =>
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event: "idempotency_prune_error", error: err.message }) + "\n")
  );
}, 60 * 60 * 1000).unref();

// ── DLQ retry — reattempt failed ingests every 5 minutes ──
const runDlqRetry = async () => {
  const pending = await listPendingFailedIngests(20).catch(() => []);
  for (const item of pending) {
    try {
      const normalizedRun = normalizePayload(item.payload);
      await upsertTenantRuns(item.tenant_id, [normalizedRun]);
      await markFailedIngestAttempt(item.id, { succeeded: true });
    } catch (err) {
      await markFailedIngestAttempt(item.id, { succeeded: false, error: err.message }).catch(() => {});
    }
  }
};
setInterval(runDlqRetry, 5 * 60 * 1000).unref();

server.listen(port, host, () => {
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    message: `Agent Prism listening on http://${host}:${port}`,
    env: process.env.NODE_ENV || "development"
  }) + "\n");
});

setupGracefulShutdown(server, inflightTracker);
