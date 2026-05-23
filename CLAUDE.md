# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run server (also: npm run dev)
npm test           # Run all tests: node --test test/*.test.js
node --test test/security.test.js   # Run a single test file
node real_demo_agent.js             # Run Claude gateway demo
node real_demo_openai_agent.js      # Run OpenAI gateway demo
node real_demo_copilot_agent.js     # Run Copilot telemetry demo
```

Copy `.env.example` to `.env` before first run. Set `STORAGE_BACKEND=postgres` and `DATABASE_URL` for Postgres; defaults to file-backed storage.

## Architecture

Single-process Node.js server (`server.js`, ~1300 lines). No framework — raw `node:http`. Routes are plain `if/else if` blocks dispatching on `req.method` + `req.url`. ESM throughout (`"type": "module"`).

### Key layers

**`server.js`** — HTTP entrypoint, auth middleware inline, all route handlers. Two auth gates: `requireAdmin` (header `X-Admin-Secret`) and `requireTenant` (Bearer or `X-API-Key` containing a tenant API key).

**`src/saas-store.js`** — Storage facade. Lazily imports either `src/stores/file-store.js` or `src/stores/postgres-store.js` based on `STORAGE_BACKEND`. All persistence goes through this interface.

**`src/store.js`** — In-memory analytics. `buildDashboardSnapshot` aggregates run data into dashboard metrics. `detectCostLeaks` flags over-budget/retry-heavy runs.

**`src/scoring.js`** — `computeControlScore(run)` produces a 0–100 blended score from success rate, budget efficiency, latency, autonomy, guardrails, and retry penalty.

**`src/connectors.js`** — Normalization. `normalizeClaudeRun`, `normalizeCopilotRun`, `normalizeGenericRun` map provider-specific payloads into a common agent run schema.

**`src/pricing.js`** — Token cost lookup table (cached, refreshed on stale).

**`src/cost/`** — Per-provider cost calculators (`claude.js`, `copilot.js`, `generic.js`).

**`src/middleware/`** — Standalone helpers: `cors.js`, `rate-limiter.js`, `security-headers.js`, `logger.js`.

**`public/app.js`** — Main dashboard SPA (~41KB). Calls `/api/dashboard`, `/api/runs`, `/api/leaks`, etc.

### Data flow for an agent run

1. Agent POSTs to `/v1/messages` (Claude gateway), `/v1/responses` (OpenAI gateway), or `/api/ingest` (generic).
2. Server proxies the request to the real provider (for gateways), captures response.
3. Provider-specific normalizer maps to common run schema.
4. `upsertTenantRuns` persists via the storage backend.
5. `buildDashboardSnapshot` re-aggregates on next `/api/dashboard` GET.

### Multi-tenancy

Bootstrap via `POST /api/bootstrap` (admin-only) creates a tenant + initial API key. Tenant API keys are prefixed `acp_`. `requireTenant` resolves the calling tenant from the key and scopes all data reads/writes to that tenant ID.

### Storage backends

- **File** (`data/app-state.json`): JSON blob, read-write on every mutation. Dev/demo only.
- **Postgres** (`db/schema.sql`): Full relational schema. Tables: `tenants`, `users`, `api_keys`, `connectors`, `agent_runs`, `sessions`, `audit_logs`.

### API surface

| Path | Auth | Purpose |
|------|------|---------|
| `POST /api/bootstrap` | Admin | Create tenant |
| `POST /api/admin/api-keys` | Admin | Issue browser key |
| `POST /v1/messages` | Tenant | Claude gateway proxy |
| `POST /v1/responses` | Tenant | OpenAI gateway proxy |
| `POST /api/ingest` | Tenant | Generic run ingest |
| `GET /api/dashboard` | Tenant | Aggregated analytics snapshot |
| `GET /api/runs` | Tenant | Raw run list |
| `GET /api/leaks` | Tenant | Cost leak signals |
| `POST /api/connectors` | Tenant | Save connector config |
| `GET /api/audit` | Tenant | Audit log |
| `GET /api/audit/export` | Tenant | CSV export |
| `POST /api/sessions` | Tenant | Record agent session |
| `GET /api/tenant` | Tenant | Workspace context |
| `POST /api/oauth/token` | Public | JWT issuance for SDK flows |
