#!/usr/bin/env node
/**
 * seed_ml_demo.js — Seeds 42 realistic agent runs to activate ML analytics.
 *
 * Activates:
 *   1. Isolation Forest  — needs 30+ runs (trains on token/cost/latency patterns)
 *   2. Logistic Regression — open Activity tab, 👍 clearly-good runs, 👎 bad ones (20 needed)
 *
 * Run:
 *   PRISM_KEY=acp_... node seed_ml_demo.js
 *   PRISM_KEY=acp_... PRISM_URL=https://your-app.onrender.com node seed_ml_demo.js
 *
 * Get your PRISM_KEY: Admin tab → Workspace Credentials section.
 */

const ENDPOINT     = process.env.PRISM_URL    || "http://localhost:3000";
const API_KEY      = process.env.PRISM_KEY    || "";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

if (!API_KEY) {
  console.error(`
  Missing PRISM_KEY.

  1. Open Agent Prism → Admin tab
  2. Scroll to "Workspace Credentials" → copy your acp_... key
  3. Run:  PRISM_KEY=acp_xxx node seed_ml_demo.js

  For production:
     PRISM_KEY=acp_xxx PRISM_URL=https://your-app.onrender.com node seed_ml_demo.js
`);
  process.exit(1);
}

function ago(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
function end(startAgo, durationMs) {
  return new Date(Date.now() - startAgo * 60_000 + durationMs).toISOString();
}

// ── 42 runs across 8 agents, 4 providers, 6 workflows ─────────────────────────
// Grouped by ML label expectation (shown in comments for labeling guide below).
// The IsoForest picks up statistical outliers automatically.

const runs = [

  // ── CLEARLY VALUABLE (label 👍) — fast, cheap, successful ──────────────────
  { agentName: "PR Review Bot",       provider: "Anthropic", model: "claude-haiku-4-5-20251001", workflow: "code-review",
    tokensIn: 2100, tokensOut: 680,  costUsd: 0.0009, budgetUsd: 0.005, latencyMs: 1200,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(180), endTime: end(180, 1200) },

  { agentName: "PR Review Bot",       provider: "Anthropic", model: "claude-haiku-4-5-20251001", workflow: "code-review",
    tokensIn: 1900, tokensOut: 540,  costUsd: 0.0008, budgetUsd: 0.005, latencyMs: 1050,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(170), endTime: end(170, 1050) },

  { agentName: "Classifier Agent",    provider: "OpenAI",    model: "gpt-4.1-mini",              workflow: "classification",
    tokensIn: 720,  tokensOut: 180,  costUsd: 0.0003, budgetUsd: 0.002, latencyMs: 700,
    status: "success", retryCount: 0, autonomyLevel: 1, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(160), endTime: end(160, 700) },

  { agentName: "Classifier Agent",    provider: "OpenAI",    model: "gpt-4.1-mini",              workflow: "classification",
    tokensIn: 690,  tokensOut: 200,  costUsd: 0.0003, budgetUsd: 0.002, latencyMs: 680,
    status: "success", retryCount: 0, autonomyLevel: 1, policyViolations: 0, userSatisfaction: 4,
    startTime: ago(155), endTime: end(155, 680) },

  { agentName: "Classifier Agent",    provider: "OpenAI",    model: "gpt-4.1-mini",              workflow: "classification",
    tokensIn: 810,  tokensOut: 220,  costUsd: 0.0004, budgetUsd: 0.002, latencyMs: 750,
    status: "success", retryCount: 0, autonomyLevel: 1, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(150), endTime: end(150, 750) },

  { agentName: "Support Triage Bot",  provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "support",
    tokensIn: 3200, tokensOut: 900,  costUsd: 0.021,  budgetUsd: 0.05,  latencyMs: 2800,
    status: "success", retryCount: 0, autonomyLevel: 3, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(145), endTime: end(145, 2800) },

  { agentName: "Support Triage Bot",  provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "support",
    tokensIn: 2900, tokensOut: 850,  costUsd: 0.019,  budgetUsd: 0.05,  latencyMs: 2600,
    status: "success", retryCount: 0, autonomyLevel: 3, policyViolations: 0, userSatisfaction: 4,
    startTime: ago(140), endTime: end(140, 2600) },

  { agentName: "SQL Query Agent",     provider: "OpenAI",    model: "gpt-4o",                   workflow: "analytics",
    tokensIn: 1400, tokensOut: 420,  costUsd: 0.006,  budgetUsd: 0.02,  latencyMs: 1800,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(135), endTime: end(135, 1800) },

  { agentName: "SQL Query Agent",     provider: "OpenAI",    model: "gpt-4o",                   workflow: "analytics",
    tokensIn: 1550, tokensOut: 480,  costUsd: 0.007,  budgetUsd: 0.02,  latencyMs: 1950,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(130), endTime: end(130, 1950) },

  { agentName: "PR Review Bot",       provider: "Anthropic", model: "claude-haiku-4-5-20251001", workflow: "code-review",
    tokensIn: 2400, tokensOut: 720,  costUsd: 0.0010, budgetUsd: 0.005, latencyMs: 1300,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 4,
    startTime: ago(125), endTime: end(125, 1300) },

  { agentName: "Doc Writer",          provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "content",
    tokensIn: 1800, tokensOut: 2400, costUsd: 0.031,  budgetUsd: 0.05,  latencyMs: 5200,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(120), endTime: end(120, 5200) },

  { agentName: "Doc Writer",          provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "content",
    tokensIn: 1600, tokensOut: 2200, costUsd: 0.028,  budgetUsd: 0.05,  latencyMs: 4800,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(115), endTime: end(115, 4800) },

  { agentName: "Security Scanner",    provider: "Anthropic", model: "claude-opus-4-8",           workflow: "security-scan",
    tokensIn: 8200, tokensOut: 2100, costUsd: 0.18,   budgetUsd: 0.30,  latencyMs: 9500,
    status: "success", retryCount: 0, autonomyLevel: 4, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(110), endTime: end(110, 9500) },

  { agentName: "Security Scanner",    provider: "Anthropic", model: "claude-opus-4-8",           workflow: "security-scan",
    tokensIn: 7800, tokensOut: 1900, costUsd: 0.17,   budgetUsd: 0.30,  latencyMs: 8900,
    status: "success", retryCount: 0, autonomyLevel: 4, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(105), endTime: end(105, 8900) },

  // ── MEDIOCRE (label 👎 if cost/latency high relative to outcome) ────────────
  { agentName: "Report Generator",    provider: "OpenAI",    model: "gpt-4o",                   workflow: "reporting",
    tokensIn: 5100, tokensOut: 3800, costUsd: 0.42,   budgetUsd: 0.30,  latencyMs: 12000,
    status: "success", retryCount: 1, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 3,
    startTime: ago(100), endTime: end(100, 12000) },

  { agentName: "Report Generator",    provider: "OpenAI",    model: "gpt-4o",                   workflow: "reporting",
    tokensIn: 4800, tokensOut: 3600, costUsd: 0.39,   budgetUsd: 0.30,  latencyMs: 11500,
    status: "success", retryCount: 1, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 3,
    startTime: ago(95), endTime: end(95, 11500) },

  { agentName: "SQL Query Agent",     provider: "OpenAI",    model: "gpt-4o",                   workflow: "analytics",
    tokensIn: 3200, tokensOut: 900,  costUsd: 0.11,   budgetUsd: 0.02,  latencyMs: 6800,
    status: "success", retryCount: 2, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 3,
    startTime: ago(90), endTime: end(90, 6800) },

  { agentName: "Doc Writer",          provider: "Anthropic", model: "claude-opus-4-8",           workflow: "content",
    tokensIn: 2100, tokensOut: 2800, costUsd: 0.22,   budgetUsd: 0.05,  latencyMs: 14000,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 1, userSatisfaction: 2,
    startTime: ago(85), endTime: end(85, 14000) },

  // ── CLEARLY NOT VALUABLE (label 👎) — failed, over budget, retries ──────────
  { agentName: "Data Pipeline Agent", provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "etl",
    tokensIn: 6200, tokensOut: 1100, costUsd: 1.85,   budgetUsd: 1.00,  latencyMs: 22000,
    status: "failed", retryCount: 4, autonomyLevel: 3, policyViolations: 1, userSatisfaction: 1,
    startTime: ago(80), endTime: end(80, 22000) },

  { agentName: "Data Pipeline Agent", provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "etl",
    tokensIn: 5800, tokensOut: 900,  costUsd: 1.62,   budgetUsd: 1.00,  latencyMs: 19500,
    status: "failed", retryCount: 3, autonomyLevel: 3, policyViolations: 2, userSatisfaction: 1,
    startTime: ago(75), endTime: end(75, 19500) },

  { agentName: "Security Scanner",    provider: "Anthropic", model: "claude-opus-4-8",           workflow: "security-scan",
    tokensIn: 12000, tokensOut: 800, costUsd: 0.62,   budgetUsd: 0.30,  latencyMs: 35000,
    status: "failed", retryCount: 3, autonomyLevel: 4, policyViolations: 2, userSatisfaction: 1,
    startTime: ago(70), endTime: end(70, 35000) },

  { agentName: "PR Review Bot",       provider: "Anthropic", model: "claude-haiku-4-5-20251001", workflow: "code-review",
    tokensIn: 3800, tokensOut: 200,  costUsd: 0.018,  budgetUsd: 0.005, latencyMs: 18000,
    status: "failed", retryCount: 5, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 1,
    startTime: ago(65), endTime: end(65, 18000) },

  { agentName: "Support Triage Bot",  provider: "OpenAI",    model: "gpt-4o",                   workflow: "support",
    tokensIn: 4100, tokensOut: 600,  costUsd: 2.40,   budgetUsd: 0.05,  latencyMs: 8500,
    status: "failed", retryCount: 2, autonomyLevel: 3, policyViolations: 3, userSatisfaction: 1,
    startTime: ago(60), endTime: end(60, 8500) },

  // ── MORE NORMAL RUNS (IsoForest baseline) ──────────────────────────────────
  { agentName: "Classifier Agent",    provider: "OpenAI",    model: "gpt-4.1-mini",              workflow: "classification",
    tokensIn: 760,  tokensOut: 195,  costUsd: 0.0003, budgetUsd: 0.002, latencyMs: 720,
    status: "success", retryCount: 0, autonomyLevel: 1, policyViolations: 0, userSatisfaction: 4,
    startTime: ago(58), endTime: end(58, 720) },

  { agentName: "PR Review Bot",       provider: "Anthropic", model: "claude-haiku-4-5-20251001", workflow: "code-review",
    tokensIn: 2250, tokensOut: 660,  costUsd: 0.0009, budgetUsd: 0.005, latencyMs: 1180,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 4,
    startTime: ago(55), endTime: end(55, 1180) },

  { agentName: "SQL Query Agent",     provider: "OpenAI",    model: "gpt-4o",                   workflow: "analytics",
    tokensIn: 1480, tokensOut: 440,  costUsd: 0.0062, budgetUsd: 0.02,  latencyMs: 1820,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(52), endTime: end(52, 1820) },

  { agentName: "Doc Writer",          provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "content",
    tokensIn: 1700, tokensOut: 2300, costUsd: 0.029,  budgetUsd: 0.05,  latencyMs: 5000,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(49), endTime: end(49, 5000) },

  { agentName: "Support Triage Bot",  provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "support",
    tokensIn: 3100, tokensOut: 870,  costUsd: 0.020,  budgetUsd: 0.05,  latencyMs: 2700,
    status: "success", retryCount: 0, autonomyLevel: 3, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(46), endTime: end(46, 2700) },

  { agentName: "Classifier Agent",    provider: "OpenAI",    model: "gpt-4.1-mini",              workflow: "classification",
    tokensIn: 800,  tokensOut: 210,  costUsd: 0.0003, budgetUsd: 0.002, latencyMs: 740,
    status: "success", retryCount: 0, autonomyLevel: 1, policyViolations: 0, userSatisfaction: 4,
    startTime: ago(43), endTime: end(43, 740) },

  { agentName: "Security Scanner",    provider: "Anthropic", model: "claude-opus-4-8",           workflow: "security-scan",
    tokensIn: 8500, tokensOut: 2000, costUsd: 0.19,   budgetUsd: 0.30,  latencyMs: 9200,
    status: "success", retryCount: 0, autonomyLevel: 4, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(40), endTime: end(40, 9200) },

  { agentName: "PR Review Bot",       provider: "Anthropic", model: "claude-haiku-4-5-20251001", workflow: "code-review",
    tokensIn: 2050, tokensOut: 610,  costUsd: 0.0008, budgetUsd: 0.005, latencyMs: 1100,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(37), endTime: end(37, 1100) },

  { agentName: "SQL Query Agent",     provider: "OpenAI",    model: "gpt-4o",                   workflow: "analytics",
    tokensIn: 1520, tokensOut: 460,  costUsd: 0.0065, budgetUsd: 0.02,  latencyMs: 1870,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(34), endTime: end(34, 1870) },

  { agentName: "Doc Writer",          provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "content",
    tokensIn: 1650, tokensOut: 2100, costUsd: 0.027,  budgetUsd: 0.05,  latencyMs: 4600,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 4,
    startTime: ago(31), endTime: end(31, 4600) },

  { agentName: "Support Triage Bot",  provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "support",
    tokensIn: 3050, tokensOut: 820,  costUsd: 0.018,  budgetUsd: 0.05,  latencyMs: 2550,
    status: "success", retryCount: 0, autonomyLevel: 3, policyViolations: 0, userSatisfaction: 4,
    startTime: ago(28), endTime: end(28, 2550) },

  // ── STATISTICAL ANOMALIES — IsoForest should flag these ────────────────────
  // Anomaly 1: astronomical token count (context leak)
  { agentName: "Data Pipeline Agent", provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "etl",
    tokensIn: 95000, tokensOut: 200, costUsd: 4.20,   budgetUsd: 1.00,  latencyMs: 95000,
    status: "failed", retryCount: 6, autonomyLevel: 3, policyViolations: 0, userSatisfaction: 1,
    startTime: ago(25), endTime: end(25, 95000) },

  // Anomaly 2: near-zero output (model stuck / silent failure)
  { agentName: "Report Generator",    provider: "OpenAI",    model: "gpt-4o",                   workflow: "reporting",
    tokensIn: 18000, tokensOut: 12,  costUsd: 0.35,   budgetUsd: 0.30,  latencyMs: 62000,
    status: "failed", retryCount: 2, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 1,
    startTime: ago(22), endTime: end(22, 62000) },

  // Anomaly 3: cost spike — same agent as normal but 50x cost
  { agentName: "Classifier Agent",    provider: "OpenAI",    model: "gpt-4o",                   workflow: "classification",
    tokensIn: 42000, tokensOut: 8500, costUsd: 3.80,  budgetUsd: 0.002, latencyMs: 45000,
    status: "success", retryCount: 0, autonomyLevel: 1, policyViolations: 0, userSatisfaction: 2,
    startTime: ago(19), endTime: end(19, 45000) },

  // Recent normal runs (most recent = top of Activity tab)
  { agentName: "PR Review Bot",       provider: "Anthropic", model: "claude-haiku-4-5-20251001", workflow: "code-review",
    tokensIn: 2180, tokensOut: 640,  costUsd: 0.0009, budgetUsd: 0.005, latencyMs: 1150,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(12), endTime: end(12, 1150) },

  { agentName: "SQL Query Agent",     provider: "OpenAI",    model: "gpt-4o",                   workflow: "analytics",
    tokensIn: 1460, tokensOut: 430,  costUsd: 0.0060, budgetUsd: 0.02,  latencyMs: 1780,
    status: "success", retryCount: 0, autonomyLevel: 2, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(8), endTime: end(8, 1780) },

  { agentName: "Classifier Agent",    provider: "OpenAI",    model: "gpt-4.1-mini",              workflow: "classification",
    tokensIn: 770,  tokensOut: 205,  costUsd: 0.0003, budgetUsd: 0.002, latencyMs: 710,
    status: "success", retryCount: 0, autonomyLevel: 1, policyViolations: 0, userSatisfaction: 5,
    startTime: ago(4), endTime: end(4, 710) },

  { agentName: "Support Triage Bot",  provider: "Anthropic", model: "claude-sonnet-4-6",         workflow: "support",
    tokensIn: 3080, tokensOut: 840,  costUsd: 0.019,  budgetUsd: 0.05,  latencyMs: 2620,
    status: "success", retryCount: 0, autonomyLevel: 3, policyViolations: 0, userSatisfaction: 4,
    startTime: ago(2), endTime: end(2, 2620) },
];

// ── Ingest ─────────────────────────────────────────────────────────────────────
// Runs use environment:"staging" to bypass the production certification gate.
// ML models (IsoForest, LR) train on all runs regardless of environment.

async function post(run, i) {
  const label = `[${String(i + 1).padStart(2)}/${runs.length}]  ${run.agentName.padEnd(22)} ${run.workflow.padEnd(14)} $${run.costUsd.toFixed(4)}  ${run.status}`;
  let attempts = 0;
  while (attempts < 5) {
    try {
      const res = await fetch(`${ENDPOINT}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({ source: "generic", payload: { ...run, environment: "staging" } })
      });
      if (res.status === 429) {
        let retryAfter = 35;
        try { retryAfter = (await res.json()).message?.match(/(\d+) seconds/)?.[1] ?? 35; } catch (_) {}
        retryAfter = parseInt(retryAfter, 10) + 2;
        process.stdout.write(`  ⏳ rate-limited, waiting ${retryAfter}s…\r`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        attempts++;
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        console.error(`  FAIL ${label} → ${res.status} ${text}`);
        return false;
      }
      console.log(`  ✓  ${label}`);
      return true;
    } catch (err) {
      console.error(`  ERR ${label} → ${err.message}`);
      return false;
    }
  }
  console.error(`  FAIL ${label} → max retries exceeded`);
  return false;
}

// ── Upgrade tenant plan to enterprise-trial via admin ─────────────────────────
async function upgradePlan() {
  if (!ADMIN_SECRET) return false;
  try {
    // Get tenant ID from /api/me
    const me = await fetch(`${ENDPOINT}/api/me`, {
      headers: { "x-api-key": API_KEY }
    }).then(r => r.json()).catch(() => null);
    if (!me?.tenant?.id) return false;

    const r = await fetch(`${ENDPOINT}/api/admin/tenant/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN_SECRET },
      body: JSON.stringify({ tenantId: me.tenant.id, plan: "enterprise-trial" })
    });
    if (r.ok) { console.log(`  ✓ plan upgraded → enterprise-trial (no rate limit)\n`); return true; }
    const err = await r.json().catch(() => ({}));
    console.log(`  ~ plan upgrade failed: ${err.message || r.status} (continuing anyway)\n`);
    return false;
  } catch (e) {
    console.log(`  ~ plan upgrade error: ${e.message} (continuing anyway)\n`);
    return false;
  }
}

