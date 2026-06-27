-- 008_agent_certification_phase2.sql
-- Certification engine tables: cert records, check log, promotion requests, HITL audit.

BEGIN;

-- ── Certification records ──────────────────────────────────────────────────────
-- One row per agent per environment per tenant. Replaced on each evaluation.
-- cert_status: uncertified | pending | certified | revoked
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

CREATE INDEX IF NOT EXISTS idx_agent_certs_tenant_env  ON agent_certifications (tenant_id, environment);
CREATE INDEX IF NOT EXISTS idx_agent_certs_status      ON agent_certifications (tenant_id, cert_status);
CREATE INDEX IF NOT EXISTS idx_agent_certs_agent       ON agent_certifications (agent_definition_id);
CREATE INDEX IF NOT EXISTS idx_agent_certs_expires     ON agent_certifications (expires_at) WHERE cert_status = 'certified';

-- ── Certification check log ────────────────────────────────────────────────────
-- Granular pass/fail per check per evaluation. Immutable audit trail.
CREATE TABLE IF NOT EXISTS certification_checks (
  id                TEXT        PRIMARY KEY,
  certification_id  TEXT        NOT NULL REFERENCES agent_certifications(id) ON DELETE CASCADE,
  tenant_id         TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_name        TEXT        NOT NULL,
  check_category    TEXT        NOT NULL,
  passed            BOOLEAN     NOT NULL,
  severity          TEXT        NOT NULL DEFAULT 'info',
  detail            TEXT        NOT NULL DEFAULT '',
  evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_checks_cert    ON certification_checks (certification_id);
CREATE INDEX IF NOT EXISTS idx_cert_checks_tenant  ON certification_checks (tenant_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cert_checks_fail    ON certification_checks (tenant_id, passed) WHERE passed = FALSE;

-- ── Promotion requests ─────────────────────────────────────────────────────────
-- Immutable log of staging→prod promotion lifecycle.
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

CREATE INDEX IF NOT EXISTS idx_promotions_tenant   ON agent_promotions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_promotions_agent    ON agent_promotions (agent_definition_id, requested_at DESC);

-- ── HITL approval records ──────────────────────────────────────────────────────
-- Human approvals per run — also stored in agent_runs.human_approvals JSONB
-- but indexed here for coverage queries.
CREATE TABLE IF NOT EXISTS hitl_approvals (
  id              TEXT        PRIMARY KEY,
  tenant_id       TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id          TEXT        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_name      TEXT        NOT NULL,
  step_name       TEXT        NOT NULL,
  tool_called     TEXT        NOT NULL DEFAULT '',
  action_summary  TEXT        NOT NULL DEFAULT '',
  approved_by     TEXT        NOT NULL,
  approved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hitl_approvals_run    ON hitl_approvals (run_id);
CREATE INDEX IF NOT EXISTS idx_hitl_approvals_agent  ON hitl_approvals (tenant_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_hitl_approvals_time   ON hitl_approvals (tenant_id, approved_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE agent_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_promotions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitl_approvals       ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_certs_select ON agent_certifications FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_certs_insert ON agent_certifications FOR INSERT WITH CHECK (true);
CREATE POLICY agent_certs_update ON agent_certifications FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_certs_delete ON agent_certifications FOR DELETE USING (true);

CREATE POLICY cert_checks_select ON certification_checks FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY cert_checks_insert ON certification_checks FOR INSERT WITH CHECK (true);
CREATE POLICY cert_checks_update ON certification_checks FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY cert_checks_delete ON certification_checks FOR DELETE USING (true);

CREATE POLICY agent_promo_select ON agent_promotions FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_promo_insert ON agent_promotions FOR INSERT WITH CHECK (true);
CREATE POLICY agent_promo_update ON agent_promotions FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_promo_delete ON agent_promotions FOR DELETE USING (true);

CREATE POLICY hitl_select ON hitl_approvals FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY hitl_insert ON hitl_approvals FOR INSERT WITH CHECK (true);
CREATE POLICY hitl_update ON hitl_approvals FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY hitl_delete ON hitl_approvals FOR DELETE USING (true);

COMMIT;
