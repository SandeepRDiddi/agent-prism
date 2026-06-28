/**
 * PR Review Agent — RISKY version (Tier 4)
 *
 * Same purpose as PRReviewAgent — reviews pull requests.
 * BUT this version declares dangerous tools:
 *   exec_shell       — runs shell commands on the server
 *   force_merge_pr   — merges PRs bypassing review requirements
 *   delete_branch    — deletes branches after merge
 *   modify_repo_settings — can change branch protection rules
 *
 * These tools push it to Tier 3-4. Agent Prism will BLOCK this agent
 * from reaching production certification.
 *
 * Setup: same as pr_review_safe
 *   export GITHUB_TOKEN=ghp_...
 *   export GITHUB_REPO=owner/repo
 *   export PRISM_KEY=acp_...
 *   export PRISM_URL=http://localhost:3000
 *
 * Run:
 *   node agents/pr_review_risky/agent.js
 *
 * Expected outcome:
 *   - Registers with Agent Prism → shows as Tier 3/4 in dashboard
 *   - Governance tab shows dangerous tools with red risk labels
 *   - Certification for production is BLOCKED by policy
 *   - Agent stays in "waiting" state — never goes live on GitHub
 */

// ── Config ─────────────────────────────────────────────────────────────────────

const AGENT_NAME    = "PRReviewAgentPlus";
const AGENT_VERSION = "1.0.0-RISKY";
const POLL_CERT_MS  = 15_000;
const ENV           = "production";

const PRISM_URL    = process.env.PRISM_URL || process.env.AGENT_PRISM_ENDPOINT || "http://localhost:3000";
const PRISM_KEY    = process.env.PRISM_KEY || process.env.AGENT_PRISM_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO;

// ⚠️ DANGEROUS tool manifest — this is what gets this agent blocked
const TOOL_MANIFEST = [
  { name: "fetch_pr_metadata" },      // read — level 0 — safe
  { name: "read_pr_files" },          // read — level 0 — safe
  { name: "post_review_comment" },    // external-call — level 2 — ok
  { name: "exec_shell" },             // process-exec — level 3 — DANGEROUS: runs arbitrary shell commands
  { name: "force_merge_pr" },         // destructive — level 3 — DANGEROUS: bypasses branch protection
  { name: "delete_branch" },          // destructive — level 3 — DANGEROUS: permanent deletion
  { name: "modify_repo_settings" }    // destructive — level 3 — DANGEROUS: changes branch protection rules
];

// ── Validation ─────────────────────────────────────────────────────────────────

const missing = [];
if (!PRISM_KEY)    missing.push("PRISM_KEY");
if (!GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
if (!GITHUB_REPO)  missing.push("GITHUB_REPO");

if (missing.length) {
  console.error(`\n[${AGENT_NAME}] Missing env vars: ${missing.join(", ")}\n`);
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function prism(method, path, body) {
  const res = await fetch(`${PRISM_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-API-Key": PRISM_KEY },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json().catch(() => ({}));
}

function log(msg)  { console.log(`[${new Date().toISOString()}] ${AGENT_NAME} · ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toISOString()}] ⚠ ${AGENT_NAME} · ${msg}`); }

async function checkCertification() {
  try {
    const data = await prism("GET", `/api/agents/${encodeURIComponent(AGENT_NAME)}/cert?env=${ENV}`);
    return (data.cert || data)?.certStatus === "certified";
  } catch {
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${AGENT_NAME} v${AGENT_VERSION}`);
  console.log(`  Repo     : ${GITHUB_REPO}`);
  console.log(`  Prism    : ${PRISM_URL}`);
  console.log(`  Tools    : ${TOOL_MANIFEST.length} tools declared`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  ⚠  WARNING: This agent declares dangerous tools:`);
  for (const t of TOOL_MANIFEST.slice(3)) {
    console.log(`       - ${t.name}`);
  }
  console.log(`  ⚠  Expected result: BLOCKED from production by Agent Prism`);
  console.log(`${"═".repeat(60)}\n`);

  // Register with Agent Prism
  log("Registering with Agent Prism (staging run)...");
  await prism("POST", "/api/ingest", {
    agent_name:         AGENT_NAME,
    model_name:         "rule-based-v1",
    outcome:            "success",
    started_at:         new Date().toISOString(),
    duration_ms:        50,
    prompt_tokens:      0,
    completion_tokens:  0,
    estimated_cost_usd: 0,
    budget_usd:         0.01,
    autonomy_level:     3,
    retry_count:        0,
    environment:        "staging",
    workflow:           "agent-startup",
    team:               "engineering",
    tool_manifest:      TOOL_MANIFEST,
    human_approvals:    [],
    notes:              "Risky agent startup — declares exec_shell, force_merge, delete_branch"
  }).catch(err => warn(`Prism registration failed: ${err.message}`));

  log("Registered. Now check Agent Prism Governance tab.");
  log("This agent shows as Tier 3/4 with red risk labels on its tools.");
  log("Try to certify it — production promotion will be blocked.\n");

  // Poll for cert — will never succeed because tier 4 can't reach production
  let attempts = 0;
  while (true) {
    await new Promise(r => setTimeout(r, POLL_CERT_MS));
    attempts++;

    const certified = await checkCertification();
    if (certified) {
      // This should never happen for a Tier 4 agent — but handle it
      warn("Unexpectedly received production cert — this agent has dangerous tools!");
      warn("Check your certification engine — Tier 4 agents should not reach production.");
      break;
    }

    if (attempts % 4 === 0) {
      log(`Still waiting for cert (attempt ${attempts}). Check Governance tab in dashboard.`);
      log("  → This agent is BLOCKED because it declares exec_shell, force_merge_pr, delete_branch.");
      log("  → Those tools cannot be approved for production by policy.");
    } else {
      process.stdout.write(`  · Not certified (attempt ${attempts}) — ${new Date().toLocaleTimeString()}\r`);
    }
  }
}

main().catch(err => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
