#!/usr/bin/env node
// Quick dashboard seed — posts varied runs to trigger all Token Coach scenarios.
// Usage: PRISM_KEY=acp_xxx node seed_dashboard.js
// Optional: PRISM_URL=http://localhost:3000 (defaults to local)

const PRISM_URL = process.env.PRISM_URL || "http://localhost:3000";
const PRISM_KEY = process.env.PRISM_KEY || "";

if (!PRISM_KEY) {
  console.error("Set PRISM_KEY env var (your acp_... API key)");
  process.exit(1);
}

function ago(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// Runs are designed to trigger specific Token Coach scenarios:
// - High input ratio  → "Trim repeated context"
// - High output ratio → "Cap verbose responses"
// - Retry waste       → "Eliminate retry token waste"
// - Large agent       → "Right-size agent"
// - Budget breach     → Cost Leak Radar
const runs = [
  // HIGH INPUT — input 88% (triggers trim-context suggestion)
  { agentName: "Code Review Agent", provider: "Anthropic", model: "claude-haiku-3", workflow: "pr-review",
    tokensIn: 9200, tokensOut: 1300, costUsd: 0.0031, budgetUsd: 0.005, latencyMs: 3100,
    status: "success", retryCount: 0, startTime: ago(50), endTime: ago(49) },
  { agentName: "Code Review Agent", provider: "Anthropic", model: "claude-haiku-3", workflow: "pr-review",
    tokensIn: 8800, tokensOut: 900, costUsd: 0.0028, budgetUsd: 0.005, latencyMs: 2900,
    status: "success", retryCount: 0, startTime: ago(40), endTime: ago(39) },

  // HIGH OUTPUT — output 52% (triggers cap-verbose suggestion)
  { agentName: "Report Generator", provider: "OpenAI", model: "gpt-4.1-mini", workflow: "reporting",
    tokensIn: 1800, tokensOut: 1950, costUsd: 0.0022, budgetUsd: 0.004, latencyMs: 4200,
    status: "success", retryCount: 0, startTime: ago(35), endTime: ago(34) },
  { agentName: "Report Generator", provider: "OpenAI", model: "gpt-4.1-mini", workflow: "reporting",
    tokensIn: 1600, tokensOut: 2100, costUsd: 0.0024, budgetUsd: 0.004, latencyMs: 4800,
    status: "success", retryCount: 0, startTime: ago(25), endTime: ago(24) },

  // RETRY WASTE — 3 retries on a single run (triggers retry suggestion + cost leak)
  { agentName: "Data Pipeline Agent", provider: "Anthropic", model: "claude-sonnet-4-5", workflow: "etl",
    tokensIn: 4100, tokensOut: 800, costUsd: 1.85, budgetUsd: 1.00, latencyMs: 18000,
    status: "failed", retryCount: 3, startTime: ago(20), endTime: ago(17) },

  // LARGE AGENT — 14k avg tokens/run (triggers right-size suggestion)
  { agentName: "Full Codebase Scanner", provider: "Anthropic", model: "claude-sonnet-4-5", workflow: "security-scan",
    tokensIn: 11200, tokensOut: 3400, costUsd: 0.092, budgetUsd: 0.1, latencyMs: 12000,
    status: "success", retryCount: 0, startTime: ago(15), endTime: ago(13) },
  { agentName: "Full Codebase Scanner", provider: "Anthropic", model: "claude-sonnet-4-5", workflow: "security-scan",
    tokensIn: 10800, tokensOut: 3100, costUsd: 0.085, budgetUsd: 0.1, latencyMs: 11500,
    status: "success", retryCount: 0, startTime: ago(10), endTime: ago(8) },

  // BUDGET BREACH — cost > budget (triggers cost leak radar)
  { agentName: "Support Triage Bot", provider: "OpenAI", model: "gpt-4o", workflow: "support",
    tokensIn: 3200, tokensOut: 1100, costUsd: 2.40, budgetUsd: 1.00, latencyMs: 5500,
    status: "success", retryCount: 0, userSatisfaction: 2, startTime: ago(5), endTime: ago(4) },

  // HEALTHY RUN — good mix, no issues (provider comparison baseline)
  { agentName: "Classifier Agent", provider: "OpenAI", model: "gpt-4.1-mini", workflow: "classification",
    tokensIn: 800, tokensOut: 200, costUsd: 0.0004, budgetUsd: 0.002, latencyMs: 900,
    status: "success", retryCount: 0, startTime: ago(3), endTime: ago(2) },
  { agentName: "Classifier Agent", provider: "OpenAI", model: "gpt-4.1-mini", workflow: "classification",
    tokensIn: 750, tokensOut: 210, costUsd: 0.0004, budgetUsd: 0.002, latencyMs: 850,
    status: "success", retryCount: 0, startTime: ago(2), endTime: ago(1) },
];

async function post(run, i) {
  const label = `[${i + 1}/${runs.length}] ${run.agentName} (${run.workflow})`;
  try {
    const res = await fetch(`${PRISM_URL}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": PRISM_KEY },
      body: JSON.stringify({ source: "generic", payload: run })
    });
    const text = await res.text();
    if (!res.ok) { console.error(`  FAIL ${res.status}: ${text}`); return; }
    console.log(`  OK  ${label}  ${run.tokensIn}in + ${run.tokensOut}out  $${run.costUsd}`);
  } catch (err) {
    console.error(`  ERR ${label}: ${err.message}`);
  }
}

console.log(`Seeding ${runs.length} runs → ${PRISM_URL}\n`);
(async () => {
  for (let i = 0; i < runs.length; i++) await post(runs[i], i);
  console.log("\nDone. Refresh Token Coach — you should see:");
  console.log("  • Efficiency score < 80 (mixed quality)");
  console.log("  • Cost Leak Radar: 2 flagged runs (retry spiral + budget breach)");
  console.log("  • Action Plan: trim context, cap output, retry waste, right-size agent");
  console.log("  • Provider comparison: Anthropic vs OpenAI scorecard");
})();
