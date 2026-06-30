import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApiKey, createId, createSessionToken, hashPassword, verifyApiKey, verifyPassword } from "../auth.js";
import { encryptConnectorConfig, decryptConnectorConfig } from "../crypto.js";

const dataDir = join(process.cwd(), "data");
const appStatePath = join(dataDir, "app-state.json");

const emptyState = {
  tenants: [],
  users: [],
  apiKeys: [],
  connectors: [],
  runs: [],
  sessions: [],
  dashboardSessions: [],
  auditLogs: [],
  promptAnalyses: [],
  promptCaptures: []
};

function now() {
  return new Date().toISOString();
}

async function ensureState() {
  await mkdir(dataDir, { recursive: true });

  if (!existsSync(appStatePath)) {
    await writeFile(appStatePath, JSON.stringify(emptyState, null, 2), "utf8");
  }
}

export async function readState() {
  await ensureState();
  const raw = await readFile(appStatePath, "utf8");
  const state = JSON.parse(raw);
  return { ...emptyState, ...state };
}

export async function writeState(state) {
  const tempPath = `${appStatePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
  await rename(tempPath, appStatePath);
}

export async function getBootstrapStatus() {
  const state = await readState();
  return {
    bootstrapped: state.tenants.length > 0,
    tenants: state.tenants.length
  };
}

export async function bootstrapSaas({ companyName, adminEmail, adminName, adminPassword, plan = "free" }) {
  const state = await readState();

  if (state.tenants.length > 0) {
    throw new Error("Control plane is already bootstrapped.");
  }

  const tenantId = createId("tenant");
  const userId = createId("user");
  const apiKeyId = createId("key");
  const apiKey = createApiKey();
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const tenant = {
    id: tenantId,
    name: companyName,
    slug: slug || tenantId,
    plan,
    status: "active",
    createdAt: now()
  };

  const user = {
    id: userId,
    tenantId,
    email: adminEmail,
    name: adminName || adminEmail,
    role: "owner",
    passwordHash: adminPassword ? hashPassword(adminPassword) : null,
    createdAt: now()
  };

  const connector = {
    id: createId("connector"),
    tenantId,
    provider: "github-copilot",
    name: "GitHub Copilot",
    status: "ready",
    mode: "webhook",
    createdAt: now()
  };

  state.tenants.push(tenant);
  state.users.push(user);
  state.apiKeys.push({
    id: apiKeyId,
    tenantId,
    name: "Default ingest key",
    prefix: apiKey.prefix,
    hash: apiKey.hash,
    status: "active",
    scopes: ["*"],
    createdAt: now(),
    lastUsedAt: null
  });
  state.connectors.push(connector);

  await writeState(state);

  return {
    tenant,
    user,
    connector,
    apiKey: apiKey.plainText
  };
}

export async function createTenantApiKey({ tenantId, name } = {}) {
  const state = await readState();
  const tenant = tenantId
    ? state.tenants.find((item) => item.id === tenantId)
    : state.tenants[0];

  if (!tenant) {
    throw new Error("No tenant is bootstrapped yet.");
  }

  const apiKey = createApiKey();
  const record = {
    id: createId("key"),
    tenantId: tenant.id,
    name: name || "Browser dashboard key",
    prefix: apiKey.prefix,
    hash: apiKey.hash,
    status: "active",
    scopes: ["*"],
    createdAt: now(),
    lastUsedAt: null
  };

  state.apiKeys.push(record);
  await writeState(state);

  return {
    tenant,
    apiKey: apiKey.plainText,
    key: {
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      prefix: record.prefix,
      status: record.status,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt
    }
  };
}

export async function listTenantApiKeys(tenantId) {
  const state = await readState();
  return state.apiKeys
    .filter((item) => item.tenantId === tenantId)
    .map((item) => ({
      id: item.id,
      tenantId: item.tenantId,
      name: item.name,
      prefix: item.prefix,
      status: item.status,
      scopes: item.scopes || ["*"],
      createdAt: item.createdAt,
      lastUsedAt: item.lastUsedAt || null
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function revokeTenantApiKey(tenantId, keyId) {
  const state = await readState();
  const key = state.apiKeys.find((item) => item.tenantId === tenantId && item.id === keyId);

  if (!key) return null;

  key.status = "revoked";
  key.revokedAt = now();
  await writeState(state);

  return {
    id: key.id,
    tenantId: key.tenantId,
    name: key.name,
    prefix: key.prefix,
    status: key.status,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt || null,
    revokedAt: key.revokedAt
  };
}

export async function deleteTenantApiKey(tenantId, keyId) {
  const state = await readState();
  const idx = state.apiKeys.findIndex((k) => k.tenantId === tenantId && k.id === keyId);
  if (idx === -1) return null;
  const [removed] = state.apiKeys.splice(idx, 1);
  await writeState(state);
  return { id: removed.id, name: removed.name, prefix: removed.prefix };
}

export async function authenticateTenantApiKey(apiKeyValue) {
  if (!apiKeyValue) {
    return null;
  }

  const state = await readState();
  const keyRecord = state.apiKeys.find(
    (item) => item.status === "active" && verifyApiKey(apiKeyValue, item.hash)
  );

  if (!keyRecord) {
    return null;
  }

  keyRecord.lastUsedAt = now();
  await writeState(state);

  const tenant = state.tenants.find((item) => item.id === keyRecord.tenantId);
  return {
    tenant,
    apiKey: keyRecord
  };
}

export async function authenticateUser(email, password) {
  const state = await readState();
  const normalized = String(email || "").trim().toLowerCase();
  const user = state.users.find((item) => item.email.toLowerCase() === normalized);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  const tenant = state.tenants.find((item) => item.id === user.tenantId && item.status === "active");
  if (!tenant) return null;
  return { tenant, user: sanitizeUser(user) };
}

export async function createDashboardSession(tenantId, userId) {
  const state = await readState();
  if (!state.dashboardSessions) state.dashboardSessions = [];
  const token = createSessionToken();
  const session = {
    id: createId("dashsess"),
    tenantId,
    userId,
    tokenHash: token.hash,
    createdAt: now(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    revokedAt: null
  };
  state.dashboardSessions.push(session);
  await writeState(state);
  return { session, token: token.plainText };
}

export async function authenticateDashboardSession(token) {
  if (!token) return null;
  const state = await readState();
  const tokenHash = createHashForSession(token);
  const session = (state.dashboardSessions || []).find((item) =>
    item.tokenHash === tokenHash && !item.revokedAt && item.expiresAt > now()
  );
  if (!session) return null;
  const tenant = state.tenants.find((item) => item.id === session.tenantId && item.status === "active");
  const user = state.users.find((item) => item.id === session.userId && item.tenantId === session.tenantId);
  if (!tenant || !user) return null;
  return { tenant, user: sanitizeUser(user), session };
}

export async function revokeDashboardSession(token) {
  if (!token) return null;
  const state = await readState();
  const tokenHash = createHashForSession(token);
  const session = (state.dashboardSessions || []).find((item) => item.tokenHash === tokenHash && !item.revokedAt);
  if (!session) return null;
  session.revokedAt = now();
  await writeState(state);
  return session;
}

export async function setUserPassword({ tenantId, email, password }) {
  const state = await readState();
  const normalized = String(email || "").trim().toLowerCase();
  const user = state.users.find((item) =>
    (!tenantId || item.tenantId === tenantId) && item.email.toLowerCase() === normalized
  );
  if (!user) return null;
  user.passwordHash = hashPassword(password);
  await writeState(state);
  return sanitizeUser(user);
}

function createHashForSession(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sanitizeUser(user) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt
  };
}

export async function updateTenantPlan(tenantId, plan) {
  const state = await readState();
  const tenant = state.tenants.find(t => t.id === tenantId);
  if (!tenant) return null;
  tenant.plan = plan;
  await writeState(state);
  return { ...tenant };
}

export async function upsertSsoUser({ email, name }) {
  const state = await readState();
  const normalized = String(email || "").trim().toLowerCase();

  const existing = state.users.find(u => u.email.toLowerCase() === normalized);
  if (existing) {
    const tenant = state.tenants.find(t => t.id === existing.tenantId && t.status === "active");
    if (!tenant) return null;
    return { tenant, user: sanitizeUser(existing) };
  }

  // Resolve target tenant: explicit env var, or single-tenant shortcut
  const activeTenants = state.tenants.filter(t => t.status === "active");
  const defaultId = process.env.OIDC_DEFAULT_TENANT_ID;
  const tenant = defaultId
    ? activeTenants.find(t => t.id === defaultId)
    : activeTenants.length === 1 ? activeTenants[0] : null;
  if (!tenant) return null;

  const user = {
    id: createId("user"),
    tenantId: tenant.id,
    email: normalized,
    name: name || normalized,
    role: "member",
    passwordHash: null,
    createdAt: now()
  };
  state.users.push(user);
  await writeState(state);
  return { tenant, user: sanitizeUser(user) };
}

export async function listTenantContext(tenantId) {
  const state = await readState();
  return {
    tenant: state.tenants.find((item) => item.id === tenantId) || null,
    users: state.users.filter((item) => item.tenantId === tenantId),
    connectors: state.connectors
      .filter((item) => item.tenantId === tenantId)
      .map((c) => ({ ...c, config: decryptConnectorConfig(c.config) })),
    runs: state.runs.filter((item) => item.tenantId === tenantId)
  };
}

export async function upsertTenantRuns(tenantId, incomingRuns) {
  const state = await readState();
  const tenantRuns = state.runs.filter((item) => item.tenantId === tenantId);
  const byId = new Map(tenantRuns.map((item) => [item.id, item]));

  for (const run of incomingRuns) {
    byId.set(run.id, {
      ...run,
      tenantId
    });
  }

  state.runs = [
    ...state.runs.filter((item) => item.tenantId !== tenantId),
    ...Array.from(byId.values())
  ].sort((left, right) => right.startTime.localeCompare(left.startTime));

  await writeState(state);
  return state.runs.filter((item) => item.tenantId === tenantId);
}

export async function createConnector(tenantId, connector) {
  const state = await readState();
  const record = {
    id: createId("connector"),
    tenantId,
    status: "ready",
    createdAt: now(),
    ...connector,
    config: encryptConnectorConfig(connector.config || {})
  };
  state.connectors.push(record);
  await writeState(state);
  // Return with decrypted config so callers get the original value back
  return { ...record, config: decryptConnectorConfig(record.config) };
}

export async function resetTenantRuns(tenantId) {
  const state = await readState();
  state.runs = state.runs.filter((item) => item.tenantId !== tenantId);
  await writeState(state);
}

export async function resetPromptCaptures(tenantId) {
  const state = await readState();
  state.promptCaptures = (state.promptCaptures || []).filter((c) => c.tenantId !== tenantId);
  await writeState(state);
}

export async function applyDataRetention(daysToKeep) {
  if (!daysToKeep || daysToKeep <= 0) return { deletedRuns: 0, deletedCaptures: 0 };
  const cutoff = new Date(Date.now() - daysToKeep * 86400_000).toISOString();
  const state = await readState();
  const runsBefore = (state.runs || []).length;
  const capturesBefore = (state.promptCaptures || []).length;
  state.runs = (state.runs || []).filter((r) => (r.startTime || r.createdAt) >= cutoff);
  state.promptCaptures = (state.promptCaptures || []).filter((c) => (c.createdAt || "") >= cutoff);
  await writeState(state);
  return {
    deletedRuns: runsBefore - state.runs.length,
    deletedCaptures: capturesBefore - state.promptCaptures.length
  };
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function ensureSessions(state) {
  if (!state.sessions) state.sessions = [];
}

export async function createSession(tenantId, { sessionId, platform, startTime }) {
  const state = await readState();
  ensureSessions(state);

  const session = {
    id: sessionId || createId("sess"),
    tenantId,
    platform: platform || "generic",
    status: "running",
    startTime: startTime || now(),
    lastSeen: startTime || now(),
    endTime: null,
    costUsd: 0
  };
  state.sessions.push(session);
  await writeState(state);
  return session;
}

export async function updateSession(sessionId, { status, lastSeen, endTime, costDelta }) {
  const state = await readState();
  ensureSessions(state);

  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return null;

  if (status) session.status = status;
  if (lastSeen) session.lastSeen = lastSeen;
  if (endTime) session.endTime = endTime;
  if (typeof costDelta === "number") session.costUsd = (session.costUsd || 0) + costDelta;

  await writeState(state);
  return session;
}

export async function applySessionTimeout(timeoutMs) {
  const state = await readState();
  ensureSessions(state);

  const threshold = new Date(Date.now() - timeoutMs).toISOString();
  let changed = false;

  for (const session of state.sessions) {
    if (
      (session.status === "running" || session.status === "idle") &&
      session.lastSeen < threshold
    ) {
      session.status = "timed_out";
      changed = true;
    }
  }

  if (changed) await writeState(state);
  return state.sessions;
}

export async function listSessions(tenantId, { windowStart } = {}) {
  const state = await readState();
  ensureSessions(state);

  let sessions = state.sessions.filter((s) => s.tenantId === tenantId);
  if (windowStart) {
    sessions = sessions.filter(
      (s) => s.startTime >= windowStart || s.lastSeen >= windowStart
    );
  }
  return sessions;
}

export async function getActiveSessionCounts(tenantId) {
  const state = await readState();
  ensureSessions(state);

  const active = state.sessions.filter(
    (s) => s.tenantId === tenantId && (s.status === "running" || s.status === "idle")
  );

  const byPlatform = active.reduce((acc, s) => {
    acc[s.platform] = (acc[s.platform] || 0) + 1;
    return acc;
  }, {});

  return { total: active.length, byPlatform };
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

export async function logAuditEvent(tenantId, { actor, action, resource, details, ip }) {
  const state = await readState();
  if (!state.auditLogs) state.auditLogs = [];

  const tenantLogs = state.auditLogs.filter(l => l.tenantId === tenantId);
  const prevHash = tenantLogs.length > 0 ? tenantLogs[tenantLogs.length - 1].hash : "0".repeat(64);

  const timestamp = now();
  const id = createId("audit");
  const hashInput = `${prevHash}:${id}:${tenantId}:${actor}:${action}:${resource}:${timestamp}`;
  const hash = createHash("sha256").update(hashInput).digest("hex");

  const log = {
    id,
    tenantId,
    actor,
    action,
    resource,
    details: details || {},
    ip: ip || "unknown",
    timestamp,
    prevHash,
    hash
  };

  state.auditLogs.push(log);
  // Keep newest 500 — file store is dev/demo only; use Postgres for long-term retention
  if (state.auditLogs.length > 500) state.auditLogs = state.auditLogs.slice(-500);
  await writeState(state);
  return log;
}

export async function listAuditLogs(tenantId) {
  const state = await readState();
  if (!state.auditLogs) return [];
  
  return state.auditLogs
    .filter((log) => log.tenantId === tenantId)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export async function getPromptAnalysis(tenantId, runId) {
  const state = await readState();
  return (state.promptAnalyses || []).find(a => a.tenantId === tenantId && a.runId === runId) || null;
}

export async function savePromptAnalysis(tenantId, runId, promptHash, analysis) {
  const state = await readState();
  if (!state.promptAnalyses) state.promptAnalyses = [];
  const idx = state.promptAnalyses.findIndex(a => a.tenantId === tenantId && a.runId === runId);
  const record = { tenantId, runId, promptHash, ...analysis, analyzedAt: now() };
  if (idx >= 0) state.promptAnalyses[idx] = record;
  else state.promptAnalyses.push(record);
  await writeState(state);
  return record;
}

export async function listPromptAnalyses(tenantId) {
  const state = await readState();
  return (state.promptAnalyses || []).filter(a => a.tenantId === tenantId);
}

export async function savePromptCapture(tenantId, capture) {
  const state = await readState();
  if (!state.promptCaptures) state.promptCaptures = [];
  state.promptCaptures.push({ ...capture, tenantId });
  // Keep last 10k captures in file store to avoid unbounded growth
  if (state.promptCaptures.length > 10000) {
    state.promptCaptures = state.promptCaptures.slice(-10000);
  }
  await writeState(state);
  return capture;
}

export async function listPromptCaptures(tenantId, { limit = 100, offset = 0, taskType, model } = {}) {
  const state = await readState();
  let captures = (state.promptCaptures || []).filter(c => c.tenantId === tenantId);
  if (taskType) captures = captures.filter(c => c.taskType === taskType);
  if (model)    captures = captures.filter(c => c.model === model);
  captures = captures.slice().reverse(); // newest first
  return { captures: captures.slice(offset, offset + limit), total: captures.length };
}

export async function getModelFitnessStats(tenantId) {
  const state = await readState();
  const captures = (state.promptCaptures || []).filter(c => c.tenantId === tenantId);

  const fitnessBreakdown = Object.entries(
    captures.reduce((acc, c) => {
      const f = c.modelFitness || "unknown";
      if (!acc[f]) acc[f] = { model_fitness: f, count: 0, total_cost: 0 };
      acc[f].count++;
      acc[f].total_cost += Number(c.costUsd || 0);
      return acc;
    }, {})
  ).map(([, v]) => ({ model_fitness: v.model_fitness, count: v.count, avg_cost: v.count ? (v.total_cost / v.count).toFixed(4) : 0 }));

  const pairMap = {};
  for (const c of captures) {
    const key = `${c.taskType}|${c.model}`;
    if (!pairMap[key]) pairMap[key] = { task_type: c.taskType, model: c.model, count: 0, mismatches: 0 };
    pairMap[key].count++;
    if (c.modelFitness === "mismatch") pairMap[key].mismatches++;
  }
  const topTaskModelPairs = Object.values(pairMap).sort((a, b) => b.count - a.count).slice(0, 20);

  return { fitnessBreakdown, topTaskModelPairs };
}

// Auto-bootstraps a demo tenant + user when no tenant exists (file-store only).
// Mirrors the postgres-store version so demo login works on ephemeral deployments.
export async function ensureDemoUser({ email, password }) {
  const state = await readState();
  const normalized = String(email || "").trim().toLowerCase();
  const hash = hashPassword(password);

  // Find existing user
  const existing = state.users.find((u) => u.email.toLowerCase() === normalized);
  if (existing) {
    existing.passwordHash = hash;
    await writeState(state);
    return { id: existing.id, tenantId: existing.tenantId, email: existing.email, name: existing.name, role: existing.role };
  }

  // No tenant yet → auto-bootstrap a demo tenant so demo login always works
  let tenant = state.tenants.find((t) => t.status === "active");
  if (!tenant) {
    const tenantId = createId("tenant");
    const apiKey = createApiKey();
    tenant = {
      id: tenantId,
      name: "Demo Workspace",
      slug: "demo",
      plan: "free",
      status: "active",
      createdAt: now()
    };
    state.tenants.push(tenant);
    state.apiKeys.push({
      id: createId("key"),
      tenantId,
      name: "Demo key",
      prefix: apiKey.prefix,
      hash: apiKey.hash,
      status: "active",
      scopes: ["*"],
      createdAt: now(),
      lastUsedAt: null
    });
  }

  const userId = createId("user");
  const user = {
    id: userId,
    tenantId: tenant.id,
    email: normalized,
    name: "Demo User",
    role: "admin",
    passwordHash: hash,
    createdAt: now()
  };
  state.users.push(user);
  await writeState(state);
  return { id: userId, tenantId: tenant.id, email: normalized, name: "Demo User", role: "admin" };
}
