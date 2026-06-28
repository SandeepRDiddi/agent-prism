/**
 * PR Review Agent — Safe (Tier 2)
 *
 * A real working agent that reviews open GitHub pull requests.
 * Registers itself with Agent Prism, then waits for certification.
 * Once certified in the dashboard → springs to life and starts posting
 * PR reviews on GitHub.
 *
 * Tools declared:
 *   fetch_pr_metadata   — reads PR title, author, branch (read, level 0)
 *   read_pr_files       — reads changed files in the PR (read, level 0)
 *   post_review_comment — posts a comment via GitHub API (external-call, level 2)
 *
 * Risk Tier: T2 (external API call to GitHub, no secrets access, no deletion)
 *
 * Setup:
 *   export GITHUB_TOKEN=ghp_...
 *   export GITHUB_REPO=owner/repo          # e.g. SandeepRDiddi/agent-prism
 *   export PRISM_KEY=acp_...
 *   export PRISM_URL=http://localhost:3000  # or your Render URL
 *
 * Run:
 *   node agents/pr_review_safe/agent.js
 */

// ── Config ─────────────────────────────────────────────────────────────────────

const AGENT_NAME    = "PRReviewAgent";
const AGENT_VERSION = "1.0.0";
const POLL_CERT_MS  = 15_000;   // how often to check cert status
const POLL_PRS_MS   = 60_000;   // how often to scan for new PRs when live
const ENV           = "production";

const PRISM_URL    = process.env.PRISM_URL || process.env.AGENT_PRISM_ENDPOINT || "http://localhost:3000";
const PRISM_KEY    = process.env.PRISM_KEY || process.env.AGENT_PRISM_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO; // "owner/repo"

const TOOL_MANIFEST = [
  { name: "fetch_pr_metadata" },    // reads PR title, labels, author — safe read
  { name: "read_pr_files" },        // reads file diffs from GitHub API — safe read
  { name: "post_review_comment" }   // posts comment via GitHub REST API — external call
];

// ── Validation ─────────────────────────────────────────────────────────────────

const missing = [];
if (!PRISM_KEY)    missing.push("PRISM_KEY");
if (!GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
if (!GITHUB_REPO)  missing.push("GITHUB_REPO");

if (missing.length) {
  console.error(`\n[PRReviewAgent] Missing env vars: ${missing.join(", ")}`);
  console.error("  export PRISM_KEY=acp_...");
  console.error("  export GITHUB_TOKEN=ghp_...");
  console.error("  export GITHUB_REPO=owner/repo\n");
  process.exit(1);
}

const [REPO_OWNER, REPO_NAME] = GITHUB_REPO.split("/");

// ── Helpers ────────────────────────────────────────────────────────────────────

async function prism(method, path, body) {
  const res = await fetch(`${PRISM_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-API-Key": PRISM_KEY },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json().catch(() => ({}));
}

async function github(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub ${res.status}: ${err.message || path}`);
  }
  return res.json();
}

function log(msg)   { console.log(`[${new Date().toISOString()}] ${AGENT_NAME} · ${msg}`); }
function warn(msg)  { console.warn(`[${new Date().toISOString()}] ⚠ ${AGENT_NAME} · ${msg}`); }

// ── Agent Prism: cert check ────────────────────────────────────────────────────

async function checkCertification() {
  try {
    const data = await prism("GET", `/api/agents/${encodeURIComponent(AGENT_NAME)}/cert?env=${ENV}`);
    return (data.cert || data)?.certStatus === "certified";
  } catch {
    return false;
  }
}

// ── Agent Prism: register a run ───────────────────────────────────────────────

async function reportRun({ status, prNumber, filesReviewed, tokensEstimated, startedAt, durationMs, notes }) {
  await prism("POST", "/api/ingest", {
    agent_name:           AGENT_NAME,
    model_name:           "rule-based-v1",
    outcome:              status,
    started_at:           startedAt,
    duration_ms:          durationMs,
    prompt_tokens:        tokensEstimated,
    completion_tokens:    Math.floor(tokensEstimated * 0.3),
    estimated_cost_usd:   0,
    budget_usd:           0.01,
    autonomy_level:       2,
    retry_count:          0,
    environment:          ENV,
    workflow:             "pr-review",
    team:                 "engineering",
    tool_manifest:        TOOL_MANIFEST,
    human_approvals:      [],
    notes:                notes || `Reviewed PR #${prNumber} — ${filesReviewed} files`
  }).catch(err => warn(`Failed to report run to Prism: ${err.message}`));
}

