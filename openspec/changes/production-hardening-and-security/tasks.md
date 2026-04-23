## 1. UI Cleanup

- [x] 1.1 Remove the "View Sales Story" anchor tag from `public/index.html` topbar — the link to `/storyline.html` must not appear in any client-facing nav
- [x] 1.2 Verify `public/dashboard.html` also does not contain any reference to `/storyline.html` (confirm it was never added)
- [x] 1.3 Verify the storyline page itself (`public/storyline.html`) is still served when accessed directly (it is not deleted, just unlinked)

## 2. Startup Validation

- [x] 2.1 Create `src/startup.js` — exports a `validateConfig()` function that runs all checks and throws/exits on failures
- [x] 2.2 Implement check: if `NODE_ENV=production` and `ACP_ADMIN_SECRET` equals `change-me-before-production`, exit with code 1 and descriptive stderr message
- [x] 2.3 Implement check: if `NODE_ENV=production` and `DASHBOARD_USERNAME` or `DASHBOARD_PASSWORD` is empty/unset, exit with code 1
- [x] 2.4 Implement check: warn to stderr if `NODE_ENV` is not one of `development`, `production`, `test` or is unset
- [x] 2.5 Call `validateConfig()` in `server.js` before `server.listen()` — validation must complete before the port is bound
- [x] 2.6 Add `NODE_ENV=production` to `.env.example` and to `docker-compose.yml` service environment

## 3. Request Body Size Limits

- [x] 3.1 Modify `parseBody()` in `server.js` to accept a `maxBytes` parameter (default from `MAX_BODY_BYTES` env var, default `1048576`)
- [x] 3.2 Track running byte count as chunks arrive; when count exceeds `maxBytes`, destroy the socket and respond with HTTP 413 immediately
- [x] 3.3 Add `MAX_BODY_BYTES` to `.env.example` with default value and comment
- [x] 3.4 Write a test: POST request with body > `MAX_BODY_BYTES` returns 413

## 4. Path Traversal Protection

- [x] 4.1 Import `path.resolve` in `server.js` (already imported as `path` — use `resolve`)
- [x] 4.2 In `serveStatic`, after computing `filePath`, call `path.resolve(filePath)` and assert the result starts with `path.resolve(publicDir)` — if not, return 403
- [x] 4.3 Strip query strings from `req.url` before computing `filePath` (use `new URL(req.url, 'http://localhost').pathname`)
- [x] 4.4 Write a test: request for `/../../../etc/passwd` returns 403, not file contents

## 5. Security Headers

