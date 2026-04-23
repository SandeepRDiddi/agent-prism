import { test } from "node:test";
import assert from "node:assert/strict";
import { pricing, isPricingStale } from "../src/pricing.js";

test("pricing config loads and has required fields", () => {
  assert.ok(pricing.platforms?.claude?.input_price_per_token > 0, "claude input price should be > 0");
  assert.ok(pricing.platforms?.claude?.output_price_per_token > 0, "claude output price should be > 0");
  assert.ok(pricing.platforms?.copilot?.hourly_seat_rate > 0, "copilot hourly rate should be > 0");
  assert.ok(pricing.fte?.avg_human_hours_per_task > 0, "avg_human_hours_per_task should be > 0");
  assert.ok(pricing.fte?.loaded_hourly_rate_usd > 0, "loaded_hourly_rate_usd should be > 0");
  assert.ok(pricing.session_timeout_minutes > 0, "session_timeout_minutes should be > 0");
});

test("isPricingStale returns false for a recent last_verified date", () => {
  // pricing.json has last_verified = today, so should not be stale
  const stale = isPricingStale();
  assert.equal(stale, false, "freshly set last_verified should not be stale");
});
