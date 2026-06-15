-- 005_rls_auth_tables.sql
-- Row-Level Security on users, api_keys, and dashboard_sessions.
--
-- Auth lookups (authenticateTenantApiKey by prefix, authenticateUser by email,
-- authenticateDashboardSession by token hash) run without a tenant context and
-- must see all rows to find the matching record. RLS policies therefore PERMIT
-- SELECT when app.current_tenant_id is unset (returns '' via missing_ok=true),
-- and restrict to the calling tenant when context is set (via withTenant()).
--
-- All write paths include tenant_id in the VALUES clause or FK constraint, so
-- INSERT/UPDATE/DELETE policies are unrestricted — the application enforces
-- correct tenant scoping before reaching the DB.

BEGIN;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_sessions ENABLE ROW LEVEL SECURITY;

-- FORCE RLS so even the table owner (app DB user) is subject to policies.
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE dashboard_sessions FORCE ROW LEVEL SECURITY;

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE POLICY users_select ON users
  FOR SELECT USING (
    current_setting('app.current_tenant_id', true) = ''
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (true);

CREATE POLICY users_update ON users
  FOR UPDATE USING (
    current_setting('app.current_tenant_id', true) = ''
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY users_delete ON users
  FOR DELETE USING (true);

-- ── api_keys ──────────────────────────────────────────────────────────────────
CREATE POLICY api_keys_select ON api_keys
  FOR SELECT USING (
    current_setting('app.current_tenant_id', true) = ''
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY api_keys_insert ON api_keys
  FOR INSERT WITH CHECK (true);

CREATE POLICY api_keys_update ON api_keys
  FOR UPDATE USING (
    current_setting('app.current_tenant_id', true) = ''
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY api_keys_delete ON api_keys
  FOR DELETE USING (true);

-- ── dashboard_sessions ────────────────────────────────────────────────────────
CREATE POLICY dashboard_sessions_select ON dashboard_sessions
  FOR SELECT USING (
    current_setting('app.current_tenant_id', true) = ''
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY dashboard_sessions_insert ON dashboard_sessions
  FOR INSERT WITH CHECK (true);

CREATE POLICY dashboard_sessions_update ON dashboard_sessions
  FOR UPDATE USING (
    current_setting('app.current_tenant_id', true) = ''
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY dashboard_sessions_delete ON dashboard_sessions
  FOR DELETE USING (true);

COMMIT;
