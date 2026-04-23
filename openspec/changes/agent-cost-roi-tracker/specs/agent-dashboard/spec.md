## ADDED Requirements

### Requirement: Live agent count display
The system SHALL display the current number of active agents (status `running` or `idle`) on the dashboard, broken down by platform, and refresh this count automatically without a full page reload.

#### Scenario: Active agents shown on load
- **WHEN** a user navigates to the dashboard page
- **THEN** the page SHALL display the total active agent count and per-platform counts within 2 seconds of load

#### Scenario: Count updates automatically
- **WHEN** the active agent count changes (new session starts or session completes)
- **THEN** the dashboard SHALL reflect the updated count within 10 seconds without requiring a manual page refresh

#### Scenario: No active agents state
- **WHEN** no agents are currently active
- **THEN** the dashboard SHALL display a count of zero with a clear empty state message rather than blank space

### Requirement: Real-time cost burn display
The system SHALL display cumulative agent cost for the current day and rolling 30 days, broken down by platform, and refresh automatically.

#### Scenario: Cost totals displayed on load
- **WHEN** a user loads the dashboard
- **THEN** the page SHALL show today's total cost and 30-day total cost, each with a per-platform breakdown

#### Scenario: Stale pricing config warning shown
- **WHEN** the pricing config's `last_verified` date is more than 90 days old
- **THEN** the dashboard SHALL display a visible warning banner indicating the cost figures may be inaccurate due to outdated pricing config

### Requirement: FTE equivalent and ROI display
The system SHALL display FTE hours saved, the cost of equivalent human work, and net savings for both the current day and rolling 30 days, alongside the assumption inputs used to compute them.

#### Scenario: ROI metrics displayed
- **WHEN** a user loads the dashboard and at least one session has completed in the selected window
- **THEN** the page SHALL display `FTE hours saved`, `FTE cost equivalent (USD)`, `Agent cost (USD)`, and `Net savings (USD)` as clearly labeled metrics

#### Scenario: ROI assumptions visible
- **WHEN** ROI metrics are displayed
- **THEN** the dashboard SHALL show the configured `avg_human_hours_per_task` and `loaded_hourly_rate` values adjacent to the ROI figures so users can verify the model inputs

#### Scenario: Negative net savings displayed
- **WHEN** the ROI engine returns a negative net savings value
- **THEN** the dashboard SHALL display the negative value clearly (e.g., in red or with a negative sign) and SHALL NOT hide or replace it with zero

### Requirement: Dashboard authentication gate
The system SHALL require authentication before displaying any dashboard data to prevent unauthorized access to cost and ROI information.

#### Scenario: Unauthenticated user redirected
- **WHEN** an unauthenticated request is made to the dashboard page
- **THEN** the system SHALL respond with an authentication prompt (HTTP Basic Auth or equivalent) and SHALL NOT return any metric data

#### Scenario: Authenticated user accesses dashboard
- **WHEN** a request is made with valid credentials
- **THEN** the system SHALL serve the full dashboard page with all metric data

### Requirement: Platform configuration status display
The system SHALL display which platforms are currently configured (API keys present) and which are not, so operators can identify missing integrations at a glance.

#### Scenario: Configured platform shown as active
- **WHEN** a platform's API key is present in environment variables
- **THEN** the dashboard SHALL show that platform with an active/connected indicator

#### Scenario: Unconfigured platform shown as inactive
- **WHEN** a platform's API key is absent
- **THEN** the dashboard SHALL show that platform with a disconnected indicator and a prompt to configure it, rather than hiding the platform entirely
