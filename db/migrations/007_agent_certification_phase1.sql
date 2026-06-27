-- 007_agent_certification_phase1.sql
-- Phase 1 of agent certification: tool manifest capture, danger classification,
-- agent registry, and enriched run columns.

BEGIN;

-- ── Extend agent_runs with certification fields ────────────────────────────────
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tool_manifest   JSONB        NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS human_approvals JSONB        NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS danger_score    NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS agent_tier      INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cert_status     TEXT         NOT NULL DEFAULT 'uncertified';

CREATE INDEX IF NOT EXISTS idx_agent_runs_tier      ON agent_runs (tenant_id, agent_tier DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_cert      ON agent_runs (tenant_id, cert_status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_danger    ON agent_runs (tenant_id, danger_score DESC);

-- ── Agent registry ─────────────────────────────────────────────────────────────
-- One row per unique agent per tenant. Upserted on each ingest.
-- declared_tier: developer self-declares in toolManifest payload.
-- computed_tier: platform derives from tools seen in runs.
-- effective_tier: MAX(declared, computed) — used for all gate decisions.
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

-- ── Tool manifest per agent ────────────────────────────────────────────────────
-- Every tool seen in any run for this agent. Upserted on each ingest.
-- danger_level: 0=none 1=low 2=medium 3=high 4=critical
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

-- ── RLS for new tables ─────────────────────────────────────────────────────────
ALTER TABLE agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tools       ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_definitions_select ON agent_definitions FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_definitions_insert ON agent_definitions FOR INSERT WITH CHECK (true);
CREATE POLICY agent_definitions_update ON agent_definitions FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_definitions_delete ON agent_definitions FOR DELETE USING (true);

CREATE POLICY agent_tools_select ON agent_tools FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_tools_insert ON agent_tools FOR INSERT WITH CHECK (true);
CREATE POLICY agent_tools_update ON agent_tools FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY agent_tools_delete ON agent_tools FOR DELETE USING (true);

COMMIT;
