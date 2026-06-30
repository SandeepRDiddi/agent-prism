/**
 * Binary logistic regression via mini-batch SGD with L2 regularization.
 *
 * Target: P(run is valuable | run features) ∈ [0,1]
 * Labels: user_outcome = 1 (valuable) / 0 (not valuable)
 *
 * Feature vector (6 dims, all ∈ [0,1]):
 *   [success, budgetEfficiency, latencyScore, autonomyScore, guardrailScore, retryScore]
 *
 * When sampleCount < MIN_SAMPLES the model is "not ready" and callers
 * should fall back to the fixed-weight formula in scoring.js.
 */

export const FEATURE_NAMES = [
  "success",
  "budgetEfficiency",
  "latencyScore",
  "autonomyScore",
  "guardrailScore",
  "retryScore"
];
const N = FEATURE_NAMES.length;

export const MIN_SAMPLES = 20;
const DEFAULT_LR = 0.05;
const DEFAULT_L2 = 0.01;
const DEFAULT_EPOCHS = 200;

function sigmoid(z) {
  // Clamp to avoid overflow in exp
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/**
 * Extract normalized feature vector [0,1]^6 from a run object.
 * Mirrors the six dimensions of computeControlScore but on [0,1] scale.
 */
export function extractFeatures(run) {
  const success = run.status === "success" || run.status === "completed" ? 1.0 : 0.0;

  const budgetRatio = run.budgetUsd > 0
    ? Math.min(run.costUsd / run.budgetUsd, 3)
    : (run.costUsd > 0 ? 1.5 : 0);
  const budgetEff = Math.max(0, 1 - budgetRatio);

  const latency = 1 - Math.min((run.latencyMs || 0) / 120000, 1);
  const autonomy = Math.min((run.autonomyLevel || 0) / 5, 1);
  const guardrail = Math.max(0, 1 - Math.min((run.policyViolations || 0) / 5, 1));
  const retry = Math.max(0, 1 - Math.min((run.retryCount || 0) / 10, 1));

  return [success, budgetEff, latency, autonomy, guardrail, retry];
}

export class LogisticRegression {
  constructor({ learningRate = DEFAULT_LR, l2 = DEFAULT_L2 } = {}) {
    this.w = new Float64Array(N); // weights
    this.b = 0;                   // bias
    this.learningRate = learningRate;
    this.l2 = l2;
    this.sampleCount = 0;
    this.trainedAt = null;
    this.finalLoss = null;
  }

  get ready() {
    return this.sampleCount >= MIN_SAMPLES;
  }

  /** P(valuable | features) ∈ [0,1] */
  predict(features) {
    let z = this.b;
    for (let i = 0; i < N; i++) z += this.w[i] * features[i];
    return sigmoid(z);
  }

  /** Score ∈ [0,100] for direct substitution into control score */
  score(run) {
    return Math.round(this.predict(extractFeatures(run)) * 100);
  }

  /**
   * Full batch gradient descent.
   * samples: Array<{ features: number[], label: 0|1 }>
   * Returns { loss, epochs, converged }
   */
  train(samples, epochs = DEFAULT_EPOCHS) {
    if (samples.length < MIN_SAMPLES) {
      return { loss: null, epochs: 0, converged: false };
    }

    const n = samples.length;
    let prevLoss = Infinity;
    let converged = false;

    for (let epoch = 0; epoch < epochs; epoch++) {
      const dw = new Float64Array(N);
      let db = 0;
      let loss = 0;

      for (const { features, label } of samples) {
        const p = this.predict(features);
        const err = p - label;
        loss += -(label * Math.log(p + 1e-15) + (1 - label) * Math.log(1 - p + 1e-15));
        for (let i = 0; i < N; i++) dw[i] += err * features[i];
        db += err;
      }

      // Update with averaged gradient + L2 penalty
      for (let i = 0; i < N; i++) {
        this.w[i] -= this.learningRate * (dw[i] / n + this.l2 * this.w[i]);
      }
      this.b -= this.learningRate * (db / n);

      const avgLoss = loss / n;
      if (Math.abs(prevLoss - avgLoss) < 1e-6) { converged = true; break; }
      prevLoss = avgLoss;
    }

    this.sampleCount = n;
    this.trainedAt = new Date().toISOString();
    this.finalLoss = prevLoss;
    return { loss: prevLoss, epochs, converged };
  }

  /**
   * Incremental online update for a single labeled sample (faster feedback loop).
   * Call after each user feedback — avoids full retrain for small deltas.
   */
  updateOnline(features, label) {
    const p = this.predict(features);
    const err = p - label;
    for (let i = 0; i < N; i++) {
      this.w[i] -= this.learningRate * (err * features[i] + this.l2 * this.w[i]);
    }
    this.b -= this.learningRate * err;
    this.sampleCount = Math.max(this.sampleCount, 1);
  }

  toJSON() {
    return {
      weights: Array.from(this.w),
      bias: this.b,
      sampleCount: this.sampleCount,
      trainedAt: this.trainedAt,
      finalLoss: this.finalLoss,
      featureNames: FEATURE_NAMES
    };
  }

  static fromJSON(data = {}) {
    const m = new LogisticRegression();
    if (Array.isArray(data.weights) && data.weights.length === N) {
      m.w = new Float64Array(data.weights);
    }
    m.b = Number(data.bias) || 0;
    m.sampleCount = Number(data.sampleCount) || 0;
    m.trainedAt = data.trainedAt || null;
    m.finalLoss = data.finalLoss ?? null;
    return m;
  }
}
