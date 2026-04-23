import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRoi } from "../src/roi.js";

const completedSession = { status: "completed", costUsd: 0 };
const runningSession  = { status: "running",   costUsd: 0 };

test("positive net savings when FTE cost > agent cost", () => {
  // 2 completed sessions × 2 hrs × $85/hr = $340 FTE cost
  // agent cost = $10 → net savings = $330
  const result = computeRoi({ sessions: [completedSession, completedSession], agentCostUsd: 10 });
  assert.equal(result.completedSessions, 2);
  assert.equal(result.fteHoursSaved, 4); // 2 sessions × 2 hrs
  assert.equal(result.fteCostEquivalentUsd, 340);
  assert.equal(result.agentCostUsd, 10);
  assert.equal(result.netSavingsUsd, 330);
  assert.ok(result.roiMultiplier > 1, "ROI multiplier should be > 1");
  assert.ok(result.assumptions.avg_human_hours_per_task > 0);
  assert.ok(result.assumptions.loaded_hourly_rate_usd > 0);
});

test("negative net savings when agent cost > FTE equivalent", () => {
  // 0 completed sessions → FTE cost = 0, agent cost = 100 → net = -100
  const result = computeRoi({ sessions: [], agentCostUsd: 100 });
  assert.equal(result.completedSessions, 0);
  assert.equal(result.fteHoursSaved, 0);
  assert.equal(result.fteCostEquivalentUsd, 0);
  assert.equal(result.netSavingsUsd, -100);
  // roi = 0 / 100 = 0 (not null, agent cost > 0)
  assert.equal(result.roiMultiplier, 0);
});

test("roi_multiplier is null when agent cost is zero", () => {
  const result = computeRoi({ sessions: [], agentCostUsd: 0 });
  assert.equal(result.roiMultiplier, null, "roiMultiplier should be null when agent cost is 0");
});

test("non-completed sessions do not count as FTE saved", () => {
  const sessions = [runningSession, runningSession, completedSession];
  const result = computeRoi({ sessions, agentCostUsd: 0 });
  assert.equal(result.completedSessions, 1);
});

test("assumptions object is always included in response", () => {
  const result = computeRoi({ sessions: [], agentCostUsd: 0 });
  assert.ok("assumptions" in result);
  assert.ok("avg_human_hours_per_task" in result.assumptions);
  assert.ok("loaded_hourly_rate_usd" in result.assumptions);
});