- [x] 5.1 Create `src/middleware/security-headers.js` — exports `setSecurityHeaders(res)` function that writes all required headers
- [x] 5.2 Implement headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`
- [x] 5.3 Implement conditional HSTS: only send `Strict-Transport-Security` when `NODE_ENV=production`
- [x] 5.4 Call `setSecurityHeaders(res)` in `sendJson`, `sendText`, and `serveStatic` so it applies to every response type
- [x] 5.5 Write a test: any response includes `X-Content-Type-Options: nosniff` and `X-Frame-Options: SAMEORIGIN`

## 6. CORS Policy

- [x] 6.1 Create `src/middleware/cors.js` — exports `applyCors(req, res)` that reads `CORS_ALLOWED_ORIGINS` from env and applies headers
- [x] 6.2 Implement origin matching: split `CORS_ALLOWED_ORIGINS` by comma, check `req.headers.origin` against the list
- [x] 6.3 Implement preflight handler: if `req.method === 'OPTIONS'`, respond 204 with CORS headers for allowed origins, 403 for disallowed origins, and return `true` (signal to caller to stop processing)
- [x] 6.4 Add wildcard rejection to `validateConfig()`: if `CORS_ALLOWED_ORIGINS=*`, exit with code 1 (wildcard forbidden with credentialed API)
- [x] 6.5 Call `applyCors(req, res)` at the top of the request handler; handle preflight return value to short-circuit routing
- [x] 6.6 Add `CORS_ALLOWED_ORIGINS` to `.env.example` with a comment explaining format and wildcard restriction
- [x] 6.7 Write a test: request from allowed origin gets `Access-Control-Allow-Origin` header; request from unlisted origin does not

## 7. Rate Limiting

- [x] 7.1 Create `src/middleware/rate-limiter.js` — exports a `RateLimiter` class with `check(key)` method returning `{ allowed, retryAfter }`
- [x] 7.2 Implement sliding-window counter: `Map<key, { count, windowStart }>`, reset window when `Date.now() - windowStart >= 60000`
- [x] 7.3 Implement per-tenant rate limiting: call `rateLimiter.check(tenant.id)` on authenticated ingest and metrics endpoints; return 429 with `Retry-After: 60` on breach
- [x] 7.4 Implement per-IP rate limiting for `/api/bootstrap`: max 5 attempts per 60 minutes; key is `req.socket.remoteAddress`
- [x] 7.5 Read limit from `RATE_LIMIT_REQUESTS_PER_MINUTE` env var (default 300)
- [x] 7.6 Add `RATE_LIMIT_REQUESTS_PER_MINUTE` to `.env.example`
- [x] 7.7 Write tests: tenant hitting limit gets 429; second tenant unaffected; limit resets after window

## 8. Input Validation

- [x] 8.1 Create `src/validation.js` — exports `validate(schema, data)` returning `null` (valid) or `[{ field, message }]` (errors)
- [x] 8.2 Implement schema support for: `required`, `type` (string/number/boolean), `maxLength`, `enum`, `min`/`max` for numbers
- [x] 8.3 Define schemas for each request body: `POST /api/sessions`, `PATCH /api/sessions/:id`, `POST /api/usage`, `POST /api/bootstrap`, `POST /api/connectors`, `POST /api/ingest`
- [x] 8.4 Create helper `sendValidationError(res, errors)` in `server.js` that responds with HTTP 422 in the standard format
- [x] 8.5 Add `Content-Type` check in `parseBody()`: if request has a body and `Content-Type` is not `application/json`, return 415
- [x] 8.6 Wire validation into each endpoint: call `validate(schema, body)` after `parseBody()` and before business logic; call `sendValidationError` if errors exist
- [x] 8.7 Write tests: missing required field → 422 with field detail; invalid enum → 422; valid body → passes through

## 9. Structured Logging

- [x] 9.1 Create `src/middleware/logger.js` — exports `logRequest(req, res, startTime, tenantId)` and `logError(req, error, tenantId)`
- [x] 9.2 Implement `logRequest`: writes one JSON line to stdout: `{ ts, level: "info", method, path, status, latency_ms, tenant_id }`
- [x] 9.3 Implement `logError`: writes one JSON line to stderr: `{ ts, level: "error", message, stack, method, path, tenant_id }`
- [x] 9.4 Redact secrets: never log values from `x-api-key`, `x-admin-secret`, `authorization`, or `DASHBOARD_PASSWORD` headers; log only key prefix (first 12 chars) for tracing if needed
- [x] 9.5 Capture `startTime = performance.now()` at top of request handler; pass to `logRequest` after response is sent
- [x] 9.6 Move the existing `catch (error)` handler to call `logError` before sending the 500 response
- [x] 9.7 Write a test: POST to `/api/health` emits a JSON log line with correct method, path, and status fields

## 10. Graceful Shutdown

- [x] 10.1 Create `src/shutdown.js` — exports `setupGracefulShutdown(server)` that registers SIGTERM and SIGINT handlers
- [x] 10.2 On signal: call `server.close()` to stop accepting new connections
- [x] 10.3 Track in-flight request count with a counter incremented at request start and decremented at request end
- [x] 10.4 After `server.close()`, wait for in-flight count to reach 0, then call `process.exit(0)`
- [x] 10.5 Implement shutdown timeout from `SHUTDOWN_TIMEOUT_MS` env var (default 10000): if in-flight requests don't drain within timeout, log warning and call `process.exit(1)`
- [x] 10.6 Call `setupGracefulShutdown(server)` in `server.js` after `server.listen()`
- [x] 10.7 Add `SHUTDOWN_TIMEOUT_MS` to `.env.example`

## 11. Docker & Environment Hardening

- [x] 11.1 Add `NODE_ENV: production` to the app service in `docker-compose.yml` (create app service entry if only postgres exists)
- [x] 11.2 Add a `Dockerfile` for the Node.js app: `node:24-alpine`, non-root user, `COPY` only necessary files, `EXPOSE 3000`, `CMD ["node", "server.js"]`
- [x] 11.3 Add `.dockerignore` to exclude `node_modules`, `data/`, `.env`, `openspec/`, `test/`, `.claude/`
- [x] 11.4 Update `docker-compose.yml` to use the app `Dockerfile`, pass env vars via `env_file: .env`, and restart policy `restart: unless-stopped`

## 12. Test Coverage for Security Layers

- [x] 12.1 Write test: request with URL `/../../../etc/passwd` returns 403 (path traversal protection)
- [x] 12.2 Write test: response to `/api/health` includes `X-Content-Type-Options: nosniff` (security headers)
- [x] 12.3 Write test: POST body > 1MB returns 413 (body size limit)
- [x] 12.4 Write test: POST `/api/sessions` without `platform` field returns 422 with field error (input validation)
- [x] 12.5 Write test: same tenant sending > rate limit requests receives 429 with `Retry-After` header (rate limiting)
- [x] 12.6 Write test: starting server with `NODE_ENV=production` and default admin secret causes process to exit(1) (startup validation)
- [x] 12.7 Write test: `OPTIONS` preflight from allowed origin returns 204 with CORS headers (cors policy)
