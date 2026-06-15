const DEFAULT_ADMIN_SECRET = "change-me-before-production";
const DEFAULT_DASHBOARD_PASSWORD = "change-me";
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

  // NODE_ENV
  if (!env) {
    warn("NODE_ENV is not set. Defaulting to development mode. Set NODE_ENV=production for production deployments.");
  } else if (!VALID_NODE_ENVS.includes(env)) {
    warn(`NODE_ENV="${env}" is not a recognized value. Expected one of: ${VALID_NODE_ENVS.join(", ")}.`);
  }

  // ── Storage ───────────────────────────────────────────────────────────────────
  const storageBackend = process.env.STORAGE_BACKEND || "file";
  if (storageBackend === "postgres") {
    if (!process.env.DATABASE_URL) {
      fatal("STORAGE_BACKEND=postgres requires DATABASE_URL to be set.");
    }
  } else if (isProduction && storageBackend === "file") {
    warn("STORAGE_BACKEND=file in production. Data will be lost on restart. Set STORAGE_BACKEND=postgres.");
  }

  // ── Encryption key ────────────────────────────────────────────────────────────
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) {
    if (isProduction) {
      fatal(
        "ENCRYPTION_KEY is not set. Required in production to encrypt connector API keys at rest. " +
        "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    } else {
      warn("ENCRYPTION_KEY is not set. Connector API keys stored in plaintext. Set before production deployment.");
    }
  } else if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    warn("ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Regenerate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  }

  // ── Admin secret ──────────────────────────────────────────────────────────────
  const adminSecret = process.env.ACP_ADMIN_SECRET || DEFAULT_ADMIN_SECRET;
  if (adminSecret === DEFAULT_ADMIN_SECRET) {
    if (isProduction) {
      fatal(
        "ACP_ADMIN_SECRET is set to the default value. This is insecure in production. " +
        "Set ACP_ADMIN_SECRET to a strong random secret before starting."
      );
    } else {
      warn("ACP_ADMIN_SECRET is using the insecure default value. Set it before production deployment.");
    }
  } else if (adminSecret.length < 16) {
    warn("ACP_ADMIN_SECRET is too short (< 16 characters). Use a longer random secret.");
  }

  // ── Dashboard credentials ─────────────────────────────────────────────────────
  const dashUser = process.env.DASHBOARD_USERNAME;
  const dashPass = process.env.DASHBOARD_PASSWORD;

  if (isProduction) {
    if (!dashUser) {
      fatal("DASHBOARD_USERNAME is not set. Required in production to protect the dashboard.");
    }
    if (!dashPass) {
      fatal("DASHBOARD_PASSWORD is not set. Required in production to protect the dashboard.");
    }
    if (dashPass === DEFAULT_DASHBOARD_PASSWORD) {
      fatal(
        "DASHBOARD_PASSWORD is set to the default value \"change-me\". " +
        "Set DASHBOARD_PASSWORD to a strong password before starting."
      );
    }
  } else {
    if (dashPass === DEFAULT_DASHBOARD_PASSWORD) {
      warn("DASHBOARD_PASSWORD is using the insecure default value. Set it before production deployment.");
    }
  }

  // ── CORS ──────────────────────────────────────────────────────────────────────
  const corsOrigins = process.env.CORS_ALLOWED_ORIGINS || "";
  if (corsOrigins.trim() === "*") {
    fatal(
      "CORS_ALLOWED_ORIGINS=* is not permitted. This API uses credentials (API keys). " +
      "Set CORS_ALLOWED_ORIGINS to a comma-separated list of specific allowed origins."
    );
  }
  if (isProduction && !corsOrigins.trim()) {
    warn(
      "CORS_ALLOWED_ORIGINS is not set. All origins will be accepted. " +
      "Set CORS_ALLOWED_ORIGINS to restrict cross-origin access in production."
    );
  }

  // ── Webhook signing secrets ───────────────────────────────────────────────────
  if (isProduction) {
    if (!process.env.CLAUDE_WEBHOOK_SECRET) {
      warn("CLAUDE_WEBHOOK_SECRET is not set. Webhook signatures from Claude will not be verified.");
    }
    if (!process.env.COPILOT_WEBHOOK_SECRET) {
      warn("COPILOT_WEBHOOK_SECRET is not set. Webhook signatures from Copilot will not be verified.");
    }
  }
}
