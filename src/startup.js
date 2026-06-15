import { cpus } from "node:os";

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

  // ── JWT secret ────────────────────────────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET;
  if (isProduction) {
    if (!jwtSecret) {
      fatal(
        "JWT_SECRET is not set. Required in production for OAuth token signing. " +
        "Generate: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
      );
    } else if (jwtSecret === adminSecret) {
      fatal(
        "JWT_SECRET must differ from ACP_ADMIN_SECRET. " +
        "Using the same secret for both creates a privilege escalation risk."
      );
    } else if (jwtSecret.length < 32) {
      warn("JWT_SECRET is shorter than 32 characters. Use a longer random secret.");
    }
  } else if (jwtSecret && jwtSecret === adminSecret) {
    warn("JWT_SECRET and ACP_ADMIN_SECRET are the same. Set them to different values before production.");
  }

  // ── Connection pool size in cluster mode ──────────────────────────────────────
  if (storageBackend === "postgres") {
    const poolMax = parseInt(process.env.DB_POOL_MAX || "10", 10);
    const workerCount = parseInt(process.env.CLUSTER_WORKERS || String(cpus().length), 10);
    const totalConnections = poolMax * workerCount;
    if (totalConnections > 80) {
      warn(
        `DB_POOL_MAX=${poolMax} × CLUSTER_WORKERS=${workerCount} = ${totalConnections} total Postgres connections. ` +
        "Most managed Postgres instances cap at 100. Reduce DB_POOL_MAX or set PgBouncer in front."
      );
    }
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
