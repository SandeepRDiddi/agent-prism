import { createApiKey, createId, verifyApiKey } from "../auth.js";
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

export async function bootstrapSaas({ companyName, adminEmail, adminName }) {
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
      "insert into users (id, tenant_id, email, name, role, created_at) values ($1, $2, $3, $4, $5, $6)",
      [userId, tenantId, adminEmail, adminName || adminEmail, "owner", now()]
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
            start_time, end_time, latency_ms, tokens_in, tokens_out, cost_usd, budget_usd,
            autonomy_level, retry_count, tool_calls, policy_violations, user_satisfaction,
            environment, workflow, team, tags, breadcrumbs, notes
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15,
            $16, $17, $18, $19, $20,
            $21, $22, $23, $24::jsonb, $25::jsonb, $26
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
