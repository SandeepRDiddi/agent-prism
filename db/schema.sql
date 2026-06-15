CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_tenant_email ON users (tenant_id, lower(email));

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE connectors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  latency_ms INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  user_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  system_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  context_tokens INTEGER NOT NULL DEFAULT 0,
  tool_result_tokens INTEGER NOT NULL DEFAULT 0,
  memory_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
  budget_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
  autonomy_level INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  policy_violations INTEGER NOT NULL DEFAULT 0,
  user_satisfaction INTEGER NOT NULL DEFAULT 0,
  environment TEXT NOT NULL,
  workflow TEXT NOT NULL,
  team TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  breadcrumbs JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_tenant_time ON agent_runs (tenant_id, start_time DESC);
CREATE INDEX idx_connectors_tenant ON connectors (tenant_id);
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT NOT NULL,
  hash TEXT NOT NULL DEFAULT '',
  prev_hash TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_audit_logs_tenant_time ON audit_logs (tenant_id, timestamp DESC);

CREATE TABLE dashboard_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_dashboard_sessions_token ON dashboard_sessions (token_hash);
CREATE INDEX idx_dashboard_sessions_tenant ON dashboard_sessions (tenant_id);

CREATE TABLE prompt_captures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id TEXT,
  provider TEXT NOT NULL DEFAULT 'unknown',
  model TEXT NOT NULL DEFAULT 'unknown',
  task_type TEXT NOT NULL DEFAULT 'general',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  model_fitness TEXT NOT NULL DEFAULT 'unknown',
  recommended_model TEXT NOT NULL DEFAULT '',
  pii_scrubbed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prompt_captures_tenant_time ON prompt_captures (tenant_id, created_at DESC);
CREATE INDEX idx_prompt_captures_model ON prompt_captures (tenant_id, model);
CREATE INDEX idx_prompt_captures_task ON prompt_captures (tenant_id, task_type);

-- ── Row-Level Security ─────────────────────────────────────────────────────────
-- Defense-in-depth tenant isolation at the DB engine layer.
-- The application sets app.current_tenant_id via withTenant() before each query.
-- Full policy set (SELECT/INSERT/UPDATE/DELETE) prevents default-deny blocking
-- writes if the app role has NOBYPASSRLS. To enforce at the app-role level:
--   ALTER ROLE <your_app_db_role> NOBYPASSRLS;

ALTER TABLE agent_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_runs_select ON agent_runs      FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_runs_insert ON agent_runs      FOR INSERT WITH CHECK (true);
CREATE POLICY agent_runs_update ON agent_runs      FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_runs_delete ON agent_runs      FOR DELETE USING (true);

CREATE POLICY connectors_select ON connectors      FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY connectors_insert ON connectors      FOR INSERT WITH CHECK (true);
CREATE POLICY connectors_update ON connectors      FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY connectors_delete ON connectors      FOR DELETE USING (true);

CREATE POLICY audit_logs_select ON audit_logs      FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY audit_logs_insert ON audit_logs      FOR INSERT WITH CHECK (true);
CREATE POLICY audit_logs_update ON audit_logs      FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY audit_logs_delete ON audit_logs      FOR DELETE USING (true);

CREATE POLICY prompt_captures_select ON prompt_captures FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY prompt_captures_insert ON prompt_captures FOR INSERT WITH CHECK (true);
CREATE POLICY prompt_captures_update ON prompt_captures FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY prompt_captures_delete ON prompt_captures FOR DELETE USING (true);

-- schema_migrations tracking table (used by db/migrate.js)
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT        PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
