import { createApiKey, createId, createSessionToken, hashPassword, verifyApiKey, verifyPassword } from "../auth.js";
import { createHash } from "node:crypto";
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
    poolPromise = import("pg").then(({ Pool }) => new Pool({ connectionString: config.databaseUrl }));
  }

  return poolPromise;
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
    config: row.config || {},
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

export async function bootstrapSaas({ companyName, adminEmail, adminName, adminPassword }) {
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
      [tenantId, companyName, slug || tenantId, "enterprise-trial", "active", now()]
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
  const pool = await getPool();
  const [tenant, users, connectors, runs] = await Promise.all([
    pool.query("select * from tenants where id = $1", [tenantId]),
    pool.query("select * from users where tenant_id = $1 order by created_at asc", [tenantId]),
    pool.query("select * from connectors where tenant_id = $1 order by created_at asc", [tenantId]),
    pool.query("select * from agent_runs where tenant_id = $1 order by start_time desc", [tenantId])
  ]);

  return {
    tenant: mapTenant(tenant.rows[0]),
    users: users.rows.map(mapUser),
    connectors: connectors.rows.map(mapConnector),
    runs: runs.rows.map(mapRun)
  };
}

export async function upsertTenantRuns(tenantId, incomingRuns) {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

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
            tokens_in = excluded.tokens_in,
            tokens_out = excluded.tokens_out,
            user_prompt_tokens = excluded.user_prompt_tokens,
            system_prompt_tokens = excluded.system_prompt_tokens,
            context_tokens = excluded.context_tokens,
            tool_result_tokens = excluded.tool_result_tokens,
            memory_tokens = excluded.memory_tokens,
            cost_usd = excluded.cost_usd,
            budget_usd = excluded.budget_usd,
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

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const runs = await pool.query(
    "select * from agent_runs where tenant_id = $1 order by start_time desc",
    [tenantId]
  );
  return runs.rows.map(mapRun);
}

export async function createConnector(tenantId, connector) {
  const pool = await getPool();
  const record = {
    id: createId("connector"),
    tenantId,
    provider: connector.provider,
    name: connector.name,
    mode: connector.mode || "webhook",
    status: connector.status || "ready",
    config: connector.config || {},
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
      JSON.stringify(record.config),
      record.createdAt
    ]
  );

  return record;
}

export async function resetTenantRuns(tenantId) {
  const pool = await getPool();
  await pool.query("delete from agent_runs where tenant_id = $1", [tenantId]);
}

export async function logAuditEvent(tenantId, data) {
  const pool = await getPool();
  const id = createId("audit");
  const timestamp = data.timestamp || now();
  const actor = data.actor || "System";
  const action = data.action || "Unknown Action";
  const resource = data.resource || "Unknown Resource";
  const details = data.details || {};
  const ip = data.ip || "0.0.0.0";

  await pool.query(
    `insert into audit_logs (id, tenant_id, timestamp, actor, action, resource, details, ip_address) 
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [id, tenantId, timestamp, actor, action, resource, JSON.stringify(details), ip]
  );
  
  return { id, tenantId, timestamp, actor, action, resource, details, ip };
}

export async function listAuditLogs(tenantId) {
  const pool = await getPool();
  const result = await pool.query(
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
    ip: row.ip_address
  }));
}
