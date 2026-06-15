-- Phase 1.4: Postgres Row-Level Security (RLS)
-- Defense-in-depth tenant isolation at the database engine level.
-- The application already filters every query with WHERE tenant_id = $N.
-- RLS adds a second guarantee: even if application code has a bug that omits
-- a filter, the DB engine will not return cross-tenant rows.
--
-- How the app integrates:
--   The application calls set_config('app.current_tenant_id', tenantId, true)
--   inside a transaction via the withTenant() helper before running any query.
--   'true' = local to transaction — the variable is cleared on commit/rollback,
--   so pooled connections never carry stale tenant context to the next caller.
--
-- Policy design (full set required for correctness):
--   SELECT: filtered by tenant — primary protection against cross-tenant leaks.
--   INSERT: WITH CHECK (true) — unrestricted; app supplies correct tenant_id and
--           the FK on tenants(id) prevents orphaned rows.
--   UPDATE: filtered by tenant — ensures updates only touch own rows.
--   DELETE: USING (true) — unrestricted; app WHERE clauses still apply and admin
--           retention jobs need to delete across tenants without tenant context.
--
-- Without the INSERT/UPDATE/DELETE policies, Postgres default-deny blocks ALL
-- writes when the role lacks BYPASSRLS. The full set avoids this when moving to
-- a strict role.
--
-- BYPASSRLS note:
--   If your DATABASE_URL connects as the table owner or a SUPERUSER, these
--   policies protect external direct-DB connections (analytics tools, BI connectors,
--   DB consoles) but not the application itself. To also enforce RLS for the
--   application role, run after migrating and validating withTenant() is wired up:
--     ALTER ROLE <your_app_db_role> NOBYPASSRLS;
--   All tenant-data paths use withTenant(), so reads and writes are safe.
--
-- Excluded tables: users, api_keys, dashboard_sessions, tenants.
--   Authentication flows must search across tenants (by email, key prefix)
--   before the tenant_id is known. These tables stay unprotected at the
--   DB layer but are only exposed through auth code paths.

ALTER TABLE agent_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_captures ENABLE ROW LEVEL SECURITY;

-- ── agent_runs ─────────────────────────────────────────────────────────────────

CREATE POLICY agent_runs_select ON agent_runs
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY agent_runs_insert ON agent_runs
  FOR INSERT WITH CHECK (true);

CREATE POLICY agent_runs_update ON agent_runs
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY agent_runs_delete ON agent_runs
  FOR DELETE USING (true);

-- ── connectors ─────────────────────────────────────────────────────────────────

CREATE POLICY connectors_select ON connectors
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY connectors_insert ON connectors
  FOR INSERT WITH CHECK (true);

CREATE POLICY connectors_update ON connectors
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY connectors_delete ON connectors
  FOR DELETE USING (true);

-- ── audit_logs ─────────────────────────────────────────────────────────────────

CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY audit_logs_update ON audit_logs
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY audit_logs_delete ON audit_logs
  FOR DELETE USING (true);

-- ── prompt_captures ────────────────────────────────────────────────────────────

CREATE POLICY prompt_captures_select ON prompt_captures
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY prompt_captures_insert ON prompt_captures
  FOR INSERT WITH CHECK (true);

CREATE POLICY prompt_captures_update ON prompt_captures
  FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY prompt_captures_delete ON prompt_captures
  FOR DELETE USING (true);
