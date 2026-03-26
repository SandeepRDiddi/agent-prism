export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  adminSecret: process.env.ACP_ADMIN_SECRET || "change-me-before-production",
  storageBackend: process.env.STORAGE_BACKEND || "file",
  databaseUrl: process.env.DATABASE_URL || ""
};
