## 1. Foundation & Database

- [x] 1.1 Install dependencies: no new deps needed; existing file-store used; `config/pricing.json` replaces YAML
- [x] 1.2 Create `lib/db/schema.ts` defining `agent_sessions` and `usage_events` tables with Drizzle — adapted: extended `file-store.js` emptyState with `sessions` array
- [x] 1.3 Create `lib/db/client.ts` that initializes libSQL connection — adapted: file-store already provides persistence
- [x] 1.4 Create `drizzle.config.ts` and run initial migration — adapted: no migration needed for file-store
- [x] 1.5 Create `config/pricing.yaml` with Claude token rates, Copilot seat rate, FTE config fields, and `last_verified` date — created as `config/pricing.json`
- [x] 1.6 Create `lib/pricing.ts` that loads and validates `pricing.yaml` at startup, throwing on missing required fields — created as `src/pricing.js`

## 2. Agent Registry API

- [x] 2.1 Create `app/api/sessions/route.ts` — POST handler to register a new agent session (platform, session_id, start_time) — in `server.js` + `file-store.js`
- [x] 2.2 Create `app/api/sessions/[id]/route.ts` — PATCH handler to update session status (idle, completed, error) — in `server.js`
- [x] 2.3 Add session timeout job in `lib/jobs/session-timeout.ts` — created as `src/jobs/session-timeout.js`, invoked lazily on metrics requests
- [x] 2.4 Create `app/api/sessions/active/route.ts` — GET handler returning active count by platform — in `server.js`

## 3. Cost Tracker API

- [x] 3.1 Create `app/api/usage/route.ts` — POST handler to ingest usage events; routes to platform-specific cost calculator — `/api/usage` in `server.js`
- [x] 3.2 Create `lib/cost/claude.ts` — computes cost from input/output token counts using pricing config — `src/cost/claude.js`
- [x] 3.3 Create `lib/cost/copilot.ts` — computes cost from seat-hours using pricing config — `src/cost/copilot.js`
- [x] 3.4 Create `lib/cost/generic.ts` — passes through pre-computed `cost_usd` field — `src/cost/generic.js`
- [x] 3.5 Create `app/api/metrics/cost/route.ts` — GET handler returning cost aggregated by platform for `day`, `week`, `30d` windows — `/api/metrics/cost` in `server.js`

## 4. FTE ROI Engine API

- [x] 4.1 Create `lib/roi.ts` — computes FTE hours saved, FTE cost equivalent, agent cost, net savings, and ROI multiplier for a given time window — `src/roi.js`
- [x] 4.2 Create `app/api/metrics/roi/route.ts` — GET handler that calls `lib/roi.ts` and returns full ROI payload including `assumptions` object — `/api/metrics/roi` in `server.js`
- [x] 4.3 Handle zero agent cost edge case (return `roi_multiplier: null`) and negative net savings (pass through as-is) — implemented in `src/roi.js`

## 5. Metrics Summary Endpoint

- [x] 5.1 Create `app/api/metrics/summary/route.ts` — GET handler that aggregates active agent count, cost totals, and ROI for the dashboard — `/api/metrics/summary` in `server.js`
- [x] 5.2 Add pricing config staleness flag to summary response (boolean + `last_verified` date) — included in `meta` field
- [x] 5.3 Add platform configuration status to summary (which platforms have API keys configured) — `getPlatformStatus()` in `server.js`

## 6. Dashboard UI

- [x] 6.1 Create `app/dashboard/page.tsx` — new Next.js page route for the dashboard — adapted: `public/dashboard.html` static page served at `/dashboard`
- [x] 6.2 Create `components/dashboard/ActiveAgentsCard.tsx` — displays total + per-platform active agent count — inline in dashboard.html
- [x] 6.3 Create `components/dashboard/CostBurnCard.tsx` — displays today's cost and 30-day cost with per-platform breakdown — inline in dashboard.html
- [x] 6.4 Create `components/dashboard/ROICard.tsx` — displays FTE hours saved, FTE cost equivalent, agent cost, net savings; shows negative values in red; shows assumptions — inline in dashboard.html
- [x] 6.5 Create `components/dashboard/PlatformStatusCard.tsx` — shows connected/disconnected state per platform with setup prompt for unconfigured ones — inline in dashboard.html
- [x] 6.6 Create `hooks/useMetrics.ts` — custom hook that polls `/api/metrics/summary` every 5 seconds — `setInterval` poll loop in dashboard.html script
- [x] 6.7 Wire all cards into `app/dashboard/page.tsx` using the `useMetrics` hook — all wired via render() function in dashboard.html
- [x] 6.8 Add stale pricing config warning banner (conditionally rendered based on summary response flag) — warning banner in dashboard.html

## 7. Authentication

- [x] 7.1 Create `middleware.ts` at project root to apply HTTP Basic Auth to all `/dashboard` and `/api/` routes — `requireBasicAuth()` in `server.js`
- [x] 7.2 Read auth credentials from `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` environment variables — implemented in `server.js`
- [x] 7.3 Return 401 with `WWW-Authenticate` header for unauthenticated requests (do not redirect to a custom page) — implemented in `server.js`

## 8. Platform Ingest Integrations

- [x] 8.1 Create `app/api/ingest/claude/route.ts` — webhook handler for Claude usage events — `/api/ingest/claude` in `server.js`
- [x] 8.2 Create `app/api/ingest/copilot/route.ts` — webhook handler for GitHub Copilot usage events — `/api/ingest/copilot` in `server.js`
- [x] 8.3 Create `app/api/ingest/generic/route.ts` — generic webhook handler — `/api/ingest/generic` in `server.js`
- [x] 8.4 Add shared request signature validation utility `lib/ingest/verify.ts` — `src/ingest/verify.js` with HMAC-SHA256

## 9. Configuration & Documentation

- [x] 9.1 Add all required environment variables to `.env.example` — updated with DASHBOARD_*, ANTHROPIC_API_KEY, GITHUB_TOKEN, webhook secrets
- [x] 9.2 Document the setup flow in `docs/agent-tracker-setup.md` — created with full setup guide and API reference
- [x] 9.3 Add `/dashboard` link to the existing site navigation — added to `public/index.html` topbar

## 10. Testing & Validation

- [x] 10.1 Write integration tests for session registration and status update API routes — `test/sessions.test.js` (real file-store, temp dir)
- [x] 10.2 Write integration tests for cost accumulation across all three platform types — `test/cost.test.js`
- [x] 10.3 Write unit tests for `lib/roi.ts` covering positive savings, negative savings, and zero agent cost edge cases — `test/roi.test.js`
- [x] 10.4 Write unit tests for `lib/pricing.ts` covering valid config, missing field, and stale date scenarios — `test/pricing.test.js`
- [x] 10.5 Manual end-to-end smoke test: register a session, send usage events, verify dashboard shows correct cost and ROI
