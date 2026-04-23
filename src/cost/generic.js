/**
 * Pass-through cost for generic platforms.
 * @param {{ costUsd: number }} usage
 * @returns {number} cost in USD
 */
export function computeGenericCost({ costUsd = 0 }) {
  return Number(costUsd) || 0;
}
