import { pricing } from "../pricing.js";

/**
 * Compute cost for a Copilot usage event.
 * @param {{ seatHours: number }} usage
 * @returns {number} cost in USD
 */
export function computeCopilotCost({ seatHours = 0 }) {
  return seatHours * pricing.platforms.copilot.hourly_seat_rate;
}
