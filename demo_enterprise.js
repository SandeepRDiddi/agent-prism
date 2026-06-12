#!/usr/bin/env node
/**
 * Agent Prism — Enterprise Demo Seed
 *
 * Simulates a 15-developer engineering org (3 teams) using AI coding agents.
 * Seeds both the fleet monitor AND the analytics dashboard with realistic data
 * that tells a compelling story about why you need Agent Prism at scale.
 *
 * Story it tells:
 *   - 4.2M tokens burned today across the team
 *   - $2,847 in agent spend this month
 *   - 3 sessions about to hit context wall (work will be lost)
 *   - 6 orphan ports abandoned by agents (security + resource waste)
 *   - Rate limits hit twice today — blocked entire team for 4 minutes
 *   - One dev spending 8x more than peers on same tasks (wrong model)
 *
 * Usage:
 *   PRISM_KEY=acp_... node demo_enterprise.js
 *   PRISM_URL=https://agent-prism.onrender.com PRISM_KEY=acp_... node demo_enterprise.js
 */

const PRISM_URL = process.env.PRISM_URL || "http://localhost:3000";
const PRISM_KEY = process.env.PRISM_KEY || "";

if (!PRISM_KEY) {
  console.error("Set PRISM_KEY=acp_... environment variable");
  process.exit(1);
}

const headers = { "Content-Type": "application/json", "x-api-key": PRISM_KEY };

