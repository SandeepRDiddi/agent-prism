import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeControlScore, classifyHealth, summarizeStatus, average } from "./scoring.js";

const samplePath = join(process.cwd(), "data", "sample-runs.json");

export function seedRuns() {
  return JSON.parse(readFileSync(samplePath, "utf8"));
}

export function upsertRuns(existingRuns, incomingRuns) {
  const byId = new Map(existingRuns.map((run) => [run.id, run]));

  for (const run of incomingRuns) {
    byId.set(run.id, run);
  }

  return Array.from(byId.values()).sort((left, right) =>
    right.startTime.localeCompare(left.startTime)
  );
}

export function detectCostLeaks(runs) {
  return runs
    .filter((run) => {
      const overBudget = run.costUsd > run.budgetUsd;
      const retryHeavy = run.retryCount >= 3 && run.costUsd > 1;
      const lowOutcome = run.userSatisfaction <= 2 && run.costUsd > 1.5;
      return overBudget || retryHeavy || lowOutcome;
    })
    .map((run) => ({
      id: run.id,
      agentName: run.agentName,
      workflow: run.workflow,
      provider: run.provider,
      costUsd: run.costUsd,
      budgetUsd: run.budgetUsd,
      retryCount: run.retryCount,
      userSatisfaction: run.userSatisfaction,
      leakType:
        run.costUsd > run.budgetUsd
          ? "Budget breach"
          : run.retryCount >= 3
            ? "Retry spiral"
            : "Low-value spend",
      recommendation:
        run.retryCount >= 3
          ? "Tighten tool permissions and add intermediate checkpoints."
          : run.costUsd > run.budgetUsd
            ? "Add budget guardrails and early stopping."
            : "Review prompt quality and handoff logic."
    }))
    .sort((left, right) => right.costUsd - left.costUsd);
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {});
}

export function buildDashboardSnapshot(runs) {
  const enrichedRuns = runs.map((run) => {
    const controlScore = computeControlScore(run);
    return {
      ...run,
      controlScore,
      health: classifyHealth(controlScore)
    };
  });

  const status = summarizeStatus(enrichedRuns);
  const totalCost = enrichedRuns.reduce((sum, run) => sum + run.costUsd, 0);
  const totalBudget = enrichedRuns.reduce((sum, run) => sum + run.budgetUsd, 0);
  const averageLatency = Math.round(average(enrichedRuns.map((run) => run.latencyMs)));
  const averageScore = Math.round(average(enrichedRuns.map((run) => run.controlScore)));
  const averageSatisfaction = average(enrichedRuns.map((run) => run.userSatisfaction)).toFixed(1);

  const byProvider = Object.entries(groupBy(enrichedRuns, (run) => run.provider)).map(
    ([provider, providerRuns]) => ({
      provider,
      runs: providerRuns.length,
      costUsd: Number(providerRuns.reduce((sum, run) => sum + run.costUsd, 0).toFixed(2)),
      avgScore: Math.round(average(providerRuns.map((run) => run.controlScore))),
      successRate: Math.round(
        (providerRuns.filter((run) => run.status === "success").length / providerRuns.length) * 100
      )
    })
  );

  const byWorkflow = Object.entries(groupBy(enrichedRuns, (run) => run.workflow)).map(
    ([workflow, workflowRuns]) => ({
      workflow,
      costUsd: Number(workflowRuns.reduce((sum, run) => sum + run.costUsd, 0).toFixed(2)),
      avgLatencyMs: Math.round(average(workflowRuns.map((run) => run.latencyMs))),
      avgScore: Math.round(average(workflowRuns.map((run) => run.controlScore))),
      failures: workflowRuns.filter((run) => run.status === "failed").length
    })
  );

  const timeline = enrichedRuns
    .slice()
    .sort((left, right) => left.startTime.localeCompare(right.startTime))
    .map((run) => ({
      time: run.startTime,
      agentName: run.agentName,
      costUsd: run.costUsd,
      controlScore: run.controlScore,
      status: run.status
    }));

  const agentProfiles = Object.entries(groupBy(enrichedRuns, (run) => run.agentName))
    .map(([agentName, agentRuns]) => {
      const latestRun = agentRuns
        .slice()
        .sort((left, right) => right.startTime.localeCompare(left.startTime))[0];
      const totalTokens = agentRuns.reduce(
        (sum, run) => sum + run.tokensIn + run.tokensOut,
        0
      );
      const avgLatencyMs = Math.round(average(agentRuns.map((run) => run.latencyMs)));
      const tasksDone = agentRuns.filter((run) => run.status === "success").length;
      return {
        agentName,
        provider: latestRun.provider,
        model: latestRun.model,
        team: latestRun.team,
        workflow: latestRun.workflow,
        status: latestRun.status === "running" ? "Running" : latestRun.health,
        currentTask: latestRun.notes || latestRun.taskType,
        progressPercent: Math.max(
          18,
          Math.min(
            96,
            latestRun.status === "success"
              ? 100
              : latestRun.status === "running"
                ? 64
                : 42
          )
        ),
        controlScore: latestRun.controlScore,
        tasksDone,
        totalTokens,
        avgLatencyMs,
        latestRun
      };
    })
    .sort((left, right) => right.latestRun.startTime.localeCompare(left.latestRun.startTime));

  const selectedAgent = agentProfiles[0] || null;
  const activityFeed = enrichedRuns
    .slice()
    .sort((left, right) => right.startTime.localeCompare(left.startTime))
    .flatMap((run) =>
      (run.breadcrumbs || []).map((breadcrumb, index) => ({
        time: new Date(new Date(run.startTime).getTime() + index * 15000).toISOString(),
        agentName: run.agentName,
        level:
          run.status === "failed"
            ? "error"
            : breadcrumb.toLowerCase().includes("retry")
              ? "warn"
              : breadcrumb.toLowerCase().includes("fetched") ||
                  breadcrumb.toLowerCase().includes("parsed") ||
                  breadcrumb.toLowerCase().includes("loaded")
                ? "info"
                : run.status === "success"
                  ? "success"
                  : "tool",
        message: breadcrumb
      }))
    )
    .sort((left, right) => right.time.localeCompare(left.time))
    .slice(0, 24);

  return {
    usp: {
      name: "Control Score + Cost Leak Radar",
      summary:
        "A provider-agnostic way to compare agents with one score and instantly surface low-value spend before it scales.",
      pillars: [
        "Normalized telemetry across Copilot, Claude, and custom agents",
        "Control Score that blends quality, speed, cost, autonomy, and guardrails",
        "Cost leak radar that explains where money is being wasted"
      ]
    },
    headlineMetrics: {
      totalRuns: status.total,
      successRate: status.total ? Math.round((status.success / status.total) * 100) : 0,
      totalCostUsd: Number(totalCost.toFixed(2)),
      budgetUsedPercent: totalBudget ? Math.round((totalCost / totalBudget) * 100) : 0,
      averageLatencyMs: averageLatency,
      averageControlScore: averageScore,
      averageSatisfaction
    },
    status,
    providerComparison: byProvider.sort((left, right) => right.avgScore - left.avgScore),
    workflowInsights: byWorkflow.sort((left, right) => right.costUsd - left.costUsd),
    costLeaks: detectCostLeaks(enrichedRuns),
    agentProfiles,
    selectedAgent,
    activityFeed,
    recentRuns: enrichedRuns
      .slice()
      .sort((left, right) => right.startTime.localeCompare(left.startTime))
      .slice(0, 12),
    timeline
  };
}
