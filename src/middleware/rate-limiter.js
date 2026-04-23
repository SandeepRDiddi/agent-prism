const WINDOW_MS = 60 * 1000; // 60 second sliding window

/**
 * In-memory sliding-window rate limiter.
 * Not suitable for multi-process deployments without an external store.
 */
export class RateLimiter {
  /**
   * @param {number} maxRequests - Maximum requests per window
   * @param {number} [windowMs] - Window size in ms (default 60,000)
   */
  constructor(maxRequests, windowMs = WINDOW_MS) {
    this._max = maxRequests;
    this._windowMs = windowMs;
    /** @type {Map<string, { count: number, windowStart: number }>} */
    this._buckets = new Map();
  }

  /**
   * Check whether a key is within the rate limit.
   * @param {string} key - Tenant ID, IP address, etc.
   * @returns {{ allowed: boolean, retryAfter: number }} retryAfter in seconds
   */
  check(key) {
    const now = Date.now();
    let bucket = this._buckets.get(key);

    if (!bucket || now - bucket.windowStart >= this._windowMs) {
      bucket = { count: 0, windowStart: now };
      this._buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > this._max) {
      const retryAfter = Math.ceil((this._windowMs - (now - bucket.windowStart)) / 1000);
      return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
    }

    return { allowed: true, retryAfter: 0 };
  }

  /** Remove all expired buckets (optional GC, call periodically if needed) */
  gc() {
    const now = Date.now();
    for (const [key, bucket] of this._buckets) {
      if (now - bucket.windowStart >= this._windowMs) {
        this._buckets.delete(key);
      }
    }
  }
}

const rpmLimit = parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || "300", 10);

/** Per-tenant rate limiter for authenticated endpoints */
export const tenantLimiter = new RateLimiter(rpmLimit);

/** Per-IP limiter for the bootstrap endpoint: 5 attempts per 60 minutes */
export const bootstrapLimiter = new RateLimiter(5, 60 * 60 * 1000);
