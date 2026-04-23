## ADDED Requirements

### Requirement: FTE equivalence computation
The system SHALL compute FTE-equivalent hours saved by multiplying the number of agent tasks completed in a time window by the operator-configured average human hours per task.

#### Scenario: FTE hours computed for completed sessions
- **WHEN** the ROI engine is queried for a time window
- **THEN** the system SHALL count all sessions with status `completed` in that window, multiply by `avg_human_hours_per_task` from config, and return the result as `fte_hours_saved`

#### Scenario: Zero completed sessions
- **WHEN** no sessions have status `completed` in the requested window
- **THEN** the system SHALL return `fte_hours_saved` of zero rather than an error

#### Scenario: Missing FTE config value
- **WHEN** `avg_human_hours_per_task` is not set in the pricing config
- **THEN** the system SHALL refuse to compute ROI and return a descriptive error indicating which config value is missing

### Requirement: Loaded FTE cost comparison
The system SHALL compute the cost of equivalent human work by multiplying FTE hours saved by the operator-configured loaded hourly rate, and compare it to the actual agent cost to produce a net savings figure.

#### Scenario: ROI computed with positive net savings
- **WHEN** the FTE cost of equivalent human work exceeds the actual agent cost for the requested window
- **THEN** the system SHALL return `fte_cost_equivalent`, `agent_cost`, and `net_savings` (positive value indicating savings)

#### Scenario: ROI computed with negative net savings (agent costs more)
- **WHEN** the actual agent cost exceeds the FTE cost equivalent for the requested window
- **THEN** the system SHALL return a negative `net_savings` value and SHALL NOT hide or clamp this value

#### Scenario: ROI multiplier computed
- **WHEN** ROI is computed and `agent_cost` is greater than zero
- **THEN** the system SHALL include an `roi_multiplier` field computed as `fte_cost_equivalent / agent_cost`

#### Scenario: Zero agent cost edge case
- **WHEN** `agent_cost` is zero for the requested window
- **THEN** the system SHALL return `roi_multiplier` as `null` rather than dividing by zero

### Requirement: ROI config transparency
The system SHALL include the assumption inputs (avg human hours per task, loaded hourly rate) alongside every ROI response so consumers can inspect and validate the model.

#### Scenario: ROI response includes assumptions
- **WHEN** an ROI summary is returned by the API
- **THEN** the response SHALL include an `assumptions` object containing `avg_human_hours_per_task` and `loaded_hourly_rate_usd` exactly as configured

### Requirement: Time-windowed ROI query
The system SHALL support querying ROI metrics for the same time windows supported by the cost tracker (current day, current week, rolling 30 days).

#### Scenario: Daily ROI queried
- **WHEN** a request is made to the ROI endpoint with window=`day`
- **THEN** the system SHALL compute all ROI metrics using only sessions and costs from the current calendar day (UTC)

#### Scenario: Rolling 30-day ROI queried
- **WHEN** a request is made with window=`30d`
- **THEN** the system SHALL compute all ROI metrics using sessions and costs from the last 30 days