function ago(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function ts(minutesAgo) {
  return Date.now() - minutesAgo * 60_000;
}

async function post(path, body) {
  const res = await fetch(`${PRISM_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`POST ${path} → ${res.status}: ${t.slice(0, 120)}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// FLEET DATA — 15 developers, 3 teams
// Each machine posts to /api/fleet/ingest
// ─────────────────────────────────────────────────────────────────────────────

const FLEET = [

  // ── Platform Engineering (5 devs) ─────────────────────────────────────────
  {
    machineId: "alex-mbp-platform",
    hostname: "alex-chen-mbp.local",
    developer: "alex.chen@acme.com",
    online: true, lastSeenMinsAgo: 1,
    sessions: [
      {
        sessionId: "a1b2c3d4-0001-0001-0001-000000000001",
        projectDir: "-Users-alex-acme-auth-service",
        cwd: "/Users/alex/acme/auth-service",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "feat/oauth-refresh",
        totalInputTokens: 12400, totalOutputTokens: 89200,
        totalCacheRead: 1840000, lastContextTokens: 158000,
        contextPct: 79, turnCount: 67, status: "active",
        summary: "Implement OAuth 2.0 refresh token rotation with PKCE",
        lastActivity: ts(2)
      },
      {
        sessionId: "a1b2c3d4-0001-0001-0001-000000000002",
        projectDir: "-Users-alex-acme-auth-service",
        cwd: "/Users/alex/acme/auth-service",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "main",
        totalInputTokens: 3200, totalOutputTokens: 18400,
        totalCacheRead: 340000, lastContextTokens: 42000,
        contextPct: 21, turnCount: 18, status: "recent",
        summary: "Add rate limiting middleware to auth endpoints",
        lastActivity: ts(45)
      }
    ],
    processes: [
      { pid: "23441", cpu: 18.4, mem: 3.1, cmd: "claude", type: "Claude Code" }
    ],
    ports: [
      { port: 3001, pid: "18234", process: "node", isAgentPort: true },
      { port: 5432, pid: "18890", process: "postgres", isAgentPort: false }
    ]
  },

  {
    machineId: "priya-mbp-platform",
    hostname: "priya-sharma-mbp.local",
    developer: "priya.sharma@acme.com",
    online: true, lastSeenMinsAgo: 2,
    sessions: [
      {
        sessionId: "b2c3d4e5-0002-0002-0002-000000000001",
        projectDir: "-Users-priya-acme-api-gateway",
        cwd: "/Users/priya/acme/api-gateway",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "feat/graphql-federation",
        totalInputTokens: 8900, totalOutputTokens: 71300,
        totalCacheRead: 1620000, lastContextTokens: 184000,
        contextPct: 92, turnCount: 81, status: "active",
        summary: "GraphQL federation gateway — schema stitching + auth directives",
        lastActivity: ts(1)
      }
    ],
    processes: [
      { pid: "31122", cpu: 22.1, mem: 2.8, cmd: "claude", type: "Claude Code" }
    ],
    ports: [
      { port: 4000, pid: "31500", process: "node", isAgentPort: true },
      { port: 6379, pid: "31800", process: "redis", isAgentPort: false }
    ]
  },

  {
    machineId: "marcus-mbp-platform",
    hostname: "marcus-johnson-mbp.local",
    developer: "marcus.johnson@acme.com",
    online: true, lastSeenMinsAgo: 4,
    sessions: [
      {
        sessionId: "c3d4e5f6-0003-0003-0003-000000000001",
        projectDir: "-Users-marcus-acme-infra",
        cwd: "/Users/marcus/acme/infra",
        model: "claude-opus-4-8", version: "2.1.170", gitBranch: "terraform-eks-upgrade",
        totalInputTokens: 31000, totalOutputTokens: 142000,
        totalCacheRead: 2140000, lastContextTokens: 172000,
        contextPct: 86, turnCount: 94, status: "active",
        summary: "EKS cluster upgrade 1.28→1.31, migrate node groups, update Helm charts",
        lastActivity: ts(3)
      },
      {
        sessionId: "c3d4e5f6-0003-0003-0003-000000000002",
        projectDir: "-Users-marcus-acme-infra",
        cwd: "/Users/marcus/acme/infra",
        model: "claude-haiku-4-5", version: "2.1.170", gitBranch: "main",
        totalInputTokens: 1200, totalOutputTokens: 8400,
        totalCacheRead: 80000, lastContextTokens: 12000,
        contextPct: 6, turnCount: 9, status: "idle",
        summary: "Generate Terraform docs for VPC module",
        lastActivity: ts(180)
      }
    ],
    processes: [
      { pid: "41233", cpu: 14.2, mem: 2.4, cmd: "claude", type: "Claude Code" }
    ],
    ports: [
      { port: 8080, pid: "41900", process: "node", isAgentPort: true }
    ]
  },

  {
    machineId: "sarah-mbp-platform",
    hostname: "sarah-o-mbp.local",
    developer: "sarah.o@acme.com",
    online: true, lastSeenMinsAgo: 8,
    sessions: [
      {
        sessionId: "d4e5f6a7-0004-0004-0004-000000000001",
        projectDir: "-Users-sarah-acme-security-scanner",
        cwd: "/Users/sarah/acme/security-scanner",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "sast-integration",
        totalInputTokens: 6700, totalOutputTokens: 44200,
        totalCacheRead: 890000, lastContextTokens: 76000,
        contextPct: 38, turnCount: 42, status: "recent",
        summary: "Integrate Semgrep SAST into CI pipeline, custom rule authoring",
        lastActivity: ts(22)
      }
    ],
    processes: [
      { pid: "52341", cpu: 4.1, mem: 1.9, cmd: "claude", type: "Claude Code" }
    ],
    ports: []
  },

  {
    machineId: "ci-bot-platform",
    hostname: "ci-runner-01.internal",
    developer: "ci-bot@acme.com",
    online: false, lastSeenMinsAgo: 187,
    sessions: [
      {
        sessionId: "e5f6a7b8-0005-0005-0005-000000000001",
        projectDir: "-ci-acme-monorepo",
        cwd: "/ci/acme/monorepo",
        model: "claude-haiku-4-5", version: "2.1.168", gitBranch: "main",
        totalInputTokens: 88000, totalOutputTokens: 310000,
        totalCacheRead: 4200000, lastContextTokens: 24000,
        contextPct: 12, turnCount: 340, status: "idle",
        summary: "Automated PR review — 340 PRs processed, lint + test coverage checks",
        lastActivity: ts(190)
      }
    ],
    processes: [],
    ports: [
      { port: 9090, pid: "ORPHAN", process: "node", isAgentPort: true },
      { port: 9091, pid: "ORPHAN", process: "node", isAgentPort: true }
    ]
  },

  // ── Product Engineering (5 devs) ──────────────────────────────────────────
  {
    machineId: "tom-mbp-product",
    hostname: "tom-wilson-mbp.local",
    developer: "tom.wilson@acme.com",
    online: true, lastSeenMinsAgo: 3,
    sessions: [
      {
        sessionId: "f6a7b8c9-0006-0006-0006-000000000001",
        projectDir: "-Users-tom-acme-web-app",
        cwd: "/Users/tom/acme/web-app",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "feat/experiment-flags",
        totalInputTokens: 7800, totalOutputTokens: 52100,
        totalCacheRead: 1100000, lastContextTokens: 88000,
        contextPct: 44, turnCount: 51, status: "active",
        summary: "Feature flag system with gradual rollout and A/B test analytics",
        lastActivity: ts(4)
      }
    ],
    processes: [
      { pid: "61234", cpu: 11.8, mem: 2.2, cmd: "claude", type: "Claude Code" }
    ],
    ports: [
      { port: 3000, pid: "62000", process: "node", isAgentPort: true }
    ]
  },

  {
    machineId: "julia-mbp-product",
    hostname: "julia-kim-mbp.local",
    developer: "julia.kim@acme.com",
    online: true, lastSeenMinsAgo: 1,
    sessions: [
      {
        sessionId: "a7b8c9d0-0007-0007-0007-000000000001",
        projectDir: "-Users-julia-acme-mobile",
        cwd: "/Users/julia/acme/mobile",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "feat/push-notifications",
        totalInputTokens: 9100, totalOutputTokens: 63800,
        totalCacheRead: 1280000, lastContextTokens: 108000,
        contextPct: 54, turnCount: 58, status: "active",
        summary: "Push notification deep links + rich media for iOS/Android",
        lastActivity: ts(1)
      },
      {
        sessionId: "a7b8c9d0-0007-0007-0007-000000000002",
        projectDir: "-Users-julia-acme-design-system",
        cwd: "/Users/julia/acme/design-system",
        model: "claude-haiku-4-5", version: "2.1.170", gitBranch: "tokens-v2",
        totalInputTokens: 2100, totalOutputTokens: 14200,
        totalCacheRead: 210000, lastContextTokens: 18000,
        contextPct: 9, turnCount: 14, status: "recent",
        summary: "Design token migration to CSS custom properties",
        lastActivity: ts(55)
      }
    ],
    processes: [
      { pid: "71122", cpu: 16.3, mem: 2.6, cmd: "claude", type: "Claude Code" }
    ],
    ports: [
      { port: 8081, pid: "71800", process: "node", isAgentPort: true }
    ]
  },

  {
    machineId: "raj-mbp-product",
    hostname: "raj-patel-mbp.local",
    developer: "raj.patel@acme.com",
    online: true, lastSeenMinsAgo: 2,
    sessions: [
      {
        sessionId: "b8c9d0e1-0008-0008-0008-000000000001",
        projectDir: "-Users-raj-acme-payments",
        cwd: "/Users/raj/acme/payments",
        model: "claude-opus-4-8", version: "2.1.170", gitBranch: "feat/stripe-connect",
        totalInputTokens: 42000, totalOutputTokens: 187000,
        totalCacheRead: 3100000, lastContextTokens: 193000,
        contextPct: 97, turnCount: 128, status: "active",
        summary: "Stripe Connect marketplace integration — split payments + escrow logic",
        lastActivity: ts(2)
      }
    ],
    processes: [
      { pid: "81234", cpu: 28.4, mem: 4.1, cmd: "claude", type: "Claude Code" }
    ],
    ports: [
      { port: 3002, pid: "82000", process: "node", isAgentPort: true },
      { port: 4242, pid: "82100", process: "node", isAgentPort: true }
    ]
  },

  {
    machineId: "emma-mbp-product",
    hostname: "emma-davis-mbp.local",
    developer: "emma.davis@acme.com",
    online: true, lastSeenMinsAgo: 12,
    sessions: [
      {
        sessionId: "c9d0e1f2-0009-0009-0009-000000000001",
        projectDir: "-Users-emma-acme-analytics",
        cwd: "/Users/emma/acme/analytics",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "dashboard-v3",
        totalInputTokens: 5600, totalOutputTokens: 38900,
        totalCacheRead: 720000, lastContextTokens: 64000,
        contextPct: 32, turnCount: 36, status: "recent",
        summary: "Revenue analytics dashboard — cohort retention + LTV charts",
        lastActivity: ts(18)
      }
    ],
    processes: [],
    ports: [
      { port: 5173, pid: "ORPHAN", process: "node", isAgentPort: true }
    ]
  },

  {
    machineId: "felix-mbp-product",
    hostname: "felix-wang-mbp.local",
    developer: "felix.wang@acme.com",
    online: false, lastSeenMinsAgo: 420,
    sessions: [
      {
        sessionId: "d0e1f2a3-0010-0010-0010-000000000001",
        projectDir: "-Users-felix-acme-search",
        cwd: "/Users/felix/acme/search",
        model: "claude-sonnet-4-6", version: "2.1.168", gitBranch: "elastic-upgrade",
        totalInputTokens: 4800, totalOutputTokens: 32100,
        totalCacheRead: 610000, lastContextTokens: 52000,
        contextPct: 26, turnCount: 29, status: "idle",
        summary: "Elasticsearch 8.x upgrade + semantic search with embeddings",
        lastActivity: ts(440)
      }
    ],
    processes: [],
    ports: [
      { port: 9200, pid: "ORPHAN", process: "node", isAgentPort: true },
      { port: 5601, pid: "ORPHAN", process: "node", isAgentPort: true }
    ]
  },

  // ── Data & ML (5 devs) ────────────────────────────────────────────────────
  {
    machineId: "ml-pipeline-data",
    hostname: "ml-gpu-server-01.internal",
    developer: "ml-pipeline@acme.com",
    online: true, lastSeenMinsAgo: 1,
    sessions: [
      {
        sessionId: "e1f2a3b4-0011-0011-0011-000000000001",
        projectDir: "-srv-ml-pipeline",
        cwd: "/srv/ml/pipeline",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "training-v4",
        totalInputTokens: 156000, totalOutputTokens: 482000,
        totalCacheRead: 8400000, lastContextTokens: 68000,
        contextPct: 34, turnCount: 412, status: "active",
        summary: "Training pipeline automation — hyperparameter sweep + model checkpointing",
        lastActivity: ts(1)
      },
      {
        sessionId: "e1f2a3b4-0011-0011-0011-000000000002",
        projectDir: "-srv-ml-feature-store",
        cwd: "/srv/ml/feature-store",
        model: "claude-haiku-4-5", version: "2.1.170", gitBranch: "main",
        totalInputTokens: 48000, totalOutputTokens: 162000,
        totalCacheRead: 3200000, lastContextTokens: 31000,
        contextPct: 16, turnCount: 189, status: "active",
        summary: "Feature store ingestion pipeline — 200+ features, real-time + batch",
        lastActivity: ts(3)
      }
    ],
    processes: [
      { pid: "91234", cpu: 34.8, mem: 8.2, cmd: "python3 train.py --agent", type: "Claude Code" },
      { pid: "91235", cpu: 12.1, mem: 4.1, cmd: "python3 feature_pipeline.py", type: "Claude Code" }
    ],
    ports: [
      { port: 8888, pid: "91500", process: "python3", isAgentPort: true },
      { port: 6006, pid: "91600", process: "python3", isAgentPort: true }
    ]
  },

  {
    machineId: "nina-mbp-data",
    hostname: "nina-brown-mbp.local",
    developer: "nina.brown@acme.com",
    online: true, lastSeenMinsAgo: 6,
    sessions: [
      {
        sessionId: "f2a3b4c5-0012-0012-0012-000000000001",
        projectDir: "-Users-nina-acme-data-viz",
        cwd: "/Users/nina/acme/data-viz",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "d3-migration",
        totalInputTokens: 7200, totalOutputTokens: 51400,
        totalCacheRead: 960000, lastContextTokens: 82000,
        contextPct: 41, turnCount: 47, status: "recent",
        summary: "D3.js v7 migration + new heatmap component for retention analytics",
        lastActivity: ts(14)
      }
    ],
    processes: [],
    ports: []
  },

  {
    machineId: "oscar-mbp-data",
    hostname: "oscar-garcia-mbp.local",
    developer: "oscar.garcia@acme.com",
    online: true, lastSeenMinsAgo: 3,
    sessions: [
      {
        sessionId: "a3b4c5d6-0013-0013-0013-000000000001",
        projectDir: "-Users-oscar-acme-recommender",
        cwd: "/Users/oscar/acme/recommender",
        model: "claude-sonnet-4-6", version: "2.1.170", gitBranch: "collab-filter-v2",
        totalInputTokens: 11800, totalOutputTokens: 78200,
        totalCacheRead: 1440000, lastContextTokens: 124000,
        contextPct: 62, turnCount: 71, status: "active",
        summary: "Collaborative filtering model — ALS matrix factorization + cold start",
        lastActivity: ts(4)
      },
      {
        sessionId: "a3b4c5d6-0013-0013-0013-000000000002",
        projectDir: "-Users-oscar-acme-ab-testing",
        cwd: "/Users/oscar/acme/ab-testing",
        model: "claude-haiku-4-5", version: "2.1.170", gitBranch: "bayesian-stats",
        totalInputTokens: 3400, totalOutputTokens: 22100,
        totalCacheRead: 380000, lastContextTokens: 28000,
        contextPct: 14, turnCount: 22, status: "recent",
        summary: "Bayesian A/B testing framework with Thompson sampling",
        lastActivity: ts(38)
      }
    ],
    processes: [
      { pid: "101234", cpu: 19.2, mem: 3.4, cmd: "claude", type: "Claude Code" }
    ],
    ports: [
      { port: 8000, pid: "102000", process: "python3", isAgentPort: true }
    ]
  },

  {
    machineId: "lisa-mbp-data",
    hostname: "lisa-taylor-mbp.local",
    developer: "lisa.taylor@acme.com",
    online: true, lastSeenMinsAgo: 1,
    sessions: [
      {
        sessionId: "b4c5d6e7-0014-0014-0014-000000000001",
        projectDir: "-Users-lisa-acme-etl",
        cwd: "/Users/lisa/acme/etl",
        model: "claude-opus-4-8", version: "2.1.170", gitBranch: "dbt-migration",
        totalInputTokens: 54000, totalOutputTokens: 198000,
        totalCacheRead: 4800000, lastContextTokens: 188000,
        contextPct: 94, turnCount: 156, status: "active",
        summary: "dbt + Airflow migration — 80 models, custom macros, incremental strategies",
        lastActivity: ts(2)
      }
    ],
    processes: [
      { pid: "111234", cpu: 31.4, mem: 5.2, cmd: "claude", type: "Claude Code" }
    ],
    ports: [
      { port: 8793, pid: "112000", process: "python3", isAgentPort: true }
    ]
  },

  {
    machineId: "james-mbp-data",
    hostname: "james-lee-mbp.local",
    developer: "james.lee@acme.com",
    online: false, lastSeenMinsAgo: 312,
    sessions: [
      {
        sessionId: "c5d6e7f8-0015-0015-0015-000000000001",
        projectDir: "-Users-james-acme-warehouse",
        cwd: "/Users/james/acme/warehouse",
        model: "claude-sonnet-4-6", version: "2.1.168", gitBranch: "snowflake-migration",
        totalInputTokens: 8900, totalOutputTokens: 61200,
        totalCacheRead: 1180000, lastContextTokens: 74000,
        contextPct: 37, turnCount: 53, status: "idle",
        summary: "Redshift → Snowflake migration — 120 tables, query rewrite, cost comparison",
        lastActivity: ts(320)
      }
    ],
    processes: [],
    ports: [
      { port: 5439, pid: "ORPHAN", process: "node", isAgentPort: true }
    ]
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD RUNS — 120 runs across agents, models, teams
// Seeds: Overview, Activity, Token Coach, Provider Mix, Cost Leak Radar
// ─────────────────────────────────────────────────────────────────────────────

function run(override) {
  const defaults = {
    source: "generic", provider: "Anthropic", model: "claude-sonnet-4-6",
    status: "success", retryCount: 0, latencyMs: 4200,
    budgetUsd: 0.15, costUsd: 0.08, tokensIn: 8000, tokensOut: 3200,
    autonomyLevel: 3, policyViolations: 0, userSatisfaction: 4,
    environment: "production", team: "platform"
  };
  return { ...defaults, ...override };
}

const RUNS = [

  // ── Platform — Auth Service (claude-sonnet, healthy) ─────────────────────
  ...Array.from({ length: 12 }, (_, i) => run({
    agentName: "Auth Service Agent", workflow: "auth-service", team: "platform",
    model: "claude-sonnet-4-6", provider: "Anthropic",
    tokensIn: 11200 + i * 800, tokensOut: 4100 + i * 300,
    costUsd: +(0.042 + i * 0.003).toFixed(4),
    budgetUsd: 0.10, latencyMs: 3800 + i * 120,
    startTime: ago(i * 18 + 5), endTime: ago(i * 18 + 1),
    promptBreakdown: { systemPromptTokens: 1200, userPromptTokens: 980, contextTokens: 7800 + i * 600, toolResultTokens: 1220 }
  })),

  // ── Platform — CI Review Bot (haiku, high volume, low cost) ───────────────
  ...Array.from({ length: 24 }, (_, i) => run({
    agentName: "PR Review Bot", workflow: "ci-review", team: "platform",
    model: "claude-haiku-4-5-20251001", provider: "Anthropic",
    tokensIn: 3400 + i * 100, tokensOut: 820 + i * 40,
    costUsd: +(0.0008 + i * 0.00004).toFixed(5),
    budgetUsd: 0.005, latencyMs: 1200 + i * 50,
    startTime: ago(i * 8 + 2), endTime: ago(i * 8 + 1),
    promptBreakdown: { systemPromptTokens: 400, userPromptTokens: 280, contextTokens: 2400 + i * 80, toolResultTokens: 320 }
  })),

  // ── Platform — Infrastructure Agent (opus, justified — complex IaC) ───────
  ...Array.from({ length: 6 }, (_, i) => run({
    agentName: "Infrastructure Agent", workflow: "infra-terraform", team: "platform",
    model: "claude-opus-4-8", provider: "Anthropic",
    tokensIn: 28000 + i * 3200, tokensOut: 11400 + i * 1800,
    costUsd: +(0.84 + i * 0.12).toFixed(3),
    budgetUsd: 1.20, latencyMs: 18200 + i * 2100,
    startTime: ago(i * 120 + 10), endTime: ago(i * 120 + 1),
    promptBreakdown: { systemPromptTokens: 3200, userPromptTokens: 1800, contextTokens: 18000 + i * 2000, toolResultTokens: 5000 }
  })),

  // ── Product — Feature Flag Agent (sonnet) ─────────────────────────────────
  ...Array.from({ length: 10 }, (_, i) => run({
    agentName: "Feature Dev Agent", workflow: "feature-development", team: "product",
    model: "claude-sonnet-4-6", provider: "Anthropic",
    tokensIn: 9800 + i * 600, tokensOut: 4200 + i * 280,
    costUsd: +(0.048 + i * 0.004).toFixed(4),
    budgetUsd: 0.12, latencyMs: 4100 + i * 180,
    startTime: ago(i * 25 + 8), endTime: ago(i * 25 + 4),
    promptBreakdown: { systemPromptTokens: 1400, userPromptTokens: 1100, contextTokens: 6800 + i * 400, toolResultTokens: 500 }
  })),

  // ── Product — Payment Agent (opus, WAY OVER budget — big red flag) ────────
  ...Array.from({ length: 8 }, (_, i) => run({
    agentName: "Payment Integration Agent", workflow: "payment-stripe", team: "product",
    model: "claude-opus-4-8", provider: "Anthropic",
    tokensIn: 41000 + i * 5000, tokensOut: 18200 + i * 2400,
    costUsd: +(1.84 + i * 0.28).toFixed(3),
    budgetUsd: 0.30, latencyMs: 22000 + i * 3000,
    retryCount: i > 4 ? 2 : 0,
    userSatisfaction: i > 4 ? 2 : 4,
    startTime: ago(i * 45 + 6), endTime: ago(i * 45 + 2),
    promptBreakdown: { systemPromptTokens: 4800, userPromptTokens: 2100, contextTokens: 28000 + i * 3200, toolResultTokens: 6100 }
  })),

  // ── Product — Support Triage (GPT-4o via OpenAI — for provider comparison) ─
  ...Array.from({ length: 10 }, (_, i) => run({
    agentName: "Support Triage Agent", workflow: "support-triage", team: "product",
    model: "gpt-4o", provider: "OpenAI",
    tokensIn: 4200 + i * 300, tokensOut: 1800 + i * 120,
    costUsd: +(0.062 + i * 0.006).toFixed(4),
    budgetUsd: 0.10, latencyMs: 6800 + i * 400,
    userSatisfaction: 3,
    startTime: ago(i * 30 + 12), endTime: ago(i * 30 + 9),
    promptBreakdown: { systemPromptTokens: 800, userPromptTokens: 620, contextTokens: 2400 + i * 200, toolResultTokens: 380 }
  })),

  // ── Data — ML Pipeline (sonnet, high volume, automated) ───────────────────
  ...Array.from({ length: 20 }, (_, i) => run({
    agentName: "ML Training Agent", workflow: "ml-training", team: "data",
    model: "claude-sonnet-4-6", provider: "Anthropic",
    tokensIn: 18000 + i * 2200, tokensOut: 7400 + i * 800,
    costUsd: +(0.12 + i * 0.018).toFixed(4),
    budgetUsd: 0.35, latencyMs: 8400 + i * 600,
    startTime: ago(i * 14 + 3), endTime: ago(i * 14),
    promptBreakdown: { systemPromptTokens: 2400, userPromptTokens: 1800, contextTokens: 12000 + i * 1400, toolResultTokens: 1800 }
  })),

  // ── Data — ETL Agent (opus, context overflow, RETRY SPIRAL) ──────────────
  ...Array.from({ length: 8 }, (_, i) => run({
    agentName: "ETL Migration Agent", workflow: "dbt-migration", team: "data",
    model: "claude-opus-4-8", provider: "Anthropic",
    tokensIn: 52000 + i * 4000, tokensOut: 21000 + i * 2000,
    costUsd: +(2.24 + i * 0.32).toFixed(3),
    budgetUsd: 0.50,
    retryCount: i > 2 ? 3 : 1,
    status: i > 5 ? "failure" : "success",
    latencyMs: 28000 + i * 4000,
    userSatisfaction: i > 4 ? 1 : 3,
    startTime: ago(i * 60 + 15), endTime: ago(i * 60 + 5),
    promptBreakdown: { systemPromptTokens: 6200, userPromptTokens: 2800, contextTokens: 36000 + i * 2800, toolResultTokens: 7000 }
  })),

  // ── Data — Classifier (haiku, good model fit — contrast with ETL) ─────────
  ...Array.from({ length: 14 }, (_, i) => run({
    agentName: "Data Classifier Agent", workflow: "classification", team: "data",
    model: "claude-haiku-4-5-20251001", provider: "Anthropic",
    tokensIn: 1800 + i * 80, tokensOut: 420 + i * 20,
    costUsd: +(0.0006 + i * 0.00003).toFixed(5),
    budgetUsd: 0.003, latencyMs: 880 + i * 30,
    startTime: ago(i * 5 + 1), endTime: ago(i * 5),
    promptBreakdown: { systemPromptTokens: 320, userPromptTokens: 240, contextTokens: 1100 + i * 50, toolResultTokens: 140 }
  })),

  // ── Codex CLI runs — for agent type diversity ─────────────────────────────
  ...Array.from({ length: 6 }, (_, i) => run({
    agentName: "Codex CLI Agent", workflow: "code-completion", team: "product",
    model: "gpt-4.1", provider: "OpenAI",
    tokensIn: 6200 + i * 400, tokensOut: 2800 + i * 200,
    costUsd: +(0.058 + i * 0.005).toFixed(4),
    budgetUsd: 0.12, latencyMs: 3200 + i * 250,
    startTime: ago(i * 40 + 20), endTime: ago(i * 40 + 18),
    promptBreakdown: { systemPromptTokens: 900, userPromptTokens: 780, contextTokens: 4200 + i * 280, toolResultTokens: 320 }
  })),
];

// ─────────────────────────────────────────────────────────────────────────────
// SEED FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

async function seedFleet() {
  console.log("\n📡 Seeding fleet snapshots (15 machines)...\n");
  let ok = 0, fail = 0;

  for (const machine of FLEET) {
    const { online, lastSeenMinsAgo, ...snapshot } = machine;
    try {
      await post("/api/fleet/ingest", snapshot);
      const statusIcon = online ? "🟢" : "⚫";
      const sessCount = snapshot.sessions.length;
      const orphanPorts = snapshot.ports.filter((p) => p.pid === "ORPHAN").length;
      const activeSess = snapshot.sessions.filter((s) => s.status === "active").length;
      const maxCtx = snapshot.sessions.reduce((n, s) => Math.max(n, s.contextPct || 0), 0);
      const ctxAlert = maxCtx >= 90 ? " 🔴 CONTEXT CRITICAL" : maxCtx >= 80 ? " 🟡 context high" : "";
      const orphanAlert = orphanPorts > 0 ? ` 👻 ${orphanPorts} orphan port${orphanPorts > 1 ? "s" : ""}` : "";
      console.log(`  ${statusIcon} ${snapshot.developer.padEnd(28)} ${String(sessCount + " sess").padEnd(10)} ${String(activeSess + " active").padEnd(12)} ctx:${String(maxCtx + "%").padEnd(6)}${ctxAlert}${orphanAlert}`);
      ok++;
    } catch (err) {
      console.error(`  ❌ ${machine.developer}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n  ✓ ${ok} machines ingested${fail ? `, ${fail} failed` : ""}`);
}

async function seedDashboard() {
  console.log("\n📊 Seeding dashboard runs (", RUNS.length, "runs)...\n");
  let ok = 0, fail = 0;
  const totalTokens = RUNS.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0);
  const totalCost = RUNS.reduce((n, r) => n + r.costUsd, 0);

  for (let i = 0; i < RUNS.length; i++) {
    const r = RUNS[i];
    try {
      await post("/api/ingest", { source: "generic", payload: r });
      ok++;
      if (i % 20 === 0) process.stdout.write(`  ${i + 1}/${RUNS.length} runs posted...\r`);
    } catch (err) {
      fail++;
      if (fail === 1) console.error(`\n  ❌ Run ${i}: ${err.message}`);
    }
  }

  console.log(`  ✓ ${ok} runs ingested — ${(totalTokens / 1000000).toFixed(1)}M tokens, $${totalCost.toFixed(2)} total cost\n`);
}

function printSummary() {
  const totalSessions = FLEET.reduce((n, m) => n + m.sessions.length, 0);
  const activeSessions = FLEET.reduce((n, m) => n + m.sessions.filter((s) => s.status === "active").length, 0);
  const totalFleetTokens = FLEET.reduce((n, m) =>
    n + m.sessions.reduce((s, sess) => s + (sess.totalInputTokens || 0) + (sess.totalOutputTokens || 0), 0), 0);
  const criticalCtx = FLEET.flatMap((m) => m.sessions).filter((s) => (s.contextPct || 0) >= 85).length;
  const orphanPorts = FLEET.reduce((n, m) => n + m.ports.filter((p) => p.pid === "ORPHAN").length, 0);
  const onlineMachines = FLEET.filter((m) => m.online).length;
  const runTokens = RUNS.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0);
  const runCost = RUNS.reduce((n, r) => n + r.costUsd, 0);
  const overBudget = RUNS.filter((r) => r.costUsd > r.budgetUsd).length;

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AGENT PRISM — Enterprise Demo Active");
  console.log("═══════════════════════════════════════════════════════");
  console.log();
  console.log("  FLEET (Live Sessions tab)");
  console.log(`  ├─ ${onlineMachines}/15 machines online`);
  console.log(`  ├─ ${activeSessions} active sessions  (${totalSessions} total)`);
  console.log(`  ├─ ${(totalFleetTokens / 1000000).toFixed(1)}M tokens in active sessions`);
  console.log(`  ├─ ${criticalCtx} sessions at critical context (≥85%) — will lose work`);
  console.log(`  └─ ${orphanPorts} orphan ports abandoned by offline agents`);
  console.log();
  console.log("  DASHBOARD (Overview / Token Coach / Activity tabs)");
  console.log(`  ├─ ${RUNS.length} agent runs ingested`);
  console.log(`  ├─ ${(runTokens / 1000000).toFixed(1)}M tokens tracked`);
  console.log(`  ├─ $${runCost.toFixed(2)} in agent spend`);
  console.log(`  └─ ${overBudget} runs over budget — cost leak radar will fire`);
  console.log();
  console.log("  PAIN POINTS VISIBLE AT A GLANCE");
  console.log("  🔴  raj.patel — payment agent at 97% context, $1.84/run vs $0.30 budget");
  console.log("  🔴  lisa.taylor — ETL agent at 94% context, retry spiral detected");
  console.log("  🟡  priya.sharma — API gateway at 92% context");
  console.log("  🟡  marcus.johnson — infra agent at 86% context");
  console.log("  👻  felix.wang (offline) — 2 orphan ports left running");
  console.log("  👻  ci-bot (offline) — 2 orphan ports left running");
  console.log("  💸  ETL agent spending 8x budget on wrong model (opus for scripted tasks)");
  console.log();
  console.log(`  → Open: ${PRISM_URL}`);
  console.log("═══════════════════════════════════════════════════════");
}

(async () => {
  console.log(`\nAgent Prism Enterprise Demo Seed`);
  console.log(`Target: ${PRISM_URL}\n`);

  await seedFleet();
  await seedDashboard();
  printSummary();
})().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
