# Agent Control Plane

Agent Control Plane is a plug-and-play product starter for teams running multiple AI agents across tools like GitHub Copilot, Claude, and custom agent frameworks. It gives you one place to understand:

- How well agents are performing
- How much they are costing
- Which workflows are leaking budget
- Which providers are reliable enough for production

The core product idea is simple: agent adoption is exploding, but teams still lack a shared operating layer to compare agents fairly. Each vendor exposes different telemetry, cost models, and event formats. This project solves that by normalizing every run into one schema and then layering opinionated analytics on top.

## The USP

Most dashboards stop at usage metrics. This product is designed around a stronger differentiator:

**Control Score + Cost Leak Radar**

This is the USP for the product and the part worth leaning into commercially.

### 1. Control Score

Every agent run gets a single comparable score based on:

- success or failure
- budget efficiency
- latency
- autonomy level
- policy / guardrail violations
- retry behavior

That makes it possible to compare:

- Copilot vs Claude
- one workflow vs another
- a premium model vs a cheaper model
- highly autonomous agents vs human-in-the-loop agents

Instead of debating anecdotal quality, teams get a normalized operational score.

### 2. Cost Leak Radar

This product also flags low-value spend, not just high spend.

Examples:

- repeated retries that burn money without better outcomes
- workflows that routinely exceed budget
- expensive runs with poor user satisfaction
- agents that keep running despite low confidence or poor guardrail posture

This is the commercial edge: not just “what did we spend?” but “where are we wasting spend, and what should we change?”

### 3. Replay-Ready Breadcrumbs

Each run stores breadcrumbs and notes so teams can replay what happened during a session, audit agent behavior, and coach prompts / policies over time.

That creates a clean path toward premium features later:

- root-cause analysis
- approval workflows
- policy governance
- benchmarking
- procurement reporting

## Product positioning

If you want a crisp positioning statement:

> Agent Control Plane helps enterprises govern AI agents across providers by combining normalized telemetry, performance benchmarking, and cost leak detection in one control layer.

Good target buyers:

- platform engineering teams
- AI infrastructure teams
- security / governance leaders
- finance / ops teams managing AI budgets
- product teams deploying many workflow agents

## What is implemented

This repository now includes a runnable SaaS foundation with:

- a zero-dependency Node.js control-plane server
- first-run tenant bootstrap
- tenant-scoped API key authentication
- normalized ingestion APIs
- multi-tenant state for tenants, users, connectors, and runs
- sample adapters for Copilot, Claude, and generic agents
- a control-room dashboard UI
- a Postgres-ready schema for the next production step
- a detailed README so the project is easy to extend

## Tech choices

This version intentionally uses almost no dependencies.

Why:

- easy to run anywhere
- simple to understand
- good for demoing product direction quickly
- avoids lock-in before the product surface is validated

You can later migrate the same concepts into:

- Next.js
- React + FastAPI
- Supabase / Postgres
- ClickHouse for telemetry scale
- Kafka or webhooks for ingestion

## File structure

```text
.
├── README.md
├── package.json
├── server.js
├── data/
│   └── sample-runs.json
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── src/
    ├── connectors.js
    ├── scoring.js
    └── store.js
```

## How it works

### Normalized run schema

Every provider-specific event is transformed into a common run model with fields such as:

- `agentName`
- `provider`
- `model`
- `taskType`
- `status`
- `latencyMs`
- `tokensIn`
- `tokensOut`
- `costUsd`
- `budgetUsd`
- `autonomyLevel`
- `retryCount`
- `policyViolations`
- `userSatisfaction`
- `workflow`
- `team`
- `breadcrumbs`

This is the backbone that makes cross-agent comparison possible.

### Connectors

Provider adapters live in [src/connectors.js](/Users/sandeepdiddi/Documents/AgentControlPlane/src/connectors.js).

The project currently supports:

- `normalizeCopilotRun(payload)`
- `normalizeClaudeRun(payload)`
- `normalizeGenericRun(payload)`

To add a new provider, create a mapper from that provider’s raw payload into the normalized run format.

### Scoring

Control Score logic lives in [src/scoring.js](/Users/sandeepdiddi/Documents/AgentControlPlane/src/scoring.js).

The current score blends:

- success rate impact
- budget efficiency
- latency performance
- autonomy level
- guardrail posture
- retry penalties