console.log(`\nAgent Prism ML Seed  →  ${ENDPOINT}`);
console.log(`Sending ${runs.length} runs across 8 agents, 4 providers\n`);

(async () => {
  // Try to upgrade plan so rate limit doesn't block seeding.
  // Set ADMIN_SECRET env var to enable: ADMIN_SECRET=xxx PRISM_KEY=acp_... node seed_ml_demo.js
  if (ADMIN_SECRET) {
    process.stdout.write(`Upgrading tenant plan to enterprise-trial...\n`);
    await upgradePlan();
  } else {
    console.log(`Tip: set ADMIN_SECRET=xxx to auto-upgrade plan and skip rate limiting.\n`);
  }

  let ok = 0;
  for (let i = 0; i < runs.length; i++) {
    const success = await post(runs[i], i);
    if (success) ok++;
    await new Promise(r => setTimeout(r, 120)); // 120ms ≈ 500 req/min well under enterprise limits
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Done: ${ok}/${runs.length} runs ingested`);
  console.log(`\nNext steps to activate ML:\n`);
  console.log(`  1. ISOLATION FOREST — auto-trains in ~60s (needs 30+ runs)`);
  console.log(`     Check: Admin tab → ML Analytics panel → "🟢 ACTIVE"`);
  console.log(`     Watch: Cost Leaks tab — 3 anomalous runs will be flagged`);
  console.log(`            with detectionMethod: "isolation_forest"\n`);
  console.log(`  2. LOGISTIC REGRESSION — needs 20 labeled runs`);
  console.log(`     a) Open Activity tab`);
  console.log(`     b) Expand each run row (click ▼)`);
  console.log(`     c) Label with 👍 / 👎 using this guide:\n`);
  console.log(`     👍 VALUABLE (label these ~20 runs):`);
  console.log(`        PR Review Bot       — cheap, fast, success`);
  console.log(`        Classifier Agent    — tiny, always success`);
  console.log(`        SQL Query Agent     — good latency, success`);
  console.log(`        Support Triage Bot  — within budget, success`);
  console.log(`        Security Scanner    — expensive but worth it`);
  console.log(`        Doc Writer          — success runs only\n`);
  console.log(`     👎 NOT VALUABLE (label these ~5 runs):`);
  console.log(`        Data Pipeline Agent — failed, retry spiral`);
  console.log(`        Report Generator    — over budget, slow`);
  console.log(`        Any failed run      — retryCount > 2\n`);
  console.log(`     After 20 labels: Admin → ML Analytics → LR shows "🟢 ACTIVE"`);
  console.log(`     Control scores on new runs switch to 🤖 ML scoring\n`);
  console.log(`  3. LLM CLASSIFIER — set ANTHROPIC_API_KEY env var on server`);
  console.log(`     (already labels task_type async on every new ingest)\n`);
})();
