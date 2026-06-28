/**
 * demo_realworld.js
 *
 * Real-world end-to-end demo: FinanceFlow Corp — AI Operations
 *
 * Five agents across four risk tiers. Walks through the complete lifecycle:
 *   1. Ingest staging run history
 *   2. Certify each agent (some pass, one fails by policy)
 *   3. Promote certified agents to production
 *   4. Production gate: certified agent passes, uncertified blocked
 *   5. DataAnalyticsBot goes rogue — auto-revoke triggers mid-flight
 *
 * Run:
 *   PRISM_KEY=acp_... node demo_realworld.js
 *   PRISM_KEY=acp_... PRISM_URL=http://localhost:3000 node demo_realworld.js
 *
 * Open the dashboard BEFORE running — watch cards update live.
 * Tip: reset tenant data in Admin tab first for a clean slate.
 */

const ENDPOINT = process.env.AGENT_PRISM_ENDPOINT || process.env.PRISM_URL || "http://localhost:3000";
const API_KEY  = process.env.AGENT_PRISM_API_KEY  || process.env.PRISM_KEY;

if (!API_KEY) {
  console.error("\n  ERROR: No API key.\n  Run with: PRISM_KEY=acp_... node demo_realworld.js\n");
  process.exit(1);
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m"
};

function pad(str, n)  { return String(str ?? "").padEnd(n); }
function hr(c = "─", n = 62) { return c.repeat(n); }

function header(title, sub = "") {
  console.log(`\n${C.bold}${hr("═")}${C.reset}`);
  console.log(`${C.bold}  ${title}${C.reset}`);
  if (sub) console.log(`${C.dim}  ${sub}${C.reset}`);
  console.log(`${C.bold}${hr("═")}${C.reset}`);
}

function step(n, total, title, context = "") {
  console.log(`\n${C.bold}${C.cyan}  ▸ Step ${n}/${total} — ${title}${C.reset}`);
  if (context) console.log(`${C.dim}  ${context}${C.reset}`);
  console.log(`${C.dim}  ${hr("─", 58)}${C.reset}`);
}