This formula is intentionally transparent. In a real product, you could:

- tune weights per team
- define separate scorecards per workflow class
- add outcome quality signals
- incorporate human review scores

### Analytics

Dashboard analytics live in [src/store.js](/Users/sandeepdiddi/Documents/AgentControlPlane/src/store.js).

It computes:

- headline KPIs
- provider comparison
- workflow insights
- leak detection
- recent activity timeline

### UI

The dashboard is served from:

- [public/index.html](/Users/sandeepdiddi/Documents/AgentControlPlane/public/index.html)
- [public/styles.css](/Users/sandeepdiddi/Documents/AgentControlPlane/public/styles.css)
- [public/app.js](/Users/sandeepdiddi/Documents/AgentControlPlane/public/app.js)

The interface is intentionally product-facing rather than developer-tool plain:

- strong positioning in the hero
- clear USP callout
- glassy warm visual system
- provider comparisons
- workflow spend visibility
- leak radar
- recent run cards for fast scanning

## SaaS foundation included

This is no longer just a dashboard demo.

The app now has these SaaS-oriented foundations:

- `tenant bootstrap`
  creates the first tenant, owner, connector, and ingest API key
- `tenant API keys`
  every dashboard and ingest request is tenant-scoped
- `tenant state model`
  tenants, users, connectors, API keys, and runs live in a structured app-state store
- `Postgres-ready schema`
  production schema is included in [db/schema.sql](/Users/sandeepdiddi/Documents/AgentControlPlane/db/schema.sql)

### Local development persistence

The current local development store is:

- [data/app-state.json](/Users/sandeepdiddi/Documents/AgentControlPlane/data/app-state.json)

That is the dev-mode backing store for:

- tenants
- users
- API keys
- connectors
- runs

This keeps the project runnable without external services.

For production, move that same model to Postgres and keep telemetry analytics in ClickHouse or BigQuery.

### Storage backends

The app now supports an environment-driven storage seam:

- `STORAGE_BACKEND=file`
  local development using [data/app-state.json](/Users/sandeepdiddi/Documents/AgentControlPlane/data/app-state.json)
- `STORAGE_BACKEND=postgres`
  production-oriented Postgres repository

Repository switching happens through [src/saas-store.js](/Users/sandeepdiddi/Documents/AgentControlPlane/src/saas-store.js), with concrete backends in:

- [src/stores/file-store.js](/Users/sandeepdiddi/Documents/AgentControlPlane/src/stores/file-store.js)
- [src/stores/postgres-store.js](/Users/sandeepdiddi/Documents/AgentControlPlane/src/stores/postgres-store.js)

## Run locally

### Requirements

- Node.js 18+

### Start the app

```bash
npm start
```

Then open:

