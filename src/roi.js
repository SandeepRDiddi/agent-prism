import { pricing } from "./pricing.js";

/**
 * Compute ROI metrics for a set of sessions and their aggregated cost.
 *
 * @param {{ sessions: Array, agentCostUsd: number }} params
 * @returns {object} ROI payload
 */
export function computeRoi({ sessions, agentCostUsd }) {
  const { avg_human_hours_per_task, loaded_hourly_rate_usd } = pricing.fte;

  const completedCount = sessions.filter((s) => s.status === "completed").length;
  const fteSaved = completedCount * avg_human_hours_per_task;
  const fteCostEquivalent = fteSaved * loaded_hourly_rate_usd;
  const netSavings = fteCostEquivalent - agentCostUsd;
  const roiMultiplier = agentCostUsd > 0 ? fteCostEquivalent / agentCostUsd : null;

  return {
    completedSessions: completedCount,
    fteHoursSaved: Number(fteSaved.toFixed(2)),
    fteCostEquivalentUsd: Number(fteCostEquivalent.toFixed(2)),
    agentCostUsd: Number(agentCostUsd.toFixed(4)),
    netSavingsUsd: Number(netSavings.toFixed(2)),
    roiMultiplier: roiMultiplier !== null ? Number(roiMultiplier.toFixed(2)) : null,
    assumptions: {
      avg_human_hours_per_task,
      loaded_hourly_rate_usd
    }
  };
}
