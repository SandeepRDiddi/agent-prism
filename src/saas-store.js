import { config } from "./config.js";

let backendPromise;

async function getBackend() {
  if (!backendPromise) {
    backendPromise =
      config.storageBackend === "postgres"
        ? import("./stores/postgres-store.js")
        : import("./stores/file-store.js");
  }

  return backendPromise;
}

export async function readState() {
  const backend = await getBackend();
  return backend.readState ? backend.readState() : null;
}

export async function writeState(state) {
  const backend = await getBackend();
  return backend.writeState ? backend.writeState(state) : null;
}

export async function getBootstrapStatus() {
  const backend = await getBackend();
  return backend.getBootstrapStatus();
}

export async function bootstrapSaas(payload) {
  const backend = await getBackend();
  return backend.bootstrapSaas(payload);
}

export async function createTenantApiKey(payload) {
  const backend = await getBackend();
  return backend.createTenantApiKey(payload);
}

export async function listTenantApiKeys(tenantId) {
  const backend = await getBackend();
  return backend.listTenantApiKeys ? backend.listTenantApiKeys(tenantId) : [];
}

export async function revokeTenantApiKey(tenantId, keyId) {
  const backend = await getBackend();
  return backend.revokeTenantApiKey ? backend.revokeTenantApiKey(tenantId, keyId) : null;
}

export async function deleteTenantApiKey(tenantId, keyId) {
  const backend = await getBackend();
  return backend.deleteTenantApiKey ? backend.deleteTenantApiKey(tenantId, keyId) : null;
}

export async function authenticateTenantApiKey(apiKeyValue) {
  const backend = await getBackend();
  return backend.authenticateTenantApiKey(apiKeyValue);
}

export async function authenticateUser(email, password) {
  const backend = await getBackend();
  return backend.authenticateUser ? backend.authenticateUser(email, password) : null;
}

export async function createDashboardSession(tenantId, userId) {
  const backend = await getBackend();
  return backend.createDashboardSession ? backend.createDashboardSession(tenantId, userId) : null;
}

export async function authenticateDashboardSession(token) {
  const backend = await getBackend();
  return backend.authenticateDashboardSession ? backend.authenticateDashboardSession(token) : null;
}

export async function revokeDashboardSession(token) {
  const backend = await getBackend();
  return backend.revokeDashboardSession ? backend.revokeDashboardSession(token) : null;
}

export async function setUserPassword({ tenantId, email, password }) {
  const backend = await getBackend();
  return backend.setUserPassword ? backend.setUserPassword({ tenantId, email, password }) : null;
}

export async function listTenantContext(tenantId) {
  const backend = await getBackend();
  return backend.listTenantContext(tenantId);
}

export async function upsertTenantRuns(tenantId, incomingRuns) {
  const backend = await getBackend();
  return backend.upsertTenantRuns(tenantId, incomingRuns);
}

export async function createConnector(tenantId, connector) {
  const backend = await getBackend();
  return backend.createConnector(tenantId, connector);
}

export async function resetTenantRuns(tenantId) {
  const backend = await getBackend();
  return backend.resetTenantRuns(tenantId);
}

export async function resetPromptCaptures(tenantId) {
  const backend = await getBackend();
  return backend.resetPromptCaptures ? backend.resetPromptCaptures(tenantId) : null;
}

export async function applyDataRetention(daysToKeep) {
  const backend = await getBackend();
  return backend.applyDataRetention ? backend.applyDataRetention(daysToKeep) : { deletedRuns: 0, deletedCaptures: 0 };
}

export async function createSession(tenantId, data) {
  const backend = await getBackend();
  return backend.createSession(tenantId, data);
}

export async function updateSession(sessionId, data) {
  const backend = await getBackend();
  return backend.updateSession(sessionId, data);
}

export async function applySessionTimeout(timeoutMs) {
  const backend = await getBackend();
  return backend.applySessionTimeout(timeoutMs);
}

export async function listSessions(tenantId, opts) {
  const backend = await getBackend();
  return backend.listSessions(tenantId, opts);
}

export async function getActiveSessionCounts(tenantId) {
  const backend = await getBackend();
  return backend.getActiveSessionCounts(tenantId);
}

export async function logAuditEvent(tenantId, data) {
  const backend = await getBackend();
  if (backend.logAuditEvent) {
    return backend.logAuditEvent(tenantId, data);
  }
}

