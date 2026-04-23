## Context

Agent Prism is a plain Node.js HTTP server (`node:http`) with no framework. All middleware must be written inline or as imported ES modules — there is no Express, Fastify, or similar. The codebase has no external runtime dependencies beyond `pg` (PostgreSQL client). All new security layers must be added without introducing heavy dependencies; `node:crypto` and `node:http` cover most needs natively.

Current security posture gaps identified:
1. **Path traversal**: `serveStatic` does `join(publicDir, url)` with no containment check — a request for `/../../../etc/passwd` resolves outside `publicDir`
2. **No input validation**: Every endpoint calls `parseBody()` and uses raw fields with no type/shape checks
3. **No body size limit**: `parseBody()` accumulates unbounded chunks — a 1GB payload will consume all memory
4. **No security headers**: Responses have no CSP, HSTS, X-Frame-Options, or similar
5. **No rate limiting**: A single tenant can send unlimited requests
6. **No CORS policy**: Any origin can call the API from a browser
7. **Insecure defaults not warned**: `ACP_ADMIN_SECRET=change-me-before-production` is the default and nothing catches it in production
8. **No structured logging**: Errors go to `console.error` with no context, requests are not logged
9. **No graceful shutdown**: SIGTERM kills the process mid-request

## Goals / Non-Goals

**Goals:**
- Eliminate all identified security vulnerabilities with no new runtime npm dependencies
- Make every layer configurable via environment variables with safe defaults
- Fail fast and visibly at startup when the configuration is unsafe for production
- Produce structured, machine-readable logs suitable for log aggregation (Datadog, Loki, CloudWatch)
- Allow existing API clients to continue working unchanged

