## ADDED Requirements

### Requirement: Security headers on every HTTP response
The system SHALL include a set of HTTP security headers on every response, including error responses, static file responses, and API responses.

#### Scenario: API response includes security headers
- **WHEN** any request is made to any endpoint
- **THEN** the response SHALL include all of: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`

#### Scenario: 404 and 500 responses include security headers
- **WHEN** the server returns a 404 or 500 error
- **THEN** the error response SHALL still include the full set of security headers

#### Scenario: Content-Security-Policy header present
- **WHEN** any HTML page is served
- **THEN** the response SHALL include a `Content-Security-Policy` header that restricts script and style sources

### Requirement: HSTS header in production only
The system SHALL send `Strict-Transport-Security` only when `NODE_ENV=production` to prevent breaking local HTTP development.

#### Scenario: HSTS sent in production
- **WHEN** `NODE_ENV` is set to `production` and any response is sent
- **THEN** the response SHALL include `Strict-Transport-Security: max-age=63072000; includeSubDomains`

#### Scenario: HSTS not sent in development
- **WHEN** `NODE_ENV` is not set to `production`
- **THEN** the response SHALL NOT include a `Strict-Transport-Security` header
