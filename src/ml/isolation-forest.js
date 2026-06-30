/**
 * Isolation Forest for unsupervised anomaly detection on agent run telemetry.
 *
 * Reference: Liu, Fei Tony, Kai Ming Ting, and Zhi-Hua Zhou. "Isolation forest."
 *   2008 Eighth IEEE International Conference on Data Mining. IEEE, 2008.
 *
 * Anomaly score s(x,n) = 2^{ -E[h(x)] / c(n) }
 *   where E[h(x)] = mean path length across T trees
 *         c(n)    = expected path length in an unsuccessful BST search (normalizer)
 *
 * Score > 0.5 → likely anomaly; > 0.65 → strong anomaly.
 *
 * Feature space: [tokensIn, tokensOut, costUsd, latencyMs, retryCount]
 * All features normalized to [0,1] via per-feature min/max from training set.
 */

const N_TREES_DEFAULT = 100;
const MAX_SAMPLES_DEFAULT = 256; // subsample size per tree
const MIN_RUNS_TO_FIT = 30;
const REBUILD_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const FEATURE_NAMES = ["tokensIn", "tokensOut", "costUsd", "latencyMs", "retryCount"];
const NF = FEATURE_NAMES.length;

/** Expected path length normalizer — matches Liu et al. eq. (1) */
function c(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  const H = Math.log(n - 1) + 0.5772156649015328; // Euler–Mascheroni γ
  return 2 * H - (2 * (n - 1) / n);
}

function extractRaw(run) {
  return [
    run.tokensIn || 0,
    run.tokensOut || 0,
    run.costUsd || 0,
    run.latencyMs || 0,
    run.retryCount || 0
  ];
}

/** Build one isolation tree on a (sub)sample of normalized feature vectors. */
function buildTree(samples, depth, maxDepth) {
  const n = samples.length;
  if (n <= 1 || depth >= maxDepth) return { leaf: true, size: n };

  // Random feature selection
  const fi = (Math.random() * NF) | 0;

  let min = Infinity, max = -Infinity;
  for (const s of samples) {
    if (s[fi] < min) min = s[fi];
    if (s[fi] > max) max = s[fi];
  }
  if (min === max) return { leaf: true, size: n };

  const split = min + Math.random() * (max - min);
  const left  = [];
  const right = [];
  for (const s of samples) (s[fi] < split ? left : right).push(s);

  return {
    leaf: false,
    fi,
    split,
    left:  buildTree(left,  depth + 1, maxDepth),
    right: buildTree(right, depth + 1, maxDepth)
  };
}

/** Traverse one tree, returning path length for point x. */
function pathLength(node, x, depth) {
  if (node.leaf) return depth + c(node.size);
  return x[node.fi] < node.split
    ? pathLength(node.left,  x, depth + 1)
    : pathLength(node.right, x, depth + 1);
}

/** Fisher-Yates shuffle in-place, return first k elements. */
function sampleWithoutReplacement(arr, k) {
  const a = arr.slice();
  const n = a.length;
  const end = Math.min(k, n);
  for (let i = 0; i < end; i++) {
    const j = i + ((Math.random() * (n - i)) | 0);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, end);
}

export class IsolationForest {
  constructor({ nTrees = N_TREES_DEFAULT, maxSamples = MAX_SAMPLES_DEFAULT } = {}) {
    this.nTrees     = nTrees;
    this.maxSamples = maxSamples;
    this.trees      = [];
    this.stats      = null; // per-feature { min, range } for normalization
    this.nSamples   = 0;
    this.trainedAt  = null;
    this._rebuildTimer = null;
  }

  get ready() {
    return this.trees.length > 0 && this.nSamples >= MIN_RUNS_TO_FIT;
  }

  /**
   * Fit the forest on an array of run objects.
   * Returns { trained, reason } — call this whenever run set changes significantly.
   */
  fit(runs) {
    if (!runs || runs.length < MIN_RUNS_TO_FIT) {
      return { trained: false, reason: `need ${MIN_RUNS_TO_FIT}+ runs (have ${runs?.length ?? 0})` };
    }

    const rawFeatures = runs.map(extractRaw);

    // Per-feature min/max for [0,1] normalization
    this.stats = FEATURE_NAMES.map((_, i) => {
      let min = Infinity, max = -Infinity;
      for (const f of rawFeatures) {
        if (f[i] < min) min = f[i];
        if (f[i] > max) max = f[i];
      }
      return { min, range: max > min ? max - min : 1 };
    });

    const normalized = rawFeatures.map(f =>
      f.map((v, i) => (v - this.stats[i].min) / this.stats[i].range)
    );

    const maxDepth = Math.ceil(Math.log2(Math.min(this.maxSamples, normalized.length)));

    this.trees = Array.from({ length: this.nTrees }, () => {
      const sub = sampleWithoutReplacement(normalized, this.maxSamples);
      return buildTree(sub, 0, maxDepth);
    });

    this.nSamples  = normalized.length;
    this.trainedAt = new Date().toISOString();
    return { trained: true, nTrees: this.nTrees, nSamples: this.nSamples };
  }

  /**
   * Anomaly score for a single run. Returns null if forest not fitted.
   * Score ∈ [0,1]: closer to 1 = more anomalous.
   */
  score(run) {
    if (!this.ready) return null;
    const raw = extractRaw(run);
    const x = raw.map((v, i) => (v - this.stats[i].min) / this.stats[i].range);
    const avgPath = this.trees.reduce((sum, tree) => sum + pathLength(tree, x, 0), 0) / this.nTrees;
    return Math.pow(2, -avgPath / c(this.nSamples));
  }

  /**
   * Returns true when the run is anomalous enough to flag.
   * threshold=0.62 gives ≈5% false-positive rate empirically on synthetic telemetry.
   */
  isAnomaly(run, threshold = 0.62) {
    const s = this.score(run);
    return s !== null && s > threshold;
  }

  /**
   * Start periodic rebuild. getRunsFn() must return Promise<run[]>.
   * Clears any existing timer first.
   */
  scheduleRebuild(getRunsFn, intervalMs = REBUILD_INTERVAL_MS) {
    if (this._rebuildTimer) clearInterval(this._rebuildTimer);
    const rebuild = async () => {
      try {
        const runs = await getRunsFn();
        const result = this.fit(runs);
        process.stderr.write(`[isolation-forest] rebuild: ${JSON.stringify(result)}\n`);
      } catch (err) {
        process.stderr.write(`[isolation-forest] rebuild error: ${err.message}\n`);
      }
    };
    this._rebuildTimer = setInterval(rebuild, intervalMs);
    rebuild(); // immediate first build
  }

  toJSON() {
    return {
      nTrees:    this.nTrees,
      nSamples:  this.nSamples,
      trainedAt: this.trainedAt,
      ready:     this.ready,
      featureNames: FEATURE_NAMES
    };
  }
}
