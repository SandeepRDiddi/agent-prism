#!/usr/bin/env node
/**
 * Agent Prism — Live Demo Loop
 *
 * Keeps the Live Sessions tab alive during a crowd demo.
 * Every 5 s  → updates token counts on all active sessions (counters climb live)
 * Every 30 s → spawns a new agent session on a random machine
 * Every 90 s → completes the oldest session + ingests it as a dashboard run
 *
 * Usage:
 *   PRISM_KEY=acp_... node live_demo_loop.js
 *   PRISM_URL=https://agent-prism.onrender.com PRISM_KEY=acp_... node live_demo_loop.js
 *
 * Press Ctrl+C to stop. Active sessions are completed on exit.
 */

const PRISM_URL = process.env.PRISM_URL || "http://localhost:3000";
const PRISM_KEY = process.env.PRISM_KEY || "";
const UPDATE_INTERVAL_MS  = 5_000;
const SPAWN_INTERVAL_MS   = 30_000;
const COMPLETE_INTERVAL_MS = 90_000;

if (!PRISM_KEY) {
  console.error("Set PRISM_KEY=acp_... environment variable");
  process.exit(1);
}

const H = { "Content-Type": "application/json", "x-api-key": PRISM_KEY };

async function post(path, body) {
  const res = await fetch(`${PRISM_URL}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`POST ${path} → ${res.status}: ${t.slice(0, 120)}`);
  }
  return res.json();
}

function uid() {
  return `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function ago(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function col(c, t) { return `\x1b[${c}m${t}\x1b[0m`; }
const green  = (t) => col(32, t);
const yellow = (t) => col(33, t);
const cyan   = (t) => col(36, t);
const red    = (t) => col(31, t);
const bold   = (t) => col(1, t);
const dim    = (t) => col(2, t);

// ── Agent roster — mix of correct and mismatched models ──────────────────────

const AGENTS = [
  {
    name: "PR Review Agent",
    workflow: "code-review",
    model: "claude-sonnet-4-6",
    provider: "Anthropic",
    summary: "Reviewing auth middleware refactor for SQL injection vectors",
    tokensPerTick: { in: 1800, out: 420 },
    costPerToken: 0.0000038,
    budgetUsd: 0.80,
    misuse: false,
    team: "platform",
  },
  {
    name: "ETL Pipeline Agent",
    workflow: "data-pipeline",
    model: "claude-opus-4-8",
    provider: "Anthropic",
    summary: "Parsing CSV → Parquet: 3-column rename job",
    tokensPerTick: { in: 3200, out: 890 },
    costPerToken: 0.000018,
    budgetUsd: 0.60,
    misuse: true,
    mismatchReason: "Opus used for trivial CSV rename — Haiku is 22× cheaper",
    team: "data",
  },
  {
    name: "Security Scanner",
    workflow: "sast-scan",
    model: "claude-haiku-4-5",
    provider: "Anthropic",
    summary: "SAST pass on payments-service — 847 files",
    tokensPerTick: { in: 2100, out: 310 },
    costPerToken: 0.00000055,
    budgetUsd: 0.25,
    misuse: false,
    team: "security",
  },
  {
    name: "Copilot Workspace Agent",
    workflow: "feature-build",
    model: "gpt-4.1",
    provider: "OpenAI",
    summary: "Scaffolding GraphQL resolvers for user-preferences API",
    tokensPerTick: { in: 2600, out: 740 },
    costPerToken: 0.000010,
    budgetUsd: 1.20,
    misuse: false,
    team: "product",
  },
  {
    name: "Docs Writer Agent",
    workflow: "documentation",
    model: "claude-opus-4-8",
    provider: "Anthropic",
    summary: "Generating API docs for 12-endpoint REST service",
    tokensPerTick: { in: 4100, out: 1200 },
    costPerToken: 0.000018,
    budgetUsd: 0.40,
    misuse: true,
    mismatchReason: "Opus for docs generation — Sonnet produces identical quality at 5× lower cost",
    team: "product",
  },
  {
    name: "Test Generator",
    workflow: "test-gen",
    model: "claude-haiku-4-5",
    provider: "Anthropic",
    summary: "Generating Jest test suite for billing module (38 functions)",
    tokensPerTick: { in: 1500, out: 560 },
    costPerToken: 0.00000055,
    budgetUsd: 0.15,
    misuse: false,
    team: "platform",
  },
  {
    name: "Infra Planner Agent",
    workflow: "iac-generation",
    model: "gpt-4.1-mini",
    provider: "OpenAI",
    summary: "Writing Terraform modules for EKS node-group auto-scaling",
    tokensPerTick: { in: 1900, out: 480 },
    costPerToken: 0.0000004,
    budgetUsd: 0.20,
    misuse: false,
    team: "platform",
  },
];

const MACHINES = [
  { machineId: "alex-mbp-platform",   developer: "alex.chen@acme.com",    hostname: "alex-chen-mbp.local" },
  { machineId: "maya-mbp-data",       developer: "maya.patel@acme.com",   hostname: "maya-patel-mbp.local" },
  { machineId: "carlos-mbp-security", developer: "carlos.ruiz@acme.com",  hostname: "carlos-ruiz-mbp.local" },
  { machineId: "priya-mbp-product",   developer: "priya.sharma@acme.com", hostname: "priya-sharma-mbp.local" },
  { machineId: "liam-mbp-platform",   developer: "liam.jones@acme.com",   hostname: "liam-jones-mbp.local" },
];

// ── Local state ───────────────────────────────────────────────────────────────

const machineState = new Map(
  MACHINES.map((m) => [m.machineId, { ...m, online: true, sessions: [], ports: [] }])
);

let agentCursor = 0;
let spawnCount  = 0;
let completedCount = 0;

// ── Core helpers ──────────────────────────────────────────────────────────────

function pickMachine() {
  const keys = [...machineState.keys()];
  return keys[Math.floor(Math.random() * keys.length)];
}

function pickAgent() {
  const a = AGENTS[agentCursor % AGENTS.length];
  agentCursor++;
  return a;
}

function buildFleetSnapshot(machine) {
  return {
    machineId:    machine.machineId,
    hostname:     machine.hostname,
    developer:    machine.developer,
    online:       machine.online,
    sessions:     machine.sessions,
    ports:        machine.ports,
  };
}

async function pushMachine(machineId) {
  const m = machineState.get(machineId);
  await post("/api/fleet/ingest", buildFleetSnapshot(m));
}

// ── Spawn a new session ───────────────────────────────────────────────────────

async function spawnSession() {
  const machineId = pickMachine();
  const machine   = machineState.get(machineId);
  const agent     = pickAgent();
  const sessionId = uid();

  const session = {
    sessionId,
    projectDir:        `-Users-${machine.developer.split("@")[0].replace(".", "-")}-acme-${agent.workflow}`,
    cwd:               `/Users/${machine.developer.split("@")[0].replace(".", "-")}/acme/${agent.workflow}`,
    model:             agent.model,
    version:           "2.1.170",
    gitBranch:         `feat/${agent.workflow}-${spawnCount + 1}`,
    totalInputTokens:  agent.tokensPerTick.in,
    totalOutputTokens: agent.tokensPerTick.out,
    totalCacheRead:    agent.tokensPerTick.in * 12,
    lastContextTokens: agent.tokensPerTick.in + agent.tokensPerTick.out,
    contextPct:        Math.floor(Math.random() * 25) + 10,
    turnCount:         1,
    status:            "active",
    summary:           agent.summary,
    lastActivity:      Date.now(),
    _meta: { agent, spawnedAt: Date.now(), ticks: 0 },
  };

  machine.sessions.push(session);
  await pushMachine(machineId);
  spawnCount++;

  const mismatchTag = agent.misuse ? red(`  ⚠ MODEL MISMATCH`) : green(`  ✓ correct model`);
  console.log(`\n${bold(green("▶ SPAWN"))} [${String(spawnCount).padStart(2, "0")}] ${bold(agent.name)}`);
  console.log(`   machine: ${cyan(machine.developer)}  model: ${yellow(agent.model)}${mismatchTag}`);
  console.log(`   task:    ${dim(agent.summary)}`);
}

// ── Tick — update all active sessions ────────────────────────────────────────

async function tick() {
  const affected = new Set();

  for (const [machineId, machine] of machineState) {
    for (const sess of machine.sessions) {
      if (sess.status !== "active") continue;
      const meta = sess._meta;

      meta.ticks++;
      const elapsedMin = (Date.now() - meta.spawnedAt) / 60_000;

      sess.totalInputTokens  += meta.agent.tokensPerTick.in  + Math.floor(Math.random() * 400);
      sess.totalOutputTokens += meta.agent.tokensPerTick.out + Math.floor(Math.random() * 100);
      sess.totalCacheRead    += meta.agent.tokensPerTick.in  * 8;
      sess.lastContextTokens  = Math.min(
        sess.totalInputTokens + sess.totalOutputTokens,
        200_000
      );
      sess.contextPct = Math.min(
        Math.floor((sess.lastContextTokens / 200_000) * 100),
        98
      );
      sess.turnCount    += 1;
      sess.lastActivity  = Date.now();

      affected.add(machineId);
    }
  }

  for (const machineId of affected) {
    await pushMachine(machineId);
  }

  const totalActive = [...machineState.values()]
    .reduce((n, m) => n + m.sessions.filter((s) => s.status === "active").length, 0);
  const totalTokens = [...machineState.values()]
    .reduce((n, m) => n + m.sessions.reduce((s, sess) => s + sess.totalInputTokens + sess.totalOutputTokens, 0), 0);

  process.stdout.write(
    `\r${dim("tick")}  active: ${bold(String(totalActive))} sessions  tokens: ${bold((totalTokens / 1_000_000).toFixed(2) + "M")}  spawned: ${spawnCount}  completed: ${completedCount}   `
  );
}

// ── Complete oldest session → ingest as dashboard run ────────────────────────

async function completeOldest() {
  let oldest = null;
  let oldestMachineId = null;

  for (const [machineId, machine] of machineState) {
    for (const sess of machine.sessions) {
      if (sess.status !== "active") continue;
      if (!oldest || sess._meta.spawnedAt < oldest._meta.spawnedAt) {
        oldest = sess;
        oldestMachineId = machineId;
      }
    }
  }

  if (!oldest) return;

  const agent = oldest._meta.agent;
  const durationMs = Date.now() - oldest._meta.spawnedAt;
  const costUsd = +(
    (oldest.totalInputTokens + oldest.totalOutputTokens) * agent.costPerToken
  ).toFixed(4);

  oldest.status = "completed";
  await pushMachine(oldestMachineId);

  // Ingest completed run to dashboard
  await post("/api/ingest", {
    source: "generic",
    payload: {
      agentName:   agent.name,
      workflow:    agent.workflow,
      model:       agent.model,
      provider:    agent.provider,
      status:      "completed",
      tokensIn:    oldest.totalInputTokens,
      tokensOut:   oldest.totalOutputTokens,
      costUsd,
      budgetUsd:   agent.budgetUsd,
      latencyMs:   durationMs,
      startTime:   new Date(oldest._meta.spawnedAt).toISOString(),
      endTime:     new Date().toISOString(),
      team:        agent.team,
      successRate: agent.misuse ? 0.82 : 0.97,
      retries:     agent.misuse ? 2 : 0,
      metadata: {
        modelMisuse:      agent.misuse || false,
        mismatchReason:   agent.mismatchReason || null,
        recommendedModel: agent.misuse
          ? (agent.provider === "Anthropic" ? "claude-haiku-4-5" : "gpt-4.1-mini")
          : agent.model,
        recoverableUsd:   agent.misuse ? +(costUsd * 0.78).toFixed(4) : 0,
        contextPctFinal:  oldest.contextPct,
        turnCount:        oldest.turnCount,
      },
    },
  });

  completedCount++;

  const machine = machineState.get(oldestMachineId);
  machine.sessions = machine.sessions.filter((s) => s.sessionId !== oldest.sessionId);
  await pushMachine(oldestMachineId);

  console.log(`\n${bold(yellow("■ COMPLETE"))} ${bold(agent.name)}  cost: ${bold("$" + costUsd.toFixed(4))}  ${agent.misuse ? red("MODEL MISMATCH → dashboard flagged") : green("clean run")}`);
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

async function shutdown() {
  console.log(`\n\n${bold("Shutting down — completing all active sessions...")}`);
  for (const [machineId, machine] of machineState) {
    for (const sess of machine.sessions) {
      if (sess.status === "active") {
        sess.status = "completed";
      }
    }
    if (machine.sessions.length > 0) {
      await pushMachine(machineId).catch(() => {});
    }
  }
  console.log(green("Done. All sessions closed."));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  console.log(bold("═══════════════════════════════════════════════════════"));
  console.log(bold("  AGENT PRISM — Live Demo Loop"));
  console.log(bold("═══════════════════════════════════════════════════════"));
  console.log(`  Target:   ${cyan(PRISM_URL)}`);
  console.log(`  Spawn:    every ${SPAWN_INTERVAL_MS / 1000}s`);
  console.log(`  Tick:     every ${UPDATE_INTERVAL_MS / 1000}s`);
  console.log(`  Complete: every ${COMPLETE_INTERVAL_MS / 1000}s`);
  console.log(`  Agents:   ${AGENTS.length} in roster (${AGENTS.filter((a) => a.misuse).length} with model misuse)`);
  console.log(`  Press Ctrl+C to stop`);
  console.log("═══════════════════════════════════════════════════════\n");

  // Seed 3 sessions immediately so Live Sessions tab isn't empty
  console.log("Seeding initial sessions...");
  await spawnSession();
  await spawnSession();
  await spawnSession();
  console.log(green("\nLive! Open Agent Prism → Live Sessions tab\n"));

  setInterval(tick, UPDATE_INTERVAL_MS);
  setInterval(spawnSession, SPAWN_INTERVAL_MS);
  setInterval(completeOldest, COMPLETE_INTERVAL_MS);

  // First tick immediately
  await tick();
}

main().catch((err) => {
  console.error(red("\nFatal: " + err.message));
  process.exit(1);
});
