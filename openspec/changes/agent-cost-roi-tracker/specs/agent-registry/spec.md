## ADDED Requirements

### Requirement: Agent session registration
The system SHALL accept a session start event from any supported platform and record the agent session in persistent storage with a unique session ID, platform identifier, start timestamp, and initial status of `running`.

#### Scenario: New Claude session registered
- **WHEN** a Claude agent session start event is received via the ingest API
- **THEN** the system SHALL create a new session record with status `running`, the platform set to `claude`, and the start timestamp set to the event time

#### Scenario: New Copilot session registered
- **WHEN** a GitHub Copilot session start event is received via the ingest API
- **THEN** the system SHALL create a new session record with status `running`, the platform set to `copilot`, and the start timestamp set to the event time

#### Scenario: Generic agent session registered
- **WHEN** a session start webhook is received with a valid `platform` field not matching a built-in platform
- **THEN** the system SHALL create a session record using the provided `platform` value and mark status `running`

### Requirement: Agent session status updates
The system SHALL accept status update events (idle, completed, error) for existing sessions and update the stored status and last-seen timestamp accordingly.

#### Scenario: Session marked completed
- **WHEN** a session completion event is received for an existing session ID
- **THEN** the system SHALL update that session's status to `completed` and record the end timestamp

#### Scenario: Session marked idle
- **WHEN** a session idle event is received for an existing session ID
- **THEN** the system SHALL update that session's status to `idle` and update the last-seen timestamp

#### Scenario: Unknown session ID on update
- **WHEN** a status update event is received for a session ID that does not exist in storage
- **THEN** the system SHALL return a 404 response and SHALL NOT create a new session record

### Requirement: Automatic session timeout
The system SHALL automatically transition sessions that have not received any event for longer than the configured timeout period from `running` or `idle` to `timed_out`.

#### Scenario: Session exceeds timeout threshold
- **WHEN** a session's last-seen timestamp is older than the configured timeout (default 30 minutes) and its status is `running` or `idle`
- **THEN** the system SHALL update the session status to `timed_out` on the next metrics computation cycle

#### Scenario: Session receives event before timeout
- **WHEN** a session event is received before the timeout threshold is reached
- **THEN** the system SHALL update the last-seen timestamp and the session SHALL remain in its current active status

### Requirement: Active agent count query
The system SHALL expose an endpoint that returns the current count of sessions with status `running` or `idle`, broken down by platform.

#### Scenario: Active agents queried
- **WHEN** a request is made to the active agent count endpoint
- **THEN** the system SHALL return a JSON object with total active count and per-platform counts, reflecting only sessions with status `running` or `idle`

#### Scenario: No active agents
- **WHEN** no sessions have status `running` or `idle`
- **THEN** the system SHALL return a count of zero for total and all platforms, rather than an error
