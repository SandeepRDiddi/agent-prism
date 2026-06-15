import { cpus } from "node:os";

function envValue(key, fallback = "") {
  const raw = process.env[key] || fallback;
  const prefix = `${key}=`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : raw;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  adminSecret: envValue("ACP_ADMIN_SECRET", "change-me-before-production"),
  storageBackend: envValue("STORAGE_BACKEND", "file"),
  databaseUrl: envValue("DATABASE_URL"),
  db: {
    // Maximum connections per worker. Auto-calculated: floor(80 / workers) capped at 20.
    // Keeps total connections under 80 for typical managed Postgres (100-connection default).
    // Override with DB_POOL_MAX env var.
    get max() {
      if (process.env.DB_POOL_MAX) return Number(envValue("DB_POOL_MAX", "10"));
      const workers = Number(process.env.CLUSTER_WORKERS || cpus().length);
      return Math.max(2, Math.min(20, Math.floor(80 / workers)));
    },
    // Minimum connections kept alive (warm) to avoid cold-start latency on burst traffic.
    min: Number(envValue("DB_POOL_MIN", "2")),
    // Release idle connections after this many ms. Frees DB-side resources during quiet periods.
    idleTimeoutMillis: Number(envValue("DB_IDLE_TIMEOUT_MS", "30000")),
    // Fail fast when all connections are busy. 0 = wait forever (dangerous under load).
    connectionTimeoutMillis: Number(envValue("DB_CONNECTION_TIMEOUT_MS", "5000")),
    // Kill any query running longer than this. Prevents runaway scans holding connections.
    statementTimeoutMs: Number(envValue("DB_STATEMENT_TIMEOUT_MS", "30000")),
    // SSL required for all managed Postgres (Render, RDS, Supabase, Azure, Neon).
    // Set DB_SSL=false only for local dev with a non-SSL instance.
    ssl: envValue("DB_SSL", "true") !== "false"
  },
  aiAdvisor: {
    provider: envValue("AI_ADVISOR_PROVIDER", "ollama"),
    model: envValue("AI_ADVISOR_MODEL", "llama3.1"),
    ollamaBaseUrl: envValue("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    openRouterBaseUrl: envValue("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    openRouterApiKey: envValue("OPENROUTER_API_KEY"),
    anthropicApiKey: envValue("ANTHROPIC_API_KEY"),
    anthropicModel: envValue("AI_ADVISOR_ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
    timeoutMs: Number(envValue("AI_ADVISOR_TIMEOUT_MS", "30000"))
  }
};
