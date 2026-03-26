const weights = {
  successRate: 0.25,
  budgetEfficiency: 0.2,
  latency: 0.15,
  autonomy: 0.15,
  guardrails: 0.15,
  retryPenalty: 0.1
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function computeControlScore(run) {
  const successScore = run.status === "success" ? 100 : 35;
  const budgetEfficiency = clamp(
    100 - ((run.costUsd / Math.max(run.budgetUsd, 0.01)) * 100 - 100),
    0,
    100
  );
  const latencyScore = clamp(100 - run.latencyMs / 120, 0, 100);
  const autonomyScore = clamp(run.autonomyLevel * 20, 0, 100);
  const guardrailScore = clamp(100 - run.policyViolations * 30, 0, 100);
  const retryPenaltyScore = clamp(100 - run.retryCount * 18, 0, 100);

  const weighted =
    successScore * weights.successRate +
    budgetEfficiency * weights.budgetEfficiency +
    latencyScore * weights.latency +
    autonomyScore * weights.autonomy +
    guardrailScore * weights.guardrails +
    retryPenaltyScore * weights.retryPenalty;

  return Math.round(weighted);
}

export function classifyHealth(score) {
  if (score >= 85) {
    return "Strong";
  }

  if (score >= 70) {
    return "Stable";
  }

  if (score >= 55) {
    return "Watch";
  }

  return "Critical";
}

export function summarizeStatus(runs) {
  return runs.reduce(
    (accumulator, run) => {
      accumulator.total += 1;
      accumulator.success += run.status === "success" ? 1 : 0;
      accumulator.failed += run.status === "failed" ? 1 : 0;
      accumulator.running += run.status === "running" ? 1 : 0;
      return accumulator;
    },
    {
      total: 0,
      success: 0,
      failed: 0,
      running: 0
    }
  );
}

export function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
