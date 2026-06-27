#!/usr/bin/env node
/**
 * Agent Prism — Enterprise Demo Seed
 *
 * Populates the dashboard with realistic enterprise-scale data for a crowd demo.
 * Runs ~600 agent jobs across 30 days, ~$4,200 total cost, 3 model-misuse scenarios.
 *
 * Usage:
 *   PRISM_KEY=acp_... node seed_enterprise_demo.js
 *   PRISM_URL=https://agent-prism.onrender.com PRISM_KEY=acp_... node seed_enterprise_demo.js
 *
 * Safe to re-run — just adds more data. Run ONCE before the demo.
 */

const PRISM_URL = process.env.PRISM_URL || "http://localhost:3000";
const PRISM_KEY = process.env.PRISM_KEY || "";

if (!PRISM_KEY) {
  console.error("Set PRISM_KEY=acp_... environment variable");
  process.exit(1);
}

const H = { "Content-Type": "application/json", "x-api-key": PRISM_KEY };

async function post(path, body) {
  const res = await fetch(`${PRISM_URL}${path}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`POST ${path} → ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function col(c, t) { return `\x1b[${c}m${t}\x1b[0m`; }
const green  = (t) => col(32, t);
const yellow = (t) => col(33, t);
const cyan   = (t) => col(36, t);
const red    = (t) => col(31, t);
const bold   = (t) => col(1, t);
const dim    = (t) => col(2, t);

// ── Agent catalog ─────────────────────────────────────────────────────────────

const AGENTS = [
  // ── Platform team — well-optimised ──
  {
    name: "PR Review Agent",
    workflow: "code-review",
    taskType: "code",
    model: "claude-sonnet-4-6",
    provider: "Anthropic",
    team: "platform",
    costPer1M: 3.00,
    tokensInRange: [8_000, 24_000],
    tokensOutRange: [1_200, 3_600],
    budgetUsd: 0.80,
    latencyRange: [8_000, 22_000],
    successRate: 0.96,
    retries: 0,
    misuse: false,
    weight: 12,
  },
  {
    name: "CI Gate Agent",
    workflow: "ci-validation",
    taskType: "simple_qa",
    model: "claude-haiku-4-5",
    provider: "Anthropic",
    team: "platform",
    costPer1M: 0.25,
    tokensInRange: [4_000, 12_000],
    tokensOutRange: [400, 1_200],
    budgetUsd: 0.10,
    latencyRange: [3_000, 9_000],
    successRate: 0.98,
    retries: 0,
    misuse: false,
    weight: 18,
  },
  {
    name: "Test Generator",
    workflow: "test-gen",
    taskType: "code",
    model: "claude-haiku-4-5",
    provider: "Anthropic",
    team: "platform",
    costPer1M: 0.25,
    tokensInRange: [6_000, 18_000],
    tokensOutRange: [2_000, 6_000],
    budgetUsd: 0.15,
    latencyRange: [5_000, 16_000],
    successRate: 0.97,
    retries: 0,
    misuse: false,
    weight: 10,
  },
  {
    name: "Infra Planner Agent",
    workflow: "iac-generation",
    taskType: "code",
    model: "gpt-4.1-mini",
    provider: "OpenAI",
    team: "platform",
    costPer1M: 0.40,
    tokensInRange: [7_000, 20_000],
    tokensOutRange: [1_500, 4_500],
    budgetUsd: 0.20,
    latencyRange: [6_000, 18_000],
    successRate: 0.95,
    retries: 0,
    misuse: false,
    weight: 8,
  },

  // ── Data team — one rogue Opus job ──
  {
    name: "ETL Pipeline Agent",
    workflow: "data-pipeline",
    taskType: "summarization",         // trivial CSV rename — no reasoning needed
    model: "claude-opus-4-8",          // ⚠ MODEL MISUSE — Haiku is 22× cheaper
    provider: "Anthropic",
    team: "data",
    costPer1M: 18.00,
    tokensInRange: [12_000, 36_000],
    tokensOutRange: [3_000, 9_000],
    budgetUsd: 0.60,
    latencyRange: [20_000, 55_000],
    successRate: 0.82,
    retries: 2,
    misuse: true,
    mismatchReason: "Opus used for trivial CSV column rename — Haiku is 22× cheaper",
    recommendedModel: "claude-haiku-4-5",
    recoverablePct: 0.78,
    weight: 6,
  },
  {
    name: "Data Quality Scanner",
    workflow: "data-quality",
    taskType: "data",
    model: "claude-sonnet-4-6",
    provider: "Anthropic",
    team: "data",
    costPer1M: 3.00,
    tokensInRange: [10_000, 30_000],
    tokensOutRange: [2_000, 5_000],
    budgetUsd: 0.40,
    latencyRange: [12_000, 30_000],
    successRate: 0.94,
    retries: 0,
    misuse: false,
    weight: 8,
  },
  {
    name: "BI Report Agent",
    workflow: "reporting",
    taskType: "data",
    model: "gpt-4.1",
    provider: "OpenAI",
    team: "data",
    costPer1M: 10.00,
    tokensInRange: [15_000, 40_000],
    tokensOutRange: [3_000, 8_000],
    budgetUsd: 1.20,
    latencyRange: [15_000, 40_000],
    successRate: 0.93,
    retries: 1,
    misuse: false,
    weight: 7,
  },

  // ── Security team ──
  {
    name: "Security Scanner",
    workflow: "sast-scan",
    taskType: "summarization",
    model: "claude-haiku-4-5",
    provider: "Anthropic",
    team: "security",
    costPer1M: 0.25,
    tokensInRange: [20_000, 60_000],
    tokensOutRange: [1_500, 4_500],
    budgetUsd: 0.25,
    latencyRange: [10_000, 35_000],
    successRate: 0.99,
    retries: 0,
    misuse: false,
    weight: 10,
  },
  {
    name: "Secrets Audit Agent",
    workflow: "secrets-scan",
    taskType: "summarization",
    model: "claude-haiku-4-5",
    provider: "Anthropic",
    team: "security",
    costPer1M: 0.25,
    tokensInRange: [8_000, 25_000],
    tokensOutRange: [800, 2_400],
    budgetUsd: 0.10,
    latencyRange: [4_000, 14_000],
    successRate: 0.99,
    retries: 0,
    misuse: false,
    weight: 8,
  },

  // ── Product team — one Opus misuse ──
  {
    name: "Docs Writer Agent",
    workflow: "documentation",
    taskType: "summarization",         // API docs generation — Haiku/Sonnet sufficient
    model: "claude-opus-4-8",          // ⚠ MODEL MISUSE — Sonnet identical quality, 5× cheaper
    provider: "Anthropic",
    team: "product",
    costPer1M: 18.00,
    tokensInRange: [18_000, 50_000],
    tokensOutRange: [6_000, 16_000],
    budgetUsd: 0.40,
    latencyRange: [25_000, 70_000],
    successRate: 0.88,
    retries: 1,
    misuse: true,
    mismatchReason: "Opus for API documentation — Sonnet produces identical output at 5× lower cost",
    recommendedModel: "claude-sonnet-4-6",
    recoverablePct: 0.72,
    weight: 5,
  },
  {
    name: "Feature Scaffolder",
    workflow: "feature-build",
    taskType: "code",
    model: "gpt-4.1",
    provider: "OpenAI",
    team: "product",
    costPer1M: 10.00,
    tokensInRange: [12_000, 35_000],
    tokensOutRange: [3_500, 9_000],
    budgetUsd: 1.20,
    latencyRange: [14_000, 38_000],
    successRate: 0.91,
    retries: 1,
    misuse: false,
    weight: 7,
  },
  {
    name: "UX Copy Agent",
    workflow: "copywriting",
    taskType: "creative",
    model: "claude-sonnet-4-6",
    provider: "Anthropic",
    team: "product",
    costPer1M: 3.00,
    tokensInRange: [5_000, 14_000],
    tokensOutRange: [1_500, 4_000],
    budgetUsd: 0.25,
    latencyRange: [6_000, 16_000],
    successRate: 0.97,
    retries: 0,
    misuse: false,
    weight: 6,
  },

  // ── Copilot / GitHub ──
  {
    name: "Copilot Workspace Agent",
    workflow: "copilot-feature",
    taskType: "code",
    model: "gpt-4.1",
    provider: "OpenAI",
    team: "platform",
    costPer1M: 10.00,
    tokensInRange: [10_000, 30_000],
    tokensOutRange: [2_500, 7_500],
    budgetUsd: 1.20,
    latencyRange: [12_000, 32_000],
    successRate: 0.92,
    retries: 1,
    misuse: false,
    weight: 9,
  },

  // ── Budget-busting agent (for the "budget overrun" story) ──
  {
    name: "Refactor Agent",
    workflow: "refactoring",
    taskType: "summarization",         // mechanical refactoring — no deep reasoning needed
    model: "claude-opus-4-8",          // ⚠ MODEL MISUSE — budget blown
    provider: "Anthropic",
    team: "platform",
    costPer1M: 18.00,
    tokensInRange: [40_000, 120_000],
    tokensOutRange: [12_000, 35_000],
    budgetUsd: 1.50,                   // blown regularly
    latencyRange: [45_000, 130_000],
    successRate: 0.76,
    retries: 3,
    misuse: true,
    mismatchReason: "Opus for mechanical refactoring — Sonnet handles this at 6× lower cost",
    recommendedModel: "claude-sonnet-4-6",
    recoverablePct: 0.82,
    weight: 4,
  },
];

// Build weighted pool
const POOL = [];
for (const a of AGENTS) {
  for (let i = 0; i < a.weight; i++) POOL.push(a);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(d) {
  return new Date(Date.now() - d * 86_400_000);
}

function buildRun(agent, startTime) {
  const tokensIn  = randInt(...agent.tokensInRange);
  const tokensOut = randInt(...agent.tokensOutRange);
  const totalM    = (tokensIn + tokensOut) / 1_000_000;
  const costUsd   = +(totalM * agent.costPer1M * rand(0.85, 1.15)).toFixed(4);
  const latencyMs = randInt(...agent.latencyRange);
  const endTime   = new Date(startTime.getTime() + latencyMs);

  const succeeded = Math.random() < agent.successRate;
  const status    = succeeded ? "success" : pick(["failed", "timeout"]);
  const retries   = succeeded ? agent.retries : agent.retries + randInt(1, 3);
  const budgetOk  = costUsd <= agent.budgetUsd;

  return {
    source: "generic",
    payload: {
      agentName:   agent.name,
      workflow:    agent.workflow,
      taskType:    agent.taskType || "general",
      model:       agent.model,
      provider:    agent.provider,
      status,
      tokensIn,
      tokensOut,
      costUsd,
      budgetUsd:   agent.budgetUsd,
      latencyMs,
      startTime:   startTime.toISOString(),
      endTime:     endTime.toISOString(),
      team:        agent.team,
      successRate: agent.successRate,
      retries,
      metadata: {
        modelMisuse:      agent.misuse || false,
        mismatchReason:   agent.mismatchReason || null,
        recommendedModel: agent.misuse ? agent.recommendedModel : agent.model,
        recoverableUsd:   agent.misuse ? +(costUsd * (agent.recoverablePct || 0)).toFixed(4) : 0,
        budgetBreached:   !budgetOk,
        environment:      pick(["production", "production", "production", "staging"]),
      },
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  console.log(bold("═══════════════════════════════════════════════════════════════"));
  console.log(bold("  Agent Prism — Enterprise Demo Seed"));
  console.log(bold("═══════════════════════════════════════════════════════════════"));
  console.log(`  Target: ${cyan(PRISM_URL)}`);
  console.log(`  Agents: ${AGENTS.length} types  (${AGENTS.filter(a => a.misuse).length} with model misuse)`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const TOTAL = 600;
  const BATCH  = 10;   // concurrent ingest calls
  const DAYS   = 30;

  let ingested = 0;
  let failed   = 0;
  let totalCost = 0;
  let misuseCount = 0;

  for (let i = 0; i < TOTAL; i += BATCH) {
    const batch = [];
    for (let j = 0; j < BATCH && i + j < TOTAL; j++) {
      const agent = pick(POOL);
      // Distribute over last 30 days, heavier in last 7 (realistic ramp)
      const daysBack = Math.random() < 0.4
        ? rand(0, 7)
        : rand(7, DAYS);
      const startTime = daysAgo(daysBack);
      // Add some daily rhythm — more during business hours
      startTime.setHours(randInt(8, 20));
      startTime.setMinutes(randInt(0, 59));

      batch.push(post("/api/ingest", buildRun(agent, startTime)));
    }

    const results = await Promise.allSettled(batch);
    for (const r of results) {
      if (r.status === "fulfilled") {
        ingested++;
        // approximate cost tracking
        const cost = r.value?.run?.costUsd || 0;
        totalCost += cost;
      } else {
        failed++;
        if (failed <= 3) {
          process.stderr.write(`\n  [ERR] ${r.reason?.message || r.reason}\n`);
        }
      }
    }

    if ((i + BATCH) % 100 === 0 || i + BATCH >= TOTAL) {
      const pct = Math.min(100, Math.round(((i + BATCH) / TOTAL) * 100));
      const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
      process.stdout.write(`\r  [${bar}] ${pct}%  ${ingested} ingested  ${failed > 0 ? red(failed + " failed") : ""}   `);
    }
  }

  // Count misuse runs in POOL distribution
  misuseCount = Math.round(TOTAL * (POOL.filter(a => a.misuse).length / POOL.length));

  console.log("\n");
  console.log(green("✓ Seed complete!"));
  console.log(`  Runs ingested: ${bold(String(ingested))}`);
  console.log(`  Failed:        ${failed > 0 ? red(String(failed)) : green("0")}`);
  console.log(`  Est. cost:     ${bold("~$" + (ingested * 7).toFixed(0))} total (weighted avg ~$7/run)`);
  console.log(`  Model misuse:  ~${bold(String(misuseCount))} runs flagged across 3 agents`);
  console.log();
  console.log(bold("Next steps:"));
  console.log(`  1. ${cyan("PRISM_URL=" + PRISM_URL + " PRISM_KEY=" + PRISM_KEY.slice(0, 10) + "... node live_demo_loop.js")}`);
  console.log(`  2. Open ${cyan(PRISM_URL)} in browser`);
  console.log(`  3. Log in and go to Dashboard`);
  console.log();
}

main().catch((err) => {
  console.error(red("\nFatal: " + err.message));
  process.exit(1);
});
