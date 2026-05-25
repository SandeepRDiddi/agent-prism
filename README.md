# Agent Prism

**Agent Prism is the control plane for enterprise AI agents — one dashboard to compare providers, catch cost leaks, and prove your agents are working correctly, without touching your existing code.**

AI agents are moving from experiments into production, but most teams have zero visibility into which agents are working, which providers are worth scaling, and where budget is being wasted. Agent Prism sits between your agents and the AI providers, capturing every call, scoring every run, and surfacing exactly what to fix.



---

## The One-Paragraph Pitch

Companies spend millions on AI agents across Copilot, Claude, and OpenAI — and have no idea if the money is being used efficiently or safely. Agent Prism sits between your agents and the AI providers, capturing every call. It scores each agent on cost, speed, quality, and compliance in a single number. It tells you which provider wins for your specific workloads. And it finds the exact prompts and workflows wasting your budget — with step-by-step instructions to fix them. Setup takes 5 minutes. No code changes.

---

## See. Compare. Control.

### Control Score
Every agent run is normalized into a 0–100 blended score across success rate, latency, cost efficiency, retries, autonomy, and policy posture. Compare agents across providers on one number instead of anecdotes.

### Cost Leak Radar
Not just spend visibility — specific flagged runs. Budget breaches, retry spirals, and low-value spend are surfaced with the exact agent, dollar amount overspent, and a one-line fix.

### Token Coach
Actionable optimization recommendations backed by your own data. Each recommendation shows what went wrong (with specific metrics), what to change (numbered steps), and how to verify the fix. Savings estimates are calculated from your actual run rate and projected monthly cost.

### ML Token Analytics
Statistical analysis across all runs: linear regression on cost and token trends, z-score anomaly detection (flags outlier runs at z > 2.0), percentile-based efficiency clustering (Efficient / Moderate / Wasteful), and 30-day cost forecasting. Visualized with four developer-focused SVG charts — no external dependencies.

### Provider Scorecard
Head-to-head comparison across all connected providers on 8 metrics: runs, success rate, Control Score, avg latency, tokens/run, cost/run, cost/1k tokens, and retries. Winner highlighted per metric with an overall winner banner.

---

## Dashboard Views

| Tab | Purpose |
|-----|---------|
| **Overview** | KPI strip, primary agent signal, Control Score, provider mix, risk posture |
| **Activity** | Real-time execution trail and agent event log |
| **Token Coach** | Cost Leak Radar · ML mini-strip · accordion Action Plan · Top Agents · Workflow Hotspots |
| **ML Analytics** | Token burn rate chart · cost regression · efficiency scatter · input/output mix bars |
| **Governance** | Provider scorecard · audit trail · cost leak detail |
| **Admin** | Workspace setup · connector marketplace · API key management · developer integration guides |

---

## Token Coach — How It Works

Token Coach analyzes every run through the proxy and generates ranked recommendations. Each card in the Action Plan:

- Shows collapsed by default (title + effort level + monthly savings estimate)
- Expands on click to reveal: **What went wrong** (specific data), **What to change** (numbered steps), **How to verify the fix** (exact metric threshold to watch)
- Has an **Apply** button (paid feature) that marks the fix as applied and tracks it
- **Automatically detects manual fixes** — if you follow the steps yourself and re-run your agents, Token Coach compares the new metrics to the snapshot taken when you read the card and shows a congratulations banner with the dollar amount saved

### ML-powered signals shown in Token Coach hero:
- Cost trend direction with regression confidence (R²)
- Anomaly count (z-score threshold)
- 30-day cost forecast
- Efficiency cluster summary (wasteful / efficient agents)

---

## Supported Integrations

### Provider Gateways (zero-code — just change the endpoint)

| Provider | Endpoint | What gets captured |
|----------|----------|-------------------|
| Claude (Anthropic) | `POST /v1/messages` | Tokens in/out, model, latency, cost |
| OpenAI Chat | `POST /v1/chat/completions` | Tokens in/out, model, latency, cost |
| OpenAI Responses API | `POST /v1/responses` | Tokens in/out, model, latency, cost |

Change your agent's base URL to `https://agent-prism.onrender.com` and pass your `acp_...` key as the Bearer token. Your existing code is unchanged.

### Direct Ingest

```bash
curl -X POST https://agent-prism.onrender.com/api/ingest \
  -H "x-api-key: acp_your_key" \
  -H "Content-Type: application/json" \
  -d '{"source":"generic","payload":{
    "agentName":"My Agent","provider":"Anthropic","model":"claude-haiku-3",
    "status":"success","tokensIn":1200,"tokensOut":340,"costUsd":0.0008,
    "budgetUsd":0.005,"latencyMs":1800,"workflow":"my-workflow"
  }}'
```

### Connector Marketplace

Admin tab includes one-click connectors for: Claude, OpenAI, GitHub Copilot, LiteLLM, LangChain/LangGraph, CrewAI, OpenAI Agents SDK, and generic webhooks.

---

## Quick Test

**Seed the dashboard with varied test data (covers all Token Coach scenarios):**

```bash
export PRISM_KEY=acp_your_key_here
export PRISM_URL=https://agent-prism.onrender.com

node seed_dashboard.js
```

This posts 9 runs covering: high input ratio, high output ratio, retry waste, oversized agent, budget breach, and a healthy baseline — triggering all Token Coach recommendations, Cost Leak Radar entries, and enough data for ML Analytics.

