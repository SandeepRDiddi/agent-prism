#!/usr/bin/env node
/**
 * Agent Prism — Model Fitness + Prompt Capture Demo
 *
 * Usage:
 *   PRISM_URL=https://agent-prism.onrender.com \
 *   PRISM_KEY=acp_your_key \
 *   ANTHROPIC_KEY=sk-ant-your-key \
 *   node demo_model_fitness.js
 *
 * Optional (auto-creates API key + connector):
 *   ADMIN_SECRET=your_admin_secret \
 *   ANTHROPIC_KEY=sk-ant-your-key \
 *   node demo_model_fitness.js
 */

const PRISM_URL   = process.env.PRISM_URL   || "https://agent-prism.onrender.com";
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || "";
const ADMIN_SECRET  = process.env.ADMIN_SECRET  || "";
let   PRISM_KEY     = process.env.PRISM_KEY     || "";

if (!ANTHROPIC_KEY) {
  console.error("❌  Set ANTHROPIC_KEY=sk-ant-...");
  process.exit(1);
}
if (!PRISM_KEY && !ADMIN_SECRET) {
  console.error("❌  Set PRISM_KEY=acp_... or ADMIN_SECRET=... to auto-bootstrap");
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function col(code, text) { return `\x1b[${code}m${text}\x1b[0m`; }
const green  = t => col(32, t);
const yellow = t => col(33, t);
const red    = t => col(31, t);
const cyan   = t => col(36, t);
const bold   = t => col(1,  t);
const dim    = t => col(2,  t);

const fitnessColor = {
  optimal:    green,
  good:       green,
  suboptimal: yellow,
  mismatch:   red,
  unknown:    dim
};

async function api(path, opts = {}) {
  const res = await fetch(`${PRISM_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": PRISM_KEY,
      ...(opts.headers || {})
    }
  });
  return res;
}

async function apiJson(path, opts = {}) {
  const res = await api(path, opts);
  return res.json();
}

// ── bootstrap: create key + connector if ADMIN_SECRET provided ───────────────

async function ensureSetup() {
  if (PRISM_KEY) {
    console.log(dim(`Using existing PRISM_KEY: ${PRISM_KEY.slice(0, 16)}...`));
    return;
  }

  console.log(cyan("\n▶ Creating API key via admin..."));
  const keyRes = await fetch(`${PRISM_URL}/api/admin/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Secret": ADMIN_SECRET },
    body: JSON.stringify({ name: "demo-model-fitness" })
  });
  if (!keyRes.ok) {
    console.error(red("❌  Failed to create API key:"), await keyRes.text());
    process.exit(1);
  }
  const keyData = await keyRes.json();
  PRISM_KEY = keyData.key || keyData.apiKey?.key;
  if (!PRISM_KEY) {
    console.error(red("❌  No key in response:"), JSON.stringify(keyData));
    process.exit(1);
  }
  console.log(green(`✓  API key: ${PRISM_KEY.slice(0, 16)}...`));

  console.log(cyan("\n▶ Adding Anthropic connector..."));
  const connRes = await fetch(`${PRISM_URL}/api/connectors`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": PRISM_KEY },
    body: JSON.stringify({
      provider: "anthropic",
      name: "Demo Claude Gateway",
      mode: "proxy",
      status: "ready",
      config: { apiKey: ANTHROPIC_KEY }
    })
  });
  if (!connRes.ok) {
    console.error(red("❌  Connector setup failed:"), await connRes.text());
    process.exit(1);
  }
  console.log(green("✓  Anthropic connector saved"));
}

// ── demo prompts — 10 scenarios covering all task types + fitness states ──────

