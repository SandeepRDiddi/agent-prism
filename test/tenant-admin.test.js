import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempDir;
const originalCwd = process.cwd();
let store;

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "acp-tenant-admin-"));
  process.chdir(tempDir);
  await mkdir(join(tempDir, "data"), { recursive: true });
  store = await import("../src/stores/file-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

test("tenant api keys can be listed and revoked without exposing hashes", async () => {
  const boot = await store.bootstrapSaas({
    companyName: "Example Co",
    adminEmail: "owner@example.com",
    adminName: "Owner"
  });
  const created = await store.createTenantApiKey({
    tenantId: boot.tenant.id,
    name: "Demo key"
  });

  const keys = await store.listTenantApiKeys(boot.tenant.id);
  const demoKey = keys.find((key) => key.id === created.key.id);

  assert.ok(demoKey);
  assert.equal(demoKey.name, "Demo key");
  assert.equal(demoKey.hash, undefined);
  assert.equal(demoKey.key_hash, undefined);

  const revoked = await store.revokeTenantApiKey(boot.tenant.id, created.key.id);
  assert.equal(revoked.status, "revoked");

  const afterRevoke = await store.listTenantApiKeys(boot.tenant.id);
  assert.equal(afterRevoke.find((key) => key.id === created.key.id).status, "revoked");
});