export async function listAuditLogs(tenantId) {
  const backend = await getBackend();
  if (backend.listAuditLogs) {
    return backend.listAuditLogs(tenantId);
  }
  return [];
}

export async function getPromptAnalysis(tenantId, runId) {
  const backend = await getBackend();
  return backend.getPromptAnalysis ? backend.getPromptAnalysis(tenantId, runId) : null;
}

export async function savePromptAnalysis(tenantId, runId, promptHash, analysis) {
  const backend = await getBackend();
  return backend.savePromptAnalysis ? backend.savePromptAnalysis(tenantId, runId, promptHash, analysis) : null;
}

export async function listPromptAnalyses(tenantId) {
  const backend = await getBackend();
  return backend.listPromptAnalyses ? backend.listPromptAnalyses(tenantId) : [];
}

export async function savePromptCapture(tenantId, capture) {
  const backend = await getBackend();
  return backend.savePromptCapture ? backend.savePromptCapture(tenantId, capture) : null;
}

export async function listPromptCaptures(tenantId, opts) {
  const backend = await getBackend();
  return backend.listPromptCaptures ? backend.listPromptCaptures(tenantId, opts) : { captures: [], total: 0 };
}

export async function getModelFitnessStats(tenantId) {
  const backend = await getBackend();
  return backend.getModelFitnessStats ? backend.getModelFitnessStats(tenantId) : { fitnessBreakdown: [], topTaskModelPairs: [] };
}

export async function updateTenantPlan(tenantId, plan) {
  const backend = await getBackend();
  return backend.updateTenantPlan ? backend.updateTenantPlan(tenantId, plan) : null;
}

export async function pingDb() {
  const backend = await getBackend();
  return backend.pingDb ? backend.pingDb() : { ok: true, latencyMs: 0, note: "file backend — no DB" };
}

export async function getApiKeyStatus(keyId) {
  const backend = await getBackend();
  return backend.getApiKeyStatus ? backend.getApiKeyStatus(keyId) : "active";
}

export async function setApiKeyIpAllowlist(tenantId, keyId, ipList) {
  const backend = await getBackend();
  return backend.setApiKeyIpAllowlist ? backend.setApiKeyIpAllowlist(tenantId, keyId, ipList) : null;
}

export async function getApiKeyIpAllowlist(keyId) {
  const backend = await getBackend();
  return backend.getApiKeyIpAllowlist ? backend.getApiKeyIpAllowlist(keyId) : null;
}

export async function checkAndSetIdempotencyKey(tenantId, key, runId) {
  const backend = await getBackend();
  return backend.checkAndSetIdempotencyKey
    ? backend.checkAndSetIdempotencyKey(tenantId, key, runId)
    : { isDuplicate: false, runId };
}

export async function pruneIdempotencyKeys() {
  const backend = await getBackend();
  return backend.pruneIdempotencyKeys ? backend.pruneIdempotencyKeys() : 0;
}

export async function createRefreshToken(tenantId, apiKeyId) {
  const backend = await getBackend();
  return backend.createRefreshToken ? backend.createRefreshToken(tenantId, apiKeyId) : null;
}

export async function verifyAndRotateRefreshToken(plainToken) {
  const backend = await getBackend();
  return backend.verifyAndRotateRefreshToken ? backend.verifyAndRotateRefreshToken(plainToken) : null;
}

export async function revokeAllRefreshTokens(tenantId, apiKeyId) {
  const backend = await getBackend();
  return backend.revokeAllRefreshTokens ? backend.revokeAllRefreshTokens(tenantId, apiKeyId) : 0;
}

export async function saveFailedIngest(tenantId, source, payload, error) {
  const backend = await getBackend();
  return backend.saveFailedIngest ? backend.saveFailedIngest(tenantId, source, payload, error) : null;
}

export async function listPendingFailedIngests(limit) {
  const backend = await getBackend();
  return backend.listPendingFailedIngests ? backend.listPendingFailedIngests(limit) : [];
}

export async function markFailedIngestAttempt(id, opts) {
  const backend = await getBackend();
  return backend.markFailedIngestAttempt ? backend.markFailedIngestAttempt(id, opts) : null;
}

export async function upsertSsoUser({ email, name }) {
  const backend = await getBackend();
  return backend.upsertSsoUser ? backend.upsertSsoUser({ email, name }) : null;
}
