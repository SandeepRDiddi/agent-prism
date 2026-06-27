/**
 * demo_cert_agents.js
 *
 * End-to-end certification demo:
 *   1. Ingest staging runs with toolManifest + humanApprovals for 3 agents
 *   2. Certify each agent in staging
 *   3. Promote eligible agents to production
 *   4. Show final cert status table
 *
 * Run: node demo_cert_agents.js
 */

import { AgentPrism } from "./src/sdk/index.js";

// Accepts both naming conventions:
//   AGENT_PRISM_ENDPOINT / PRISM_URL   — server base URL
//   AGENT_PRISM_API_KEY  / PRISM_KEY   — tenant API key
const ENDPOINT = process.env.AGENT_PRISM_ENDPOINT || process.env.PRISM_URL || "http://localhost:3000";
const API_KEY  = process.env.AGENT_PRISM_API_KEY  || process.env.PRISM_KEY;

if (!API_KEY) {
  console.error("ERROR: No API key set.\nRun with: PRISM_KEY=acp_... node demo_cert_agents.js");
  process.exit(1);
}

console.log(`  Target: ${ENDPOINT}\n`);
const prism = new AgentPrism({ endpoint: ENDPOINT, clientSecret: API_KEY });

// ── Agent definitions ─────────────────────────────────────────────────────────
// Three agents at different risk tiers.  The script shows which pass, which
// are promoted, and which are blocked.

const AGENTS = [
  {
    name: "DataPipelineAgent",
    description: "T1 Low-risk — reads + writes internal DB records",
    stagingRuns: 15,
    tools: [
      { name: "select_records" },   // level 0 — read
      { name: "list_tables" },      // level 0 — read
      { name: "insert_batch" },     // level 1 — internal-write
      { name: "update_record" }     // level 1 — internal-write
    ],
    // Tier 1 needs no HITL (hitlLevels: [])
    humanApprovals: []
  },
  {
    name: "SecretsAuditAgent",
    description: "T3 High-risk — reads secrets + sends alerts, full HITL coverage",
    stagingRuns: 35,  // tier 3 needs >= 30 staging runs for prod promotion
    tools: [
      { name: "get_secret" },        // level 3 — secret-access  → needs HITL
      { name: "select_audit_log" },  // level 0 — read
      { name: "send_message" }       // level 2 — external-call  → needs HITL (tier 3 checks level 2+)
    ],
    // HITL approval with no toolCalled = covers ALL tools in the run
    humanApprovals: [
      { step: "pre-execution-review", approvedBy: "alice@company.com", at: new Date().toISOString() }
    ]
  },
  {
    name: "InfraDestroyAgent",
    description: "T4 Critical — infra destruction + shell exec. Cannot be certified.",
    stagingRuns: 5,
    tools: [
      { name: "terraform_destroy" }, // level 4 — infra-mutate
      { name: "exec_shell" }         // level 3 — process-exec
    ],
    humanApprovals: []
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthToken() {
  return prism._authenticate();
}

async function apiCall(method, path, body) {
  const token = await getAuthToken();
  const res = await fetch(`${prism.endpoint}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function buildStagingRun(agent, index) {
  const startedAt = new Date(Date.now() - (agent.stagingRuns - index) * 5 * 60000).toISOString();
  return {
    payload: {
      session_id: `cert_demo_${agent.name}_${Date.now()}_${index}`,
      agent_name: agent.name,
      model_name: "claude-sonnet-4-20250514",
      outcome: "success",
      started_at: startedAt,
      duration_ms: 4200 + index * 100,
      prompt_tokens: 1200,
      completion_tokens: 300,
      estimated_cost_usd: 0.002,
      budget_usd: 0.05,
      autonomy_level: 2,
      retry_count: 0,
      environment: "staging",
      tool_manifest: agent.tools,
      human_approvals: agent.humanApprovals
    }
  };
}

function statusIcon(s) {
  return s === "certified" ? "✓" : s === "revoked" ? "✗" : "○";
}

function pad(str, n) {
  return String(str ?? "").padEnd(n);
}

// ── Main flow ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Agent Prism — Certification Demo");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── Step 1: ingest staging runs ─────────────────────────────────────────────
  console.log("Step 1 / 3 — Ingesting staging runs with tool manifests...\n");

  for (const agent of AGENTS) {
    process.stdout.write(`  ${pad(agent.name, 24)} `);
    let ok = 0;
    for (let i = 0; i < agent.stagingRuns; i++) {
      try {
        await prism.logRun(buildStagingRun(agent, i));
        ok++;
      } catch (err) {
        process.stdout.write("E");
      }
    }
    console.log(`${ok}/${agent.stagingRuns} runs ingested   (${agent.description})`);
  }

  // ── Step 2: certify in staging ──────────────────────────────────────────────
  console.log("\nStep 2 / 3 — Certifying agents in staging...\n");

  const stagingResults = {};
  for (const agent of AGENTS) {
    const { ok, data } = await apiCall("POST", `/api/agents/${encodeURIComponent(agent.name)}/certify`, { environment: "staging" });
    const cert = data.certification || data;
    stagingResults[agent.name] = { status: cert.certStatus || (ok ? "certified" : "uncertified"), failures: cert.failureReasons || [], checks: cert.checks || [] };

    const icon = stagingResults[agent.name].status === "certified" ? "✓" : "✗";
    console.log(`  ${icon} ${pad(agent.name, 26)} staging: ${stagingResults[agent.name].status}`);

    if (stagingResults[agent.name].failures.length > 0) {
      for (const f of stagingResults[agent.name].failures) {
        console.log(`      ↳ [${f.check}] ${f.detail}`);
      }
    }
  }

  // ── Step 3: promote certified agents to production ─────────────────────────
  console.log("\nStep 3 / 3 — Promoting certified agents to production...\n");

  const prodResults = {};
  for (const agent of AGENTS) {
    if (stagingResults[agent.name].status !== "certified") {
      console.log(`  ○ ${pad(agent.name, 26)} skipped (staging cert failed)`);
      prodResults[agent.name] = "skipped";
      continue;
    }

    const { ok, status, data } = await apiCall("POST", `/api/agents/${encodeURIComponent(agent.name)}/promote`, {});
    if (ok) {
      const certStatus = data.certification?.certStatus || "certified";
      prodResults[agent.name] = certStatus;
      console.log(`  ✓ ${pad(agent.name, 26)} promoted to production`);
    } else {
      prodResults[agent.name] = "blocked";
      const failures = data.failures || data.failureReasons || [];
      console.log(`  ✗ ${pad(agent.name, 26)} promotion blocked (${status})`);
      for (const f of failures) {
        console.log(`      ↳ [${f.check || f}] ${f.detail || ""}`);
      }
    }
  }

  // ── Summary table ───────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────");
  console.log("  CERTIFICATION SUMMARY");
  console.log("───────────────────────────────────────────────────────────");
  console.log(`  ${"Agent".padEnd(28)} ${"Staging".padEnd(14)} ${"Production"}`);
  console.log(`  ${"─".repeat(28)} ${"─".repeat(14)} ${"─".repeat(14)}`);

  for (const agent of AGENTS) {
    const s = stagingResults[agent.name]?.status || "—";
    const p = prodResults[agent.name] || "—";
    console.log(`  ${pad(agent.name, 28)} ${statusIcon(s)} ${pad(s, 12)} ${statusIcon(p)} ${p}`);
  }

  console.log("\n───────────────────────────────────────────────────────────");
  console.log("  Open Governance tab in the dashboard to see live cert status.");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\nDemo failed:", err.message);
  process.exitCode = 1;
});