const DEMOS = [
  {
    label: "1. Simple Q&A  ➜  haiku  [OPTIMAL]",
    desc:  "Cheap model for trivial question — correct choice",
    model: "claude-haiku-3-5",
    prompt: "What is the capital of France?",
    expect: { task: "simple_qa", fitness: "optimal" }
  },
  {
    label: "2. Simple Q&A  ➜  opus   [SUBOPTIMAL — overkill]",
    desc:  "Most expensive model wasted on a one-word answer",
    model: "claude-opus-4",
    prompt: "What does HTTP stand for?",
    expect: { task: "simple_qa", fitness: "suboptimal" }
  },
  {
    label: "3. Code gen    ➜  haiku  [MISMATCH — quality risk]",
    desc:  "Fast/cheap model asked to write production auth code",
    model: "claude-haiku-3-5",
    prompt: "Write a Python function to parse and validate JWT tokens, checking signature, expiry, and audience claims.",
    expect: { task: "code", fitness: "mismatch" }
  },
  {
    label: "4. Code gen    ➜  sonnet [OPTIMAL]",
    desc:  "Balanced model for code — right tier",
    model: "claude-sonnet-3-7",
    prompt: "Implement a rate limiter in Node.js using a sliding window algorithm with Redis.",
    expect: { task: "code", fitness: "optimal" }
  },
  {
    label: "5. Complex reasoning  ➜  haiku  [MISMATCH — dangerous]",
    desc:  "Fast model asked to do multi-step legal/risk analysis",
    model: "claude-haiku-3-5",
    prompt: "Analyze the trade-offs between GDPR compliance and product velocity for a B2B SaaS company entering the EU market. Compare the risks, costs, and strategic implications.",
    expect: { task: "reasoning", fitness: "mismatch" }
  },
  {
    label: "6. Complex reasoning  ➜  opus   [OPTIMAL]",
    desc:  "Powerful model for deep analysis — correct choice",
    model: "claude-opus-4",
    prompt: "Compare microservices vs monolith architecture for a 10-person startup. Evaluate long-term operational complexity, team cognitive load, and scale-up costs.",
    expect: { task: "reasoning", fitness: "optimal" }
  },
  {
    label: "7. Summarization  ➜  opus   [SUBOPTIMAL — cost waste]",
    desc:  "Expensive model for a task haiku handles perfectly",
    model: "claude-opus-4",
    prompt: "Summarize this article in 3 bullet points: AI agents are becoming mainstream in enterprise software. Companies are deploying agents for code review, customer support, and data analysis. The main challenges are cost, reliability, and governance.",
    expect: { task: "summarization", fitness: "suboptimal" }
  },
  {
    label: "8. Summarization  ➜  haiku  [OPTIMAL]",
    desc:  "Fast model for summarization — correct and cheap",
    model: "claude-haiku-3-5",
    prompt: "Give me the key points from this: Enterprise AI budgets are growing 40% YoY. Most companies lack visibility into per-agent cost. Token waste is the biggest controllable cost lever.",
    expect: { task: "summarization", fitness: "optimal" }
  },
  {
    label: "9. Creative writing  ➜  sonnet [OPTIMAL]",
    desc:  "Balanced model for creative content — right tier",
    model: "claude-sonnet-3-7",
    prompt: "Write a short product launch email for an AI cost-monitoring SaaS. Make it compelling for a CTO audience, 3 paragraphs.",
    expect: { task: "creative", fitness: "optimal" }
  },
  {
    label: "10. Data / SQL  ➜  haiku  [MISMATCH]",
    desc:  "Cheap model for complex SQL query generation",
    model: "claude-haiku-3-5",
    prompt: "Write a SQL query to calculate month-over-month token cost growth per agent, using a window function with LAG, grouped by provider and workflow. Include a CTE for clarity.",
    expect: { task: "data", fitness: "mismatch" }
  }
];

// ── run one prompt through the proxy ─────────────────────────────────────────