**Non-Goals:**
- OAuth2 / OIDC authentication (out of scope for this phase; API key model is sufficient)
- Database-backed rate limiting (in-memory is sufficient for single-process deployments; note in docs for multi-process)
- WAF or DDoS protection (operator's infrastructure responsibility)
- End-to-end encryption of stored data (file-store is a local file; Turso/Postgres TLS is the operator's responsibility)
- Audit logging to an external system (structured logs to stdout covers this for now)

## Decisions

### 1. No new npm dependencies — use `node:crypto`, `node:http`, stdlib only

**Decision**: Every new capability (rate limiting, validation, security headers, logging) is implemented as a plain ES module with zero new npm packages.

**Rationale**: Adding npm dependencies expands the attack surface, introduces supply-chain risk, and complicates client security reviews. Node 24 stdlib has everything needed: `node:crypto` for HMAC/hashing, `node:http` for headers, `performance.now()` for latency timing. The codebase already has zero non-pg dependencies for the server core.

**Alternative considered**: `helmet` (security headers) + `express-rate-limit` — convenient but pulls in Express ecosystem; not justified given the small API surface.

### 2. Middleware as a pipeline wrapper in `server.js`, not a framework

**Decision**: Create a `applyMiddleware(req, res, next)` style pipeline that wraps the existing request handler. Each middleware module exports a single function `(req, res, next)` and is composed in `server.js`.

**Rationale**: Mirrors how frameworks work but keeps the implementation under full control. Avoids the need to rewrite the existing route logic. Middleware runs for every request in order: CORS → body-size check → rate limit → security headers → route → logging.

**Alternative considered**: Rewriting server in Fastify/Express — too invasive, changes the deployment model, and is unnecessary for the API surface size.

### 3. In-memory sliding-window rate limiter per tenant

**Decision**: A `Map<tenantId, { count, windowStart }>` sliding window, reset every 60 seconds. Configurable via `RATE_LIMIT_REQUESTS_PER_MINUTE` (default: 300 for ingest, 60 for metrics). Returns 429 with `Retry-After: 60` header.

**Rationale**: No external Redis/Valkey dependency. Sufficient for single-process deployments. Multi-process deployments (multiple Node processes behind a load balancer) will have per-process limits — document this as a known limitation; a Redis adapter can be added later without changing the interface.

**Alternative considered**: Token bucket — more complex to implement correctly without a library; sliding window is simpler and good enough.

### 4. JSON schema validation via a hand-written `validate()` helper

**Decision**: Create `src/validation.js` with a minimal `validate(schema, data)` function that checks required fields, types, and string lengths. Schema is a plain object `{ field: { type, required, maxLength, enum } }`. Returns an array of error objects or null.

**Rationale**: No Zod, Joi, or ajv. These libraries are large and pull in dependencies. The API surface has ~8 distinct request shapes — a 50-line validator covers all of them without a framework.

**Alternative considered**: `ajv` — fast and battle-tested but adds 300KB of dependencies and requires JSON Schema familiarity.

### 5. Security headers as a single `setSecurityHeaders(res)` function

**Decision**: A single function called on every response (including errors) that sets:
- `Content-Security-Policy: default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (only when `NODE_ENV=production`)

**Rationale**: HSTS is production-only because it can break local HTTP dev if sent on localhost.

### 6. Path traversal fix: `path.resolve` + `startsWith(publicDir)` check

**Decision**: In `serveStatic`, after computing `filePath`, resolve it to an absolute path and assert it starts with `publicDir`. If not, return 403.

**Rationale**: `path.join` does not normalize `..` segments on all inputs. `path.resolve` always returns an absolute normalized path, making the containment check reliable.

### 7. Structured logging: JSON lines to stdout

**Decision**: Every completed request emits one JSON line: `{ ts, level, method, path, status, latency_ms, tenant_id }`. Errors emit `{ ts, level, error, stack, method, path, tenant_id }`. No secrets (API keys, admin secrets) ever appear in logs.

**Rationale**: JSON lines are natively ingested by every log aggregation system. stdout is the correct output for containerized workloads (12-factor app). Sensitive values are redacted at the log-write callsite.

### 8. Startup validation: fail fast on unsafe config

**Decision**: A `src/startup.js` module runs before the server binds to the port. It checks:
- `ACP_ADMIN_SECRET` is not the default value when `NODE_ENV=production` → exit(1)
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` are set when `NODE_ENV=production` → exit(1)
- `NODE_ENV` is one of `development`, `production`, `test` → warn if unset

**Rationale**: Silent misconfiguration is a major production risk. Fail fast is always better than silently running with insecure defaults.

## Risks / Trade-offs

- **CSP breaks inline styles/scripts**: The dashboard and main app use inline `<style>` and `<script>` blocks → Mitigation: Audit all inline code and move to external files (`public/dashboard.js`, etc.) before enabling strict CSP; or use `nonce`-based CSP if inline blocks must stay
- **In-memory rate limiter lost on restart**: All counters reset on process restart → Mitigation: Document as known limitation; acceptable for v1 since restarts are rare and rate limits are per-minute
- **Rate limiter doesn't cover unauthenticated paths**: `/api/health`, `/api/bootstrap` are public → Mitigation: Apply a separate IP-based limit on the bootstrap endpoint (max 5 attempts per hour)
- **HSTS cannot be reverted easily**: Once sent to a browser, HSTS is sticky for `max-age` seconds → Mitigation: Only send on `NODE_ENV=production`; document that operators must ensure HTTPS before enabling
- **Body size limit breaks legitimate large payloads**: Default 1MB may be too small for batch ingest → Mitigation: Make configurable via `MAX_BODY_BYTES` env var; default is 1MB but operators can raise it

## Migration Plan

1. All changes are backward-compatible — existing API clients continue to work
2. Deploy steps:
   a. Update `.env` with new required variables (`NODE_ENV=production`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`)
   b. Set `ACP_ADMIN_SECRET` to a strong random value (not the default)
   c. Deploy new server build — startup validation will reject unsafe config before binding
   d. Verify: `curl -I /api/health` response headers include `X-Content-Type-Options: nosniff`
3. Rollback: revert `server.js` to prior commit — no schema or data changes involved

## Open Questions

- Should CSP be strict (no `unsafe-inline`) from day one, or start permissive and tighten? → Recommend: start with `unsafe-inline` allowed, track removing it as a follow-up once inline scripts are extracted to files
- Should the rate limiter use per-tenant limits or per-IP limits for unauthenticated paths? → Recommend per-IP for public endpoints (requires `req.socket.remoteAddress`), per-tenant for authenticated endpoints
