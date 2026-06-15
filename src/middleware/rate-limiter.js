const WINDOW_MS = 60 * 1000; // 60 second sliding window

/**
 * In-memory sliding-window rate limiter.
 * Not suitable for multi-process deployments without an external store.
 * In cluster mode each worker has its own instance; effective limit = configured × workers.
 * For true global limits, set up Redis and replace this with a Redis-backed limiter.
 */
export class RateLimiter {
  constructor(maxRequests, windowMs = WINDOW_MS) {
    this._max = maxRequests;
    this._windowMs = windowMs;
    this._buckets = new Map();
  }

  /**
   * @param {string} key
   * @param {number} [maxOverride] - per-call limit override (e.g. per-plan limits)
   * @returns {{ allowed: boolean, retryAfter: number }}
   */
  check(key, maxOverride) {
    const max = (maxOverride != null && Number.isFinite(maxOverride)) ? maxOverride : this._max;
    const now = Date.now();
    let bucket = this._buckets.get(key);

    if (!bucket || now - bucket.windowStart >= this._windowMs) {
      bucket = { count: 0, windowStart: now };
      this._buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.ceil((this._windowMs - (now - bucket.windowStart)) / 1000);
      return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
    }

    return { allowed: true, retryAfter: 0 };
  }

  gc() {
    const now = Date.now();
    for (const [key, bucket] of this._buckets) {
      if (now - bucket.windowStart >= this._windowMs) {
        this._buckets.delete(key);
      }
    }
  }

  get size() {
    return this._buckets.size;
  }
}

export class TokenLimiter {
  constructor(maxTokens, windowMs = WINDOW_MS) {
    this._max = maxTokens;
    this._windowMs = windowMs;
    this._buckets = new Map();
  }

  check(key) {
    const now = Date.now();
    let bucket = this._buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this._windowMs) {
      bucket = { tokens: 0, windowStart: now };
      this._buckets.set(key, bucket);
    }
    if (bucket.tokens >= this._max) {
      const retryAfter = Math.ceil((this._windowMs - (now - bucket.windowStart)) / 1000);
      return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  record(key, tokens) {
    const now = Date.now();
    let bucket = this._buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this._windowMs) {
      bucket = { tokens: 0, windowStart: now };
      this._buckets.set(key, bucket);
    }
    bucket.tokens += tokens;
  }

  gc() {
    const now = Date.now();
    for (const [key, bucket] of this._buckets) {
      if (now - bucket.windowStart >= this._windowMs) {
        this._buckets.delete(key);
      }
    }
  }

  get size() {
    return this._buckets.size;
  }
}

const rpmLimit    = parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || "300", 10);
const keyRpmLimit = parseInt(process.env.RATE_LIMIT_KEY_RPM || "60", 10);
const keyTpmLimit = parseInt(process.env.RATE_LIMIT_KEY_TPM || "100000", 10);

export const tenantLimiter    = new RateLimiter(rpmLimit);
export const keyRpmLimiter    = new RateLimiter(keyRpmLimit);
export const keyTpmLimiter    = new TokenLimiter(keyTpmLimit);
export const bootstrapLimiter = new RateLimiter(5, 60 * 60 * 1000);
