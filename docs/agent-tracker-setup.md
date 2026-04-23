# Agent Cost & ROI Tracker — Setup Guide

This guide walks through connecting Agent Prism's ROI dashboard to your AI agent fleet.

## 1. Configure pricing

Edit `config/pricing.json` and set rates for the platforms you use:

```json
{
  "last_verified": "2026-04-19",
  "platforms": {
    "claude": {
      "input_price_per_token": 0.000003,
      "output_price_per_token": 0.000015
    },
    "copilot": {
      "hourly_seat_rate": 0.054
    }
  },
  "fte": {
    "avg_human_hours_per_task": 2.0,
    "loaded_hourly_rate_usd": 85.0
  },
  "session_timeout_minutes": 30
}
```

Update `last_verified` whenever you check pricing. The dashboard will warn you if it's been more than 90 days.

## 2. Set environment variables

Copy `.env.example` to `.env` and fill in:

```bash
# Dashboard login (leave blank to skip auth in dev)
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=yourpassword

# Platform API keys (determines "connected" status in dashboard)
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...

# Webhook signing secrets (optional)
CLAUDE_WEBHOOK_SECRET=...
COPILOT_WEBHOOK_SECRET=...
```

## 3. Bootstrap a tenant (first-time setup)

```bash
curl -X POST http://localhost:3000/api/bootstrap \
  -H "x-admin-secret: your-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"companyName":"Acme Corp","adminEmail":"you@acme.com"}'
```

Save the returned `apiKey` — you'll need it for all agent API calls and to log in to the main dashboard.

## 4. Register agent sessions

When an agent starts, POST to `/api/sessions`:

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "claude",
    "session_id": "my-agent-run-001",
    "start_time": "2026-04-19T10:00:00Z"
  }'
```

Supported platforms: `claude`, `copilot`, `generic`

## 5. Report usage events (cost accumulation)

As the agent runs, POST usage events to `/api/usage`:

**Claude (token-based):**
```bash
curl -X POST http://localhost:3000/api/usage \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "my-agent-run-001",
    "platform": "claude",
    "input_tokens": 1500,
    "output_tokens": 400
  }'
```

**Copilot (seat-hours):**
```bash
curl -X POST http://localhost:3000/api/usage \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "copilot-sess-001",
    "platform": "copilot",
    "seat_hours": 0.5
  }'
```

**Generic (pre-computed cost):**
```bash
curl -X POST http://localhost:3000/api/usage \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "custom-agent-001",
    "platform": "generic",
    "cost_usd": 0.0042
  }'
```

## 6. Mark sessions complete

When an agent finishes:

```bash
curl -X PATCH http://localhost:3000/api/sessions/my-agent-run-001 \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

Valid statuses: `running`, `idle`, `completed`, `error`

## 7. View the ROI dashboard

Navigate to `http://localhost:3000/dashboard` (enter your `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` if configured).

The dashboard shows:
- **Active agents** — count by platform, refreshed every 5 seconds
- **Agent cost** — today and 30-day rolling totals by platform
- **FTE hours saved** — completed sessions × avg human hours per task
- **Net savings** — FTE equivalent cost minus agent cost (red if negative)
- **ROI multiplier** — how many times more valuable agents are vs. human FTE

## 8. Platform webhook ingest (optional)

You can also use platform-native webhooks to auto-ingest runs into the main timeline:

| Platform | Endpoint              | Signing header               |
|----------|-----------------------|------------------------------|
| Claude   | `POST /api/ingest/claude`  | `anthropic-signature`   |
| Copilot  | `POST /api/ingest/copilot` | `x-hub-signature-256`   |
| Generic  | `POST /api/ingest/generic` | none                    |

Set `CLAUDE_WEBHOOK_SECRET` / `COPILOT_WEBHOOK_SECRET` in `.env` to enable signature verification.

## API Reference

| Method | Path                     | Auth          | Description                         |
|--------|--------------------------|---------------|-------------------------------------|
| POST   | `/api/sessions`          | Tenant key    | Register a new agent session        |
| PATCH  | `/api/sessions/:id`      | Tenant key    | Update session status               |
| GET    | `/api/sessions/active`   | Tenant key    | Active agent counts by platform     |
| POST   | `/api/usage`             | Tenant key    | Ingest a usage/cost event           |
| GET    | `/api/metrics/cost`      | Tenant key    | Cost aggregates by platform + window|
| GET    | `/api/metrics/roi`       | Tenant key    | FTE ROI metrics for a window        |
| GET    | `/api/metrics/summary`   | Tenant key    | Full summary (used by dashboard)    |
