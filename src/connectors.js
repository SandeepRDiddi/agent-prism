function isoNow() {
  return new Date().toISOString();
}

function baseRun(payload) {
  return {
    id: payload.id || `run_${Math.random().toString(36).slice(2, 10)}`,
    source: payload.source || "generic",
    agentName: payload.agentName || "Unknown Agent",
    provider: payload.provider || "Unknown Provider",
    model: payload.model || "unknown",
    taskType: payload.taskType || "general",
    status: payload.status || "success",
    startTime: payload.startTime || isoNow(),
    endTime: payload.endTime || isoNow(),
    latencyMs: payload.latencyMs || 0,
    tokensIn: payload.tokensIn || 0,
    tokensOut: payload.tokensOut || 0,
    costUsd: payload.costUsd || 0,
    budgetUsd: payload.budgetUsd || 1,
    autonomyLevel: payload.autonomyLevel || 3,
    retryCount: payload.retryCount || 0,
    toolCalls: payload.toolCalls || 0,
    policyViolations: payload.policyViolations || 0,
    userSatisfaction: payload.userSatisfaction || 4,
    environment: payload.environment || "production",
    workflow: payload.workflow || "default",
    team: payload.team || "platform",
    tags: payload.tags || [],
    breadcrumbs: payload.breadcrumbs || [],
    notes: payload.notes || ""
  };
}

export function normalizeGenericRun(payload) {
  return baseRun({
    ...payload,
    source: payload.source || "generic"
  });
}

export function normalizeCopilotRun(payload) {
  return baseRun({
    id: payload.session_id,
    source: "copilot",
    agentName: payload.agent_name || "GitHub Copilot Agent",
    provider: "GitHub",
    model: payload.model_name,
    taskType: payload.intent,
    status: payload.outcome,
    startTime: payload.started_at,
    endTime: payload.completed_at,
    latencyMs: payload.duration_ms,
    tokensIn: payload.prompt_tokens,
    tokensOut: payload.completion_tokens,
    costUsd: payload.estimated_cost_usd,
    budgetUsd: payload.budget_usd,
    autonomyLevel: payload.autonomy_level,
    retryCount: payload.retry_count,
    toolCalls: payload.tool_invocations,
    policyViolations: payload.policy_alerts,
    userSatisfaction: payload.user_score,
    environment: payload.environment,
    workflow: payload.workflow,
    team: payload.team,
    tags: payload.labels,
    breadcrumbs: payload.trace || [],
    notes: payload.summary
  });
}

export function normalizeClaudeRun(payload) {
  return baseRun({
    id: payload.runId,
    source: "claude",
    agentName: payload.agent || "Claude Agent",
    provider: "Anthropic",
    model: payload.model,
    taskType: payload.jobType,
    status: payload.status,
    startTime: payload.startedAt,
    endTime: payload.finishedAt,
    latencyMs: payload.elapsedMs,
    tokensIn: payload.inputTokens,
    tokensOut: payload.outputTokens,
    costUsd: payload.costUsd,
    budgetUsd: payload.budgetUsd,
    autonomyLevel: payload.autonomyLevel,
    retryCount: payload.retries,
    toolCalls: payload.toolCalls,
    policyViolations: payload.guardrailHits,
    userSatisfaction: payload.feedbackScore,
    environment: payload.environment,
    workflow: payload.flow,
    team: payload.team,
    tags: payload.tags,
    breadcrumbs: payload.breadcrumbs,
    notes: payload.notes
  });
}
