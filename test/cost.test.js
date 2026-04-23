import { test } from "node:test";
import assert from "node:assert/strict";
import { computeClaudeCost } from "../src/cost/claude.js";
import { computeCopilotCost } from "../src/cost/copilot.js";
import { computeGenericCost } from "../src/cost/generic.js";
import { pricing } from "../src/pricing.js";

test("claude cost: input + output tokens", () => {
  const cost = computeClaudeCost({ inputTokens: 1000, outputTokens: 500 });
  const expected =
    1000 * pricing.platforms.claude.input_price_per_token +
    500  * pricing.platforms.claude.output_price_per_token;
  assert.equal(cost, expected);
});

test("claude cost: zero tokens returns zero", () => {
  assert.equal(computeClaudeCost({ inputTokens: 0, outputTokens: 0 }), 0);
});

test("copilot cost: seat hours * hourly rate", () => {
  const cost = computeCopilotCost({ seatHours: 2 });
  const expected = 2 * pricing.platforms.copilot.hourly_seat_rate;
  assert.equal(cost, expected);
});

test("copilot cost: zero hours returns zero", () => {
  assert.equal(computeCopilotCost({ seatHours: 0 }), 0);
});

test("generic cost: passes through cost_usd", () => {
  assert.equal(computeGenericCost({ costUsd: 1.5 }), 1.5);
});

test("generic cost: returns 0 for missing cost_usd", () => {
  assert.equal(computeGenericCost({}), 0);
});
