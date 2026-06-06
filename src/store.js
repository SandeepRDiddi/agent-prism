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
  const promptBreakdown = {
    userPromptTokens: tokenRuns.reduce((sum, run) => sum + (run.userPromptTokens || 0), 0),
    systemPromptTokens: tokenRuns.reduce((sum, run) => sum + (run.systemPromptTokens || 0), 0),
    contextTokens: tokenRuns.reduce((sum, run) => sum + (run.contextTokens || 0), 0),
    toolResultTokens: tokenRuns.reduce((sum, run) => sum + (run.toolResultTokens || 0), 0),
    memoryTokens: tokenRuns.reduce((sum, run) => sum + (run.memoryTokens || 0), 0)
  };
  const capturedPromptBucketTokens = Object.values(promptBreakdown).reduce((sum, value) => sum + value, 0);
  promptBreakdown.uncategorizedPromptTokens = Math.max(0, totalInputTokens - capturedPromptBucketTokens);
  promptBreakdown.capturedPromptBucketTokens = capturedPromptBucketTokens;
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
      const agentPromptBreakdown = {
        userPromptTokens: agentRuns.reduce((sum, run) => sum + (run.userPromptTokens || 0), 0),
        systemPromptTokens: agentRuns.reduce((sum, run) => sum + (run.systemPromptTokens || 0), 0),
        contextTokens: agentRuns.reduce((sum, run) => sum + (run.contextTokens || 0), 0),
        toolResultTokens: agentRuns.reduce((sum, run) => sum + (run.toolResultTokens || 0), 0),
        memoryTokens: agentRuns.reduce((sum, run) => sum + (run.memoryTokens || 0), 0)
      };
      const agentCapturedPromptTokens = Object.values(agentPromptBreakdown).reduce((sum, value) => sum + value, 0);
      agentPromptBreakdown.uncategorizedPromptTokens = Math.max(0, tokensIn - agentCapturedPromptTokens);
      return {
        agentName,
        provider: agentRuns[0]?.provider || "Unknown",
        workflow: agentRuns[0]?.workflow || "default",
        runs: agentRuns.length,
        tokensIn,
        tokensOut,
        promptBreakdown: agentPromptBreakdown,
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
      metricKey: "inputTokenPercent",
      metricSnapshot: Math.round(inputRatio * 100),
      impact: `${Math.round(inputRatio * 100)}% of tokens are input (${totalInputTokens.toLocaleString()} tokens total)`,
      savingsEstimate: `Cutting input by 30% saves ~${savableTokens.toLocaleString()} tokens = $${monthlySavings}/month at current run rate`,
      effort: "Medium",
      diagnosis: `Your agents are sending ${Math.round(inputRatio * 100)}% input tokens — healthy agents stay below 65%. This gap of ${Math.round((inputRatio - 0.65) * 100)}% means prompts contain far more context than the model needs. Common causes: full file contents sent on every run, long system prompts repeated each call, entire conversation history re-attached instead of a summary.`,
      whatToChange: [
        `Cache repository or document summaries once per session — do not re-send on every run`,
        `Send only the changed lines (diff), not the full file`,
        `Replace system prompts longer than 2,000 tokens with a compact task brief`,
        `Summarise prior conversation turns instead of appending the full history`
      ],
      howToTest: `After making these changes, run the same agent 3 times. Return to Token Coach — the Input Mix stat should drop below 65% and your Efficiency Score should increase. If input% is still above 70%, at least one of the above changes has not been applied yet.`,
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
      metricKey: "outputTokenPercent",
      metricSnapshot: Math.round(outputRatio * 100),
      impact: `${Math.round(outputRatio * 100)}% of tokens are output (${totalOutputTokens.toLocaleString()} tokens total)`,
      savingsEstimate: `Reducing output verbosity by 35% saves ~${savableTokens.toLocaleString()} tokens = $${monthlySavings}/month`,
      effort: "Low",
      diagnosis: `Output tokens account for ${Math.round(outputRatio * 100)}% of usage — above the 35% healthy ceiling. Models bill output at 3–5× the cost of input tokens, so verbosity compounds fast. Likely cause: no response length constraint in the system prompt. The model is generating preambles, recaps, and closing remarks that no downstream system reads.`,
      whatToChange: [
        `Add to system prompt: "Respond with findings only. No preamble, no recap, no closing remarks."`,
        `Specify a word or token budget: "Maximum 400 words" or "max_tokens: 600" in the API call`,
        `For programmatic consumers, instruct the model to return structured JSON instead of prose`,
        `Use bullet points instead of paragraphs — models produce fewer tokens per fact`
      ],
      howToTest: `Run the same task after adding the constraint. Compare the Output Mix stat in Token Coach — it should drop below 35%. Check that the response still contains all the data your workflow actually uses. If quality drops, the constraint is too tight — relax the word budget by 20%.`,
      action: "Add to your system prompt: 'Respond with findings only. No preamble, no recap, no closing remarks. Use bullet points. Maximum 500 words.' Switch to structured JSON output for programmatic consumers.",
      target: `Target: output mix below 35% (currently ${Math.round(outputRatio * 100)}%)`
    });
  }

  if (retryWasteTokens > 0) {
    const monthlySavings = Number((retryWasteTokens * costPer1kTokens / 1000 / tokenRuns.length * projectedMonthlyRuns).toFixed(2));
    suggestions.push({
      title: "Eliminate retry token waste",
      metricKey: "wastePercent",
      metricSnapshot: wastePercent,
      impact: `${retryWasteTokens.toLocaleString()} tokens wasted in retry loops (${wastePercent}% of all usage)`,
      savingsEstimate: `Fixing root retry causes saves $${monthlySavings}/month`,
      effort: "High",
      diagnosis: `${retryWasteTokens.toLocaleString()} tokens (${wastePercent}% of total spend) were consumed by runs that failed and retried. Each retry re-sends the full context from scratch. Root causes are typically: tool call errors not caught before retry, missing validation between agent steps, no maximum retry cap configured, or upstream API rate limits hitting mid-run.`,
      whatToChange: [
        `Add a preflight validation step — check that required inputs and tool permissions are valid before the agent starts`,
        `Log the exact error message from the first failure so you can diagnose the root cause`,
        `Set max_retries: 2 (or equivalent) in your agent config — halting beats looping`,
        `Add a checkpoint after each major workflow step so a failure restarts from the last checkpoint, not the beginning`
      ],
      howToTest: `After applying these changes, run the same workflow and check the Activity tab. You should see zero "retry" events in the event log. In Token Coach, Retry Waste should read 0%. If retries still appear, open the Activity log and find the exact error message — that is what still needs to be fixed.`,
      action: "Add a preflight validation step before the agent runs. Log the exact failure message on first attempt. Add a stop condition so the agent halts after 2 failures instead of retrying indefinitely.",
      target: "Target: retry count = 0 on all runs"
    });
  }

  if (topAgent && topAgent.avgTokensPerRun > 8000) {
    const excessTokens = topAgent.avgTokensPerRun - 6000;
    const monthlySavings = Number((excessTokens * costPer1kTokens / 1000 * topAgent.runs / tokenRuns.length * projectedMonthlyRuns).toFixed(2));
    suggestions.push({
      title: `Right-size "${topAgent.agentName}"`,
      metricKey: "avgTokensPerRun",
      metricSnapshot: topAgent.avgTokensPerRun,
      impact: `${topAgent.avgTokensPerRun.toLocaleString()} avg tokens/run — ${excessTokens.toLocaleString()} above 6k target`,
      savingsEstimate: `Trimming to 6k avg tokens/run saves ~$${monthlySavings}/month`,
      effort: "Medium",
      diagnosis: `"${topAgent.agentName}" averages ${topAgent.avgTokensPerRun.toLocaleString()} tokens per run — ${excessTokens.toLocaleString()} tokens above the 6,000 recommended ceiling. This agent is likely doing too much in one call: combining planning, execution, and verification in a single prompt. Large single-call agents are expensive, harder to debug, and fail more expensively when something goes wrong.`,
      whatToChange: [
        `Split into 3 focused calls: (1) Plan — describe the task only, under 1,000 tokens; (2) Execute — pass only the specific context needed; (3) Verify — pass only the diff or output to check`,
        `Remove any full codebase or document context — pass only the relevant section`,
        `Profile which part of the prompt is largest using the token count in the Activity log`
      ],
      howToTest: `After splitting, check the Top Agents table in Token Coach. "${topAgent.agentName}" should now appear with an avg tokens/run below 6,000. Total cost for this agent should decrease even though run count increases (3 small calls replace 1 large one). If cost increases, the split is not reducing context — check what each sub-call is receiving.`,
      action: "Split this agent's work into 3 phases: (1) plan — lightweight, under 1k tokens; (2) execute — focused context only; (3) verify — diff only. Each call gets only what it needs.",
      target: "Target: avg tokens/run below 6,000"
    });
  }

  if (topWorkflow && topWorkflow.retries > 0) {
    suggestions.push({
      title: `Stabilise "${topWorkflow.workflow}" workflow`,
      metricKey: "wastePercent",
      metricSnapshot: wastePercent,
      impact: `${topWorkflow.retries} retries logged — highest-token workflow at ${topWorkflow.avgTokensPerRun.toLocaleString()} avg tokens/run`,
      savingsEstimate: "Every retry doubles token cost for that run",
      effort: "High",
      diagnosis: `The "${topWorkflow.workflow}" workflow has logged ${topWorkflow.retries} retries and is your most token-intensive workflow at ${topWorkflow.avgTokensPerRun.toLocaleString()} avg tokens/run. Retries in high-token workflows are especially costly — each retry re-runs the full context window. This indicates missing validation between steps or an unhandled failure mode that causes the entire workflow to restart.`,
      whatToChange: [
        `Add a validation gate after each step — verify the output before passing it to the next step`,
        `Identify which step triggers the retry by reading the Activity log for this workflow`,
        `Set an explicit stop condition: fail fast with a clear error rather than retrying silently`,
        `Add an idempotency key so resumed workflows pick up from the last successful step`
      ],
      howToTest: `After adding validation gates, run the workflow end-to-end. In the Activity tab, filter by this workflow name — you should see a clean sequence with no retry events. In Token Coach, the Workflow Hotspots table should show 0 retries for "${topWorkflow.workflow}". If retries persist, read the specific error in the Activity log — that step needs its own fix.`,
      action: "Add checkpoints between workflow steps. Validate tool outputs before passing to next step. Set explicit stop conditions so failures surface immediately rather than looping.",
      target: "Target: 0 retries on this workflow"
    });
  }

  if (suggestions.length < 3 && totalTokens > 0) {
    const haiku_savings = Number((totalCostUsd * 0.6 / tokenRuns.length * projectedMonthlyRuns).toFixed(2));
    suggestions.push({
      title: "Route routine tasks to cheaper model tiers",
      metricKey: "costPer1kTokensUsd",
      metricSnapshot: costPer1kTokens,
      impact: `All runs on current model — not all tasks need premium capability`,
      savingsEstimate: `Routing 60% of tasks to a smaller model could save ~$${haiku_savings}/month`,
      effort: "Low",
      diagnosis: `All current runs are using the same model tier regardless of task complexity. Simple tasks — classification, formatting, summarisation, boolean lookups — do not need a premium reasoning model. Running them on claude-sonnet or gpt-4o consumes 5–10× the budget of a smaller model with no improvement in outcome for routine operations.`,
      whatToChange: [
        `Classify tasks by complexity before routing: simple tasks go to claude-haiku or gpt-4.1-mini; complex reasoning goes to claude-sonnet or gpt-4o`,
        `Tasks that are "simple": format conversion, field extraction, yes/no checks, short summarisation`,
        `Tasks that need premium: multi-step code generation, chain-of-thought analysis, ambiguous instructions`
      ],
      howToTest: `After routing, return to Token Coach. The Provider Comparison scorecard in the Governance tab will show a new lightweight model alongside your current one. Compare cost-per-run — the lightweight model should cost 5–10× less per run. Verify quality by checking user satisfaction scores in the Agent Profiles panel. If satisfaction drops, move that task type back to the premium tier.`,
      action: "Use claude-haiku or gpt-4o-mini for classification, formatting, summarisation, and simple lookups. Reserve claude-sonnet or gpt-4o for multi-step reasoning and code generation.",
      target: "Target: 40% of runs on lightweight models"
    });
  }

  return {
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    promptBreakdown,
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

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y || 0, r2: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  const yMean = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - yMean) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { slope, intercept, r2 };
}