// ── PR Analysis ────────────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /\.env$/i, /secret/i, /password/i, /credential/i, /private.key/i,
  /\.pem$/i, /\.p12$/i, /token/i, /api.?key/i
];

const RISKY_EXTENSIONS = new Set([".sql", ".sh", ".bash", ".ps1", ".tf"]);

function analysePR(pr, files) {
  const flags   = [];
  const summary = [];

  // Size check
  const additions = files.reduce((s, f) => s + f.additions, 0);
  const deletions = files.reduce((s, f) => s + f.deletions, 0);
  if (files.length > 20)      flags.push(`⚠️ Large PR: ${files.length} files changed`);
  if (additions > 500)        flags.push(`⚠️ High addition volume: +${additions} lines`);
  if (deletions > 300)        flags.push(`⚠️ High deletion volume: -${deletions} lines`);

  // Sensitive file check
  const sensitiveFiles = files.filter(f =>
    SENSITIVE_PATTERNS.some(p => p.test(f.filename)));
  if (sensitiveFiles.length)
    flags.push(`🔐 Sensitive files modified: ${sensitiveFiles.map(f => f.filename).join(", ")}`);

  // Risky extension check
  const riskyFiles = files.filter(f => {
    const ext = "." + f.filename.split(".").pop().toLowerCase();
    return RISKY_EXTENSIONS.has(ext);
  });
  if (riskyFiles.length)
    flags.push(`🔧 Infrastructure/script files changed: ${riskyFiles.map(f => f.filename).join(", ")}`);

  // Test coverage check
  const hasTestFiles = files.some(f => /\.(test|spec)\.[jt]sx?$/.test(f.filename) || /\/__tests__\//.test(f.filename));
  const hasSourceFiles = files.some(f => /\.[jt]sx?$/.test(f.filename) && !/(test|spec)/.test(f.filename));
  if (hasSourceFiles && !hasTestFiles)
    flags.push(`📋 Source changes with no test file changes`);

  // File type breakdown
  const byType = {};
  for (const f of files) {
    const ext = f.filename.includes(".") ? f.filename.split(".").pop().toLowerCase() : "other";
    byType[ext] = (byType[ext] || 0) + 1;
  }
  const typeList = Object.entries(byType).sort((a,b)=>b[1]-a[1])
    .slice(0, 4).map(([k,v]) => `${v}×.${k}`).join(", ");
  summary.push(`**Files:** ${files.length} changed (+${additions}/-${deletions} lines) — ${typeList}`);
  summary.push(`**Branch:** \`${pr.head.ref}\` → \`${pr.base.ref}\``);

  return { flags, summary, riskLevel: flags.length === 0 ? "low" : flags.length <= 2 ? "medium" : "high" };
}

function buildReviewComment(pr, files, analysis) {
  const icon = analysis.riskLevel === "low" ? "✅" : analysis.riskLevel === "medium" ? "⚠️" : "🔴";
  const lines = [
    `## ${icon} PR Review — Agent Prism`,
    ``,
    `**Agent:** ${AGENT_NAME} v${AGENT_VERSION} · Certified for production via [Agent Prism](${PRISM_URL})`,
    ``,
    ...analysis.summary,
    ``
  ];

  if (analysis.flags.length > 0) {
    lines.push(`### Flags`);
    for (const f of analysis.flags) lines.push(`- ${f}`);
    lines.push(``);
  }

  if (analysis.riskLevel === "low") {
    lines.push(`### Assessment`);
    lines.push(`No risk flags. PR looks clean. Human review recommended before merge.`);
  } else if (analysis.riskLevel === "medium") {
    lines.push(`### Assessment`);
    lines.push(`Some flags raised. Please review the items above before merging.`);
  } else {
    lines.push(`### Assessment`);
    lines.push(`Multiple risk flags. Recommend thorough review before merging.`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`*Automated review by ${AGENT_NAME} · Certified via Agent Prism · ${new Date().toUTCString()}*`);

  return lines.join("\n");
}

// ── Core: review a single PR ───────────────────────────────────────────────────

async function reviewPR(pr) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  log(`Reviewing PR #${pr.number}: "${pr.title}" by @${pr.user.login}`);

  // tool: fetch_pr_metadata  (already have it from list call)
  // tool: read_pr_files
  const files = await github(`/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${pr.number}/files`);
  log(`  read_pr_files: ${files.length} files`);

  // Analyse
  const analysis = analysePR(pr, files);
  log(`  Risk level: ${analysis.riskLevel} · Flags: ${analysis.flags.length}`);

  // tool: post_review_comment
  const body = buildReviewComment(pr, files, analysis);
  await github(`/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${pr.number}/reviews`, {
    method: "POST",
    body: JSON.stringify({ body, event: "COMMENT" })
  });
  log(`  post_review_comment: posted to PR #${pr.number}`);

  // Report run to Agent Prism
  await reportRun({
    status:          "success",
    prNumber:        pr.number,
    filesReviewed:   files.length,
    tokensEstimated: files.length * 80,
    startedAt,
    durationMs:      Date.now() - t0,
    notes:           `PR #${pr.number}: ${analysis.riskLevel} risk · ${analysis.flags.length} flag(s)`
  });

  return analysis;
}

// ── Main loop ──────────────────────────────────────────────────────────────────

const reviewed = new Set(); // track PRs already reviewed in this session

async function runReviewCycle() {
  log(`Scanning ${GITHUB_REPO} for open PRs...`);
  try {
    const prs = await github(`/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=open&per_page=10`);
    const toReview = prs.filter(pr => !reviewed.has(pr.number));

    if (toReview.length === 0) {
      log(`No new PRs to review (${prs.length} open, all already reviewed this session)`);
      return;
    }

    log(`Found ${toReview.length} new PR(s) to review`);
    for (const pr of toReview) {
      await reviewPR(pr);
      reviewed.add(pr.number);
    }
  } catch (err) {
    warn(`PR scan failed: ${err.message}`);
  }
}

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${AGENT_NAME} v${AGENT_VERSION}`);
  console.log(`  Repo     : ${GITHUB_REPO}`);
  console.log(`  Prism    : ${PRISM_URL}`);
  console.log(`  Tools    : ${TOOL_MANIFEST.map(t => t.name).join(", ")}`);
  console.log(`${"═".repeat(60)}\n`);

  // Register with Agent Prism by ingesting a staging run so the agent appears in the dashboard
  log("Registering with Agent Prism (staging run to create cert profile)...");
  await prism("POST", "/api/ingest", {
    agent_name:     AGENT_NAME,
    model_name:     "rule-based-v1",
    outcome:        "success",
    started_at:     new Date().toISOString(),
    duration_ms:    50,
    prompt_tokens:  0,
    completion_tokens: 0,
    estimated_cost_usd: 0,
    budget_usd:     0.01,
    autonomy_level: 2,
    retry_count:    0,
    environment:    "staging",
    workflow:       "agent-startup",
    team:           "engineering",
    tool_manifest:  TOOL_MANIFEST,
    human_approvals: [],
    notes:          "Agent startup registration"
  }).catch(err => warn(`Prism registration failed: ${err.message}`));

  log("Registered. Checking certification status...\n");

  // Wait for certification
  let certified = await checkCertification();

  if (!certified) {
    console.log(`  ╔${"═".repeat(54)}╗`);
    console.log(`  ║  WAITING FOR CERTIFICATION                           ║`);
    console.log(`  ║                                                      ║`);
    console.log(`  ║  Open Agent Prism dashboard → Governance tab         ║`);
    console.log(`  ║  Find PRReviewAgent → click Review & Certify         ║`);
    console.log(`  ║  Review tools → confirm → Promote to Production      ║`);
    console.log(`  ║                                                      ║`);
    console.log(`  ║  Agent will spring to life automatically.            ║`);
    console.log(`  ╚${"═".repeat(54)}╝\n`);

    while (!certified) {
      await new Promise(r => setTimeout(r, POLL_CERT_MS));
      certified = await checkCertification();
      if (!certified) {
        process.stdout.write(`  · Waiting for production cert in Prism dashboard... (${new Date().toLocaleTimeString()})\r`);
      }
    }
  }

  console.log(`\n  ✓ CERTIFIED — Agent is now live!\n`);
  log(`Production cert confirmed. Starting PR review loop for ${GITHUB_REPO}`);

  // Initial scan immediately
  await runReviewCycle();

  // Then poll
  setInterval(runReviewCycle, POLL_PRS_MS);
  log(`Polling for new PRs every ${POLL_PRS_MS / 1000}s. Press Ctrl+C to stop.`);
}

main().catch(err => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