**Test OpenAI via proxy:**

```bash
PRISM_KEY=acp_your_key node public/test_openai_via_prism.sh
```

---

## Running Locally

```bash
cp .env.example .env   # set ACP_ADMIN_SECRET and optionally DATABASE_URL
npm install
npm start              # server at http://localhost:3000
npm test               # run all tests
```

For Postgres: set `STORAGE_BACKEND=postgres` and `DATABASE_URL` in `.env`, then run `db/schema.sql`.

---

## Architecture

Single-process Node.js server (`server.js`). No framework — raw `node:http`. ESM throughout.

```
Agent / SDK / CI workflow
  ↓
Provider Gateway  (/v1/messages · /v1/chat/completions · /v1/responses)
  or Direct Ingest  (/api/ingest)
  ↓
Normalization  (src/connectors.js)
  ↓
Tenant Store  (src/saas-store.js → file-store or postgres-store)
  ↓
Analytics  (src/store.js → Control Score · Cost Leaks · Token Efficiency · ML Analytics)
  ↓
Dashboard API  (/api/dashboard)
  ↓
SPA  (public/app.js)
```

### Key modules

| File | Role |
|------|------|
| `server.js` | HTTP entrypoint, auth middleware, all route handlers |
| `src/store.js` | `buildDashboardSnapshot` · `buildTokenEfficiency` · `buildMLAnalytics` · `detectCostLeaks` |
| `src/scoring.js` | `computeControlScore` — 0–100 blended score |
| `src/connectors.js` | `normalizeClaudeRun` · `normalizeGenericRun` · `normalizeCopilotRun` |
| `src/saas-store.js` | Storage facade — lazily loads file or Postgres backend |
| `src/pricing.js` | Token cost lookup table per model |
| `public/app.js` | Dashboard SPA — all views, SVG charts, accordion logic |
| `public/styles.css` | UI system — dark theme, responsive grid |
| `seed_dashboard.js` | Quick test data seeder |

### ML Analytics implementation (zero dependencies)

- **Linear regression** — `linearRegression()` in `store.js`, computes slope/intercept/R² on cost and token sequences
- **Z-score anomaly detection** — flags runs where `|tokens - mean| / σ > 2.0`
- **Moving average** — window-3 smoothing on token counts
- **Percentile clustering** — p33/p66 thresholds classify agents as Efficient / Moderate / Wasteful
- **SVG charts** — `svgLineChart`, `svgScatter`, `svgMixBars` generate inline SVG strings, no canvas, no chart library

---

## API Reference

| Path | Auth | Purpose |
|------|------|---------|
| `POST /api/bootstrap` | Admin | Create tenant |
| `POST /api/admin/api-keys` | Admin | Issue browser key |
| `POST /v1/messages` | Tenant | Claude gateway proxy |
| `POST /v1/chat/completions` | Tenant | OpenAI Chat API proxy |
| `POST /v1/responses` | Tenant | OpenAI Responses API proxy |
| `POST /api/ingest` | Tenant | Generic run ingest |
| `GET /api/dashboard` | Tenant | Full analytics snapshot (includes ML) |
| `GET /api/runs` | Tenant | Raw run list |
| `GET /api/leaks` | Tenant | Cost leak signals |
| `POST /api/connectors` | Tenant | Save connector config |
| `GET /api/audit` | Tenant | Audit log |
| `GET /api/audit/export` | Tenant | CSV export |
| `POST /api/sessions` | Tenant | Record agent session |
| `GET /api/tenant` | Tenant | Workspace context |
| `POST /api/oauth/token` | Public | JWT issuance for SDK flows |

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | No | Server port (default 3000) |
| `ACP_ADMIN_SECRET` | Yes (prod) | Admin endpoint protection |
| `DASHBOARD_USERNAME` | No | Basic auth username |
| `DASHBOARD_PASSWORD` | No | Basic auth password |
| `JWT_SECRET` | No | JWT signing key |
| `STORAGE_BACKEND` | No | `file` (default) or `postgres` |
| `DATABASE_URL` | Postgres only | Postgres connection string |
| `OPENAI_INPUT_USD_PER_1M_TOKENS` | No | Override OpenAI input pricing |
| `OPENAI_OUTPUT_USD_PER_1M_TOKENS` | No | Override OpenAI output pricing |

---

## Target Buyers

| Buyer | Pain solved |
|-------|------------|
| Engineering leadership | Unified view across Claude, OpenAI, Copilot without building internal tooling |
| Finance / operations | Exact dollar amounts per agent, per workflow, with overspend alerts |
| AI platform teams | Provider benchmarking with real workload data, not vendor benchmarks |
| Security / governance | Audit trail, policy violation tracking, compliance export |
| Product teams | Which agents are producing value vs burning budget |

---

## Roadmap

**Near-term:**
- Onboarding wizard (provider connection → first test run → dashboard activation)
- Budget policy builder with alert rules UI
- Executive reporting exports and weekly summaries
- Self-serve connector management

**Enterprise:**
- SSO / SAML / OIDC
- Role-based access control
- Data residency options
- SOC 2-ready compliance reporting
- Analytics warehouse support for high-volume telemetry

---

## Positioning

**Agent Prism is the operating layer for enterprise AI agents.**

It helps teams govern agent performance, provider choice, cost, and risk from one SaaS control plane — without replacing any tool they already use.
