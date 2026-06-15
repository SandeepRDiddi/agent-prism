-- 006_enterprise_schema.sql
-- Enterprise hardening: idempotency keys, refresh tokens, failed ingest DLQ,
-- IP allowlist per API key, and missing dashboard performance indexes.

BEGIN;

-- ── Idempotency keys ──────────────────────────────────────────────────────────
-- Prevents duplicate ingest of the same run when webhooks retry.
-- 24-hour TTL enforced at the application layer via created_at.
CREATE TABLE idempotency_keys (
  key        TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key)
);

-- Allow periodic cleanup of expired keys (> 24h)
CREATE INDEX idx_idempotency_keys_expiry ON idempotency_keys (created_at);

-- ── OAuth refresh tokens ──────────────────────────────────────────────────────
-- Allows clients to get new access tokens without re-presenting API key.
CREATE TABLE refresh_tokens (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_tenant ON refresh_tokens (tenant_id, created_at DESC);

-- ── Failed ingest dead-letter queue ──────────────────────────────────────────
-- Stores runs that failed to persist (e.g. DB down during webhook).
-- A background job retries with exponential backoff (max 5 attempts).
CREATE TABLE failed_ingests (
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

-- Partial index — only pending/retrying rows need to be scanned by retry job
CREATE INDEX idx_failed_ingests_retry ON failed_ingests (next_retry_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX idx_failed_ingests_tenant ON failed_ingests (tenant_id, created_at DESC);

-- ── IP allowlist per API key ──────────────────────────────────────────────────
-- NULL = no restriction; non-null = only allow listed CIDRs/IPs.
ALTER TABLE api_keys ADD COLUMN ip_allowlist TEXT[] DEFAULT NULL;

-- ── Missing dashboard performance indexes ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_model
  ON agent_runs (tenant_id, model);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_status
  ON agent_runs (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_agent
  ON agent_runs (tenant_id, agent_name);

COMMIT;
