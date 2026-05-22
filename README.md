# Agent Prism

**Agent Prism is a SaaS control plane for teams running AI agents across Claude, OpenAI, Copilot, and internal automation workflows.**

AI agents are moving from experiments into production, but most teams still do not have one trusted view of agent cost, quality, reliability, and governance. Agent Prism gives leadership, platform teams, and operators a clean way to understand which agents are creating value, which providers are performing, and where autonomous workflows are leaking budget or risk.

Live product demo:

[https://agent-prism.onrender.com](https://agent-prism.onrender.com)

## Product Promise

Agent Prism helps companies answer four business-critical questions:

- Which AI agents are actually working?
- Which providers are worth scaling?
- Where is agent spend being wasted?
- Which workflows need governance before they expand?

The product turns fragmented agent activity into a single decision layer for engineering, finance, security, and AI platform leadership.

## Core Differentiator

### Control Score

Every agent run is normalized into a common operational score. The score blends success rate, latency, cost efficiency, retries, autonomy, and policy posture so teams can compare agents across providers instead of relying on anecdotes.

### Cost Leak Radar

Agent Prism does not only show spend. It highlights low-value spend: retry loops, budget breaches, slow workflows, failed runs, and expensive actions that do not produce value.

### Provider-Agnostic Governance

Claude, OpenAI, Copilot, and custom agents can all be measured through the same lens. Agent Prism sits above the tools a company already uses rather than replacing them.

## Current SaaS Capabilities

The current product foundation includes:

- Multi-tenant workspace bootstrap
- Tenant-scoped API key access
- Browser key generation for dashboard access
- OAuth-style token issuance for SDK and gateway flows
- Basic Auth protection for the dashboard when configured
- Provider connector setup for Claude and OpenAI
- Real Claude gateway demo agent
- Real OpenAI gateway demo agent
- Copilot demo telemetry agent for live product demos
- Normalized ingest API for custom agents
- Control Score analytics
- Cost Leak Radar
- Token Coach recommendations for efficient prompt and token usage
- Provider comparison
- Workflow reliability signals
- Audit trail for key actions
- Tenant admin view for workspace, keys, connectors, and audit evidence
- Tenant-scoped API key creation, listing, and revocation
- Connector marketplace for OpenAI, Claude, Copilot, LiteLLM, LangChain/LangGraph, CrewAI, OpenAI Agents SDK, and generic webhooks
- One-click connector test events that populate the dashboard without writing code
- Audit CSV export for customer evidence reviews
- Session tracking and timeout handling
- Cost, ROI, and active-agent metrics APIs
- Slack budget alert webhook support
- Executive overview dashboard
- Activity and governance drill-down views
- File and Postgres storage backends
- Render deployment support

## Dashboard Experience

The main dashboard is designed as a clean SaaS overview, not a noisy log viewer.

Default view:

- KPI strip
- Primary agent signal
- Control Score
- Provider mix
- Risk posture
- Latest business signals

Secondary views:

- **Activity**: execution trail and recent agent events
- **Token Coach**: token mix, retry waste, workflow hotspots, and usage-efficiency suggestions
- **Governance**: provider performance, leak radar, and audit trail

The goal is simple: customers should understand the product value in the first screen without scrolling through operational noise.

## Target Buyers

Agent Prism is built for teams that are adopting multiple AI agents and need governance before usage spreads across the company.

Best-fit buyers:

- AI platform teams
- Engineering leadership
- Security and governance leaders
- Finance and operations teams managing AI spend
- Enterprise transformation teams
- Product teams deploying agentic workflows

## Use Cases

### AI Agent Governance

Create one control plane for agents running across multiple providers and teams.

### Provider Benchmarking

Compare Claude, OpenAI, Copilot, and internal agents on cost, speed, reliability, and business impact.

### Cost Control

Identify where retries, failures, or inefficient workflows are wasting AI budget.

### Executive Reporting

Give leadership a clear view of agent adoption, ROI, and risk posture.

### Enterprise Readiness

Prepare agent programs for auditability, policy enforcement, and operational scale.

## Demo Flow

### 1. Open the product

[https://agent-prism.onrender.com](https://agent-prism.onrender.com)

If the browser does not have a tenant key saved, use the dashboard access flow to connect or generate a key.

### 2. Run the Claude demo agent

```bash
node setup_gateway.js
node real_demo_agent.js
```

This saves an Anthropic connector, routes a Claude request through Agent Prism, and records the agent run.

### 3. Run the OpenAI demo agent

```bash
node setup_openai_gateway.js
node real_demo_openai_agent.js
```

This saves an OpenAI connector, routes an OpenAI Responses API request through Agent Prism, and records the agent run.

### 4. Refresh the dashboard

The dashboard should show provider activity from both Claude and OpenAI, with normalized scoring and cost/risk signals.

### 5. Run the Copilot demo telemetry agent

```bash
node real_demo_copilot_agent.js
```

This pushes realistic Copilot coding-agent telemetry into Agent Prism. Open the **Token Coach** tab to show token mix, retry waste, token-heavy agents, workflow hotspots, and suggestions for using tokens more effectively.

If your saved CLI credential is stale, pass a fresh tenant key directly:

```bash
AGENT_PRISM_ENDPOINT=https://agent-prism.onrender.com \
AGENT_PRISM_API_KEY=acp_your_tenant_key \
node real_demo_copilot_agent.js
```

## Product Architecture

Agent Prism is structured around a simple SaaS control-plane model:

```text
AI Agents
  -> Provider Gateway or Ingest API
  -> Normalization Layer
  -> Tenant Store
  -> Scoring and Cost Analytics
  -> Dashboard and Governance Views
```

Supported paths today:

- Claude gateway: `/v1/messages`
- OpenAI gateway: `/v1/responses`
- Generic ingest: `/api/ingest`
- Dashboard API: `/api/dashboard`
- Tenant API: `/api/tenant`
- Audit API: `/api/audit`

## Product Modules

### Ingestion Layer

Receives events from provider gateways or direct telemetry submissions.

### Normalization Layer

Maps provider-specific data into one common agent run schema.

### Scoring Layer

Calculates Control Score and related performance signals.

### Cost Intelligence

Tracks cost per agent, provider, workflow, and tenant.

### Governance Layer

Surfaces audit events, provider comparison, risk posture, and cost leaks.

### Dashboard Layer

Provides a clean executive overview with drill-down views for activity and governance.

## Why This Can Become a SaaS Product

Companies will not run one AI agent from one vendor. They will run many agents across many tools. As that happens, leadership needs a vendor-neutral operating layer.

Agent Prism can become that layer by combining:

- cross-provider visibility
- normalized agent scoring
- AI spend governance
- workflow-level reliability analytics
- auditability for enterprise adoption

This is not another prompt tool. It is a control plane for agent operations.

## Roadmap

The foundations above are already implemented in this repo. The roadmap is focused on SaaS packaging, enterprise controls, and buyer-ready workflows that build on the current product.

Near-term product upgrades:

- Hosted onboarding wizard for company setup, provider connection, first test run, and dashboard activation
- Self-serve connector management UI for adding, rotating, disabling, and validating provider keys
- Production user accounts and session UX beyond the current API-key and Basic Auth flows
- Team and workflow budget policy builder using the existing cost and leak signals
- Managed provider pricing configuration, including model-level OpenAI pricing controls
- Alert rules UI with alert history, escalation targets, email, and PagerDuty destinations
- Executive reporting exports and scheduled weekly business summaries

Enterprise roadmap:

- SSO / SAML / OIDC for enterprise identity providers
- Role-based access control with role-aware views and admin actions
- Dedicated tenant environments and data residency options
- Audit export, retention, and legal hold controls
- Policy templates and approval workflows for agent rollout
- SOC 2-ready control evidence and compliance reporting
- Analytics warehouse support for high-volume telemetry

## Running Locally

```bash
npm install
npm start
```

Open:

[http://127.0.0.1:3000](http://127.0.0.1:3000)

Run tests:

```bash
npm test
```

## Environment Notes

Important production variables:

- `PORT`
- `HOST`
- `ACP_ADMIN_SECRET`
- `DASHBOARD_USERNAME`
- `DASHBOARD_PASSWORD`
- `STORAGE_BACKEND`
- `DATABASE_URL`
- `JWT_SECRET`

Optional OpenAI cost estimates:

- `OPENAI_INPUT_USD_PER_1M_TOKENS`
- `OPENAI_OUTPUT_USD_PER_1M_TOKENS`
- `OPENAI_DEMO_BUDGET_USD`

## Repository Highlights

Key product files:

- `server.js` - SaaS API, provider gateways, dashboard routes
- `public/app.js` - main dashboard experience
- `public/styles.css` - product UI system
- `src/store.js` - dashboard analytics
- `src/scoring.js` - Control Score logic
- `src/connectors.js` - provider normalization
- `src/saas-store.js` - storage abstraction
- `src/stores/file-store.js` - demo storage
- `src/stores/postgres-store.js` - Postgres storage
- `real_demo_agent.js` - Claude demo agent
- `real_demo_openai_agent.js` - OpenAI demo agent
- `setup_gateway.js` - Anthropic connector setup
- `setup_openai_gateway.js` - OpenAI connector setup
- `db/schema.sql` - production-oriented schema

## Positioning Statement

**Agent Prism is the operating layer for enterprise AI agents.**

It helps teams govern agent performance, provider choice, cost, and risk from one SaaS control plane.
