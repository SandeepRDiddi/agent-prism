## Why

Agent Prism is being sold to enterprise clients who will send real agent telemetry, cost data, and API keys through it. The current codebase was built as a proof-of-concept: it has no input validation, no rate limiting, a path traversal vulnerability in the static file server, no security headers, and a developer-focused UI element ("View Sales Story") that is inappropriate in a production product. These gaps must be closed before any client deployment.

## What Changes

- **Remove** the "View Sales Story" button from the main navigation bar — it is a demo artifact that has no place in a client-facing product
- **Add input validation** to every API endpoint that accepts a request body — reject malformed, oversized, or structurally invalid payloads before they reach business logic
- **Fix path traversal vulnerability** in the static file server — `join(publicDir, url)` with no containment check allows `../../etc/passwd`-style reads
- **Add HTTP security headers** to every response — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- **Add per-tenant rate limiting** — prevent a single tenant from flooding the ingest or metrics endpoints and degrading service for others
- **Add request body size limits** — prevent memory exhaustion via oversized payloads
- **Add structured request logging** — every request logged with method, path, status, latency, and tenant ID (no secrets, no PII in logs)
- **Add startup environment validation** — fail fast with a clear error if required env vars are missing or insecure defaults are detected in production
- **Add graceful shutdown** — drain in-flight requests before process exit on SIGTERM/SIGINT
- **Harden the admin bootstrap endpoint** — add a one-time-use lock so it cannot be called after initial bootstrap even if the secret leaks
- **Add CORS policy** — restrict which origins can call the API; default to same-origin only, configurable via env var

## Capabilities

### New Capabilities

- `ui-cleanup`: Remove "View Sales Story" nav link from main app UI; this is a one-line removal but tracked explicitly so it is not forgotten
- `input-validation`: Per-endpoint JSON schema validation for all POST/PATCH request bodies; returns structured 422 errors with field-level detail
- `security-headers`: Middleware that injects HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) on every response
- `path-traversal-protection`: Static file server containment check — resolves the real path and asserts it is inside `publicDir` before serving
- `rate-limiting`: In-memory per-tenant sliding-window rate limiter for ingest and metrics endpoints; configurable via env vars; returns 429 with Retry-After header
- `request-size-limits`: Maximum request body size enforced in `parseBody`; configurable, default 1MB; returns 413 on breach
- `structured-logging`: JSON-structured request log per response (method, path, status, latency_ms, tenant_id); error logs include stack traces; no secrets or PII logged
- `graceful-shutdown`: SIGTERM/SIGINT handler that stops accepting new connections, drains in-flight requests within a configurable timeout, then exits cleanly
- `startup-validation`: Validates required env vars at boot; warns on insecure defaults (`ACP_ADMIN_SECRET=change-me-before-production`) when `NODE_ENV=production`; exits if critical vars are missing
- `cors-policy`: CORS middleware that reads allowed origins from `CORS_ALLOWED_ORIGINS` env var; defaults to same-origin; sends correct preflight responses

### Modified Capabilities

<!-- No existing specs to modify — all changes are new defensive layers or removals -->

## Impact

- **`server.js`**: All new middleware (security headers, CORS, rate limiting, body size, logging, graceful shutdown) wires into the existing request handler; no route logic changes
- **`src/validation.js`** (new): Per-endpoint schema definitions and a `validate()` helper
- **`src/middleware/`** (new directory): Modular middleware for logging, rate limiting, security headers, CORS
- **`public/index.html`**: Remove one anchor tag ("View Sales Story")
- **`.env.example`**: Add `CORS_ALLOWED_ORIGINS`, `MAX_BODY_BYTES`, `RATE_LIMIT_REQUESTS_PER_MINUTE`, `NODE_ENV`
- **`docker-compose.yml`**: Add `NODE_ENV=production` to service env; map secrets as env_file
- **No breaking API changes** — all changes are additive security layers; existing clients continue to work
