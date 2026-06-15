import { pricing } from "../pricing.js";

/**
 * Compute cost for a Claude usage event.
 * @param {{ inputTokens: number, outputTokens: number }} usage
 * @returns {number} cost in USD
 */
export function computeClaudeCost({ inputTokens = 0, outputTokens = 0 }) {
  const rates = pricing.platforms.claude;
  if (!rates?.input_price_per_token || !rates?.output_price_per_token) return 0;
  const cost = (inputTokens * rates.input_price_per_token) + (outputTokens * rates.output_price_per_token);
  return Number.isFinite(cost) ? cost : 0;
}
