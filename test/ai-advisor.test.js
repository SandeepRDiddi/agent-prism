import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdvisorTelemetry, parseAdvisorJson } from "../src/ai-advisor.js";
import { buildDashboardSnapshot } from "../src/store.js";

const sampleRun = {
  id: "run_ai_advisor",
  agentName: "Copilot PR Agent",
  provider: "GitHub Copilot",
  model: "gpt-4.1",
  taskType: "pull-request-review",
  status: "success",
  startTime: "2026-05-22T10:00:00.000Z",
  endTime: "2026-05-22T10:00:12.000Z",
  latencyMs: 12000,
  tokensIn: 9000,
  tokensOut: 1200,
  costUsd: 0.12,
  budgetUsd: 0.2,
  autonomyLevel: 4,
  retryCount: 1,
  toolCalls: 3,
  policyViolations: 0,
  userSatisfaction: 4,
  environment: "production-demo",
  workflow: "github-copilot-pr-build",
  team: "engineering"
};

test("AI Advisor telemetry contains no connector secrets and summarizes tenant runs", () => {
  const snapshot = buildDashboardSnapshot([sampleRun]);
  const telemetry = buildAdvisorTelemetry({
    tenant: {
      id: "tenant_demo",
      name: "Demo Tenant",
      plan: "enterprise-trial",
      apiKey: "acp_should_not_leak"
    },
    snapshot,
    runs: [sampleRun]
  });

  assert.equal(telemetry.tenant.id, "tenant_demo");
  assert.equal(telemetry.headline.totalRuns, 1);
  assert.equal(telemetry.recentRuns[0].agentName, "Copilot PR Agent");
  assert.equal(JSON.stringify(telemetry).includes("acp_should_not_leak"), false);
});

test("AI Advisor parses fenced JSON from a local Llama response", () => {
  const parsed = parseAdvisorJson(`\`\`\`json
  {
    "summary": "Retry waste is the first issue to fix.",
    "confidence": "high",
    "priority": "cost",
    "recommendations": [
      {
        "title": "Cap retries",
        "why": "Retries are consuming tokens.",
        "action": "Set maximum retries to two.",
        "expectedImpact": "Lower token waste.",
        "owner": "Platform owner",
        "nextCheck": "Review the next production run."
      }
    ],
    "questions": []
  }
  \`\`\``);

  assert.equal(parsed.priority, "cost");
  assert.equal(parsed.recommendations[0].title, "Cap retries");
});
