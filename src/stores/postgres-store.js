import { createApiKey, createId, createSessionToken, hashPassword, verifyApiKey, verifyPassword } from "../auth.js";
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
async function withTenant(tenantId, fn, isolation = "READ COMMITTED") {
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
    notes: row.notes || ""
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
            environment, workflow, team, tags, breadcrumbs, notes
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18,
            $19, $20,
            $21, $22, $23, $24, $25,
            $26, $27, $28, $29::jsonb, $30::jsonb, $31
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
            notes = excluded.notes
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
          run.notes || ""
        ]
      );
    }

    const runs = await client.query(
      "select * from agent_runs where tenant_id = $1 order by start_time desc",
      [tenantId]
    );
    return runs.rows.map(mapRun);
  });
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
