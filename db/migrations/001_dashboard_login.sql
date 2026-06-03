ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email
ON users (tenant_id, lower(email));

CREATE TABLE IF NOT EXISTS dashboard_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_token
ON dashboard_sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_tenant
ON dashboard_sessions (tenant_id);
