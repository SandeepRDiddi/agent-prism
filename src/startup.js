const DEFAULT_ADMIN_SECRET = "change-me-before-production";
const VALID_NODE_ENVS = ["development", "production", "test"];

function fatal(message) {
  process.stderr.write(`[agent-prism] FATAL: ${message}\n`);
  process.exit(1);
}

function warn(message) {
  process.stderr.write(`[agent-prism] WARN: ${message}\n`);
}

export function validateConfig() {
  const env = process.env.NODE_ENV;
  const isProduction = env === "production";

  // NODE_ENV check
  if (!env) {
    warn("NODE_ENV is not set. Defaulting to development mode. Set NODE_ENV=production for production deployments.");
  } else if (!VALID_NODE_ENVS.includes(env)) {
    warn(`NODE_ENV="${env}" is not a recognized value. Expected one of: ${VALID_NODE_ENVS.join(", ")}.`);
  }

  // Admin secret check
  const adminSecret = process.env.ACP_ADMIN_SECRET || DEFAULT_ADMIN_SECRET;
  if (isProduction && adminSecret === DEFAULT_ADMIN_SECRET) {
    fatal(
      "ACP_ADMIN_SECRET is set to the default value. This is insecure in production. " +
      "Set ACP_ADMIN_SECRET to a strong random secret before starting."
    );
  } else if (!isProduction && adminSecret === DEFAULT_ADMIN_SECRET) {
    warn("ACP_ADMIN_SECRET is using the insecure default value. Set it before production deployment.");
  }

  // Dashboard credentials check
  if (isProduction) {
    if (!process.env.DASHBOARD_USERNAME) {
      fatal("DASHBOARD_USERNAME is not set. This is required in production to protect the dashboard.");
    }
    if (!process.env.DASHBOARD_PASSWORD) {
      fatal("DASHBOARD_PASSWORD is not set. This is required in production to protect the dashboard.");
    }
  }

  // CORS wildcard check
  const corsOrigins = process.env.CORS_ALLOWED_ORIGINS || "";
  if (corsOrigins.trim() === "*") {
    fatal(
      "CORS_ALLOWED_ORIGINS=* is not permitted. This API uses credentials (API keys). " +
      "Set CORS_ALLOWED_ORIGINS to a comma-separated list of specific allowed origins."
    );
  }
}