- [http://localhost:3000](http://localhost:3000)

### First-run bootstrap

Before the dashboard can load, bootstrap the first tenant.

1. Copy [.env.example](/Users/sandeepdiddi/Documents/AgentControlPlane/.env.example) values into your shell or environment.
2. Set `ACP_ADMIN_SECRET` to your own value.
3. Start the app with `npm start`.
4. Open the UI.
5. Use the bootstrap screen to enter:
   company name, admin name, admin email, admin secret.
6. The app will create:
   first tenant, first owner user, default connector, default tenant API key.
7. That tenant API key is then used for dashboard access and ingestion.

### Run with Postgres

1. Install dependencies:
   `npm install`
2. Start Postgres:
   `docker compose up -d`
3. Set environment variables:
   `STORAGE_BACKEND=postgres`
   `DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_control_plane`
4. Start the app:
   `npm start`

The included [docker-compose.yml](/Users/sandeepdiddi/Documents/AgentControlPlane/docker-compose.yml) starts Postgres and applies [db/schema.sql](/Users/sandeepdiddi/Documents/AgentControlPlane/db/schema.sql) automatically on first boot.

### Tenant access model

The browser stores the tenant API key in `localStorage` for local dev.

In production, you would replace this with:

- hosted auth session for dashboard users
- tenant-scoped API keys or service accounts for connectors and ingestion

## API reference

### `GET /api/health`

Simple health check.

### `GET /api/bootstrap/status`

Returns whether the control plane has been bootstrapped.

### `POST /api/bootstrap`

Creates the first tenant and first API key.

Headers:

- `x-admin-secret: <ACP_ADMIN_SECRET>`

Body:

```json
{
  "companyName": "Acme Corp",
  "adminName": "Sandeep",
  "adminEmail": "sandeep@example.com"
}
```

### `GET /api/dashboard`

Returns the entire dashboard snapshot:

- USP metadata
- headline metrics
- provider comparison
- workflow insights
- cost leaks
- recent runs
- timeline

### `GET /api/runs`

Returns all normalized runs.

Requires:

- `x-api-key: <tenant-api-key>`

### `GET /api/leaks`

Returns the current leak radar output.

Requires:

- `x-api-key: <tenant-api-key>`

### `GET /api/tenant`

Returns tenant profile, users, connectors, and run count.

Requires:

- `x-api-key: <tenant-api-key>`

### `POST /api/connectors`

Creates a connector record for the tenant.

Requires:

- `x-api-key: <tenant-api-key>`

Example:

```json
{
  "provider": "github-copilot",
  "name": "Copilot Production Connector",
  "mode": "webhook",
  "config": {
    "environment": "production"
  }
}
```

### `POST /api/ingest`

Ingest a new run. You can send either a provider-specific payload or a generic normalized payload.

Requires:

- `x-api-key: <tenant-api-key>`

#### Generic example

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "source": "generic",
    "payload": {
      "id": "run_009",
      "agentName": "Marketing Copy Agent",
      "provider": "Custom",
      "model": "gpt-4o",
      "taskType": "copywriting",
      "status": "success",
      "startTime": "2026-03-25T16:00:00.000Z",
      "endTime": "2026-03-25T16:02:00.000Z",
      "latencyMs": 120000,
      "tokensIn": 1400,
      "tokensOut": 1100,
      "costUsd": 0.84,
      "budgetUsd": 1.2,
      "autonomyLevel": 3,
      "retryCount": 0,
      "toolCalls": 2,
      "policyViolations": 0,
      "userSatisfaction": 4,
      "workflow": "campaign-copy",
      "team": "marketing",
      "breadcrumbs": ["brief loaded", "copy generated", "variants exported"],
      "notes": "Strong low-cost run."
    }
  }'
```

#### Copilot example

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "source": "copilot",
    "payload": {
      "session_id": "copilot_101",
      "agent_name": "Copilot Refactor Agent",
      "model_name": "gpt-4.1",
      "intent": "refactor",
      "outcome": "success",
      "started_at": "2026-03-25T17:00:00.000Z",
      "completed_at": "2026-03-25T17:06:00.000Z",
      "duration_ms": 360000,
      "prompt_tokens": 2200,
      "completion_tokens": 1900,
      "estimated_cost_usd": 1.44,
      "budget_usd": 2,
      "autonomy_level": 4,
      "retry_count": 1,
      "tool_invocations": 6,
      "policy_alerts": 0,
      "user_score": 4,
      "environment": "production",
      "workflow": "repo-modernization",
      "team": "engineering",
      "labels": ["refactor"],
      "trace": ["workspace indexed", "files patched", "summary produced"],
      "summary": "Refactor completed cleanly."
    }
  }'
```

#### Claude example

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "source": "claude",
    "payload": {
      "runId": "claude_202",
      "agent": "Claude Contract Analyst",
      "model": "claude-3.7-sonnet",
      "jobType": "legal-analysis",
      "status": "success",
      "startedAt": "2026-03-25T18:00:00.000Z",
      "finishedAt": "2026-03-25T18:05:00.000Z",
      "elapsedMs": 300000,
      "inputTokens": 4200,
      "outputTokens": 2100,
      "costUsd": 2.3,
      "budgetUsd": 3,
      "autonomyLevel": 3,
      "retries": 0,
      "toolCalls": 2,
      "guardrailHits": 0,
      "feedbackScore": 5,
      "environment": "production",
      "flow": "contract-redlining",
      "team": "legal",
      "tags": ["contracts"],
      "breadcrumbs": ["document parsed", "risk clauses flagged"],
      "notes": "High-value contract analysis."
    }
  }'
