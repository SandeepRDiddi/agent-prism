import { extractFeatures } from "./ml/logistic-regression.js";

const FIXED_WEIGHTS = {
  successRate: 0.25,
  budgetEfficiency: 0.20,
  latency: 0.15,
  autonomy: 0.15,
  guardrails: 0.15,
  retryPenalty: 0.10
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function isSuccess(status) {
  return status === "success" || status === "completed";
}

/** Fixed-weight linear combination — the baseline scorer, always available. */
export function computeControlScoreFixed(run) {
  const successScore      = isSuccess(run.status) ? 100 : 35;
  const budgetEfficiency  = clamp(100 - ((run.costUsd / Math.max(run.budgetUsd, 0.01)) * 100 - 100), 0, 100);
  const latencyScore      = clamp(100 - run.latencyMs / 120, 0, 100);
  const autonomyScore     = clamp(run.autonomyLevel * 20, 0, 100);
  const guardrailScore    = clamp(100 - run.policyViolations * 30, 0, 100);
  const retryPenaltyScore = clamp(100 - run.retryCount * 18, 0, 100);

  return Math.round(
    successScore      * FIXED_WEIGHTS.successRate      +
    budgetEfficiency  * FIXED_WEIGHTS.budgetEfficiency +
    latencyScore      * FIXED_WEIGHTS.latency          +
    autonomyScore     * FIXED_WEIGHTS.autonomy         +
    guardrailScore    * FIXED_WEIGHTS.guardrails       +
    retryPenaltyScore * FIXED_WEIGHTS.retryPenalty
  );
}

/**
 * ML-enhanced control score.
 *   - When lrModel is ready (≥20 labeled samples): logistic regression score
 *   - Otherwise: falls back to computeControlScoreFixed
 *
 * lrModel must have: ready (bool), predict(features) → [0,1]
 */
export function computeControlScore(run, lrModel = null) {
  if (lrModel?.ready) {
    const features = extractFeatures(run);
    const p = lrModel.predict(features);
    return Math.round(clamp(p * 100, 0, 100));
  }
  return computeControlScoreFixed(run);
}

/**
 * Explainability helper: returns per-feature contributions as a string.
 * Used by /api/ml/status and the admin panel.
 */
export function explainScore(run, lrModel = null) {
  const features = extractFeatures(run);
  const featureNames = ["success", "budgetEfficiency", "latencyScore", "autonomyScore", "guardrailScore", "retryScore"];

  if (lrModel?.ready) {
    const contributions = featureNames.map((name, i) => ({
      name,
      weight: Number(lrModel.w[i].toFixed(4)),
      value: Number(features[i].toFixed(3)),
      contribution: Number((lrModel.w[i] * features[i]).toFixed(4))
    }));
    return { mode: "logistic_regression", bias: lrModel.b, features: contributions };
  }

  const fixedValues = Object.values(FIXED_WEIGHTS);
  return {
    mode: "fixed_weights",
    features: featureNames.map((name, i) => ({
      name,
      weight: fixedValues[i],
      value: Number(features[i].toFixed(3)),
      contribution: Number((fixedValues[i] * features[i] * 100).toFixed(2))
    }))
  };
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
      accumulator.success += isSuccess(run.status) ? 1 : 0;
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
