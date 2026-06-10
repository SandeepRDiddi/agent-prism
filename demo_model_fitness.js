#!/usr/bin/env node
/**
 * Agent Prism — Multi-Provider Model Fitness + Prompt Capture Demo
 *
 * Covers: Anthropic Claude, OpenAI GPT, GitHub Copilot, LangChain,
 *         CrewAI, OpenAI Agents SDK, and generic custom agents.
 *
 * Required:
 *   PRISM_KEY=acp_...          (or use ADMIN_SECRET to auto-create)
 *   ANTHROPIC_KEY=sk-ant-...   (for Claude gateway calls)
 *
 * Optional:
 *   ADMIN_SECRET=...           (auto-creates API key + connectors)
 *   OPENAI_KEY=sk-...          (enables OpenAI gateway calls)
 *   PRISM_URL=https://...      (default: https://agent-prism.onrender.com)
 *
 * Usage:
 *   ADMIN_SECRET=xxx ANTHROPIC_KEY=sk-ant-xxx OPENAI_KEY=sk-xxx node demo_model_fitness.js
 */

const PRISM_URL     = process.env.PRISM_URL     || "https://agent-prism.onrender.com";
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || "";
const OPENAI_KEY    = process.env.OPENAI_KEY    || "";
const ADMIN_SECRET  = process.env.ADMIN_SECRET  || "";
let   PRISM_KEY     = process.env.PRISM_KEY     || "";

if (!PRISM_KEY && !ADMIN_SECRET) {
  console.error("❌  Set PRISM_KEY=acp_... or ADMIN_SECRET=...");
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function col(c, t) { return `\x1b[${c}m${t}\x1b[0m`; }
const green  = t => col(32, t);
const yellow = t => col(33, t);
const red    = t => col(31, t);
const cyan   = t => col(36, t);
const bold   = t => col(1,  t);
const dim    = t => col(2,  t);
const blue   = t => col(34, t);
const magenta = t => col(35, t);

const fitnessFn = f => ({ optimal: green, good: green, suboptimal: yellow, mismatch: red }[f] || dim);

async function prismFetch(path, opts = {}) {
  return fetch(`${PRISM_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-API-Key": PRISM_KEY, ...(opts.headers || {}) }
  });
}
async function prismJson(path, opts = {}) { return (await prismFetch(path, opts)).json(); }

function ago(minutes) { return new Date(Date.now() - minutes * 60_000).toISOString(); }

// ── bootstrap ─────────────────────────────────────────────────────────────────

async function ensureSetup() {
  if (PRISM_KEY) {
    console.log(dim(`Using PRISM_KEY: ${PRISM_KEY.slice(0, 16)}...`));
  } else {
    console.log(cyan("\n▶ Creating API key..."));
    const r = await fetch(`${PRISM_URL}/api/admin/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Secret": ADMIN_SECRET },
      body: JSON.stringify({ name: "multi-provider-demo" })
    });
    if (!r.ok) { console.error(red("❌  " + await r.text())); process.exit(1); }
    const d = await r.json();
    PRISM_KEY = typeof d.apiKey === "string" ? d.apiKey : d.key?.plainText;
    if (!PRISM_KEY) { console.error(red("❌  No key in response: " + JSON.stringify(d))); process.exit(1); }
    console.log(green(`✓  API key: ${PRISM_KEY.slice(0, 16)}...`));
  }

  if (ANTHROPIC_KEY) {
    console.log(cyan("▶ Saving Anthropic connector..."));
    const r = await prismFetch("/api/connectors", {
      method: "POST",
      body: JSON.stringify({ provider: "anthropic", name: "Claude Gateway", mode: "proxy", apiKey: ANTHROPIC_KEY })
    });
    console.log(r.ok ? green("✓  Anthropic connector saved") : yellow("⚠  Anthropic connector: " + (await r.text()).slice(0, 80)));
  }

  if (OPENAI_KEY) {
    console.log(cyan("▶ Saving OpenAI connector..."));
    const r = await prismFetch("/api/connectors", {
      method: "POST",
      body: JSON.stringify({ provider: "openai", name: "OpenAI Gateway", mode: "proxy", apiKey: OPENAI_KEY })
    });
    console.log(r.ok ? green("✓  OpenAI connector saved") : yellow("⚠  OpenAI connector: " + (await r.text()).slice(0, 80)));
  }

  // pre-flight: check headers present (confirms new code is deployed)
  console.log(cyan("\n▶ Pre-flight check..."));
  if (ANTHROPIC_KEY) {
    const probe = await prismFetch("/v1/messages", {
      method: "POST",
      headers: { "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 5, messages: [{ role: "user", content: "hi" }] })
    });
    const h = probe.headers.get("x-agent-prism-task-type");
    if (!h) console.log(yellow("⚠  Model fitness headers missing — Render may still be deploying. Wait 2 min."));
    else console.log(green(`✓  Model fitness headers live (task=${h})`));
  } else {
    console.log(dim("  Skipping header probe (no ANTHROPIC_KEY)"));
  }
}

