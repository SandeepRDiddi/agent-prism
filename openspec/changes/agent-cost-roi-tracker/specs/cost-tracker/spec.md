## ADDED Requirements

### Requirement: Per-session cost accumulation
The system SHALL accumulate cost for each agent session by applying the platform-specific pricing model to each usage event received for that session.

#### Scenario: Claude token usage event received
- **WHEN** a Claude usage event is received containing input token count and output token count
- **THEN** the system SHALL compute cost as `(input_tokens × input_price_per_token) + (output_tokens × output_price_per_token)` using rates from the pricing config and add the computed amount to the session's cumulative cost

#### Scenario: Copilot usage event received
- **WHEN** a Copilot usage event is received containing active seat-hours
- **THEN** the system SHALL compute cost as `seat_hours × hourly_seat_rate` from the pricing config and add it to the session's cumulative cost

#### Scenario: Generic usage event received
- **WHEN** a usage event is received for a generic platform containing a pre-computed `cost_usd` field
- **THEN** the system SHALL add the provided `cost_usd` value directly to the session's cumulative cost without further computation

#### Scenario: Usage event for unknown session
- **WHEN** a usage event is received for a session ID that does not exist
- **THEN** the system SHALL return a 404 and SHALL NOT record any cost

### Requirement: Platform cost aggregation
The system SHALL provide aggregated cost totals by platform and by time window (current day, current week, rolling 30 days) queryable via an API endpoint.

#### Scenario: Daily cost by platform queried
- **WHEN** a request is made to the cost aggregation endpoint with window=`day`
- **THEN** the system SHALL return total cost per platform for all sessions with events in the current calendar day (UTC)

#### Scenario: Rolling 30-day cost queried
- **WHEN** a request is made with window=`30d`
- **THEN** the system SHALL return total cost per platform for all sessions with events within the last 30 days

#### Scenario: No cost data for window
- **WHEN** no usage events exist for the requested time window
- **THEN** the system SHALL return zero costs for all platforms rather than an error

### Requirement: Pricing config validation
The system SHALL validate the pricing configuration at startup and surface a clear error if required pricing fields are missing or malformed.

#### Scenario: Valid pricing config loaded
- **WHEN** the application starts and the pricing config contains all required fields with valid numeric values
- **THEN** the system SHALL start successfully and use the configured rates for cost computation

#### Scenario: Missing pricing field detected
- **WHEN** the application starts and a required pricing field (e.g., `claude.input_price_per_token`) is absent from the config
- **THEN** the system SHALL log a descriptive error identifying the missing field and SHALL refuse to start

#### Scenario: Stale pricing config warning
- **WHEN** the pricing config's `last_verified` date is more than 90 days before the current date
- **THEN** the system SHALL surface a warning in the dashboard UI indicating the pricing config may be out of date

### Requirement: Total cumulative cost query
The system SHALL expose an endpoint returning the total cost across all platforms and all sessions for a requested time window.

#### Scenario: Total cost across all platforms queried
- **WHEN** a request is made to the total cost endpoint
- **THEN** the system SHALL return a single numeric value representing the sum of all platform costs for the requested window, along with a per-platform breakdown
