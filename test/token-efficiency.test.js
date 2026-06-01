import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDashboardSnapshot } from "../src/store.js";

test("dashboard snapshot includes token efficiency recommendations", () => {
  const snapshot = buildDashboardSnapshot([
    {
      id: "run_token_heavy",
      agentName: "GitHub Copilot Coding Agent",
      provider: "GitHub",
      model: "copilot-gpt-4.1",
      taskType: "pull-request-implementation",
      status: "success",
      startTime: "2026-05-22T10:00:00.000Z",
      endTime: "2026-05-22T10:00:12.000Z",
      latencyMs: 12000,
      tokensIn: 12000,
      tokensOut: 2500,
      costUsd: 0.17,
      budgetUsd: 0.25,
      autonomyLevel: 4,
      retryCount: 1,
      toolCalls: 6,
      policyViolations: 0,
      userSatisfaction: 4,
      environment: "production-demo",
      workflow: "github-copilot-pr-build",
      team: "engineering",
      tags: ["copilot"],
      breadcrumbs: ["loaded repository context", "retried patch generation"],
      notes: "Copilot implemented a dashboard feature."
    }
  ]);

  assert.equal(snapshot.tokenEfficiency.totalTokens, 14500);
  assert.equal(snapshot.tokenEfficiency.inputTokenPercent, 83);
  assert.equal(snapshot.tokenEfficiency.topAgents[0].agentName, "GitHub Copilot Coding Agent");
  assert.ok(snapshot.tokenEfficiency.retryWasteTokens > 0);
  assert.ok(snapshot.tokenEfficiency.suggestions.some((item) => item.title.includes("Trim repeated context")));
});
