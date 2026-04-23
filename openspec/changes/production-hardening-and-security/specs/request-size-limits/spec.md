## ADDED Requirements

### Requirement: Maximum request body size enforced
The system SHALL enforce a maximum request body size on all endpoints that accept a request body. Requests that exceed this limit SHALL be rejected with HTTP 413 before the full body is read into memory.

#### Scenario: Request body within size limit processed
- **WHEN** a POST request body is smaller than `MAX_BODY_BYTES`
- **THEN** the system SHALL read the body and process the request normally

#### Scenario: Request body exceeding size limit rejected
- **WHEN** a POST request body size exceeds `MAX_BODY_BYTES` (default 1,048,576 bytes / 1MB)
- **THEN** the system SHALL return HTTP 413 Payload Too Large with a JSON error body, and SHALL destroy the socket to prevent further data from being read

#### Scenario: Body size limit configurable via environment variable
- **WHEN** `MAX_BODY_BYTES=5242880` is set (5MB)
- **THEN** the system SHALL accept bodies up to 5MB and reject bodies larger than 5MB

#### Scenario: Size limit applied before full body buffering
- **WHEN** a request body chunk causes the running total to exceed `MAX_BODY_BYTES`
- **THEN** the system SHALL immediately respond with 413 and stop reading — it SHALL NOT buffer the entire body before checking the limit

### Requirement: GET requests with unexpected bodies are not buffered
The system SHALL NOT attempt to parse or buffer request bodies on GET, HEAD, or DELETE requests.

#### Scenario: GET request with body ignored safely
- **WHEN** a GET request arrives with a non-empty `Content-Length` header
- **THEN** the system SHALL not attempt to read or parse the body, and SHALL process the GET request normally
