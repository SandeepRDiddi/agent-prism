import { createApiKey, createId, createSessionToken, hashPassword, verifyApiKey, verifyPassword } from "../auth.js";
import { inferAgentType } from "../certification/danger-classifier.js";
import { createHash, randomBytes } from "node:crypto";
import { encryptConnectorConfig, decryptConnectorConfig } from "../crypto.js";
import { config } from "../config.js";

let poolPromise;

function now() {
  return new Date().toISOString();
}

async function getPool() {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_BACKEND=postgres.");
  }

  if (!poolPromise) {
    poolPromise = import("pg").then(({ Pool }) => {
      const poolConfig = {
        connectionString: config.databaseUrl,
        max: config.db.max,
        min: config.db.min,
        idleTimeoutMillis: config.db.idleTimeoutMillis,
        connectionTimeoutMillis: config.db.connectionTimeoutMillis,
        // statement_timeout set at session level via options string; pg-native uses options
        options: `--statement_timeout=${config.db.statementTimeoutMs}`
      };

      // SSL: required for all managed Postgres providers
      if (config.db.ssl) {
        poolConfig.ssl = {
          // rejectUnauthorized=false is needed for some providers (Render, Neon) that use
          // self-signed or non-standard certs. Set DB_SSL_REJECT_UNAUTHORIZED=true for
          // providers with properly verifiable certs (RDS with cert bundle, etc.).
          rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true"
        };
      }

      const pool = new Pool(poolConfig);

      // Handle idle-client errors — without this, an error on an idle connection
      // emits an uncaught 'error' event and crashes the process.
      pool.on("error", (err) => {
        process.stderr.write(`[postgres-pool] Idle client error: ${err.message}\n`);
      });

      return pool;
    });
  }

  return poolPromise;
}

/**
 * Verify DB connectivity. Returns { ok: true, latencyMs } or { ok: false, error }.
 * Used by the health check endpoint.
 */
export async function pingDb() {
  const start = Date.now();
  try {
    const pool = await getPool();
    await pool.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err.message, latencyMs: Date.now() - start };
  }
}

/**
 * Idempotent schema patch — runs at startup to ensure all columns and tables
 * added by incremental migrations exist, even on DBs bootstrapped before
 * those migrations were written. Safe to run on an up-to-date DB.
 */
export async function ensureSchemaPatches() {
  const pool = await getPool();
  await pool.query(`
    -- migration 003: audit log hash chain
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS hash      TEXT NOT NULL DEFAULT '';
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT NOT NULL DEFAULT '';

    -- migration 006: IP allowlist on api_keys
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS ip_allowlist TEXT[] DEFAULT NULL;

    -- migration 006: idempotency keys
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key        TEXT NOT NULL,
      tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      run_id     TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expiry ON idempotency_keys (created_at);

    -- migration 006: OAuth refresh tokens
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         TEXT PRIMARY KEY,
      tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash   ON refresh_tokens (token_hash);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_tenant ON refresh_tokens (tenant_id, created_at DESC);

    -- migration 006: failed ingest dead-letter queue
    CREATE TABLE IF NOT EXISTS failed_ingests (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      source          TEXT NOT NULL,
      payload         JSONB NOT NULL,
      error           TEXT NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TIMESTAMPTZ,
      next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status          TEXT NOT NULL DEFAULT 'pending',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_failed_ingests_tenant ON failed_ingests (tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_failed_ingests_retry  ON failed_ingests (next_retry_at) WHERE status IN ('pending', 'retrying');

    -- migration 006: dashboard performance indexes
    CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_model  ON agent_runs (tenant_id, model);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_status ON agent_runs (tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_agent  ON agent_runs (tenant_id, agent_name);

    -- migration 007: agent certification phase 1
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tool_manifest   JSONB        NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS human_approvals JSONB        NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS danger_score    NUMERIC(6,2) NOT NULL DEFAULT 0;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS agent_tier      INTEGER      NOT NULL DEFAULT 0;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cert_status     TEXT         NOT NULL DEFAULT 'uncertified';

    CREATE INDEX IF NOT EXISTS idx_agent_runs_tier   ON agent_runs (tenant_id, agent_tier DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_cert   ON agent_runs (tenant_id, cert_status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_danger ON agent_runs (tenant_id, danger_score DESC);

    CREATE TABLE IF NOT EXISTS agent_definitions (
      id              TEXT        PRIMARY KEY,
      tenant_id       TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      agent_name      TEXT        NOT NULL,
      agent_type      TEXT        NOT NULL DEFAULT 'custom',
      declared_tier   INTEGER     NOT NULL DEFAULT 0,
      computed_tier   INTEGER     NOT NULL DEFAULT 0,
      effective_tier  INTEGER     NOT NULL DEFAULT 0,
      description     TEXT        NOT NULL DEFAULT '',
      owner_team      TEXT        NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, agent_name)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_definitions_tenant ON agent_definitions (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_agent_definitions_tier   ON agent_definitions (tenant_id, effective_tier DESC);

    CREATE TABLE IF NOT EXISTS agent_tools (
      id                  TEXT        PRIMARY KEY,
      agent_definition_id TEXT        NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
      tenant_id           TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      tool_name           TEXT        NOT NULL,
      tool_type           TEXT        NOT NULL DEFAULT 'function',
      danger_category     TEXT        NOT NULL DEFAULT 'unclassified',
      danger_level        INTEGER     NOT NULL DEFAULT 0,
      requires_hitl       BOOLEAN     NOT NULL DEFAULT FALSE,
      first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      run_count           INTEGER     NOT NULL DEFAULT 1,
      UNIQUE(agent_definition_id, tool_name)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tools_agent  ON agent_tools (agent_definition_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tools_danger ON agent_tools (tenant_id, danger_level DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_tools_hitl   ON agent_tools (tenant_id, requires_hitl) WHERE requires_hitl = TRUE;

    -- migration 008: agent certification phase 2
    CREATE TABLE IF NOT EXISTS agent_certifications (
      id                  TEXT         PRIMARY KEY,
      tenant_id           TEXT         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      agent_definition_id TEXT         NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
      environment         TEXT         NOT NULL,
      cert_status         TEXT         NOT NULL DEFAULT 'uncertified',
      effective_tier      INTEGER      NOT NULL DEFAULT 0,
      danger_score        NUMERIC(6,2) NOT NULL DEFAULT 0,
      hitl_coverage_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
      runs_evaluated      INTEGER      NOT NULL DEFAULT 0,
      runs_passed         INTEGER      NOT NULL DEFAULT 0,
      failure_reasons     JSONB        NOT NULL DEFAULT '[]'::jsonb,
      danger_flags        JSONB        NOT NULL DEFAULT '[]'::jsonb,
      hitl_gaps           JSONB        NOT NULL DEFAULT '[]'::jsonb,
      evaluated_at        TIMESTAMPTZ,
      certified_at        TIMESTAMPTZ,
      expires_at          TIMESTAMPTZ,
      revoked_at          TIMESTAMPTZ,
      revoke_reason       TEXT         NOT NULL DEFAULT '',
      evaluated_by        TEXT         NOT NULL DEFAULT 'system',
      certified_by        TEXT         NOT NULL DEFAULT 'system',
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, agent_definition_id, environment)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_certs_tenant_env ON agent_certifications (tenant_id, environment);
    CREATE INDEX IF NOT EXISTS idx_agent_certs_status     ON agent_certifications (tenant_id, cert_status);

    CREATE TABLE IF NOT EXISTS certification_checks (
      id               TEXT        PRIMARY KEY,
      certification_id TEXT        NOT NULL REFERENCES agent_certifications(id) ON DELETE CASCADE,
      tenant_id        TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      check_name       TEXT        NOT NULL,
      check_category   TEXT        NOT NULL,
      passed           BOOLEAN     NOT NULL,
      severity         TEXT        NOT NULL DEFAULT 'info',
      detail           TEXT        NOT NULL DEFAULT '',
      evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_cert_checks_cert ON certification_checks (certification_id);

    CREATE TABLE IF NOT EXISTS agent_promotions (
      id                  TEXT        PRIMARY KEY,
      tenant_id           TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      agent_definition_id TEXT        NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
      from_env            TEXT        NOT NULL,
      to_env              TEXT        NOT NULL,
      status              TEXT        NOT NULL DEFAULT 'pending',
      cert_snapshot       JSONB       NOT NULL DEFAULT '{}'::jsonb,
      blocking_checks     JSONB       NOT NULL DEFAULT '[]'::jsonb,
      requested_by        TEXT        NOT NULL,
      approved_by         TEXT        NOT NULL DEFAULT '',
      rejected_by         TEXT        NOT NULL DEFAULT '',
      reject_reason       TEXT        NOT NULL DEFAULT '',
      requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at         TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_promotions_tenant ON agent_promotions (tenant_id, status);

    CREATE TABLE IF NOT EXISTS hitl_approvals (
      id             TEXT        PRIMARY KEY,
      tenant_id      TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      run_id         TEXT        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      agent_name     TEXT        NOT NULL,
      step_name      TEXT        NOT NULL,
      tool_called    TEXT        NOT NULL DEFAULT '',
      action_summary TEXT        NOT NULL DEFAULT '',
      approved_by    TEXT        NOT NULL,
      approved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_hitl_approvals_run   ON hitl_approvals (run_id);
    CREATE INDEX IF NOT EXISTS idx_hitl_approvals_agent ON hitl_approvals (tenant_id, agent_name);

    -- migration 009: dashboard sessions (added with login feature — may be missing on old DBs)
    CREATE TABLE IF NOT EXISTS dashboard_sessions (
      id         TEXT        PRIMARY KEY,
      tenant_id  TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id    TEXT        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      token_hash TEXT        NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_token  ON dashboard_sessions (token_hash);
    CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_tenant ON dashboard_sessions (tenant_id);

    -- migration 009: password_hash column on users (added with login feature)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
  `);
  process.stderr.write("[schema] Startup patches verified\n");
}

