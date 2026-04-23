## ADDED Requirements

### Requirement: JSON structured request log per response
The system SHALL emit one JSON log line to stdout for every completed HTTP request, including the HTTP method, path, response status code, response latency, and tenant ID (if authenticated).

#### Scenario: Successful authenticated request logged
- **WHEN** a tenant makes a request to `/api/ingest` that returns 201
- **THEN** stdout SHALL receive a JSON line containing `{ "ts": "<ISO8601>", "level": "info", "method": "POST", "path": "/api/ingest", "status": 201, "latency_ms": <number>, "tenant_id": "<id>" }`

#### Scenario: Unauthenticated request logged without tenant_id
- **WHEN** a request arrives with no valid API key and returns 401
- **THEN** the log line SHALL include `"tenant_id": null` and SHALL NOT include any API key value

#### Scenario: Static file request logged
- **WHEN** a browser requests `/styles.css`
- **THEN** the log line SHALL include `"method": "GET"`, `"path": "/styles.css"`, and the response status

### Requirement: Error log with stack trace on unhandled exceptions
The system SHALL emit a JSON error log to stderr whenever the request handler catches an unhandled exception, including the error message and stack trace.

#### Scenario: Unhandled error logged with context
- **WHEN** an unhandled exception occurs during request processing
- **THEN** stderr SHALL receive a JSON line containing `{ "ts": "<ISO8601>", "level": "error", "message": "<error message>", "stack": "<stack trace>", "method": "<method>", "path": "<path>" }`

### Requirement: Secrets and PII are never logged
The system SHALL never include API key values, admin secrets, passwords, or any other credential in any log output.

#### Scenario: API key value not logged
- **WHEN** a request includes an `x-api-key` header
- **THEN** the log line SHALL NOT contain the API key value; it MAY contain the key prefix (first 12 characters) for tracing purposes but never the full key

#### Scenario: Admin secret not logged
- **WHEN** a request includes an `x-admin-secret` header
- **THEN** the log line SHALL NOT contain the admin secret value under any circumstances
