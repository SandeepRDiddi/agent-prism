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

export async function authenticateTenantApiKey(apiKeyValue) {
  const backend = await getBackend();
  return backend.authenticateTenantApiKey(apiKeyValue);
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
