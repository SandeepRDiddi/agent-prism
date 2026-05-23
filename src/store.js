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

function buildTokenEfficiency(enrichedRuns) {
  const tokenRuns = enrichedRuns.filter((run) => (run.tokensIn || 0) + (run.tokensOut || 0) > 0);
  const totalInputTokens = tokenRuns.reduce((sum, run) => sum + (run.tokensIn || 0), 0);
  const totalOutputTokens = tokenRuns.reduce((sum, run) => sum + (run.tokensOut || 0), 0);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const totalCostUsd = tokenRuns.reduce((sum, run) => sum + (run.costUsd || 0), 0);
  const retryRuns = tokenRuns.filter((run) => (run.retryCount || 0) > 0);
  const retryWasteTokens = retryRuns.reduce((sum, run) => {
    const runTokens = (run.tokensIn || 0) + (run.tokensOut || 0);
    const retryShare = run.retryCount / (run.retryCount + 1);
    return sum + Math.round(runTokens * retryShare);
  }, 0);

  const byAgent = Object.entries(groupBy(tokenRuns, (run) => run.agentName)).map(
    ([agentName, agentRuns]) => {
      const tokensIn = agentRuns.reduce((sum, run) => sum + (run.tokensIn || 0), 0);
      const tokensOut = agentRuns.reduce((sum, run) => sum + (run.tokensOut || 0), 0);
      const costUsd = agentRuns.reduce((sum, run) => sum + (run.costUsd || 0), 0);
      return {
        agentName,
        provider: agentRuns[0]?.provider || "Unknown",
        workflow: agentRuns[0]?.workflow || "default",
        runs: agentRuns.length,
        tokensIn,
        tokensOut,
        totalTokens: tokensIn + tokensOut,
        avgTokensPerRun: Math.round((tokensIn + tokensOut) / agentRuns.length),
        costUsd: Number(costUsd.toFixed(4))
      };
    }
  ).sort((left, right) => right.totalTokens - left.totalTokens);

  const byWorkflow = Object.entries(groupBy(tokenRuns, (run) => run.workflow)).map(
    ([workflow, workflowRuns]) => {
      const total = workflowRuns.reduce((sum, run) => sum + (run.tokensIn || 0) + (run.tokensOut || 0), 0);
      const retries = workflowRuns.reduce((sum, run) => sum + (run.retryCount || 0), 0);
      return {
        workflow,
        runs: workflowRuns.length,
        totalTokens: total,
        avgTokensPerRun: Math.round(total / workflowRuns.length),
        retries
      };
    }
  ).sort((left, right) => right.totalTokens - left.totalTokens);

  const suggestions = [];
  const inputRatio = totalTokens ? totalInputTokens / totalTokens : 0;
  const outputRatio = totalTokens ? totalOutputTokens / totalTokens : 0;
  const topAgent = byAgent[0];
  const topWorkflow = byWorkflow[0];
  const costPer1kTokens = totalTokens ? (totalCostUsd / totalTokens) * 1000 : 0;
  const runsPerDay = tokenRuns.length > 0 ? tokenRuns.length : 1;
  const projectedMonthlyRuns = runsPerDay * 30;
  const projectedMonthlyCost = totalCostUsd > 0
    ? Number((totalCostUsd / tokenRuns.length * projectedMonthlyRuns).toFixed(2))
    : 0;
  const wastePercent = totalTokens ? Math.round((retryWasteTokens / totalTokens) * 100) : 0;
  const efficiencyScore = Math.max(0, Math.min(100,
    100
    - (inputRatio > 0.70 ? 25 : inputRatio > 0.65 ? 12 : 0)
    - (outputRatio > 0.45 ? 20 : outputRatio > 0.40 ? 10 : 0)
    - (wastePercent > 10 ? 25 : wastePercent > 5 ? 12 : 0)
    - (topAgent && topAgent.avgTokensPerRun > 15000 ? 20 : topAgent && topAgent.avgTokensPerRun > 8000 ? 10 : 0)
  ));

  if (!totalTokens) {
    suggestions.push({
      title: "Run an agent to unlock token coaching",
      impact: "Waiting for telemetry",
      savingsEstimate: null,
      effort: "None",
      action: "Send a run through the Claude or OpenAI proxy. Token mix, cost efficiency, and workflow patterns will be scored automatically.",
      target: "Goal: first run recorded"
    });
  }

  if (inputRatio > 0.65 && totalTokens > 3000) {
    const savableTokens = Math.round(totalInputTokens * 0.30);
    const savingsUsd = Number((savableTokens * costPer1kTokens / 1000).toFixed(4));
    const monthlySavings = Number((savingsUsd / tokenRuns.length * projectedMonthlyRuns).toFixed(2));
    suggestions.push({
      title: "Trim repeated context from prompts",
      impact: `${Math.round(inputRatio * 100)}% of tokens are input (${totalInputTokens.toLocaleString()} tokens total)`,
      savingsEstimate: `Cutting input by 30% saves ~${savableTokens.toLocaleString()} tokens = $${monthlySavings}/month at current run rate`,
      effort: "Medium",
      action: "Cache repository summaries once per session instead of re-sending them. Send only the diff, not the full file. Replace long system prompts with compact task briefs (target: under 2,000 input tokens per run).",
      target: `Target: input mix below 65% (currently ${Math.round(inputRatio * 100)}%)`
    });
  }

  if (outputRatio > 0.4 && totalTokens > 3000) {
    const savableTokens = Math.round(totalOutputTokens * 0.35);
    const savingsUsd = Number((savableTokens * costPer1kTokens / 1000).toFixed(4));
    const monthlySavings = Number((savingsUsd / tokenRuns.length * projectedMonthlyRuns).toFixed(2));
    suggestions.push({
      title: "Cap verbose agent responses",
      impact: `${Math.round(outputRatio * 100)}% of tokens are output (${totalOutputTokens.toLocaleString()} tokens total)`,
      savingsEstimate: `Reducing output verbosity by 35% saves ~${savableTokens.toLocaleString()} tokens = $${monthlySavings}/month`,
      effort: "Low",
      action: "Add to your system prompt: 'Respond with findings only. No preamble, no recap, no closing remarks. Use bullet points. Maximum 500 words.' Switch to structured JSON output for programmatic consumers.",
      target: `Target: output mix below 35% (currently ${Math.round(outputRatio * 100)}%)`
    });
  }

  if (retryWasteTokens > 0) {
    const monthlySavings = Number((retryWasteTokens * costPer1kTokens / 1000 / tokenRuns.length * projectedMonthlyRuns).toFixed(2));
    suggestions.push({
      title: "Eliminate retry token waste",
      impact: `${retryWasteTokens.toLocaleString()} tokens wasted in retry loops (${wastePercent}% of all usage)`,
      savingsEstimate: `Fixing root retry causes saves $${monthlySavings}/month`,
      effort: "High",
      action: "Add a preflight validation step before the agent runs. Log the exact failure message on first attempt. Add a stop condition so the agent halts after 2 failures instead of retrying indefinitely.",
      target: "Target: retry count = 0 on all runs"
    });
  }

  if (topAgent && topAgent.avgTokensPerRun > 8000) {
    const excessTokens = topAgent.avgTokensPerRun - 6000;
    const monthlySavings = Number((excessTokens * costPer1kTokens / 1000 * topAgent.runs / tokenRuns.length * projectedMonthlyRuns).toFixed(2));
    suggestions.push({
      title: `Right-size "${topAgent.agentName}"`,
      impact: `${topAgent.avgTokensPerRun.toLocaleString()} avg tokens/run — ${excessTokens.toLocaleString()} above 6k target`,
      savingsEstimate: `Trimming to 6k avg tokens/run saves ~$${monthlySavings}/month`,
      effort: "Medium",
      action: "Split this agent's work into 3 phases: (1) plan — lightweight, under 1k tokens; (2) execute — focused context only; (3) verify — diff only. Each call gets only what it needs.",
      target: "Target: avg tokens/run below 6,000"
    });
  }

  if (topWorkflow && topWorkflow.retries > 0) {
    suggestions.push({
      title: `Stabilise "${topWorkflow.workflow}" workflow`,
      impact: `${topWorkflow.retries} retries logged — highest-token workflow at ${topWorkflow.avgTokensPerRun.toLocaleString()} avg tokens/run`,
      savingsEstimate: "Every retry doubles token cost for that run",
      effort: "High",
      action: "Add checkpoints between workflow steps. Validate tool outputs before passing to next step. Set explicit stop conditions so failures surface immediately rather than looping.",
      target: "Target: 0 retries on this workflow"
    });
  }

  if (suggestions.length < 3 && totalTokens > 0) {
    const haiku_savings = Number((totalCostUsd * 0.6 / tokenRuns.length * projectedMonthlyRuns).toFixed(2));
    suggestions.push({
      title: "Route routine tasks to cheaper model tiers",
      impact: `All runs on current model — not all tasks need premium capability`,
      savingsEstimate: `Routing 60% of tasks to a smaller model could save ~$${haiku_savings}/month`,
      effort: "Low",
      action: "Use claude-haiku or gpt-4o-mini for classification, formatting, summarisation, and simple lookups. Reserve claude-sonnet or gpt-4o for multi-step reasoning and code generation.",
      target: "Target: 40% of runs on lightweight models"
    });
  }

  return {
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    inputTokenPercent: totalTokens ? Math.round((totalInputTokens / totalTokens) * 100) : 0,
    outputTokenPercent: totalTokens ? Math.round((totalOutputTokens / totalTokens) * 100) : 0,
    avgTokensPerRun: tokenRuns.length ? Math.round(totalTokens / tokenRuns.length) : 0,
    costPer1kTokensUsd: totalTokens ? Number(((totalCostUsd / totalTokens) * 1000).toFixed(4)) : 0,
    projectedMonthlyCost,
    efficiencyScore,
    wastePercent,
    retryWasteTokens,
    topAgents: byAgent.slice(0, 5),
    workflowHotspots: byWorkflow.slice(0, 5),
    suggestions: suggestions.slice(0, 5)
  };
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
    .flatMap((run) => {
      const crumbs = run.breadcrumbs || [];
      if (crumbs.length > 0) {
        return crumbs.map((breadcrumb, index) => ({
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
        }));
      }
      const totalTokens = (run.tokensIn || 0) + (run.tokensOut || 0);
      const events = [
        {
          time: run.startTime,
          agentName: run.agentName,
          level: "info",
          message: `Started — model: ${run.model || "unknown"}, workflow: ${run.workflow || "default"}`
        }
      ];
      if (totalTokens > 0) {
        events.push({
          time: run.endTime || run.startTime,
          agentName: run.agentName,
          level: run.status === "success" ? "success" : "error",
          message: `${run.status === "success" ? "Completed" : "Failed"} — ${(run.tokensIn || 0).toLocaleString()} in + ${(run.tokensOut || 0).toLocaleString()} out = ${totalTokens.toLocaleString()} tokens · $${(run.costUsd || 0).toFixed(4)} · ${run.latencyMs}ms`
        });
      } else {
        events.push({
          time: run.endTime || run.startTime,
          agentName: run.agentName,
          level: run.status === "success" ? "success" : "error",
          message: `${run.status === "success" ? "Completed" : "Failed"} in ${run.latencyMs}ms`
        });
      }
      return events;
    })
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
    tokenEfficiency: buildTokenEfficiency(enrichedRuns),
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
