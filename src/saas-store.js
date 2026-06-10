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
