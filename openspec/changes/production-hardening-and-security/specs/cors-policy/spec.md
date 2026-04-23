## ADDED Requirements

### Requirement: CORS headers based on allowed origins configuration
The system SHALL enforce a CORS policy on all API endpoints. Allowed origins SHALL be read from the `CORS_ALLOWED_ORIGINS` environment variable (comma-separated list). If the variable is not set, the default policy SHALL allow same-origin requests only.

#### Scenario: Request from allowed origin receives CORS header
- **WHEN** a request arrives with an `Origin` header that matches one of the configured allowed origins
- **THEN** the response SHALL include `Access-Control-Allow-Origin: <origin>` reflecting the matching origin

#### Scenario: Request from disallowed origin does not receive permissive CORS header
- **WHEN** a request arrives with an `Origin` header that does not match any configured allowed origin
- **THEN** the response SHALL NOT include `Access-Control-Allow-Origin` for that origin

#### Scenario: Wildcard origin not permitted
- **WHEN** `CORS_ALLOWED_ORIGINS=*` is set
- **THEN** the system SHALL reject this configuration at startup with a clear error — wildcard CORS is not permitted in this API because it carries credentials (API keys)

#### Scenario: No Origin header treated as same-origin
- **WHEN** a request arrives without an `Origin` header (e.g., direct curl request, server-to-server)
- **THEN** the system SHALL process the request normally without adding CORS headers

### Requirement: Preflight OPTIONS requests handled correctly
The system SHALL respond to CORS preflight (`OPTIONS`) requests with the correct headers and HTTP 204, without forwarding the request to business logic.

#### Scenario: Preflight request from allowed origin returns 204
- **WHEN** an `OPTIONS` request arrives with `Origin` and `Access-Control-Request-Method` headers from an allowed origin
- **THEN** the system SHALL return HTTP 204 with `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, and `Access-Control-Max-Age` headers

#### Scenario: Preflight request from disallowed origin returns 403
- **WHEN** an `OPTIONS` preflight request arrives from an origin not in the allowed list
- **THEN** the system SHALL return HTTP 403 Forbidden

### Requirement: CORS headers include credentials allowance for same-origin
The system SHALL include `Access-Control-Allow-Credentials: true` only when the request origin matches an explicitly configured allowed origin (not for wildcard).

#### Scenario: Credentials flag sent for allowed origin
- **WHEN** a credentialed request arrives from an explicitly allowed origin
- **THEN** the response SHALL include `Access-Control-Allow-Credentials: true`
