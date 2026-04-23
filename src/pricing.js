import { readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_PATHS = [
  ["platforms", "claude", "input_price_per_token"],
  ["platforms", "claude", "output_price_per_token"],
  ["platforms", "copilot", "hourly_seat_rate"],
  ["fte", "avg_human_hours_per_task"],
  ["fte", "loaded_hourly_rate_usd"],
  ["session_timeout_minutes"]
];

function getDeep(obj, path) {
  return path.reduce((current, key) => (current != null ? current[key] : undefined), obj);
}

function loadPricing() {
  const configPath = join(process.cwd(), "config", "pricing.json");
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`pricing.json not found at ${configPath}. Copy config/pricing.json and set your rates.`);
  }

  const config = JSON.parse(raw);

  for (const path of REQUIRED_PATHS) {
    const value = getDeep(config, path);
    if (value == null || (typeof value === "number" && isNaN(value))) {
      throw new Error(`pricing.json is missing required field: ${path.join(".")}`);
    }
  }

  return config;
}

export const pricing = loadPricing();

export function isPricingStale() {
  if (!pricing.last_verified) return true;
  const verified = new Date(pricing.last_verified);
  const now = new Date();
  const diffDays = (now - verified) / (1000 * 60 * 60 * 24);
  return diffDays > 90;
}