```

### `POST /api/load-sample`

Reload the bundled demo dataset.

### `POST /api/reset`

Clear tenant runtime data.

Requires:

- `x-api-key: <tenant-api-key>`

## How to bring Claude and Copilot agents into this control plane

This is the practical operating model:

1. Build or configure the agent in the native platform.
2. Emit telemetry for each run, step, retry, tool call, and final outcome.
3. Normalize that telemetry into the Agent Control Plane schema.
4. Ingest it through `/api/ingest` or, in production, through a message bus / collector API.

The control plane should not try to replace Claude or Copilot. It should sit above them as the shared governance and monitoring layer.

### Claude path

As of March 25, 2026, Anthropic’s official documentation points to the Claude Code SDK as the main way to build custom agents, with support for:

- TypeScript and Python SDK usage
- fine-grained tool permissions
- MCP extensibility
- production-oriented session and monitoring features

Relevant Anthropic docs:

- [Claude Code SDK overview](https://docs.anthropic.com/en/docs/claude-code/sdk)
- [Claude Code hooks reference](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Claude Code settings and subagents](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Claude Code SDK MCP support](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-mcp)

#### Recommended Claude integration pattern

- Build the agent with the Claude Code SDK or Claude Code subagents.
- Use Claude hooks for telemetry capture at session start, prompt submit, pre-tool, post-tool, subagent stop, and session end.
- Send those hook events into your telemetry collector.
- Convert them into the normalized schema in [src/connectors.js](/Users/sandeepdiddi/Documents/AgentControlPlane/src/connectors.js).
- Store step logs, cost, latency, and policy outcomes per tenant.

#### Example Claude telemetry flow

```text
Claude Agent
  -> Claude hooks / SDK events
  -> tenant-side collector or hosted ingestion gateway
  -> normalizeClaudeRun()
  -> queue / stream
  -> database
  -> dashboard / alerts / audit
```

### Copilot path

As of March 25, 2026, GitHub’s official docs show several building blocks that matter here:

- custom agents for Copilot coding agent
- custom agents for Copilot CLI
- agent skills
- hooks for Copilot agents
- MCP support for Copilot and Copilot coding agent

Relevant GitHub docs:

- [Creating custom agents for Copilot coding agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents)
- [Creating and using custom agents for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli)
- [About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [About hooks](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks)
- [Using hooks with GitHub Copilot agents](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/use-hooks)
- [Model Context Protocol and Copilot coding agent](https://docs.github.com/en/copilot/concepts/coding-agent/mcp-and-coding-agent)
- [About MCP](https://docs.github.com/en/copilot/concepts/context/mcp)

#### Recommended Copilot integration pattern

- Define specialized custom agents for your core use cases like code review, QA, release notes, or incident triage.
- Add repository or personal agent skills so behavior is reusable and consistent.
- Use Copilot hooks to capture session lifecycle events and tool activity.
- If the agent needs enterprise systems, expose them through MCP servers.
- Forward hook output and session metadata to the control plane collector.
- Normalize payloads with `normalizeCopilotRun()` before storage.

### Best plug-and-play model for both

The cleanest product architecture is:

- native agent remains where the user already works
- lightweight telemetry adapter runs close to the agent
- adapter emits a common event format
- control plane ingests only standardized telemetry and metadata

That gives you a truly provider-agnostic product.

## What plug-and-play onboarding should look like for clients

For production, do not ask every client to manually wire random JSON into your API. Treat onboarding as a productized connector flow.

### Client onboarding steps

1. Create a tenant in the control plane.
2. Choose provider:
   Claude, Copilot, OpenAI, custom, LangGraph, CrewAI, internal orchestrator.
3. Generate tenant-specific ingest credentials.
4. Install a connector package or deploy a small collector service.
5. Configure mapping:
   agent names, teams, workflows, budgets, environments, tags.
6. Validate with a test run.
7. Turn on dashboards, alerts, and policy checks.

### Product packaging for connectors

Ship three connector modes:

- SDK mode:
  npm / pip package that apps can call directly.
- Webhook mode:
  client posts events to your hosted API.
- Collector mode:
  a sidecar or small service deployed inside the client VPC that forwards sanitized telemetry.

Collector mode is usually best for enterprise clients because it gives them more control over what leaves their network.

## Recommended production architecture

Below is the production setup I would recommend if this becomes a serious B2B product.

### High-level architecture

```text
Client Agents (Claude / Copilot / Custom)
  -> Local hooks / SDK adapters / MCP-aware collectors
  -> Ingestion API Gateway
  -> Queue / Stream (Kafka, SQS, or Pub/Sub)
  -> Processing workers / normalization layer
  -> Operational DB + Analytics DB + Object Storage
  -> Dashboard API / Alerting / Audit services
