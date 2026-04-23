## Context

Agent-Prism is currently a static/Next.js marketing site presenting AI sales storylines. There is no backend, no data pipeline, and no real-time capability. This design introduces the first live data layer: a telemetry ingest + aggregation service that tracks agent sessions across AI platforms and surfaces cost and ROI metrics in a new dashboard page.

The system must work for a single operator (the repo owner) who connects their own API keys. Multi-tenant SaaS is explicitly out of scope for this phase. The dashboard is the primary consumer of all metrics.

## Goals / Non-Goals

**Goals:**
- Track active and historical agent sessions across Claude, GitHub Copilot, and an extensible generic ingest
- Compute real-time cost per session and cumulative cost per platform
- Convert agent activity into FTE-equivalent hours and compare against a configurable loaded FTE cost rate
- Display live agent count, cost burn, FTE equivalent, and ROI delta in a dashboard page
- Keep the architecture as simple as possible: no message queues, no heavy ORMs in v1

**Non-Goals:**
- Multi-tenant / multi-user support (single operator only)
- Per-repository or per-project cost breakdown in v1
- Historical analytics beyond a rolling 30-day window in v1
- Native integrations beyond Claude and Copilot in v1 (generic webhook covers the rest)
- Billing or invoicing features

## Decisions

### 1. Persistence: SQLite via Turso (libSQL) over Postgres or a hosted OLAP store

**Decision**: Use a single SQLite file (local dev) with Turso's libSQL for production — zero infra, edge-compatible, no connection pooling complexity.

**Rationale**: The data volume is tiny (one row per agent event, ~hundreds/day). SQLite is sufficient, and Turso makes it deployable without a managed DB. Postgres introduces operational overhead that isn't justified at this scale.

**Alternative considered**: Planetscale MySQL — more familiar but higher cost and complexity for a single-operator tool.

### 2. Backend: Next.js API Routes (same repo) over a separate service

**Decision**: All backend logic lives in `app/api/` as Next.js Route Handlers. No separate microservice.

**Rationale**: The project is already a Next.js site. Adding API routes avoids a separate deploy target, keeps secrets co-located, and allows Vercel deployment without additional infrastructure.

**Alternative considered**: A separate Hono/Bun service — cleaner separation but doubles deployment complexity for negligible benefit at this scale.

### 3. Real-time updates: Server-Sent Events (SSE) over WebSockets or polling

**Decision**: Dashboard polls a `/api/metrics/summary` endpoint every 5 seconds via SSE or simple interval fetch. Start with interval fetch; upgrade to SSE if latency becomes a UX issue.

**Rationale**: SSE is simpler than WebSockets (no upgrade handshake, works through Vercel's edge network). Polling every 5s is adequate for a cost dashboard — sub-second updates provide no meaningful value.

### 4. Platform cost models: static rate config file over dynamic API-fetched pricing

**Decision**: Platform pricing (e.g., Claude token costs, Copilot seat price) is stored in a `config/pricing.yaml` file checked into the repo. Operators update it when pricing changes.

**Rationale**: Pricing APIs are not consistently available, and pricing changes infrequently. A static config is transparent, auditable, and requires no additional API calls at runtime.

### 5. FTE equivalence model: configurable hours-per-task with a loaded rate

**Decision**: ROI is computed as: `FTE_savings = agent_tasks_completed × avg_human_hours_per_task × loaded_hourly_rate`. Both `avg_human_hours_per_task` and `loaded_hourly_rate` are operator-configured inputs (stored in the same `pricing.yaml`).

**Rationale**: There is no universal formula for "how long would a human take." Giving operators control over the assumption makes the ROI figure defensible in their context.

## Risks / Trade-offs

- **API availability**: Claude and Copilot usage APIs may have rate limits or data delays → Mitigation: cache last-known values, surface staleness timestamp in UI
- **Clock skew on agent sessions**: If agents do not emit an explicit "stop" event, sessions may appear perpetually active → Mitigation: implement a session timeout (configurable, default 30 min of inactivity marks session idle)
- **SQLite write contention**: Concurrent ingest webhooks could hit SQLite write lock → Mitigation: use WAL mode; acceptable at low volume; document as a known limit for high-frequency use
- **Pricing config drift**: Static pricing.yaml goes stale when vendors change rates → Mitigation: add a last-verified date field and surface a warning in the UI if it is > 90 days old
- **FTE model subjectivity**: The ROI number is only as good as the operator's inputs → Mitigation: display the assumption inputs alongside the ROI figure so stakeholders can interrogate the model

## Migration Plan

1. Add SQLite schema migration (Drizzle ORM migrations) — runs on first app start
2. Deploy Next.js API routes alongside existing static pages — no existing routes are changed
3. Operator configures `config/pricing.yaml` and platform API keys via environment variables
4. Dashboard page is added as a new route `/dashboard` — existing pages unchanged
5. Rollback: remove the `/dashboard` route and `/api/` additions; delete the SQLite file. No existing functionality is affected.

## Open Questions

- Should the dashboard require authentication (even a simple password gate) given it exposes cost data? → Recommend yes; simplest option is HTTP Basic Auth via middleware
- Should we support Cursor, Windsurf, or other IDE agents in v1, or strictly Claude + Copilot + generic? → Defer to v2; generic webhook covers ad-hoc needs
- What is the right session timeout default (30 min)? → Validate with actual usage patterns after initial deployment
