// States: CLOSED (normal) → OPEN (failing, reject fast) → HALF_OPEN (probing) → CLOSED
const CLOSED = "CLOSED";
const OPEN = "OPEN";
const HALF_OPEN = "HALF_OPEN";

// Optional alert webhook — POST JSON payload on OPEN/CLOSED transitions.
// Set CB_ALERT_WEBHOOK_URL to receive notifications.
const CB_ALERT_WEBHOOK_URL = process.env.CB_ALERT_WEBHOOK_URL || "";

async function sendCircuitAlert(payload) {
  if (!CB_ALERT_WEBHOOK_URL) return;
  try {
    await fetch(CB_ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    // Alert delivery is best-effort — never let it crash the circuit logic
  }
}

export class CircuitBreaker {
  constructor({
    name,
    failureThreshold = Number(process.env.CB_FAILURE_THRESHOLD || 5),
    successThreshold = Number(process.env.CB_SUCCESS_THRESHOLD || 2),
    resetTimeoutMs = Number(process.env.CB_RESET_TIMEOUT_MS || 30000)
  } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.successThreshold = successThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this._state = CLOSED;
    this._failures = 0;
    this._successes = 0;
    this._lastFailureAt = 0;
  }

  async execute(fn) {
    if (this._state === OPEN) {
      if (Date.now() - this._lastFailureAt >= this.resetTimeoutMs) {
        this._state = HALF_OPEN;
        this._successes = 0;
      } else {
        const err = new Error(
          `Provider "${this.name}" is temporarily unavailable (circuit open). ` +
          `Retry after ${Math.ceil((this._lastFailureAt + this.resetTimeoutMs - Date.now()) / 1000)}s.`
        );
        err.isCircuitOpen = true;
        throw err;
      }
    }

    try {
      const result = await fn();
      this._recordSuccess();
      return result;
    } catch (err) {
      if (!err.isCircuitOpen) {
        this._recordFailure();
      }
      throw err;
    }
  }

  _recordSuccess() {
    this._failures = 0;
    if (this._state === HALF_OPEN) {
      this._successes++;
      if (this._successes >= this.successThreshold) {
        this._state = CLOSED;
        const payload = {
          ts: new Date().toISOString(),
          level: "info",
          event: "circuit_closed",
          provider: this.name
        };
        process.stderr.write(JSON.stringify(payload) + "\n");
        sendCircuitAlert(payload);
      }
    }
  }

  _recordFailure() {
    this._failures++;
    this._lastFailureAt = Date.now();
    if (this._failures >= this.failureThreshold) {
      const wasOpen = this._state === OPEN;
      this._state = OPEN;
      if (!wasOpen) {
        const payload = {
          ts: new Date().toISOString(),
          level: "error",
          event: "circuit_open",
          provider: this.name,
          failures: this._failures,
          willResetAt: new Date(this._lastFailureAt + this.resetTimeoutMs).toISOString()
        };
        process.stderr.write(JSON.stringify(payload) + "\n");
        sendCircuitAlert(payload);
      }
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this._state,
      failures: this._failures,
      lastFailureAt: this._lastFailureAt ? new Date(this._lastFailureAt).toISOString() : null,
      resetTimeoutMs: this.resetTimeoutMs,
      willResetAt: this._state === OPEN
        ? new Date(this._lastFailureAt + this.resetTimeoutMs).toISOString()
        : null
    };
  }
}

// One breaker per upstream provider, shared across all requests
export const breakers = {
  anthropic: new CircuitBreaker({ name: "anthropic" }),
  openai:    new CircuitBreaker({ name: "openai" }),
  azure:     new CircuitBreaker({ name: "azure" })
};