const MAX_RUNS_PER_QUERY = parseInt(process.env.MAX_RUNS_PER_QUERY || "10000", 10);

/**
 * Execute fn(client) inside a transaction with app.current_tenant_id set.
 * This satisfies the RLS SELECT policies on agent_runs, connectors, audit_logs,
 * and prompt_captures. The config key is local to the transaction (reverts on
 * commit/rollback), so pooled connections never carry stale context.
 * @param {string} tenantId
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 * @param {"READ COMMITTED"|"REPEATABLE READ"|"SERIALIZABLE"} [isolation]
 */
const VALID_ISOLATION = new Set(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"]);

async function withTenant(tenantId, fn, isolation = "READ COMMITTED") {
  if (!VALID_ISOLATION.has(isolation)) throw new Error(`Invalid isolation level: ${isolation}`);
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [String(tenantId)]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function mapTenant(row) {
  return row
    ? {
        id: row.id,
        name: row.name,
        slug: row.slug,
        plan: row.plan,
        status: row.status,
        createdAt: row.created_at?.toISOString?.() || row.created_at
      }
    : null;
}

function mapUser(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at?.toISOString?.() || row.created_at
  };
}

function sanitizeUser(row) {
  return row
    ? {
        id: row.id,
        tenantId: row.tenant_id,
        email: row.email,
        name: row.name,
        role: row.role,
        createdAt: row.created_at?.toISOString?.() || row.created_at
      }
    : null;
}

function mapConnector(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    name: row.name,
    mode: row.mode,
    status: row.status,
    config: decryptConnectorConfig(row.config || {}),
    createdAt: row.created_at?.toISOString?.() || row.created_at
  };
}

function mapRun(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    source: row.source,
    agentName: row.agent_name,
    provider: row.provider,
    model: row.model,
    taskType: row.task_type,
    status: row.status,
    startTime: row.start_time?.toISOString?.() || row.start_time,
    endTime: row.end_time?.toISOString?.() || row.end_time,
    latencyMs: row.latency_ms,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    userPromptTokens: row.user_prompt_tokens || 0,
    systemPromptTokens: row.system_prompt_tokens || 0,
    contextTokens: row.context_tokens || 0,
    toolResultTokens: row.tool_result_tokens || 0,
    memoryTokens: row.memory_tokens || 0,
    costUsd: Number(row.cost_usd),
    budgetUsd: Number(row.budget_usd),
    autonomyLevel: row.autonomy_level,
    retryCount: row.retry_count,
    toolCalls: row.tool_calls,
    policyViolations: row.policy_violations,
    userSatisfaction: row.user_satisfaction,
    environment: row.environment,
    workflow: row.workflow,
    team: row.team,
    tags: row.tags || [],
    breadcrumbs: row.breadcrumbs || [],
    notes: row.notes || "",
    toolManifest: row.tool_manifest || [],
    humanApprovals: row.human_approvals || [],
    dangerScore: Number(row.danger_score || 0),
    agentTier: row.agent_tier || 0,
    certStatus: row.cert_status || "uncertified"
  };
}

export async function getBootstrapStatus() {
  const pool = await getPool();
  const result = await pool.query("select count(*)::int as count from tenants");
  return {
    bootstrapped: result.rows[0].count > 0,
    tenants: result.rows[0].count
  };
}

