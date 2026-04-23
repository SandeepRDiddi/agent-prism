## ADDED Requirements

### Requirement: Request body validation on all write endpoints
The system SHALL validate the structure, types, and required fields of every JSON request body before passing it to business logic. Invalid requests SHALL be rejected with HTTP 422 and a structured error body.

#### Scenario: Missing required field
- **WHEN** a POST request to `/api/sessions` is received without the required `platform` field
- **THEN** the system SHALL return HTTP 422 with a JSON body containing `{ "error": "validation_error", "fields": [{ "field": "platform", "message": "required" }] }`

#### Scenario: Invalid field type
- **WHEN** a POST request body contains a field expected to be a string but receives a number (e.g., `"platform": 42`)
- **THEN** the system SHALL return HTTP 422 with a field-level error identifying the offending field and the expected type

#### Scenario: Unknown platform value rejected
- **WHEN** a POST request to `/api/sessions` contains `"platform": "unknown_vendor_xyz"` which is not in the allowed enum
- **THEN** the system SHALL return HTTP 422 with a field-level error listing the valid platform values

#### Scenario: Valid request passes validation
- **WHEN** a POST request contains all required fields with valid types and values
- **THEN** the system SHALL pass the request to business logic and SHALL NOT return a 422 response

#### Scenario: Non-JSON content type
- **WHEN** a POST/PATCH request arrives with a `Content-Type` other than `application/json` and a non-empty body
- **THEN** the system SHALL return HTTP 415 Unsupported Media Type

### Requirement: String field length limits enforced
The system SHALL enforce maximum string lengths on all string fields in request bodies to prevent excessively long values from reaching business logic or storage.

#### Scenario: String field exceeds maximum length
- **WHEN** a request body contains a string field (e.g., `agent_name`) whose length exceeds 255 characters
- **THEN** the system SHALL return HTTP 422 with a field-level error indicating the maximum allowed length

#### Scenario: String field within length limit
- **WHEN** a request body contains string fields within their defined length limits
- **THEN** the system SHALL process the request normally

### Requirement: Structured 422 error format
All validation errors SHALL use a consistent JSON structure so that API clients can parse them programmatically.

#### Scenario: 422 response structure
- **WHEN** the system returns a 422 Unprocessable Entity response
- **THEN** the response body SHALL conform to `{ "error": "validation_error", "message": string, "fields": [{ "field": string, "message": string }] }`
