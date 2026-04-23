## ADDED Requirements

### Requirement: SIGTERM and SIGINT trigger graceful shutdown
The system SHALL listen for `SIGTERM` and `SIGINT` signals and initiate a graceful shutdown sequence: stop accepting new connections, allow in-flight requests to complete, then exit with code 0.

#### Scenario: SIGTERM received during idle server
- **WHEN** a SIGTERM signal is sent to the process and no requests are in-flight
- **THEN** the process SHALL close the server and exit with code 0 within 1 second

#### Scenario: SIGTERM received during active requests
- **WHEN** a SIGTERM signal is sent while requests are being processed
- **THEN** the server SHALL stop accepting new connections immediately, allow in-flight requests to complete, and exit with code 0 after all in-flight requests have finished or the shutdown timeout has elapsed

#### Scenario: Shutdown timeout forces exit
- **WHEN** a SIGTERM signal is sent and in-flight requests do not complete within `SHUTDOWN_TIMEOUT_MS` (default 10,000ms)
- **THEN** the process SHALL log a warning and exit with code 1 to avoid hanging indefinitely

#### Scenario: SIGINT (Ctrl+C) triggers same graceful shutdown
- **WHEN** SIGINT is received (e.g., developer pressing Ctrl+C)
- **THEN** the same graceful shutdown sequence SHALL execute as for SIGTERM

### Requirement: Graceful shutdown does not accept new connections
The system SHALL call `server.close()` immediately upon receiving a shutdown signal so that the OS stops routing new TCP connections to the process.

#### Scenario: New connections rejected after shutdown signal
- **WHEN** a shutdown signal has been received
- **THEN** new TCP connections SHALL be refused by the OS; existing in-flight requests SHALL continue to completion