function buildMLAnalytics(runs) {
  const sorted = [...runs]
    .filter(r => (r.tokensIn || 0) + (r.tokensOut || 0) > 0)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (sorted.length < 3) return null;

  const tokenCounts = sorted.map(r => (r.tokensIn || 0) + (r.tokensOut || 0));
  const costs = sorted.map(r => r.costUsd || 0);

  // Linear regression on cost and tokens over run index
  const costReg = linearRegression(costs.map((y, x) => ({ x, y })));
  const tokenReg = linearRegression(tokenCounts.map((y, x) => ({ x, y })));
  const trendDirection = costReg.slope > 0.0005 ? "rising" : costReg.slope < -0.0005 ? "falling" : "stable";

  // Z-score anomaly detection on token counts
  const n = tokenCounts.length;
  const tokenMean = tokenCounts.reduce((s, t) => s + t, 0) / n;
  const tokenStd = Math.sqrt(tokenCounts.reduce((s, t) => s + (t - tokenMean) ** 2, 0) / n) || 1;
  const anomalySet = new Set(
    tokenCounts.map((t, i) => ({ z: Math.abs((t - tokenMean) / tokenStd), i }))
      .filter(({ z }) => z > 2).map(({ i }) => i)
  );

  // Moving average (window 3)
  const movingAvg = tokenCounts.map((_, i) => {
    const w = tokenCounts.slice(Math.max(0, i - 2), i + 1);
    return w.reduce((s, t) => s + t, 0) / w.length;
  });

  // Burn timeline for charts
  const burnTimeline = sorted.map((r, i) => ({
    i,
    tokens: tokenCounts[i],
    cost: costs[i],
    movingAvg: Math.round(movingAvg[i]),
    costTrend: Number((costReg.slope * i + costReg.intercept).toFixed(6)),
    tokenTrend: Math.round(tokenReg.slope * i + tokenReg.intercept),
    isAnomaly: anomalySet.has(i),
    agentName: r.agentName,
    time: r.startTime
  }));

  // Agent efficiency clustering (percentile-based)
  const agentStats = Object.entries(groupBy(sorted, r => r.agentName)).map(([name, agentRuns]) => {
    const tIn = agentRuns.reduce((s, r) => s + (r.tokensIn || 0), 0);
    const tOut = agentRuns.reduce((s, r) => s + (r.tokensOut || 0), 0);
    const total = tIn + tOut;
    return {
      name,
      avgTokens: Math.round(total / agentRuns.length),
      avgCost: Number((agentRuns.reduce((s, r) => s + (r.costUsd || 0), 0) / agentRuns.length).toFixed(6)),
      inputPct: total ? Math.round((tIn / total) * 100) : 0,
      runs: agentRuns.length,
      provider: agentRuns[0]?.provider || ""
    };
  }).sort((a, b) => b.avgTokens - a.avgTokens);

  const tokenVals = [...agentStats.map(a => a.avgTokens)].sort((a, b) => a - b);
  const p33 = tokenVals[Math.floor(tokenVals.length * 0.33)] ?? 0;
  const p66 = tokenVals[Math.floor(tokenVals.length * 0.66)] ?? 0;
  const clusteredAgents = agentStats.map(a => ({
    ...a,
    cluster: a.avgTokens <= p33 ? "Efficient" : a.avgTokens <= p66 ? "Moderate" : "Wasteful"
  }));

  // 30-day forecast from regression slope
  const lastIdx = sorted.length - 1;
  const forecast30d = Number(Math.max(0, (costReg.slope * (lastIdx + 30) + costReg.intercept) * 30).toFixed(4));

  return {
    trendDirection,
    costSlopePerRun: Number(costReg.slope.toFixed(6)),
    costR2: Number(costReg.r2.toFixed(3)),
    anomalyCount: anomalySet.size,
    anomalyRuns: sorted.filter((_, i) => anomalySet.has(i)).slice(0, 5).map((r, idx) => ({
      agentName: r.agentName,
      tokens: tokenCounts[sorted.indexOf(r)],
      zScore: Number(Math.abs((tokenCounts[sorted.indexOf(r)] - tokenMean) / tokenStd).toFixed(2)),
      time: r.startTime
    })),
    clusteredAgents,
    burnTimeline,
    forecast30d,
    tokenMean: Math.round(tokenMean),
    tokenStd: Math.round(tokenStd),
    totalRuns: sorted.length
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
    ([provider, providerRuns]) => {
      const totalCost = providerRuns.reduce((sum, run) => sum + run.costUsd, 0);
      const totalTokensIn = providerRuns.reduce((sum, run) => sum + (run.tokensIn || 0), 0);
      const totalTokensOut = providerRuns.reduce((sum, run) => sum + (run.tokensOut || 0), 0);
      const totalTokens = totalTokensIn + totalTokensOut;
      const successRuns = providerRuns.filter((run) => run.status === "success");
      return {
        provider,
        runs: providerRuns.length,
        costUsd: Number(totalCost.toFixed(4)),
        avgScore: Math.round(average(providerRuns.map((run) => run.controlScore))),
        successRate: Math.round((successRuns.length / providerRuns.length) * 100),
        avgLatencyMs: Math.round(average(providerRuns.map((run) => run.latencyMs || 0))),
        avgTokensPerRun: providerRuns.length ? Math.round(totalTokens / providerRuns.length) : 0,
        costPerRun: providerRuns.length ? Number((totalCost / providerRuns.length).toFixed(4)) : 0,
        costPer1kTokens: totalTokens ? Number(((totalCost / totalTokens) * 1000).toFixed(4)) : 0,
        totalTokensIn,
        totalTokensOut,
        totalTokens,
        retries: providerRuns.reduce((sum, run) => sum + (run.retryCount || 0), 0)
      };
    }
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
        return crumbs.map((breadcrumb, index) => {
          const text = typeof breadcrumb === "string"
            ? breadcrumb
            : breadcrumb.message || breadcrumb.value || JSON.stringify(breadcrumb);
          return {
            time: new Date(new Date(run.startTime).getTime() + index * 15000).toISOString(),
            agentName: run.agentName,
            level:
              run.status === "failed"
                ? "error"
                : text.toLowerCase().includes("retry")
                  ? "warn"
                  : text.toLowerCase().includes("fetched") ||
                      text.toLowerCase().includes("parsed") ||
                      text.toLowerCase().includes("loaded")
                    ? "info"
                    : run.status === "success"
                      ? "success"
                      : "tool",
            message: text
          };
        });
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
    mlAnalytics: buildMLAnalytics(enrichedRuns),
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