async function runDemo(demo) {
  const body = {
    model: demo.model,
    max_tokens: 120,
    messages: [{ role: "user", content: demo.prompt }]
  };

  let taskType = "?", fitness = "?", recommended = "";

  try {
    const res = await fetch(`${PRISM_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PRISM_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    taskType    = res.headers.get("x-agent-prism-task-type")        || "?";
    fitness     = res.headers.get("x-agent-prism-model-fitness")    || "?";
    recommended = res.headers.get("x-agent-prism-recommended-model") || "";

    const data = await res.json();

    const colorFn = fitnessBadge => (fitnessBadge === "optimal" || fitnessBadge === "good")
      ? green : fitnessBadge === "suboptimal" ? yellow : red;

    const tokIn  = data.usage?.input_tokens  || 0;
    const tokOut = data.usage?.output_tokens || 0;
    const cost   = ((tokIn * 0.25 + tokOut * 1.25) / 1_000_000).toFixed(6);

    console.log(`\n${bold(demo.label)}`);
    console.log(`  ${dim(demo.desc)}`);
    console.log(`  model    : ${cyan(demo.model)}`);
    console.log(`  task     : ${bold(taskType)}`);
    console.log(`  fitness  : ${colorFn(fitness)(bold(fitness.toUpperCase()))}`);
    if (recommended) console.log(`  suggest  : ${green(recommended)}`);
    console.log(`  tokens   : ${tokIn} in / ${tokOut} out  |  cost $${cost}`);
    if (demo.expect && fitness !== demo.expect.fitness) {
      console.log(`  ${yellow("⚠ unexpected fitness")} (expected ${demo.expect.fitness}, got ${fitness})`);
    }
    return { ok: true, taskType, fitness, recommended, tokIn, tokOut };
  } catch (err) {
    console.log(`\n${bold(demo.label)}`);
    console.log(red(`  ❌ Error: ${err.message}`));
    return { ok: false };
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold(cyan("\n╔══════════════════════════════════════════════════╗")));
  console.log(bold(cyan("║   Agent Prism — Model Fitness Demo                ║")));
  console.log(bold(cyan("╚══════════════════════════════════════════════════╝")));
  console.log(dim(`  Target: ${PRISM_URL}\n`));

  await ensureSetup();

  console.log(bold("\n── Running 10 prompts across all task types ──────────\n"));

  const results = [];
  for (const demo of DEMOS) {
    const r = await runDemo(demo);
    results.push({ label: demo.label, ...r });
    await sleep(600); // avoid rate limit
  }

  // ── summary table ──────────────────────────────────────────────────────────
  console.log(bold(cyan("\n\n── Results Summary ───────────────────────────────────")));
  let optimal = 0, suboptimal = 0, mismatch = 0;
  for (const r of results) {
    if (!r.ok) continue;
    if (r.fitness === "optimal" || r.fitness === "good") optimal++;
    else if (r.fitness === "suboptimal") suboptimal++;
    else if (r.fitness === "mismatch") mismatch++;
    const fn = (r.fitness === "optimal" || r.fitness === "good") ? green : r.fitness === "suboptimal" ? yellow : red;
    console.log(`  ${fn("●")} ${r.fitness?.padEnd(10)} ${dim(r.taskType?.padEnd(14))} ${r.label.slice(0,45)}`);
  }
  console.log(`\n  ${green(`✓ Optimal: ${optimal}`)}   ${yellow(`⚠ Suboptimal: ${suboptimal}`)}   ${red(`✗ Mismatch: ${mismatch}`)}`);

  // ── captured prompts ───────────────────────────────────────────────────────
  console.log(bold(cyan("\n── Prompt Captures ───────────────────────────────────")));
  try {
    const caps = await apiJson("/api/captures?limit=10");
    console.log(`  Total captured: ${bold(String(caps.total || caps.captures?.length || 0))} prompts`);
    console.log(`  Export JSONL  : GET ${PRISM_URL}/api/captures?format=jsonl`);
  } catch { console.log(dim("  (captures endpoint not reachable — check deploy)")); }

  // ── model fitness stats ────────────────────────────────────────────────────
  console.log(bold(cyan("\n── Model Fitness Stats ───────────────────────────────")));
  try {
    const stats = await apiJson("/api/model-fitness");
    for (const row of (stats.fitnessBreakdown || [])) {
      const fn = (row.model_fitness === "optimal" || row.model_fitness === "good") ? green
               : row.model_fitness === "suboptimal" ? yellow : red;
      console.log(`  ${fn(row.model_fitness?.padEnd(12))} ${bold(String(row.count))} runs  avg $${row.avg_cost}`);
    }
    if ((stats.topTaskModelPairs || []).length) {
      console.log(bold("\n  Top task/model pairs:"));
      for (const p of stats.topTaskModelPairs.slice(0, 5)) {
        const mm = p.mismatches > 0 ? red(` (${p.mismatches} mismatches!)`) : "";
        console.log(`    ${p.task_type?.padEnd(16)} ${p.model?.padEnd(24)} ${p.count} runs${mm}`);
      }
    }
  } catch { console.log(dim("  (model-fitness endpoint not reachable — check deploy)")); }

  console.log(bold(cyan("\n── Dashboard ─────────────────────────────────────────")));
  console.log(`  ${PRISM_URL}  →  Token Coach tab  →  Model Fitness panel`);
  console.log(dim("  Hard-refresh after demo to see all runs populated\n"));
}

main().catch(err => { console.error(red("Fatal: " + err.message)); process.exit(1); });
