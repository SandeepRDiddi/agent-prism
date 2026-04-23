import { pricing } from "../pricing.js";
import { applySessionTimeout } from "../saas-store.js";

/**
 * Mark sessions that haven't received events within the timeout window as timed_out.
 * Called lazily on each metrics request.
 */
export async function runSessionTimeout() {
  const timeoutMs = pricing.session_timeout_minutes * 60 * 1000;
  return applySessionTimeout(timeoutMs);
}
