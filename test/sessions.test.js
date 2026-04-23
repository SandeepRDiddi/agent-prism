/**
 * Integration tests for session registry using the file-store directly.
 * We point the store at a temp directory so tests don't touch production data.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Capture original cwd and redirect the file-store's data path via cwd override
let tempDir;
const originalCwd = process.cwd();

// We import file-store directly, bypassing saas-store, using a temp dir.
// The file-store derives its path from process.cwd() so we patch it for tests.
let store;

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "acp-test-"));
  // Override cwd for the duration of the test suite
  process.chdir(tempDir);
  // Create the data dir the store expects
  await mkdir(join(tempDir, "data"), { recursive: true });
  // Now import — module is loaded fresh because we haven't imported it yet
  store = await import("../src/stores/file-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

const TENANT = "tenant_test_001";

test("createSession: registers a new session with status running", async () => {
  const session = await store.createSession(TENANT, {
    sessionId: "sess_001",
    platform: "claude",
    startTime: new Date().toISOString()
  });
  assert.equal(session.id, "sess_001");
  assert.equal(session.platform, "claude");
  assert.equal(session.status, "running");
  assert.equal(session.tenantId, TENANT);
});

test("getActiveSessionCounts: counts running and idle sessions", async () => {
  await store.createSession(TENANT, { sessionId: "sess_002", platform: "copilot" });
  await store.createSession(TENANT, { sessionId: "sess_003", platform: "claude" });
  const counts = await store.getActiveSessionCounts(TENANT);
  assert.ok(counts.total >= 2, "should have at least 2 active sessions");
  assert.ok(counts.byPlatform.copilot >= 1);
  assert.ok(counts.byPlatform.claude >= 1);
});

test("updateSession: marks session completed", async () => {
  await store.createSession(TENANT, { sessionId: "sess_004", platform: "generic" });
  const updated = await store.updateSession("sess_004", { status: "completed", endTime: new Date().toISOString() });
  assert.equal(updated.status, "completed");
});

test("updateSession: returns null for unknown session ID", async () => {
  const result = await store.updateSession("nonexistent_id", { status: "completed" });
  assert.equal(result, null);
});

test("updateSession: accumulates costDelta", async () => {
  await store.createSession(TENANT, { sessionId: "sess_cost_1", platform: "claude" });
  await store.updateSession("sess_cost_1", { costDelta: 0.005 });
  await store.updateSession("sess_cost_1", { costDelta: 0.003 });
  const sessions = await store.listSessions(TENANT);
  const s = sessions.find((x) => x.id === "sess_cost_1");
  assert.ok(Math.abs(s.costUsd - 0.008) < 0.0001, `expected 0.008, got ${s.costUsd}`);
});

test("applySessionTimeout: marks stale sessions as timed_out", async () => {
  const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
  await store.createSession(TENANT, { sessionId: "sess_stale", platform: "claude", startTime: oldTime });
  // Manually set lastSeen to old time
  const state = await store.readState();
  const s = state.sessions.find((x) => x.id === "sess_stale");
  s.lastSeen = oldTime;
  await store.writeState(state);

  await store.applySessionTimeout(30 * 60 * 1000); // 30 min timeout
  const sessions = await store.listSessions(TENANT);
  const stale = sessions.find((x) => x.id === "sess_stale");
  assert.equal(stale.status, "timed_out");
});
