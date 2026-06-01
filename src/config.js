export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  adminSecret: process.env.ACP_ADMIN_SECRET || "change-me-before-production",
  storageBackend: process.env.STORAGE_BACKEND || "file",
  databaseUrl: process.env.DATABASE_URL || "",
  aiAdvisor: {
    provider: process.env.AI_ADVISOR_PROVIDER || "ollama",
    model: process.env.AI_ADVISOR_MODEL || "llama3.1",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
    timeoutMs: Number(process.env.AI_ADVISOR_TIMEOUT_MS || 2500)
  }
};