```

### Core backend services

You will likely want these services:

- `ingest-service`
  receives events, validates signatures, rate-limits, and enqueues work
- `normalization-service`
  converts provider-specific telemetry into your canonical schema
- `policy-service`
  evaluates budgets, guardrails, policy breaches, and client-specific controls
- `analytics-service`
  computes scorecards, anomalies, cost trends, and SLA summaries
- `alerting-service`
  sends Slack, email, PagerDuty, and webhook alerts
- `tenant-service`
  manages organizations, users, RBAC, API keys, SSO, and plans
- `dashboard-api`
  serves the UI and external reporting APIs

## Immediate next production step from this repo

This repo is now a solid SaaS starter, but not the final production architecture yet.

The next concrete upgrade path is:

1. Add real login for dashboard users:
   SAML / OIDC.
2. Keep API keys only for connector ingestion.
3. Split ingestion workers from dashboard APIs.
4. Add a managed queue and analytics warehouse.
5. Add audit logs and per-tenant RBAC enforcement.
6. Add ClickHouse or BigQuery for large-scale analytics instead of using Postgres for all run queries.

## Database design for production

Do not keep everything in a single OLTP table if you expect telemetry scale.

### Recommended storage split

- Postgres:
  tenants, users, RBAC, billing metadata, connector configs, budgets, policies, saved views
- ClickHouse or BigQuery:
  high-volume run events, tool events, latency metrics, token usage, time-series analytics
- Redis:
  caching, rate limits, short-lived sessions, queues if needed
- S3 / GCS / Blob storage:
  raw event payloads, replay logs, traces, exported audits, long-term archives

### Practical schema groups

In Postgres:

- `tenants`
- `tenant_environments`
- `users`
- `roles`
- `connectors`
- `agent_definitions`
- `workflow_policies`
- `budget_policies`
- `alert_rules`
- `api_keys`
- `audit_events`

In analytics storage:

- `agent_runs`
- `agent_steps`
- `tool_calls`
- `cost_events`
- `policy_events`
- `feedback_events`
- `score_snapshots`

## Multi-tenant security model

Security is one of the biggest reasons clients would buy this product, so it cannot be lightweight.

### Identity and access

- SSO with SAML and OIDC
- SCIM for provisioning
- role-based access control
- environment-level access boundaries
- optional just-in-time elevation for admin actions

### Tenant isolation

You have two main patterns:

- logical isolation:
  one shared control plane with strict tenant IDs and row-level security
- strong isolation:
  separate database/schema/storage keys per enterprise tenant

My recommendation:

- start with logical isolation plus strict row-level security
- offer dedicated storage or dedicated deployment for enterprise plans

### Secrets and key management

- store secrets in Vault, AWS Secrets Manager, or GCP Secret Manager
- rotate ingest keys automatically
- support scoped API tokens per connector
- never store raw provider API keys unless absolutely necessary
- prefer client-side collectors that use their own provider credentials

### Data protection

- TLS everywhere
- encryption at rest with managed KMS keys
- per-tenant encryption keys for sensitive enterprise plans
- PII detection and redaction on ingest
- configurable field suppression so clients can exclude prompt / response bodies

### Audit and compliance

- immutable audit trail for admin actions and policy changes
- access logs for dashboards and APIs
- retention controls per tenant
- export controls for legal and security teams
- support for SOC 2, ISO 27001, and eventually HIPAA or GDPR requirements if needed

## Production security controls you should implement

### In the ingest path

- mTLS or signed webhook verification for enterprise collectors
- per-tenant API credentials
- replay protection with request timestamps and nonces
- payload size limits
- schema validation
- rate limiting and abuse controls

### In the processing path

- strict allowlists for outbound destinations
- sandboxing for enrichment jobs
- separation between raw and normalized data
- dead-letter queues for failed payloads

### In the app layer

- CSP and secure headers
- session expiration and refresh controls
- fine-grained RBAC checks in every query path
- audit logs for any sensitive read

## Deployment recommendation

If you want a practical v1 production stack:

### Application stack

- frontend:
  Next.js
- APIs and workers:
  Node.js or Go
- Postgres:
  Neon, RDS, AlloyDB, or Cloud SQL
- analytics:
  ClickHouse Cloud or BigQuery
- cache / queue:
  Redis + SQS / PubSub / Kafka
- object storage:
  S3 or GCS
- auth:
  Auth0, WorkOS, Clerk Enterprise, or custom SAML/OIDC
- observability:
  OpenTelemetry + Datadog / Grafana / Honeycomb

### Infrastructure

- Kubernetes or ECS for control-plane services
- separate environments for dev, staging, prod
- infrastructure as code with Terraform
- WAF in front of the ingest API
- private networking for databases

## Event model you should standardize

Your product becomes much more scalable if every provider eventually maps into these event types:

- `run.started`
- `run.updated`
- `run.completed`
- `run.failed`
- `tool.called`
- `tool.completed`
- `budget.threshold_exceeded`
- `policy.violation`
- `feedback.received`

Then you can compute:

- reliability by provider
- cost by workflow
- retry loops
- guardrail failures
- benchmark scores by tenant and team

## How to make the product truly plug-and-play

This is the product strategy I would use:

### Tier 1: connector-first onboarding

- prebuilt connectors for Claude, Copilot, OpenAI, LangGraph, CrewAI
- guided setup in the UI
- test event validation

### Tier 2: policy templates

- engineering workflow template
- support automation template
- finance / legal review template
- security operations template

### Tier 3: tenant customization

- custom scoring weights
- custom budgets
- custom redaction rules
- custom workflows and tags

That combination makes the product reusable across clients without turning every implementation into consulting work.

## Recommended roadmap

If you want to turn this into a stronger product, the next logical steps are:

### 1. Real integrations

Add ingestion sources for:

- GitHub webhooks
- Anthropic / Claude app telemetry
- OpenAI Responses API logs
- internal event buses
- workflow tools like LangGraph, CrewAI, AutoGen, or custom orchestrators

### 2. Persistent database

Move from JSON file storage to:

- Postgres for transactional app data
- ClickHouse for high-volume telemetry and timeseries analytics

### 3. Team governance

Add:

- role-based access control
- policy definitions
- approval gates for risky workflows
- budget thresholds per team and workflow

### 4. Replay and debugging

Add:

- step-level traces
- prompt / response diffs
- tool invocation logs
- failure clustering

### 5. Executive reporting

Add:

- department scorecards
- weekly cost trend reports
- vendor benchmarking
- ROI dashboards

## Suggested commercial packaging

One good way to package the product:

### Core plan

- unified dashboard
- provider connectors
- control score
- basic cost leak detection

### Growth plan

- alerts
- budget policies
- team-level benchmarking
- workflow drilldowns

### Enterprise plan

- audit logs
- governance policies
- SSO / RBAC
- data residency options
- procurement reports
- custom scoring logic

## Why this product can stand out

A lot of AI tooling is either:

- vendor specific
- prompt centric
- developer centric
- too focused on raw token analytics

This idea is stronger when framed as an **operating system for agent governance**, especially with:

- provider-agnostic telemetry
- a normalized score decision-makers can understand
- explicit budget leak detection
- breadcrumbs for replay and accountability

That combination is a credible USP.

## Notes for extension

- The current server keeps runtime data in `data/runtime-runs.json`.
- The seed data lives in `data/sample-runs.json`.
- The ingestion API upserts runs by `id`.
- The frontend calls the backend directly with simple fetch requests.

## Demo script

If you are pitching this product, a clean demo flow is:

1. Open the dashboard and show cross-provider visibility.
2. Explain the Control Score as a normalized decision layer.
3. Open the Leak Radar and show where retries are wasting money.
4. Ingest a new run through the API and refresh the dashboard.
5. Explain how enterprises could plug in their own agents with a thin adapter.

## Summary

This repository gives you a strong product foundation, not just a UI mock:

- working backend
- working frontend
- sample data
- reusable adapters
- a crisp USP
- a README that helps sell and extend the idea

If you want, the next step I’d recommend is upgrading this into a real multi-tenant SaaS version with authentication, database persistence, alerts, and live provider connectors.
