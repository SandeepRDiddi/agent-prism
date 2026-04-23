import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApiKey, createId, verifyApiKey } from "../auth.js";

const dataDir = join(process.cwd(), "data");
const appStatePath = join(dataDir, "app-state.json");

const emptyState = {
  tenants: [],
  users: [],
  apiKeys: [],
  connectors: [],
  runs: [],
  sessions: []
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
  return JSON.parse(raw);
}

export async function writeState(state) {
  await writeFile(appStatePath, JSON.stringify(state, null, 2), "utf8");
}

export async function getBootstrapStatus() {
  const state = await readState();
  return {
    bootstrapped: state.tenants.length > 0,
    tenants: state.tenants.length
  };
}

export async function bootstrapSaas({ companyName, adminEmail, adminName }) {
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
    plan: "enterprise-trial",
    status: "active",
    createdAt: now()
  };

  const user = {
    id: userId,
    tenantId,
    email: adminEmail,
    name: adminName || adminEmail,
    role: "owner",
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

export async function listTenantContext(tenantId) {
  const state = await readState();
  return {
    tenant: state.tenants.find((item) => item.id === tenantId) || null,
    users: state.users.filter((item) => item.tenantId === tenantId),
    connectors: state.connectors.filter((item) => item.tenantId === tenantId),
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
    ...connector
  };
  state.connectors.push(record);
  await writeState(state);
  return record;
}

export async function resetTenantRuns(tenantId) {
  const state = await readState();
  state.runs = state.runs.filter((item) => item.tenantId !== tenantId);
  await writeState(state);
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
