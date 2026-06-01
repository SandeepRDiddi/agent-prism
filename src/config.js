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
  aiAdvisor: {
    provider: envValue("AI_ADVISOR_PROVIDER", "ollama"),
    model: envValue("AI_ADVISOR_MODEL", "llama3.1"),
    ollamaBaseUrl: envValue("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    openRouterBaseUrl: envValue("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    openRouterApiKey: envValue("OPENROUTER_API_KEY"),
    timeoutMs: Number(envValue("AI_ADVISOR_TIMEOUT_MS", "30000"))
  }
};
