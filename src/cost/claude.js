import { pricing } from "../pricing.js";

/**
 * Compute cost for a Claude usage event.
 * @param {{ inputTokens: number, outputTokens: number }} usage
 * @returns {number} cost in USD
 */
export function computeClaudeCost({ inputTokens = 0, outputTokens = 0 }) {
  const rates = pricing.platforms.claude;
  return (inputTokens * rates.input_price_per_token) + (outputTokens * rates.output_price_per_token);
}