export async function bootstrapSaas({ companyName, adminEmail, adminName, adminPassword, plan = "free" }) {
  const pool = await getPool();
  const existing = await getBootstrapStatus();

  if (existing.bootstrapped) {
    throw new Error("Control plane is already bootstrapped.");
  }

  const client = await pool.connect();
  const tenantId = createId("tenant");
  const userId = createId("user");
  const apiKeyId = createId("key");
  const connectorId = createId("connector");
  const apiKey = createApiKey();
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  try {
    await client.query("begin");
    await client.query(
      "insert into tenants (id, name, slug, plan, status, created_at) values ($1, $2, $3, $4, $5, $6)",
      [tenantId, companyName, slug || tenantId, plan, "active", now()]
    );
    await client.query(
      "insert into users (id, tenant_id, email, name, role, password_hash, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [userId, tenantId, adminEmail, adminName || adminEmail, "owner", adminPassword ? hashPassword(adminPassword) : null, now()]
    );
    await client.query(
      "insert into api_keys (id, tenant_id, name, prefix, key_hash, status, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [apiKeyId, tenantId, "Default ingest key", apiKey.prefix, apiKey.hash, "active", now()]
    );
    await client.query(
      "insert into connectors (id, tenant_id, provider, name, mode, status, config, created_at) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)",
      [connectorId, tenantId, "github-copilot", "GitHub Copilot", "webhook", "ready", JSON.stringify({}), now()]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return {
    tenant: mapTenant({
      id: tenantId,
      name: companyName,
      slug: slug || tenantId,
      plan: "enterprise-trial",
      status: "active",
      created_at: now()
    }),
    user: {
      id: userId,
      tenantId,
      email: adminEmail,
      name: adminName || adminEmail,
      role: "owner",
      createdAt: now()
    },
    connector: {
      id: connectorId,
      tenantId,
      provider: "github-copilot",
      name: "GitHub Copilot",
      mode: "webhook",
      status: "ready",
      createdAt: now()
    },
    apiKey: apiKey.plainText
  };
}

export async function provisionTenant({ companyName, adminEmail, adminName, adminPassword, plan = "enterprise-trial" }) {
  const client = await (await getPool()).connect();
  const tenantId    = createId("tenant");
  const userId      = createId("user");
  const apiKeyId    = createId("key");
  const connectorId = createId("connector");
  const apiKey      = createApiKey();
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  try {
    await client.query("begin");
    await client.query(
      "insert into tenants (id, name, slug, plan, status, created_at) values ($1, $2, $3, $4, $5, $6)",
      [tenantId, companyName, slug || tenantId, plan, "active", now()]
    );
    await client.query(
      "insert into users (id, tenant_id, email, name, role, password_hash, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [userId, tenantId, adminEmail, adminName || adminEmail, "owner", adminPassword ? hashPassword(adminPassword) : null, now()]
    );
    await client.query(
      "insert into api_keys (id, tenant_id, name, prefix, key_hash, status, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [apiKeyId, tenantId, "Default ingest key", apiKey.prefix, apiKey.hash, "active", now()]
    );
    await client.query(
      "insert into connectors (id, tenant_id, provider, name, mode, status, config, created_at) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)",
      [connectorId, tenantId, "github-copilot", "GitHub Copilot", "webhook", "ready", JSON.stringify({}), now()]
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return {
    tenant: mapTenant({ id: tenantId, name: companyName, slug: slug || tenantId, plan, status: "active", created_at: now() }),
    user:   { id: userId, tenantId, email: adminEmail, name: adminName || adminEmail, role: "owner", createdAt: now() },
    apiKey: apiKey.plainText
  };
}

export async function listTenants() {
  const pool = await getPool();
  const result = await pool.query("select * from tenants order by created_at desc");
  return result.rows.map(mapTenant);
}

export async function createTenantApiKey({ tenantId, name } = {}) {
  const pool = await getPool();
  const tenantResult = tenantId
    ? await pool.query("select * from tenants where id = $1", [tenantId])
    : await pool.query("select * from tenants order by created_at asc limit 1");
  const tenant = tenantResult.rows[0];

  if (!tenant) {
    throw new Error("No tenant is bootstrapped yet.");
  }

  const apiKey = createApiKey();
  const keyId = createId("key");
  const keyName = name || "Browser dashboard key";
  const createdAt = now();

  await pool.query(
    "insert into api_keys (id, tenant_id, name, prefix, key_hash, status, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [keyId, tenant.id, keyName, apiKey.prefix, apiKey.hash, "active", createdAt]
  );

  return {
    tenant: mapTenant(tenant),
    apiKey: apiKey.plainText,
    key: {
      id: keyId,
      tenantId: tenant.id,
      name: keyName,
      prefix: apiKey.prefix,
      status: "active",
      createdAt,
      lastUsedAt: null
    }
  };
}

export async function listTenantApiKeys(tenantId) {
  const pool = await getPool();
  const result = await pool.query(
    "select id, tenant_id, name, prefix, status, created_at, last_used_at from api_keys where tenant_id = $1 order by created_at desc",
    [tenantId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    prefix: row.prefix,
    status: row.status,
    scopes: ["*"],
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    lastUsedAt: row.last_used_at?.toISOString?.() || row.last_used_at || null
  }));
}

export async function revokeTenantApiKey(tenantId, keyId) {
  const pool = await getPool();
  const result = await pool.query(
    "update api_keys set status = 'revoked' where tenant_id = $1 and id = $2 returning id, tenant_id, name, prefix, status, created_at, last_used_at",
    [tenantId, keyId]
  );
  const row = result.rows[0];

  if (!row) return null;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    prefix: row.prefix,
    status: row.status,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    lastUsedAt: row.last_used_at?.toISOString?.() || row.last_used_at || null
  };
}

export async function deleteTenantApiKey(tenantId, keyId) {
  const pool = await getPool();
  const result = await pool.query(
    "delete from api_keys where tenant_id = $1 and id = $2 returning id, name, prefix",
    [tenantId, keyId]
  );
  return result.rows[0] || null;
}

export async function deleteAllTenantApiKeys(tenantId, excludeKeyId) {
  const pool = await getPool();
  const result = await pool.query(
    "delete from api_keys where tenant_id = $1 and id != $2 returning id, name, prefix",
    [tenantId, excludeKeyId]
  );
  return result.rows;
}

export async function authenticateTenantApiKey(apiKeyValue) {
  if (!apiKeyValue) {
    return null;
  }

  const pool = await getPool();
  const prefix = apiKeyValue.slice(0, 12);
  const keys = await pool.query(
    "select * from api_keys where prefix = $1 and status = 'active'",
    [prefix]
  );
  const keyRecord = keys.rows.find((row) => verifyApiKey(apiKeyValue, row.key_hash));

  if (!keyRecord) {
    return null;
  }

  await pool.query("update api_keys set last_used_at = $2 where id = $1", [keyRecord.id, now()]);
  const tenant = await pool.query("select * from tenants where id = $1", [keyRecord.tenant_id]);

  return {
    tenant: mapTenant(tenant.rows[0]),
    apiKey: {
      id: keyRecord.id,
      tenantId: keyRecord.tenant_id,
      name: keyRecord.name,
      prefix: keyRecord.prefix,
      status: keyRecord.status,
      _ipAllowlist: keyRecord.ip_allowlist || null,
      createdAt: keyRecord.created_at?.toISOString?.() || keyRecord.created_at,
      lastUsedAt: keyRecord.last_used_at?.toISOString?.() || keyRecord.last_used_at
    }
  };
}

export async function authenticateUser(email, password) {
  const pool = await getPool();
  const normalized = String(email || "").trim().toLowerCase();
  const users = await pool.query("select * from users where lower(email) = $1", [normalized]);
  const user = users.rows.find((row) => verifyPassword(password, row.password_hash));
  if (!user) return null;

  const tenant = await pool.query("select * from tenants where id = $1 and status = 'active'", [user.tenant_id]);
  if (!tenant.rows[0]) return null;

  return {
    tenant: mapTenant(tenant.rows[0]),
    user: sanitizeUser(user)
  };
}

export async function createDashboardSession(tenantId, userId) {
  const pool = await getPool();
  const token = createSessionToken();
  const id = createId("dashsess");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await pool.query(
    "insert into dashboard_sessions (id, tenant_id, user_id, token_hash, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)",
    [id, tenantId, userId, token.hash, createdAt, expiresAt]
  );
  return {
    session: { id, tenantId, userId, createdAt, expiresAt, revokedAt: null },
    token: token.plainText
  };
}

export async function authenticateDashboardSession(tokenValue) {
  if (!tokenValue) return null;
  const pool = await getPool();
  const tokenHash = createSessionTokenHash(tokenValue);
  const result = await pool.query(
    `select
       s.id as session_id, s.tenant_id, s.user_id, s.created_at as session_created_at, s.expires_at,
       t.id as tenant_id, t.name as tenant_name, t.slug as tenant_slug, t.plan, t.status as tenant_status, t.created_at as tenant_created_at,
       u.id as user_id, u.email, u.name as user_name, u.role, u.created_at as user_created_at
     from dashboard_sessions s
     join tenants t on t.id = s.tenant_id
     join users u on u.id = s.user_id and u.tenant_id = s.tenant_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and t.status = 'active'
     limit 1`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    tenant: mapTenant({
      id: row.tenant_id,
      name: row.tenant_name,
      slug: row.tenant_slug,
      plan: row.plan,
      status: row.tenant_status,
      created_at: row.tenant_created_at
    }),
    user: {
      id: row.user_id,
      tenantId: row.tenant_id,
      email: row.email,
      name: row.user_name,
      role: row.role,
      createdAt: row.user_created_at?.toISOString?.() || row.user_created_at
    },
    session: {
      id: row.session_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      createdAt: row.session_created_at?.toISOString?.() || row.session_created_at,
      expiresAt: row.expires_at?.toISOString?.() || row.expires_at
    }
  };
}

export async function revokeDashboardSession(tokenValue) {
  if (!tokenValue) return null;
  const pool = await getPool();
  const tokenHash = createSessionTokenHash(tokenValue);
  const result = await pool.query(
    "update dashboard_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null returning id, tenant_id, user_id",
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function setUserPassword({ tenantId, email, password }) {
  const pool = await getPool();
  const normalized = String(email || "").trim().toLowerCase();
  const result = await pool.query(
    `update users
     set password_hash = $1
     where lower(email) = $2 and ($3::text is null or tenant_id = $3)
     returning id, tenant_id, email, name, role, created_at`,
    [hashPassword(password), normalized, tenantId || null]
  );
  return sanitizeUser(result.rows[0]);
}

export async function ensureDemoUser({ email, password }) {
  const pool = await getPool();
  const normalized = String(email || "").trim().toLowerCase();

  // Try update first
  const upd = await pool.query(
    `update users set password_hash = $1
     where lower(email) = $2
     returning id, tenant_id, email, name, role, created_at`,
    [hashPassword(password), normalized]
  );
  if (upd.rows[0]) {
    process.stderr.write(`[demo] Updated password for existing user: ${normalized}\n`);
    return sanitizeUser(upd.rows[0]);
  }

  // User doesn't exist — create them in the first active tenant
  const tenantRow = await pool.query(
    "select id from tenants where status = 'active' order by created_at limit 1"
  );
  if (!tenantRow.rows[0]) {
    process.stderr.write("[demo] No active tenant found — demo user not created\n");
    return null;
  }
  const tenantId = tenantRow.rows[0].id;
  const userId   = createId("usr");
  const now      = new Date().toISOString();
  const ins = await pool.query(
    `insert into users (id, tenant_id, email, name, role, password_hash, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (tenant_id, lower(email)) do update set password_hash = excluded.password_hash
     returning id, tenant_id, email, name, role, created_at`,
    [userId, tenantId, normalized, "Demo User", "owner", hashPassword(password), now]
  );
  process.stderr.write(`[demo] Created demo user: ${normalized} in tenant ${tenantId}\n`);
  return sanitizeUser(ins.rows[0]);
}

function createSessionTokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function listTenantContext(tenantId) {
  return withTenant(tenantId, async (client) => {
    const [tenant, users, connectors, runs] = await Promise.all([
      client.query("select * from tenants where id = $1", [tenantId]),
      client.query("select * from users where tenant_id = $1 order by created_at asc", [tenantId]),
      client.query("select * from connectors where tenant_id = $1 order by created_at asc", [tenantId]),
      client.query("select * from agent_runs where tenant_id = $1 order by start_time desc limit $2", [tenantId, MAX_RUNS_PER_QUERY])
    ]);

    return {
      tenant: mapTenant(tenant.rows[0]),
      users: users.rows.map(mapUser),
      connectors: connectors.rows.map(mapConnector),
      runs: runs.rows.map(mapRun)
    };
  }, "REPEATABLE READ");
}

export async function upsertTenantRuns(tenantId, incomingRuns) {
  return withTenant(tenantId, async (client) => {
    for (const run of incomingRuns) {
      await client.query(
        `
          insert into agent_runs (
            id, tenant_id, source, agent_name, provider, model, task_type, status,
            start_time, end_time, latency_ms, tokens_in, tokens_out,
            user_prompt_tokens, system_prompt_tokens, context_tokens, tool_result_tokens, memory_tokens,
            cost_usd, budget_usd,
            autonomy_level, retry_count, tool_calls, policy_violations, user_satisfaction,
            environment, workflow, team, tags, breadcrumbs, notes,
            tool_manifest, human_approvals, danger_score, agent_tier, cert_status
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18,
            $19, $20,
            $21, $22, $23, $24, $25,
            $26, $27, $28, $29::jsonb, $30::jsonb, $31,
            $32::jsonb, $33::jsonb, $34, $35, $36
          )
          on conflict (id) do update set
            tenant_id = excluded.tenant_id,
            source = excluded.source,
            agent_name = excluded.agent_name,
            provider = excluded.provider,
            model = excluded.model,
            task_type = excluded.task_type,
            status = excluded.status,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            latency_ms = excluded.latency_ms,
            tokens_in = CASE WHEN excluded.tokens_in IS NOT NULL AND excluded.tokens_in > 0 THEN excluded.tokens_in ELSE agent_runs.tokens_in END,
            tokens_out = CASE WHEN excluded.tokens_out IS NOT NULL AND excluded.tokens_out > 0 THEN excluded.tokens_out ELSE agent_runs.tokens_out END,
            user_prompt_tokens = CASE WHEN excluded.user_prompt_tokens IS NOT NULL AND excluded.user_prompt_tokens > 0 THEN excluded.user_prompt_tokens ELSE agent_runs.user_prompt_tokens END,
            system_prompt_tokens = CASE WHEN excluded.system_prompt_tokens IS NOT NULL AND excluded.system_prompt_tokens > 0 THEN excluded.system_prompt_tokens ELSE agent_runs.system_prompt_tokens END,
            context_tokens = CASE WHEN excluded.context_tokens IS NOT NULL AND excluded.context_tokens > 0 THEN excluded.context_tokens ELSE agent_runs.context_tokens END,
            tool_result_tokens = CASE WHEN excluded.tool_result_tokens IS NOT NULL AND excluded.tool_result_tokens > 0 THEN excluded.tool_result_tokens ELSE agent_runs.tool_result_tokens END,
            memory_tokens = CASE WHEN excluded.memory_tokens IS NOT NULL AND excluded.memory_tokens > 0 THEN excluded.memory_tokens ELSE agent_runs.memory_tokens END,
            cost_usd = CASE WHEN excluded.cost_usd IS NOT NULL AND excluded.cost_usd > 0 THEN excluded.cost_usd ELSE agent_runs.cost_usd END,
            budget_usd = CASE WHEN excluded.budget_usd IS NOT NULL AND excluded.budget_usd > 0 THEN excluded.budget_usd ELSE agent_runs.budget_usd END,
            autonomy_level = excluded.autonomy_level,
            retry_count = excluded.retry_count,
            tool_calls = excluded.tool_calls,
            policy_violations = excluded.policy_violations,
            user_satisfaction = excluded.user_satisfaction,
            environment = excluded.environment,
            workflow = excluded.workflow,
            team = excluded.team,
            tags = excluded.tags,
            breadcrumbs = excluded.breadcrumbs,
            notes = excluded.notes,
            tool_manifest = CASE WHEN jsonb_array_length(excluded.tool_manifest) > 0 THEN excluded.tool_manifest ELSE agent_runs.tool_manifest END,
            human_approvals = excluded.human_approvals,
            danger_score = CASE WHEN excluded.danger_score > 0 THEN excluded.danger_score ELSE agent_runs.danger_score END,
            agent_tier = CASE WHEN excluded.agent_tier > 0 THEN excluded.agent_tier ELSE agent_runs.agent_tier END,
            cert_status = excluded.cert_status
        `,
        [
          run.id,
          tenantId,
          run.source,
          run.agentName,
          run.provider,
          run.model,
          run.taskType,
          run.status,
          run.startTime,
          run.endTime,
          run.latencyMs,
          run.tokensIn,
          run.tokensOut,
          run.userPromptTokens || 0,
          run.systemPromptTokens || 0,
          run.contextTokens || 0,
          run.toolResultTokens || 0,
          run.memoryTokens || 0,
          run.costUsd,
          run.budgetUsd,
          run.autonomyLevel,
          run.retryCount,
          run.toolCalls,
          run.policyViolations,
          run.userSatisfaction,
          run.environment,
          run.workflow,
          run.team,
          JSON.stringify(run.tags || []),
          JSON.stringify(run.breadcrumbs || []),
          run.notes || "",
          JSON.stringify(run.toolManifest || []),
          JSON.stringify(run.humanApprovals || []),
          run.dangerScore || 0,
          run.agentTier || 0,
          run.certStatus || "uncertified"
        ]
      );

      // Upsert agent_definitions + agent_tools when a tool manifest is present
      if (run.toolManifest && run.toolManifest.length > 0) {
        await upsertAgentDefinition(client, tenantId, run);
      }
    }

    const runs = await client.query(
      "select * from agent_runs where tenant_id = $1 order by start_time desc",
      [tenantId]
    );
    return runs.rows.map(mapRun);
  });
}

async function upsertAgentDefinition(client, tenantId, run) {
  const agentType = inferAgentType(run.toolManifest || []);
  const computedTier = run.agentTier || 0;

  // Upsert agent_definitions — update computed_tier and effective_tier if tier increased
  const defResult = await client.query(
    `INSERT INTO agent_definitions
       (id, tenant_id, agent_name, agent_type, declared_tier, computed_tier, effective_tier, owner_team, updated_at)
     VALUES ($1, $2, $3, $4, 0, $5, $5, $6, NOW())
     ON CONFLICT (tenant_id, agent_name) DO UPDATE SET
       agent_type     = CASE WHEN agent_definitions.agent_type = 'custom' THEN excluded.agent_type ELSE agent_definitions.agent_type END,
       computed_tier  = GREATEST(agent_definitions.computed_tier, excluded.computed_tier),
       effective_tier = GREATEST(agent_definitions.declared_tier, GREATEST(agent_definitions.computed_tier, excluded.computed_tier)),
       owner_team     = CASE WHEN excluded.owner_team != '' THEN excluded.owner_team ELSE agent_definitions.owner_team END,
       updated_at     = NOW()
     RETURNING id`,
    [createId("agdef"), tenantId, run.agentName, agentType, computedTier, run.team || ""]
  );

  const agentDefId = defResult.rows[0].id;

  // Upsert each tool
  for (const tool of run.toolManifest) {
    await client.query(
      `INSERT INTO agent_tools
         (id, agent_definition_id, tenant_id, tool_name, tool_type, danger_category, danger_level, requires_hitl, last_seen_at, run_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 1)
       ON CONFLICT (agent_definition_id, tool_name) DO UPDATE SET
         danger_category = CASE WHEN excluded.danger_level > agent_tools.danger_level THEN excluded.danger_category ELSE agent_tools.danger_category END,
         danger_level    = GREATEST(agent_tools.danger_level, excluded.danger_level),
         requires_hitl   = agent_tools.requires_hitl OR excluded.requires_hitl,
         last_seen_at    = NOW(),
         run_count       = agent_tools.run_count + 1`,
      [
        createId("tool"),
        agentDefId,
        tenantId,
        tool.name,
        tool.type || "function",
        tool.dangerCategory || "unclassified",
        tool.dangerLevel || 0,
        tool.requiresHitl || false
      ]
    );
  }
}

export async function createConnector(tenantId, connector) {
  const pool = await getPool();
  const encryptedConfig = encryptConnectorConfig(connector.config || {});
  const record = {
    id: createId("connector"),
    tenantId,
    provider: connector.provider,
    name: connector.name,
    mode: connector.mode || "webhook",
    status: connector.status || "ready",
    config: encryptedConfig,
    createdAt: now()
  };

  await pool.query(
    "insert into connectors (id, tenant_id, provider, name, mode, status, config, created_at) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)",
    [
      record.id,
      record.tenantId,
      record.provider,
      record.name,
      record.mode,
      record.status,
      JSON.stringify(encryptedConfig),
      record.createdAt
    ]
  );

  // Return with decrypted config so callers get the original value back
  return { ...record, config: connector.config || {} };
}

export async function resetTenantRuns(tenantId) {
  return withTenant(tenantId, async (client) => {
    await client.query("delete from agent_runs where tenant_id = $1", [tenantId]);
  });
}

export async function resetPromptCaptures(tenantId) {
  const pool = await getPool();
  await pool.query("delete from prompt_captures where tenant_id = $1", [tenantId]);
}

export async function applyDataRetention(daysToKeep) {
  if (!daysToKeep || daysToKeep <= 0) return { deletedRuns: 0, deletedCaptures: 0 };
  const pool = await getPool();
  const [runs, captures] = await Promise.all([
    pool.query(
      "delete from agent_runs where start_time < NOW() - make_interval(days => $1) returning id",
      [daysToKeep]
    ),
    pool.query(
      "delete from prompt_captures where created_at < NOW() - make_interval(days => $1) returning id",
      [daysToKeep]
    )
  ]);
  return { deletedRuns: runs.rowCount, deletedCaptures: captures.rowCount };
}

export async function logAuditEvent(tenantId, data) {
  const id = createId("audit");
  const timestamp = data.timestamp || now();
  const actor = data.actor || "System";
  const action = data.action || "Unknown Action";
  const resource = data.resource || "Unknown Resource";
  const details = data.details || {};
  const ip = data.ip || "0.0.0.0";

  return withTenant(tenantId, async (client) => {
    const prev = await client.query(
      "select hash from audit_logs where tenant_id = $1 order by timestamp desc limit 1",
      [tenantId]
    );
    const prevHash = prev.rows[0]?.hash || "0".repeat(64);
    const hashInput = `${prevHash}:${id}:${tenantId}:${actor}:${action}:${resource}:${timestamp}`;
    const hash = createHash("sha256").update(hashInput).digest("hex");

    await client.query(
      `insert into audit_logs (id, tenant_id, timestamp, actor, action, resource, details, ip_address, hash, prev_hash)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [id, tenantId, timestamp, actor, action, resource, JSON.stringify(details), ip, hash, prevHash]
    );

    return { id, tenantId, timestamp, actor, action, resource, details, ip, hash, prevHash };
  });
}

export async function listAuditLogs(tenantId) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      "select * from audit_logs where tenant_id = $1 order by timestamp desc limit 100",
      [tenantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      timestamp: row.timestamp?.toISOString?.() || row.timestamp,
      actor: row.actor,
      action: row.action,
      resource: row.resource,
      details: row.details,
      ip: row.ip_address,
      hash: row.hash || "",
      prevHash: row.prev_hash || ""
    }));
  }, "REPEATABLE READ");
}

export async function savePromptCapture(tenantId, capture) {
  const pool = await getPool();
  await pool.query(
    `insert into prompt_captures (
      id, tenant_id, run_id, provider, model, task_type,
      messages, response, tokens_in, tokens_out, cost_usd, latency_ms,
      model_fitness, recommended_model, pii_scrubbed, created_at
    ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      capture.id, tenantId, capture.runId || null, capture.provider, capture.model,
      capture.taskType, JSON.stringify(capture.messages), JSON.stringify(capture.response),
      capture.tokensIn, capture.tokensOut, capture.costUsd, capture.latencyMs,
      capture.modelFitness, capture.recommendedModel, capture.piiScrubbed,
      capture.createdAt || now()
    ]
  );
  return capture;
}

export async function listPromptCaptures(tenantId, { limit = 100, offset = 0, taskType, model } = {}) {
  return withTenant(tenantId, async (client) => {
    const conditions = ["tenant_id = $1"];
    const params = [tenantId];
    let p = 2;

    if (taskType) { conditions.push(`task_type = $${p++}`); params.push(taskType); }
    if (model)    { conditions.push(`model = $${p++}`);     params.push(model); }

    const filterParams = params.slice();
    params.push(limit, offset);
    const result = await client.query(
      `select * from prompt_captures where ${conditions.join(" and ")}
       order by created_at desc limit $${p} offset $${p + 1}`,
      params
    );

    const countResult = await client.query(
      `select count(*)::int as total from prompt_captures where ${conditions.join(" and ")}`,
      filterParams
    );

    return {
      captures: result.rows.map(r => ({
        id: r.id, tenantId: r.tenant_id, runId: r.run_id,
        provider: r.provider, model: r.model, taskType: r.task_type,
        messages: r.messages, response: r.response,
        tokensIn: r.tokens_in, tokensOut: r.tokens_out,
        costUsd: Number(r.cost_usd), latencyMs: r.latency_ms,
        modelFitness: r.model_fitness, recommendedModel: r.recommended_model,
        piiScrubbed: r.pii_scrubbed, createdAt: r.created_at?.toISOString?.() || r.created_at
      })),
      total: countResult.rows[0]?.total || 0
    };
  }, "REPEATABLE READ");
}

export async function updateTenantPlan(tenantId, plan) {
  const pool = await getPool();
  const result = await pool.query(
    "update tenants set plan = $1 where id = $2 returning *",
    [plan, tenantId]
  );
  return result.rows[0] ? mapTenant(result.rows[0]) : null;
}

export async function getModelFitnessStats(tenantId) {
  return withTenant(tenantId, async (client) => {
    const [result, taskResult] = await Promise.all([
      client.query(
        `select model_fitness, count(*)::int as count, round(avg(cost_usd)::numeric, 4) as avg_cost
         from prompt_captures where tenant_id = $1
         group by model_fitness`,
        [tenantId]
      ),
      client.query(
        `select task_type, model, count(*)::int as count,
                sum(case when model_fitness = 'mismatch' then 1 else 0 end)::int as mismatches
         from prompt_captures where tenant_id = $1
         group by task_type, model order by count desc limit 20`,
        [tenantId]
      )
    ]);
    return {
      fitnessBreakdown: result.rows,
      topTaskModelPairs: taskResult.rows
    };
  }, "REPEATABLE READ");
}

// ── API key status lookup (for JWT revocation check) ─────────────────────────
export async function getApiKeyStatus(keyId) {
  if (!keyId) return null;
  const pool = await getPool();
  const result = await pool.query(
    "SELECT status FROM api_keys WHERE id = $1 LIMIT 1",
    [keyId]
  );
  return result.rows[0]?.status || null;
}

// ── IP allowlist management ────────────────────────────────────────────────────
export async function setApiKeyIpAllowlist(tenantId, keyId, ipList) {
  const pool = await getPool();
  const result = await pool.query(
    "UPDATE api_keys SET ip_allowlist = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id",
    [ipList && ipList.length > 0 ? ipList : null, keyId, tenantId]
  );
  return result.rows[0] || null;
}

export async function getApiKeyIpAllowlist(keyId) {
  const pool = await getPool();
  const result = await pool.query(
    "SELECT ip_allowlist FROM api_keys WHERE id = $1 LIMIT 1",
    [keyId]
  );
  return result.rows[0]?.ip_allowlist || null;
}

// ── Idempotency keys ──────────────────────────────────────────────────────────
/**
 * Atomic check-and-set. Returns { isDuplicate, runId }.
 * If key already exists → isDuplicate=true, runId=existing run ID.
 * If new → inserts row and returns isDuplicate=false.
 * TTL of 24h enforced by cleanup job — keys older than 24h are pruned.
 */
export async function checkAndSetIdempotencyKey(tenantId, key, runId) {
  const pool = await getPool();
  const result = await pool.query(
    `INSERT INTO idempotency_keys (tenant_id, key, run_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, key) DO NOTHING
     RETURNING run_id`,
    [tenantId, key, runId]
  );
  if (result.rowCount > 0) {
    return { isDuplicate: false, runId };
  }
  const existing = await pool.query(
    "SELECT run_id FROM idempotency_keys WHERE tenant_id = $1 AND key = $2",
    [tenantId, key]
  );
  return { isDuplicate: true, runId: existing.rows[0]?.run_id };
}

export async function pruneIdempotencyKeys() {
  const pool = await getPool();
  const result = await pool.query(
    "DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'"
  );
  return result.rowCount;
}

// ── OAuth refresh tokens ───────────────────────────────────────────────────────
export async function createRefreshToken(tenantId, apiKeyId) {
  const pool = await getPool();
  const id = createId("rft");
  const plainToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(plainToken).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  await pool.query(
    `INSERT INTO refresh_tokens (id, tenant_id, api_key_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, tenantId, apiKeyId, tokenHash, expiresAt]
  );
  return { id, plainToken, expiresAt };
}

export async function verifyAndRotateRefreshToken(plainToken) {
  if (!plainToken) return null;
  const pool = await getPool();
  const tokenHash = createHash("sha256").update(plainToken).digest("hex");
  const result = await pool.query(
    `SELECT rt.*, ak.status AS key_status, t.plan, t.status AS tenant_status
     FROM refresh_tokens rt
     JOIN api_keys ak ON ak.id = rt.api_key_id
     JOIN tenants t ON t.id = rt.tenant_id
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()
       AND ak.status = 'active'
       AND t.status = 'active'
     LIMIT 1`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) return null;

  // Rotate: revoke old, issue new
  await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1",
    [row.id]
  );
  const newToken = await createRefreshToken(row.tenant_id, row.api_key_id);
  return {
    tenantId: row.tenant_id,
    apiKeyId: row.api_key_id,
    plan: row.plan,
    newRefreshToken: newToken.plainToken,
    newRefreshExpiresAt: newToken.expiresAt
  };
}

export async function revokeAllRefreshTokens(tenantId, apiKeyId) {
  const pool = await getPool();
  const result = await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE tenant_id = $1 AND api_key_id = $2 AND revoked_at IS NULL",
    [tenantId, apiKeyId]
  );
  return result.rowCount;
}

// ── Failed ingest DLQ ─────────────────────────────────────────────────────────
export async function saveFailedIngest(tenantId, source, payload, error) {
  const pool = await getPool();
  const id = createId("dlq");
  await pool.query(
    `INSERT INTO failed_ingests (id, tenant_id, source, payload, error, next_retry_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, NOW() + INTERVAL '1 minute')`,
    [id, tenantId, source, JSON.stringify(payload), String(error).slice(0, 2000)]
  );
  return id;
}

export async function listPendingFailedIngests(limit = 50) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT * FROM failed_ingests
     WHERE status IN ('pending', 'retrying') AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function upsertSsoUser({ email, name }) {
  const pool = await getPool();
  const normalized = String(email || "").trim().toLowerCase();

  const existing = await pool.query(
    "SELECT u.*, t.id as tid FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE lower(u.email) = $1 AND t.status = 'active' LIMIT 1",
    [normalized]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    const tenant = await pool.query("SELECT * FROM tenants WHERE id = $1", [row.tenant_id]);
    return { tenant: mapTenant(tenant.rows[0]), user: sanitizeUser(row) };
  }

  // Resolve target tenant
  const defaultId = process.env.OIDC_DEFAULT_TENANT_ID;
  const tenantRes = defaultId
    ? await pool.query("SELECT * FROM tenants WHERE id = $1 AND status = 'active'", [defaultId])
    : await pool.query("SELECT * FROM tenants WHERE status = 'active' LIMIT 2");

  if (!tenantRes.rows[0] || (!defaultId && tenantRes.rows.length !== 1)) return null;
  const tenant = tenantRes.rows[0];

  const id = createId("user");
  await pool.query(
    "INSERT INTO users (id, tenant_id, email, name, role, created_at) VALUES ($1,$2,$3,$4,'member',NOW())",
    [id, tenant.id, normalized, name || normalized]
  );
  const newUser = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return { tenant: mapTenant(tenant), user: sanitizeUser(newUser.rows[0]) };
}

// ── Certification store ────────────────────────────────────────────────────────

export async function listAgentDefinitions(tenantId) {
  return withTenant(tenantId, async (client) => {
    const defs = await client.query(
      `SELECT ad.*,
              json_agg(at ORDER BY at.danger_level DESC) FILTER (WHERE at.id IS NOT NULL) AS tools,
              ac_staging.cert_status AS staging_cert,
              ac_prod.cert_status    AS prod_cert,
              ac_prod.expires_at     AS prod_cert_expires
       FROM agent_definitions ad
       LEFT JOIN agent_tools at ON at.agent_definition_id = ad.id
       LEFT JOIN agent_certifications ac_staging
              ON ac_staging.agent_definition_id = ad.id AND ac_staging.environment = 'staging'
       LEFT JOIN agent_certifications ac_prod
              ON ac_prod.agent_definition_id = ad.id    AND ac_prod.environment = 'production'
       WHERE ad.tenant_id = $1
       GROUP BY ad.id, ac_staging.cert_status, ac_prod.cert_status, ac_prod.expires_at
       ORDER BY ad.effective_tier DESC, ad.agent_name`,
      [tenantId]
    );
    return defs.rows.map(mapAgentDef);
  }, "REPEATABLE READ");
}

export async function getAgentDefinition(tenantId, agentName) {
  return withTenant(tenantId, async (client) => {
    const def = await client.query(
      `SELECT ad.*,
              json_agg(at ORDER BY at.danger_level DESC) FILTER (WHERE at.id IS NOT NULL) AS tools
       FROM agent_definitions ad
       LEFT JOIN agent_tools at ON at.agent_definition_id = ad.id
       WHERE ad.tenant_id = $1 AND ad.agent_name = $2
       GROUP BY ad.id`,
      [tenantId, agentName]
    );
    return def.rows[0] ? mapAgentDef(def.rows[0]) : null;
  }, "REPEATABLE READ");
}

export async function getAgentRunsForCert(tenantId, agentName) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT * FROM agent_runs WHERE tenant_id = $1 AND agent_name = $2 ORDER BY start_time DESC`,
      [tenantId, agentName]
    );
    return result.rows.map(mapRun);
  }, "REPEATABLE READ");
}

export async function saveCertification(tenantId, agentName, environment, evalResult, actor = "system") {
  const pool = await getPool();

  // Resolve agent_definition_id
  const defRow = await pool.query(
    "SELECT id FROM agent_definitions WHERE tenant_id = $1 AND agent_name = $2",
    [tenantId, agentName]
  );
  if (!defRow.rows[0]) {
    throw new Error(`Agent "${agentName}" not registered for this tenant.`);
  }
  const agentDefId = defRow.rows[0].id;
  const certId = createId("cert");
  const now_ = now();
  const certifiedAt = evalResult.status === "certified" ? now_ : null;
  const expiresAt = evalResult.status === "certified"
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  return withTenant(tenantId, async (client) => {
    // Upsert certification record
    const certRes = await client.query(
      `INSERT INTO agent_certifications
         (id, tenant_id, agent_definition_id, environment, cert_status, effective_tier,
          danger_score, hitl_coverage_pct, runs_evaluated, runs_passed,
          failure_reasons, danger_flags, hitl_gaps,
          evaluated_at, certified_at, expires_at,
          evaluated_by, certified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,
               $14,$15,$16,$17,$18)
       ON CONFLICT (tenant_id, agent_definition_id, environment) DO UPDATE SET
         cert_status       = excluded.cert_status,
         effective_tier    = excluded.effective_tier,
         danger_score      = excluded.danger_score,
         hitl_coverage_pct = excluded.hitl_coverage_pct,
         runs_evaluated    = excluded.runs_evaluated,
         runs_passed       = excluded.runs_passed,
         failure_reasons   = excluded.failure_reasons,
         danger_flags      = excluded.danger_flags,
         hitl_gaps         = excluded.hitl_gaps,
         evaluated_at      = excluded.evaluated_at,
         certified_at      = CASE WHEN excluded.cert_status = 'certified' THEN excluded.certified_at ELSE agent_certifications.certified_at END,
         expires_at        = excluded.expires_at,
         revoked_at        = NULL,
         revoke_reason     = '',
         evaluated_by      = excluded.evaluated_by,
         certified_by      = CASE WHEN excluded.cert_status = 'certified' THEN excluded.certified_by ELSE agent_certifications.certified_by END
       RETURNING id`,
      [
        certId, tenantId, agentDefId, environment,
        evalResult.status, evalResult.effectiveTier,
        evalResult.summary.dangerScore, evalResult.summary.hitlCoveragePct,
        evalResult.summary.runsEvaluated, evalResult.summary.runsPassed,
        JSON.stringify(evalResult.failureReasons || []),
        JSON.stringify(evalResult.dangerFlags || []),
        JSON.stringify(evalResult.hitlGaps || []),
        now_, certifiedAt, expiresAt, actor, actor
      ]
    );

    const savedCertId = certRes.rows[0].id;

    // Write check log entries
    for (const c of evalResult.checks || []) {
      await client.query(
        `INSERT INTO certification_checks
           (id, certification_id, tenant_id, check_name, check_category, passed, severity, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [createId("chk"), savedCertId, tenantId, c.name, c.category, c.passed, c.severity, c.detail]
      );
    }

    return getCertificationById(client, savedCertId);
  });
}

async function getCertificationById(client, certId) {
  const result = await client.query(
    `SELECT ac.*, ad.agent_name
     FROM agent_certifications ac
     JOIN agent_definitions ad ON ad.id = ac.agent_definition_id
     WHERE ac.id = $1`,
    [certId]
  );
  return result.rows[0] ? mapCert(result.rows[0]) : null;
}

export async function getCertification(tenantId, agentName, environment) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT ac.*, ad.agent_name
       FROM agent_certifications ac
       JOIN agent_definitions ad ON ad.id = ac.agent_definition_id
       WHERE ac.tenant_id = $1 AND ad.agent_name = $2 AND ac.environment = $3`,
      [tenantId, agentName, environment]
    );
    if (!result.rows[0]) return null;
    const cert = mapCert(result.rows[0]);
    const checks = await client.query(
      "SELECT * FROM certification_checks WHERE certification_id = $1 ORDER BY evaluated_at DESC",
      [result.rows[0].id]
    );
    cert.checks = checks.rows.map(mapCheck);
    return cert;
  }, "REPEATABLE READ");
}

export async function listCertifications(tenantId) {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT ac.*, ad.agent_name, ad.agent_type, ad.effective_tier
       FROM agent_certifications ac
       JOIN agent_definitions ad ON ad.id = ac.agent_definition_id
       WHERE ac.tenant_id = $1
       ORDER BY ad.agent_name, ac.environment`,
      [tenantId]
    );
    return result.rows.map(mapCert);
  }, "REPEATABLE READ");
}

export async function revokeCertification(tenantId, agentName, environment, reason, actor = "system") {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `UPDATE agent_certifications ac
       SET cert_status = 'revoked', revoked_at = NOW(), revoke_reason = $4
       FROM agent_definitions ad
       WHERE ac.agent_definition_id = ad.id
         AND ac.tenant_id = $1 AND ad.agent_name = $2 AND ac.environment = $3
       RETURNING ac.id`,
      [tenantId, agentName, environment, reason || "Manually revoked"]
    );
    return result.rows[0] || null;
  });
}

export async function createPromotion(tenantId, agentName, { fromEnv, toEnv, requestedBy, certSnapshot, blockingChecks }) {
  const pool = await getPool();
  const defRow = await pool.query(
    "SELECT id FROM agent_definitions WHERE tenant_id = $1 AND agent_name = $2",
    [tenantId, agentName]
  );
  if (!defRow.rows[0]) throw new Error(`Agent "${agentName}" not registered.`);

  const id = createId("promo");
  await pool.query(
    `INSERT INTO agent_promotions
       (id, tenant_id, agent_definition_id, from_env, to_env, status,
        cert_snapshot, blocking_checks, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
    [
      id, tenantId, defRow.rows[0].id, fromEnv, toEnv,
      blockingChecks && blockingChecks.length > 0 ? "rejected" : "approved",
      JSON.stringify(certSnapshot || {}),
      JSON.stringify(blockingChecks || []),
      requestedBy || "system"
    ]
  );
  return { id, agentName, fromEnv, toEnv, status: blockingChecks?.length > 0 ? "rejected" : "approved" };
}

function mapAgentDef(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentName: row.agent_name,
    agentType: row.agent_type,
    declaredTier: row.declared_tier,
    computedTier: row.computed_tier,
    effectiveTier: row.effective_tier,
    description: row.description || "",
    ownerTeam: row.owner_team || "",
    tools: (row.tools || []).filter(Boolean),
    stagingCert: row.staging_cert || "uncertified",
    prodCert: row.prod_cert || "uncertified",
    prodCertExpires: row.prod_cert_expires || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

function mapCert(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentName: row.agent_name,
    environment: row.environment,
    certStatus: row.cert_status,
    effectiveTier: row.effective_tier,
    dangerScore: Number(row.danger_score || 0),
    hitlCoveragePct: Number(row.hitl_coverage_pct || 0),
    runsEvaluated: row.runs_evaluated,
    runsPassed: row.runs_passed,
    failureReasons: row.failure_reasons || [],
    dangerFlags: row.danger_flags || [],
    hitlGaps: row.hitl_gaps || [],
    evaluatedAt: row.evaluated_at?.toISOString?.() || row.evaluated_at,
    certifiedAt: row.certified_at?.toISOString?.() || row.certified_at,
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at,
    revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at,
    revokeReason: row.revoke_reason || "",
    evaluatedBy: row.evaluated_by,
    certifiedBy: row.certified_by,
    createdAt: row.created_at?.toISOString?.() || row.created_at
  };
}

function mapCheck(row) {
  return {
    id: row.id,
    checkName: row.check_name,
    checkCategory: row.check_category,
    passed: row.passed,
    severity: row.severity,
    detail: row.detail,
    evaluatedAt: row.evaluated_at?.toISOString?.() || row.evaluated_at
  };
}

export async function markFailedIngestAttempt(id, { succeeded, error } = {}) {
  const pool = await getPool();
  if (succeeded) {
    await pool.query(
      "UPDATE failed_ingests SET status = 'done', last_attempt_at = NOW() WHERE id = $1",
      [id]
    );
    return;
  }
  // Exponential backoff: 1m, 5m, 25m, 2h, permanently failed after 5 attempts
  const result = await pool.query(
    "SELECT attempts FROM failed_ingests WHERE id = $1",
    [id]
  );
  const attempts = (result.rows[0]?.attempts || 0) + 1;
  const backoffMinutes = Math.min(Math.pow(5, attempts - 1), 120);
  const status = attempts >= 5 ? "failed" : "retrying";
  await pool.query(
    `UPDATE failed_ingests
     SET status = $1, attempts = $2, last_attempt_at = NOW(),
         next_retry_at = NOW() + ($3 * INTERVAL '1 minute'),
         error = $4
     WHERE id = $5`,
    [status, attempts, backoffMinutes, String(error || "").slice(0, 2000), id]
  );
}
