import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardSnapshot, detectCostLeaks } from "./src/store.js";
import { config } from "./src/config.js";
import {
  normalizeClaudeRun,
  normalizeCopilotRun,
  normalizeGenericRun
} from "./src/connectors.js";
import {
  authenticateTenantApiKey,
  bootstrapSaas,
  createConnector,
  getBootstrapStatus,
  listTenantContext,
  resetTenantRuns,
  upsertTenantRuns
} from "./src/saas-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");
const { port, host, adminSecret, storageBackend } = config;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": contentTypes[".json"] });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function normalizePayload(body) {
  const source = body.source || "generic";

  if (source === "copilot") {
    return normalizeCopilotRun(body.payload);
  }

  if (source === "claude") {
    return normalizeClaudeRun(body.payload);
  }

  return normalizeGenericRun(body.payload || body);
}

function getApiKey(req) {
  return req.headers["x-api-key"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
}

async function requireTenant(req, res) {
  const apiKey = getApiKey(req);
  const auth = await authenticateTenantApiKey(apiKey);

  if (!auth?.tenant) {
    sendJson(res, 401, {
      error: "unauthorized",
      message: "Missing or invalid tenant API key."
    });
    return null;
  }

  return auth;
}

function requireAdmin(req, res) {
  const provided = req.headers["x-admin-secret"];

  if (provided !== adminSecret) {
    sendJson(res, 401, {
      error: "unauthorized",
      message: "Missing or invalid admin secret."
    });
    return false;
  }

  return true;
}

async function serveStatic(req, res) {
  const url = req.url === "/" ? "/index.html" : req.url;
  const filePath = join(publicDir, url);
  const extension = extname(filePath);

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream"
    });
    res.end(file);
  } catch (error) {
    sendText(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      const bootstrap = await getBootstrapStatus();
      return sendJson(res, 200, {
        ok: true,
        service: "agent-prism",
        mode: "saas-foundation",
        storageBackend,
        bootstrapped: bootstrap.bootstrapped
      });
    }

    if (req.method === "GET" && req.url === "/api/bootstrap/status") {
      return sendJson(res, 200, await getBootstrapStatus());
    }

    if (req.method === "POST" && req.url === "/api/bootstrap") {
      if (!requireAdmin(req, res)) {
        return;
      }

      const body = await parseBody(req);
      const result = await bootstrapSaas(body);
      return sendJson(res, 201, result);
    }

    if (req.method === "GET" && req.url === "/api/dashboard") {
      const auth = await requireTenant(req, res);
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      const snapshot = buildDashboardSnapshot(context.runs);
      return sendJson(res, 200, snapshot);
    }

    if (req.method === "GET" && req.url === "/api/runs") {
      const auth = await requireTenant(req, res);
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      return sendJson(res, 200, { runs: context.runs });
    }

    if (req.method === "GET" && req.url === "/api/leaks") {
      const auth = await requireTenant(req, res);
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      return sendJson(res, 200, { leaks: detectCostLeaks(context.runs) });
    }

    if (req.method === "GET" && req.url === "/api/tenant") {
      const auth = await requireTenant(req, res);
      if (!auth) {
        return;
      }
      const context = await listTenantContext(auth.tenant.id);
      return sendJson(res, 200, {
        tenant: context.tenant,
        users: context.users,
        connectors: context.connectors,
        runCount: context.runs.length
      });
    }

    if (req.method === "POST" && req.url === "/api/connectors") {
      const auth = await requireTenant(req, res);
      if (!auth) {
        return;
      }
      const body = await parseBody(req);
      const connector = await createConnector(auth.tenant.id, body);
      return sendJson(res, 201, { connector });
    }

    if (req.method === "POST" && req.url === "/api/ingest") {
      const auth = await requireTenant(req, res);
      if (!auth) {
        return;
      }
      const body = await parseBody(req);
      const normalizedRun = normalizePayload(body);
      const updated = await upsertTenantRuns(auth.tenant.id, [normalizedRun]);
      return sendJson(res, 201, {
        status: "ingested",
        tenant: auth.tenant.slug,
        totalRuns: updated.length,
        normalizedRun
      });
    }

    if (req.method === "POST" && req.url === "/api/reset") {
      const auth = await requireTenant(req, res);
      if (!auth) {
        return;
      }
      await resetTenantRuns(auth.tenant.id);
      return sendJson(res, 200, { status: "reset", tenant: auth.tenant.slug });
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, {
      error: "server_error",
      message: error.message
    });
  }
});

server.listen(port, host, () => {
  console.log(`Agent Prism listening on http://${host}:${port}`);
});