// ── run one Claude prompt through /v1/messages ────────────────────────────────

async function runClaude(demo) {
  const res = await prismFetch("/v1/messages", {
    method: "POST",
    headers: { "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: demo.model, max_tokens: 120, messages: [{ role: "user", content: demo.prompt }] })
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: `HTTP ${res.status} [${data.error || "error"}] ${data.message || JSON.stringify(data)}` };

  return {
    ok: true,
    taskType:    res.headers.get("x-agent-prism-task-type")         || "?",
    fitness:     res.headers.get("x-agent-prism-model-fitness")     || "?",
    recommended: res.headers.get("x-agent-prism-recommended-model") || "",
    tokensIn:    data.usage?.input_tokens  || 0,
    tokensOut:   data.usage?.output_tokens || 0,
  };
}

// ── run one OpenAI prompt through /v1/chat/completions ────────────────────────

async function runOpenAI(demo) {
  const res = await prismFetch("/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: demo.model, max_tokens: 120, messages: [{ role: "user", content: demo.prompt }] })
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: `HTTP ${res.status} [${data.error?.code || data.error || "error"}] ${data.error?.message || data.message || JSON.stringify(data)}` };

  return {
    ok: true,
    taskType:    res.headers.get("x-agent-prism-task-type")         || "?",
    fitness:     res.headers.get("x-agent-prism-model-fitness")     || "?",
    recommended: res.headers.get("x-agent-prism-recommended-model") || "",
    tokensIn:    data.usage?.prompt_tokens     || 0,
    tokensOut:   data.usage?.completion_tokens || 0,
  };
}

// ── ingest a simulated run from any tool via /api/ingest ─────────────────────

async function runIngest(payload) {
  const res = await prismFetch("/api/ingest", { method: "POST", body: JSON.stringify(payload) });
  const data = await res.json();
  return res.ok ? { ok: true, runId: data.id || data.runId } : { ok: false, error: data.message || JSON.stringify(data) };
}

// ── print result row ──────────────────────────────────────────────────────────

function printResult(label, desc, model, provider, result) {
  console.log(`\n${bold(label)}`);
  console.log(`  ${dim(desc)}`);
  if (!result.ok) {
    console.log(red(`  ❌ Error: ${result.error}`));
    return;
  }
  const cost = ((result.tokensIn * 0.25 + result.tokensOut * 1.25) / 1_000_000).toFixed(6);
  console.log(`  provider : ${cyan(provider.padEnd(18))} model: ${cyan(model)}`);
  if (result.taskType) {
    console.log(`  task     : ${bold(result.taskType)}`);
    console.log(`  fitness  : ${fitnessFn(result.fitness)(bold((result.fitness || "?").toUpperCase()))}`);
    if (result.recommended) console.log(`  suggest  : ${green(result.recommended)}`);
    if (result.tokensIn > 0) console.log(`  tokens   : ${result.tokensIn} in / ${result.tokensOut} out  |  $${cost}`);
  } else {
    console.log(dim("  (ingested via /api/ingest — fitness scored from run metadata)"));
  }
}

// ── demo scenarios ────────────────────────────────────────────────────────────

const HAIKU  = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6";
const OPUS   = "claude-opus-4-8";

const GPT_MINI = "gpt-4o-mini";
const GPT_4O   = "gpt-4o";
const O3_MINI  = "o3-mini";

async function runAllScenarios() {
  const results = [];
  let sectionTotal = 0, sectionMismatch = 0;

  // ── SECTION 1: Anthropic Claude ────────────────────────────────────────────
  if (ANTHROPIC_KEY) {
    console.log(bold(blue("\n╔══ SECTION 1: Anthropic Claude (via /v1/messages proxy) ══════════╗")));

    const claudeScenarios = [
      { label: "1a. Simple Q&A  ➜  haiku  [OPTIMAL]",       desc: "Trivial question — fast/cheap is correct", model: HAIKU,  prompt: "What is the capital of France?",                                   fitness: "optimal"    },
      { label: "1b. Simple Q&A  ➜  opus   [SUBOPTIMAL]",    desc: "Powerful model wasted on one-word answer", model: OPUS,   prompt: "What does HTTP stand for?",                                       fitness: "suboptimal" },
      { label: "1c. Code gen    ➜  haiku  [MISMATCH]",      desc: "Auth code on cheapest model — quality risk",model: HAIKU,  prompt: "Write a Python JWT parser with signature + expiry validation.",  fitness: "mismatch"   },
      { label: "1d. Code gen    ➜  sonnet [OPTIMAL]",       desc: "Balanced model for production code",        model: SONNET, prompt: "Implement a Node.js rate limiter using sliding window + Redis.",  fitness: "optimal"    },
      { label: "1e. Reasoning   ➜  haiku  [MISMATCH]",      desc: "Legal/risk analysis on wrong tier",         model: HAIKU,  prompt: "Analyze GDPR trade-offs vs product velocity for a B2B SaaS entering EU. Compare risks and costs.", fitness: "mismatch" },
      { label: "1f. Reasoning   ➜  opus   [OPTIMAL]",       desc: "Deep analysis — powerful model justified",  model: OPUS,   prompt: "Compare microservices vs monolith for a 10-person startup. Evaluate cognitive load, ops cost, scale-up timeline.", fitness: "optimal" },
      { label: "1g. Summarize   ➜  opus   [SUBOPTIMAL]",    desc: "Paying 60x for a task haiku does fine",     model: OPUS,   prompt: "Summarize in 3 bullets: AI agents are mainstream. Cost and governance are the main challenges.", fitness: "suboptimal" },
      { label: "1h. Summarize   ➜  haiku  [OPTIMAL]",       desc: "Fast + cheap for summarization",            model: HAIKU,  prompt: "Key points: AI budgets grow 40% YoY. Token waste is the biggest cost lever.", fitness: "optimal" },
    ];

    for (const s of claudeScenarios) {
      const r = await runClaude(s);
      printResult(s.label, s.desc, s.model, "Anthropic", r);
      results.push({ label: s.label, ...r });
      sectionTotal++; if (r.ok && (r.fitness === "mismatch" || r.fitness === "suboptimal")) sectionMismatch++;
      await sleep(500);
    }
  } else {
    console.log(yellow("\n⚠  Skipping Anthropic section (no ANTHROPIC_KEY)"));
  }

  // ── SECTION 2: OpenAI GPT ─────────────────────────────────────────────────
  if (OPENAI_KEY) {
    console.log(bold(blue("\n╔══ SECTION 2: OpenAI GPT (via /v1/chat/completions proxy) ════════╗")));

    const openAiScenarios = [
      { label: "2a. Simple Q&A  ➜  gpt-4o-mini  [OPTIMAL]",    desc: "Cheap OpenAI model for trivial lookup",       model: GPT_MINI, prompt: "What year was the Eiffel Tower built?",                          fitness: "optimal"    },
      { label: "2b. Simple Q&A  ➜  gpt-4o       [SUBOPTIMAL]", desc: "Flagship model wasted on factual Q&A",        model: GPT_4O,   prompt: "What is the default HTTP port?",                                 fitness: "suboptimal" },
      { label: "2c. Code review ➜  gpt-4o-mini  [MISMATCH]",   desc: "Complex review on cheapest tier",             model: GPT_MINI, prompt: "Review this Python code for security vulnerabilities: def login(user, pwd): return db.query(f'SELECT * FROM users WHERE name={user} AND pass={pwd}')", fitness: "mismatch" },
      { label: "2d. Code gen    ➜  gpt-4o       [OPTIMAL]",    desc: "Balanced model for code — right choice",      model: GPT_4O,   prompt: "Implement a TypeScript generic repository pattern with Prisma ORM.", fitness: "optimal" },
      { label: "2e. Reasoning   ➜  gpt-4o       [GOOD]",       desc: "Balanced model for analysis",                 model: GPT_4O,   prompt: "Evaluate pros and cons of GraphQL vs REST for a mobile-first product team.", fitness: "good" },
    ];

    for (const s of openAiScenarios) {
      const r = await runOpenAI(s);
      printResult(s.label, s.desc, s.model, "OpenAI", r);
      results.push({ label: s.label, ...r });
      sectionTotal++; if (r.ok && (r.fitness === "mismatch" || r.fitness === "suboptimal")) sectionMismatch++;
      await sleep(500);
    }
  } else {
    console.log(yellow("\n⚠  Skipping OpenAI section (no OPENAI_KEY set)"));
  }

  // ── SECTION 3: Generic Ingest — simulates any tool ────────────────────────
  console.log(bold(blue("\n╔══ SECTION 3: Generic Ingest — Copilot, LangChain, CrewAI, Custom ╗")));
  console.log(dim("  (These tools POST telemetry to /api/ingest — no gateway proxy needed)\n"));

  const ingestScenarios = [
    {
      label: "3a. GitHub Copilot  ➜  gpt-4o-mini [OPTIMAL]",
      desc:  "Copilot code completion — right model for autocomplete",
      payload: { source: "generic", payload: { agentName: "GitHub Copilot", provider: "GitHub", model: "gpt-4o-mini", taskType: "code", status: "success", tokensIn: 820, tokensOut: 180, costUsd: 0.0003, budgetUsd: 0.005, latencyMs: 380, retryCount: 0, toolCalls: 0, workflow: "vscode-autocomplete", team: "engineering", environment: "development", notes: "Inline code completion for React component" } }
    },
    {
      label: "3b. GitHub Copilot  ➜  o3-mini     [SUBOPTIMAL for autocomplete]",
      desc:  "Reasoning model used for simple autocomplete — massive overkill",
      payload: { source: "generic", payload: { agentName: "GitHub Copilot Enterprise", provider: "GitHub", model: "o3-mini", taskType: "simple_qa", status: "success", tokensIn: 640, tokensOut: 90, costUsd: 0.0041, budgetUsd: 0.001, latencyMs: 2100, retryCount: 0, toolCalls: 0, workflow: "vscode-autocomplete", team: "engineering", environment: "development", notes: "Autocomplete triggered with o3-mini — over budget" } }
    },
    {
      label: "3c. LangChain Agent ➜  gpt-4o-mini [MISMATCH for multi-tool]",
      desc:  "LangChain multi-tool agent using cheapest model — tool calls fail",
      payload: { source: "generic", payload: { agentName: "LangChain Research Agent", provider: "OpenAI", model: "gpt-4o-mini", taskType: "multi_tool", status: "failed", tokensIn: 4200, tokensOut: 310, costUsd: 0.0018, budgetUsd: 0.01, latencyMs: 8900, retryCount: 3, toolCalls: 7, workflow: "market-research-pipeline", team: "product", environment: "production", notes: "Agent failed on tool chaining step 4 of 7" } }
    },
    {
      label: "3d. CrewAI         ➜  claude-sonnet-4-6 [OPTIMAL]",
      desc:  "CrewAI multi-agent crew using balanced model — correct",
      payload: { source: "generic", payload: { agentName: "CrewAI Content Crew", provider: "Anthropic", model: "claude-sonnet-4-6", taskType: "creative", status: "success", tokensIn: 2100, tokensOut: 890, costUsd: 0.0052, budgetUsd: 0.02, latencyMs: 4200, retryCount: 0, toolCalls: 2, workflow: "content-generation", team: "marketing", environment: "production", notes: "3-agent crew: researcher + writer + editor" } }
    },
    {
      label: "3e. OpenAI Agents SDK ➜ gpt-4o [OPTIMAL]",
      desc:  "OpenAI Agents SDK with handoffs — balanced model for orchestration",
      payload: { source: "generic", payload: { agentName: "OpenAI Triage Agent", provider: "OpenAI", model: "gpt-4o", taskType: "multi_tool", status: "success", tokensIn: 3400, tokensOut: 620, costUsd: 0.0089, budgetUsd: 0.02, latencyMs: 5100, retryCount: 0, toolCalls: 4, workflow: "customer-support-triage", team: "support", environment: "production", notes: "Agent with 3 handoffs: classify → route → resolve" } }
    },
    {
      label: "3f. Custom Agent   ➜  claude-haiku-4-5 [MISMATCH for reasoning]",
      desc:  "Custom Python agent running financial analysis on fast model",
      payload: { source: "generic", payload: { agentName: "Finance Analysis Agent", provider: "Anthropic", model: "claude-haiku-4-5-20251001", taskType: "reasoning", status: "success", tokensIn: 6800, tokensOut: 1200, costUsd: 0.0021, budgetUsd: 0.05, latencyMs: 3800, retryCount: 1, toolCalls: 0, workflow: "quarterly-financial-review", team: "finance", environment: "production", notes: "Q3 variance analysis — outputs looked shallow" } }
    },
    {
      label: "3g. Copilot PR Review ➜ gpt-4o [OPTIMAL]",
      desc:  "Copilot code review on a PR — balanced model for code analysis",
      payload: { source: "generic", payload: { agentName: "Copilot PR Reviewer", provider: "GitHub", model: "gpt-4o", taskType: "code", status: "success", tokensIn: 5600, tokensOut: 740, costUsd: 0.0071, budgetUsd: 0.02, latencyMs: 4600, retryCount: 0, toolCalls: 1, workflow: "pr-review", team: "engineering", environment: "production", notes: "PR #482: reviewed 340 lines across 8 files" } }
    },
  ];

  for (const s of ingestScenarios) {
    const r = await runIngest(s.payload);
    printResult(s.label, s.desc, s.payload.payload.model, s.payload.payload.provider, r);
    results.push({ label: s.label, ok: r.ok });
    await sleep(300);
  }

  return results;
}

// ── final summary + stats ─────────────────────────────────────────────────────

async function showSummary(results) {
  console.log(bold(cyan("\n\n╔══ RESULTS SUMMARY ═══════════════════════════════════════════════╗")));
  let optimal = 0, suboptimal = 0, mismatch = 0, failed = 0;
  for (const r of results) {
    const f = r.fitness;
    if (!r.ok) { failed++; console.log(`  ${red("✗")} ${dim("error")}       ${dim(r.label?.slice(0, 50))}`); continue; }
    if (f === "optimal" || f === "good") optimal++;
    else if (f === "suboptimal") suboptimal++;
    else if (f === "mismatch") mismatch++;
    const fn = fitnessFn(f);
    const tag = f ? fn((f || "?").padEnd(10)) : dim("(ingested)");
    console.log(`  ${fn("●")} ${tag}  ${dim(r.label?.slice(0, 52))}`);
  }

  console.log(`\n  ${green(`✓ Optimal/Good: ${optimal}`)}   ${yellow(`⚠ Suboptimal: ${suboptimal}`)}   ${red(`✗ Mismatch: ${mismatch}`)}   ${dim(`? Ingested: ${results.length - optimal - suboptimal - mismatch - failed}`)}`);

  // prompt captures
  console.log(bold(cyan("\n╔══ PROMPT CAPTURES ═══════════════════════════════════════════════╗")));
  try {
    const caps = await prismJson("/api/captures?limit=5");
    console.log(`  Total captured: ${bold(String(caps.total || 0))} prompts (live gateway calls only)`);
    if ((caps.captures || []).length) {
      for (const c of caps.captures.slice(0, 3)) {
        console.log(`  ${dim("·")} ${c.model?.padEnd(30)} task=${c.taskType}  fitness=${fitnessFn(c.modelFitness)(c.modelFitness)}`);
      }
    }
    console.log(`  JSONL export  : ${cyan(PRISM_URL + "/api/captures?format=jsonl")}`);
  } catch { console.log(dim("  (endpoint not reachable)")); }

  // model fitness stats
  console.log(bold(cyan("\n╔══ MODEL FITNESS STATS (all providers) ═══════════════════════════╗")));
  try {
    const stats = await prismJson("/api/model-fitness");
    for (const row of (stats.fitnessBreakdown || [])) {
      const fn = fitnessFn(row.model_fitness);
      console.log(`  ${fn((row.model_fitness || "?").padEnd(12))} ${bold(String(row.count).padStart(3))} runs   avg $${row.avg_cost}`);
    }
    if ((stats.topTaskModelPairs || []).length) {
      console.log(bold("\n  Top task/model pairs with mismatches:"));
      for (const p of stats.topTaskModelPairs.filter(p => p.mismatches > 0).slice(0, 5)) {
        console.log(`    ${red("!")} ${p.task_type?.padEnd(16)} ${p.model?.padEnd(30)} ${red(`${p.mismatches} mismatches`)}`);
      }
    }
  } catch { console.log(dim("  (endpoint not reachable)")); }

  // ingest-based mismatch (from runs)
  console.log(bold(cyan("\n╔══ CROSS-PROVIDER DASHBOARD ══════════════════════════════════════╗")));
  try {
    const dash = await prismJson("/api/dashboard");
    const mm = dash.modelMismatches || [];
    if (mm.length) {
      console.log(`  ${red(`${mm.length} model mismatch runs`)} flagged across all providers:`);
      for (const m of mm.slice(0, 6)) {
        console.log(`  ${red("✗")} ${m.agentName?.padEnd(28)} ${m.model?.padEnd(28)} ${m.taskType}  ${red(m.fitness)}`);
      }
    } else {
      console.log(dim("  No mismatches in dashboard yet (ingest runs may need a refresh)"));
    }
    console.log(`\n  Total runs tracked: ${bold(String((dash.runs || []).length))}`);
  } catch { console.log(dim("  (dashboard not reachable)")); }

  console.log(bold(cyan("\n╔══ OPEN DASHBOARD ════════════════════════════════════════════════╗")));
  console.log(`  ${PRISM_URL}`);
  console.log(`  → Token Coach tab → Model Fitness panel`);
  console.log(`  → Governance tab  → Audit trail (all provider calls logged)\n`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold(cyan("\n╔══════════════════════════════════════════════════════════════════╗")));
  console.log(bold(cyan("║   Agent Prism — Multi-Provider Model Fitness Demo                ║")));
  console.log(bold(cyan("║   Anthropic · OpenAI · GitHub Copilot · LangChain · CrewAI      ║")));
  console.log(bold(cyan("╚══════════════════════════════════════════════════════════════════╝")));
  console.log(dim(`  Target : ${PRISM_URL}`));
  console.log(dim(`  Claude : ${ANTHROPIC_KEY ? "✓ connected" : "✗ not set (skipping)"}`));
  console.log(dim(`  OpenAI : ${OPENAI_KEY    ? "✓ connected" : "✗ not set (skipping)"}`));
  console.log(dim("  Copilot/LangChain/CrewAI: via /api/ingest (no key needed)\n"));

  await ensureSetup();
  const results = await runAllScenarios();
  await showSummary(results);
}

main().catch(err => { console.error(red("\nFatal: " + err.message)); console.error(err.stack); process.exit(1); });