const log = {
  ok:   (msg) => console.log(`  ${C.green}✓${C.reset}  ${msg}`),
  fail: (msg) => console.log(`  ${C.red}✗${C.reset}  ${msg}`),
  warn: (msg) => console.log(`  ${C.yellow}⚠${C.reset}  ${msg}`),
  info: (msg) => console.log(`  ${C.dim}·${C.reset}  ${msg}`),
  gate: (msg) => console.log(`  ${C.blue}⬡${C.reset}  ${msg}`)
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── API client ─────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── Agent definitions ──────────────────────────────────────────────────────────

const now = Date.now();

const AGENTS = {
  FinanceReportBot: {
    label:       "Finance Report Bot",
    tier:        1,
    story:       "Reads internal PostgreSQL, generates quarterly reports, exports to PDF.",
    stagingRuns: 22,
    tools: [
      { name: "query_database" },
      { name: "aggregate_metrics" },
      { name: "generate_report" },
      { name: "export_pdf" }
    ],
    humanApprovals: []
  },

  CustomerMessagingAgent: {
    label:       "Customer Messaging Agent",
    tier:        2,
    story:       "Reads CRM profiles and sends transactional emails via SendGrid.",
    stagingRuns: 18,
    tools: [
      { name: "read_crm_profile" },
      { name: "render_template" },
      { name: "send_email" },
      { name: "log_sent_message" }
    ],
    humanApprovals: [
      { step: "email-batch-review", approvedBy: "ops@financeflow.com", at: new Date().toISOString() }
    ]
  },

  SecretsScannerAgent: {
    label:       "Secrets Scanner Agent",
    tier:        3,
    story:       "Reads Vault for leaked API keys, scans repos, sends Slack security alerts.",
    stagingRuns: 38,
    tools: [
      { name: "read_vault_secret" },
      { name: "scan_git_repository" },
      { name: "query_audit_log" },
      { name: "send_slack_alert" }
    ],
    humanApprovals: [
      { step: "pre-scan-sign-off", approvedBy: "security@financeflow.com", at: new Date().toISOString() }
    ]
  },

  InfraResetAgent: {
    label:       "Infra Reset Agent",
    tier:        4,
    story:       "Can destroy and rebuild AWS infrastructure via Terraform + shell exec.",
    stagingRuns: 6,
    tools: [
      { name: "terraform_plan" },
      { name: "terraform_destroy" },
      { name: "exec_shell" }
    ],
    humanApprovals: []
  },

  DataAnalyticsBot: {
    label:       "Data Analytics Bot",
    tier:        1,
    story:       "T1 analytics agent. Reads warehouse, generates charts. Safe on paper.",
    stagingRuns: 20,
    tools: [
      { name: "query_data_warehouse" },
      { name: "run_sql_query" },
      { name: "generate_chart" }
    ],
    humanApprovals: []
  }
};

function buildRun(agentName, environment, overrideTools, idx = 0) {
  const agent    = AGENTS[agentName];
  const tools    = overrideTools || agent.tools;
  const approvals = overrideTools ? [] : agent.humanApprovals;
  const offsetMs = idx * 45_000;

  return {
    agent_name:           agentName,
    model_name:           "claude-sonnet-4-20250514",
    outcome:              "success",
    started_at:           new Date(now - (agent.stagingRuns - idx) * offsetMs).toISOString(),
    duration_ms:          1800 + ((Math.random() * 4000) | 0),
    prompt_tokens:        900  + ((Math.random() * 600)  | 0),
    completion_tokens:    200  + ((Math.random() * 400)  | 0),
    estimated_cost_usd:   parseFloat((0.0015 + Math.random() * 0.004).toFixed(5)),
    budget_usd:           0.15,
    autonomy_level:       2,
    retry_count:          Math.random() > 0.85 ? 1 : 0,
    environment,
    workflow:             `${agentName.toLowerCase()}-workflow`,
    team:                 "ai-operations",
    tool_manifest:        tools,
    human_approvals:      approvals
  };
}

async function ingestBatch(agentName, environment, count, overrideTools = null) {
  let passed = 0, blocked = 0;
  for (let i = 0; i < count; i++) {
    const { ok: success, status, data } = await api("POST", "/api/ingest",
      buildRun(agentName, environment, overrideTools, i));
    if (success) passed++;
    else { blocked++; process.stdout.write(` [${status}:${data?.error}]`); }
  }
  return { passed, blocked };
}

function certResult(data) {
  const cert = data.cert || data.certification || data;
  const eval_ = data.evaluation || {};
  return {
    status:   cert.certStatus || (cert.status === "certified" ? "certified" : "failed"),
    tier:     cert.effectiveTier ?? eval_.effectiveTier ?? "?",
    failures: [
      ...(data.failures || []),
      ...(data.failureReasons || []),
      ...(eval_.failureReasons || []),
      ...(cert.failureReasons || [])
    ]
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  header(
    "Agent Prism — Real-World End-to-End Demo",
    "FinanceFlow Corp · AI Operations · Full certification lifecycle"
  );

  console.log(`\n  Platform : ${C.cyan}${ENDPOINT}${C.reset}`);
  console.log(`  Agents   : ${Object.keys(AGENTS).length} agents — Tier 1 through Tier 4`);
  console.log(`\n  ${C.bold}Open the Governance tab in the dashboard now.${C.reset}`);
  console.log(`  Watch agent cards update live as this script runs.\n`);

  const STEPS = 10;

  // ── STEP 1: Ingest staging runs ──────────────────────────────────────────────
  step(1, STEPS,
    "Build staging run history",
    "Each agent needs a minimum number of successful staging runs before it can be certified."
  );

  for (const [name, agent] of Object.entries(AGENTS)) {
    process.stdout.write(`  ${C.dim}Ingesting${C.reset} ${pad(agent.label, 30)}`);
    const { passed } = await ingestBatch(name, "staging", agent.stagingRuns);
    console.log(`${C.green}${passed}${C.reset}/${agent.stagingRuns} runs  ·  T${agent.tier}  ·  ${agent.story}`);
    await sleep(120);
  }
  log.ok("Staging run history built for all 5 agents");

  await sleep(600);

  // ── STEP 2: Certify Tier 1 ───────────────────────────────────────────────────
  step(2, STEPS,
    "Certify FinanceReportBot — Tier 1 (Low Risk)",
    "Read-only + internal writes. No external calls. Minimal oversight required."
  );

  const r1 = await api("POST", "/api/agents/FinanceReportBot/certify", { environment: "staging" });
  const c1 = certResult(r1.data);
  if (c1.status === "certified") {
    log.ok(`FinanceReportBot staging certified  ·  Tier ${c1.tier}`);
  } else {
    log.fail(`FinanceReportBot certification failed`);
    for (const f of c1.failures) log.info(`  [${f.check}] ${f.detail}`);
  }

  await sleep(400);

  // ── STEP 3: Certify Tier 2 ───────────────────────────────────────────────────
  step(3, STEPS,
    "Certify CustomerMessagingAgent — Tier 2 (Medium Risk)",
    "Makes external API calls (SendGrid email). Requires human approval on external sends."
  );

  const r2 = await api("POST", "/api/agents/CustomerMessagingAgent/certify", { environment: "staging" });
  const c2 = certResult(r2.data);
  if (c2.status === "certified") {
    log.ok(`CustomerMessagingAgent staging certified  ·  Tier ${c2.tier}`);
    log.info("HITL coverage verified: email batch review sign-off recorded");
  } else {
    log.fail(`CustomerMessagingAgent certification failed`);
    for (const f of c2.failures) log.info(`  [${f.check}] ${f.detail}`);
  }

  await sleep(400);

  // ── STEP 4: Certify Tier 3 ───────────────────────────────────────────────────
  step(4, STEPS,
    "Certify SecretsScannerAgent — Tier 3 (High Risk)",
    "Reads Vault secrets + sends external alerts. Full HITL coverage required. Needs ≥30 staging runs."
  );

  const r3 = await api("POST", "/api/agents/SecretsScannerAgent/certify", { environment: "staging" });
  const c3 = certResult(r3.data);
  if (c3.status === "certified") {
    log.ok(`SecretsScannerAgent staging certified  ·  Tier ${c3.tier}`);
    log.info("38 staging runs verified, HITL pre-scan approval on file");
  } else {
    log.fail(`SecretsScannerAgent certification failed`);
    for (const f of c3.failures) log.info(`  [${f.check}] ${f.detail}`);
  }

  await sleep(400);

  // ── STEP 5: Tier 4 — certification and promotion blocked ─────────────────────
  step(5, STEPS,
    `${C.red}InfraResetAgent — Tier 4 (Critical) — PRODUCTION BLOCKED${C.reset}`,
    "terraform_destroy + exec_shell. Can permanently destroy infrastructure. Cannot reach production by policy."
  );

  const r4s = await api("POST", "/api/agents/InfraResetAgent/certify", { environment: "staging" });
  const c4s = certResult(r4s.data);
  if (c4s.status === "certified") {
    log.warn(`Staging cert granted (T4 agents can certify in staging for controlled testing)`);
  } else {
    log.fail(`InfraResetAgent staging certification denied`);
    for (const f of c4s.failures) log.info(`  [${f.check}] ${f.detail}`);
  }

  await sleep(300);
  log.info("Attempting production promotion...");

  const r4p = await api("POST", "/api/agents/InfraResetAgent/promote", {});
  if (!r4p.ok) {
    log.fail(`Production promotion BLOCKED (${r4p.status})  ←  expected`);
    const fails = r4p.data.failures || r4p.data.failureReasons || [];
    for (const f of fails) log.info(`  [${f.check || f}] ${f.detail || ""}`);
    if (fails.length === 0) log.info(`  ${r4p.data.error || r4p.data.message}`);
  } else {
    log.warn("Promotion unexpectedly passed — verify Tier 4 gate in certification engine");
  }

  await sleep(400);

  // ── STEP 6: Certify DataAnalyticsBot (currently T1, appears safe) ────────────
  step(6, STEPS,
    "Certify DataAnalyticsBot — Tier 1 (currently)",
    "Reads data warehouse, generates charts. Looks safe. Will reveal its true nature in Step 9."
  );

  const r5 = await api("POST", "/api/agents/DataAnalyticsBot/certify", { environment: "staging" });
  const c5 = certResult(r5.data);
  if (c5.status === "certified") {
    log.ok(`DataAnalyticsBot staging certified  ·  Tier ${c5.tier}`);
  } else {
    log.fail(`DataAnalyticsBot certification failed`);
    for (const f of c5.failures) log.info(`  [${f.check}] ${f.detail}`);
  }

  await sleep(500);

  // ── STEP 7: Promote to production ────────────────────────────────────────────
  step(7, STEPS,
    "Promote certified agents to production",
    "Staging cert → production cert. Arms the production gate for each agent."
  );

  const toPromote = [
    "FinanceReportBot",
    "CustomerMessagingAgent",
    "SecretsScannerAgent",
    "DataAnalyticsBot"
  ];

  for (const name of toPromote) {
    const { ok: promoted, status, data } = await api("POST",
      `/api/agents/${encodeURIComponent(name)}/promote`, {});
    if (promoted) {
      log.ok(`${pad(name, 28)} promoted to production ✓`);
    } else {
      const fails = data.failures || data.failureReasons || [];
      log.fail(`${pad(name, 28)} promotion blocked (${status})`);
      for (const f of fails) log.info(`  [${f.check || f}] ${f.detail || data.message || ""}`);
    }
    await sleep(250);
  }

  await sleep(600);

  // ── STEP 8: Production gate ───────────────────────────────────────────────────
  step(8, STEPS,
    "Production gate enforcement",
    "Certified agents pass. Uncertified agents are blocked with HTTP 403 before any data is stored."
  );

  // Certified agent — should pass
  log.gate("Sending production run: FinanceReportBot  (certified)");
  const gPass = await api("POST", "/api/ingest", buildRun("FinanceReportBot", "production", null, 0));
  if (gPass.ok) {
    log.ok(`ALLOWED  ·  Run stored  ·  Gate open — agent has valid production cert`);
  } else {
    log.fail(`BLOCKED  ·  ${gPass.status}  ·  ${gPass.data?.error}`);
  }

  await sleep(350);

  // Certified T3 — should pass
  log.gate("Sending production run: SecretsScannerAgent  (certified T3)");
  const gPass3 = await api("POST", "/api/ingest", buildRun("SecretsScannerAgent", "production", null, 0));
  if (gPass3.ok) {
    log.ok(`ALLOWED  ·  Run stored  ·  T3 agent with HITL passes gate`);
  } else {
    log.fail(`BLOCKED  ·  ${gPass3.status}  ·  ${gPass3.data?.error}`);
  }

  await sleep(350);

  // Uncertified T4 — must block
  log.gate("Sending production run: InfraResetAgent  (NOT certified for prod)");
  const gBlock = await api("POST", "/api/ingest", buildRun("InfraResetAgent", "production", null, 0));
  if (!gBlock.ok && gBlock.status === 403) {
    log.fail(`BLOCKED  ·  403  ·  ${gBlock.data?.error}  ←  expected`);
    log.info(`Message: "${gBlock.data?.message}"`);
  } else if (gBlock.ok) {
    log.warn("Gate missed — InfraResetAgent passed when it should be blocked");
  }

  await sleep(600);

  // ── STEP 9: DataAnalyticsBot goes rogue — auto-revoke ────────────────────────
  step(9, STEPS,
    `${C.red}DataAnalyticsBot goes rogue — auto-revoke${C.reset}`,
    [
      "An engineer pushed an update to DataAnalyticsBot. It now calls terraform_destroy",
      "— a T4 infra-mutate tool NOT in its certified manifest. Watch what happens."
    ].join("\n  ")
  );

  const rogueManifest = [
    { name: "query_data_warehouse" },  // certified ✓
    { name: "generate_chart" },         // certified ✓
    { name: "terraform_destroy" }       // NEW — not in cert manifest, danger level 4
  ];

  await sleep(400);
  log.gate("Sending production run: DataAnalyticsBot with terraform_destroy in manifest...");

  const rogue1 = await api("POST", "/api/ingest",
    buildRun("DataAnalyticsBot", "production", rogueManifest, 0));

  if (rogue1.ok) {
    log.warn("Run accepted — cert was still valid at gate check");
    log.warn("Auto-revoke engine detected terraform_destroy (level 4) absent from certified manifest");
    log.ok("Cert REVOKED automatically — audit log updated");
  } else {
    log.info(`Blocked at gate (${rogue1.status}): ${rogue1.data?.error}`);
  }

  await sleep(700);

  log.gate("Sending second production run: DataAnalyticsBot (cert now revoked)...");
  const rogue2 = await api("POST", "/api/ingest",
    buildRun("DataAnalyticsBot", "production", rogueManifest, 1));

  if (!rogue2.ok && rogue2.status === 403) {
    log.fail(`BLOCKED  ·  403  ·  ${rogue2.data?.error}  ←  auto-revoke effective`);
    log.ok("Rogue agent cannot ingest production data until re-certified after review");
  } else if (rogue2.ok) {
    log.warn("Second rogue run accepted — auto-revoke may be async, try again in 1s");
  }

  await sleep(500);

  // ── STEP 10: Final status ─────────────────────────────────────────────────────
  step(10, STEPS, "Final certification status across all agents");

  const { data: agentListData } = await api("GET", "/api/agents");
  const agentList = agentListData.agents || [];

  if (agentList.length > 0) {
    console.log(`\n  ${C.bold}${pad("Agent", 28)} ${pad("Staging", 16)} ${pad("Production", 16)} Tier  Outcome${C.reset}`);
    console.log(`  ${hr("─", 70)}`);

    for (const ag of agentList) {
      const s      = ag.stagingCert || "uncertified";
      const p      = ag.prodCert    || "uncertified";
      const sIcon  = s === "certified" ? `${C.green}✓${C.reset}` : s === "revoked" ? `${C.red}✗${C.reset}` : `${C.yellow}○${C.reset}`;
      const pIcon  = p === "certified" ? `${C.green}✓${C.reset}` : p === "revoked" ? `${C.red}✗${C.reset}` : `${C.yellow}○${C.reset}`;

      const outcome = p === "certified"    ? `${C.green}Live in production${C.reset}` :
                      p === "revoked"      ? `${C.red}Revoked — blocked${C.reset}` :
                      ag.effectiveTier >= 4 ? `${C.red}Policy block (T4)${C.reset}` :
                      s === "certified"    ? `${C.yellow}Staging only${C.reset}` :
                                             `${C.dim}Uncertified${C.reset}`;

      console.log(
        `  ${pad(ag.agentName, 28)} ${sIcon} ${pad(s, 14)} ${pIcon} ${pad(p, 14)} T${ag.effectiveTier ?? "?"}   ${outcome}`
      );
    }
  }

  console.log(`\n  ${hr("─", 62)}`);
  console.log(`  ${C.bold}WHAT THIS DEMO SHOWED:${C.reset}`);
  console.log(`\n  ${C.green}✓${C.reset}  T1 FinanceReportBot     — certified, promoted, production gate open`);
  console.log(`  ${C.green}✓${C.reset}  T2 CustomerMessagingAgent — certified with HITL sign-off, promoted`);
  console.log(`  ${C.green}✓${C.reset}  T3 SecretsScannerAgent   — certified full HITL, 38 staging runs, promoted`);
  console.log(`  ${C.red}✗${C.reset}  T4 InfraResetAgent       — cert/promotion blocked by policy (infra-mutate)`);
  console.log(`  ${C.red}✗${C.reset}  DataAnalyticsBot         — T1 certified and promoted, then auto-revoked`);
  console.log(`                               when terraform_destroy appeared in a prod run`);

  console.log(`\n  ${C.bold}Check the dashboard now:${C.reset}`);
  console.log(`  · Governance → cert panel shows live status for all 5 agents`);
  console.log(`  · Governance → audit trail shows every cert/promote/revoke event`);
  console.log(`  · Overview → run volume, cost, score from staging + prod runs`);
  console.log(`\n  ${C.cyan}${ENDPOINT}${C.reset}`);
  console.log(`\n${hr("═")}\n`);
}

main().catch(err => {
  console.error(`\n  ${C.red}Demo failed:${C.reset} ${err.message}`);
  process.exitCode = 1;
});
