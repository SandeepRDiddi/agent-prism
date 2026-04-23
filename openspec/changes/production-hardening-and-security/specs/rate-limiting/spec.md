## ADDED Requirements

### Requirement: Per-tenant rate limiting on ingest and metrics endpoints
The system SHALL enforce a per-tenant request rate limit on write-heavy and read-heavy endpoints. When a tenant exceeds the limit, the system SHALL return HTTP 429 with a `Retry-After` header.

#### Scenario: Request within rate limit succeeds
- **WHEN** a tenant sends fewer requests than the configured limit within the rate window
- **THEN** the system SHALL process the request normally and SHALL NOT return a 429 response

#### Scenario: Request exceeding rate limit rejected
- **WHEN** a tenant sends more than `RATE_LIMIT_REQUESTS_PER_MINUTE` requests within a 60-second sliding window to a rate-limited endpoint
- **THEN** the system SHALL return HTTP 429 with a JSON body `{ "error": "rate_limit_exceeded", "message": "..." }` and a `Retry-After: 60` header

#### Scenario: Rate limit resets after window
- **WHEN** a tenant has been rate-limited and 60 seconds have elapsed since the window started
- **THEN** the tenant's request counter SHALL reset and subsequent requests SHALL succeed

#### Scenario: Different tenants have independent counters
- **WHEN** tenant A is rate-limited
- **THEN** tenant B's requests on the same endpoint SHALL not be affected and SHALL succeed

### Requirement: Bootstrap endpoint IP-based rate limit
The system SHALL apply a per-IP rate limit to the `/api/bootstrap` endpoint to prevent brute-force attempts against the admin secret.

#### Scenario: Excessive bootstrap attempts rejected
- **WHEN** more than 5 bootstrap attempts arrive from the same IP address within a 60-minute window
- **THEN** the system SHALL return HTTP 429 for all subsequent attempts within that window, regardless of whether the admin secret is correct

#### Scenario: Legitimate bootstrap attempt succeeds
- **WHEN** a bootstrap request arrives from an IP that has not exceeded the limit
- **THEN** the system SHALL process the request normally

### Requirement: Rate limit configuration via environment variables
The system SHALL read the per-tenant rate limit from the `RATE_LIMIT_REQUESTS_PER_MINUTE` environment variable. If not set, the system SHALL use a default of 300 requests per minute.

#### Scenario: Custom rate limit applied
- **WHEN** `RATE_LIMIT_REQUESTS_PER_MINUTE=100` is set
- **THEN** tenants SHALL be rate-limited at 100 requests per 60-second window

#### Scenario: Default rate limit applied when env var absent
- **WHEN** `RATE_LIMIT_REQUESTS_PER_MINUTE` is not set
- **THEN** the system SHALL apply a default limit of 300 requests per minute
