import { pricing } from "../pricing.js";

/**
 * Compute cost for a Copilot usage event.
 * @param {{ seatHours: number }} usage
 * @returns {number} cost in USD
 */
export function computeCopilotCost({ seatHours = 0 }) {
  const rate = pricing.platforms.copilot?.hourly_seat_rate;
  if (!rate) return 0;
  const cost = seatHours * rate;
  return Number.isFinite(cost) ? cost : 0;
}
