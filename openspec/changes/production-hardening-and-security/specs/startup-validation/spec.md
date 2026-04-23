## ADDED Requirements

### Requirement: Insecure default secrets rejected in production
The system SHALL exit with a non-zero exit code and a descriptive error message if `NODE_ENV=production` and `ACP_ADMIN_SECRET` retains its default value of `change-me-before-production`.

#### Scenario: Default admin secret in production causes immediate exit
- **WHEN** the server starts with `NODE_ENV=production` and `ACP_ADMIN_SECRET=change-me-before-production`
- **THEN** the process SHALL print a clear error to stderr identifying the insecure secret and SHALL exit with code 1 before binding to any port

#### Scenario: Strong admin secret in production allows startup
- **WHEN** `NODE_ENV=production` and `ACP_ADMIN_SECRET` is set to a value other than the default
- **THEN** startup proceeds normally

#### Scenario: Default secret in development emits warning only
- **WHEN** `NODE_ENV` is not `production` and `ACP_ADMIN_SECRET` is the default value
- **THEN** the server SHALL print a warning to stderr but SHALL continue to start

### Requirement: Dashboard credentials required in production
The system SHALL exit with a non-zero exit code if `NODE_ENV=production` and either `DASHBOARD_USERNAME` or `DASHBOARD_PASSWORD` is not set.

#### Scenario: Missing dashboard credentials in production cause exit
- **WHEN** `NODE_ENV=production` and `DASHBOARD_USERNAME` or `DASHBOARD_PASSWORD` is empty or unset
- **THEN** the process SHALL exit with code 1 and log which credential is missing

#### Scenario: Dashboard credentials set in production allow startup
- **WHEN** both `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` are non-empty strings in production
- **THEN** startup proceeds normally

### Requirement: NODE_ENV validation and warning
The system SHALL warn at startup if `NODE_ENV` is not set to one of the recognized values (`development`, `production`, `test`).

#### Scenario: Unrecognized NODE_ENV emits warning
- **WHEN** `NODE_ENV` is set to an unrecognized value (e.g., `prod` or `staging`)
- **THEN** the server SHALL emit a warning to stderr identifying the unrecognized value and continue starting

#### Scenario: Missing NODE_ENV emits warning
- **WHEN** `NODE_ENV` is not set at all
- **THEN** the server SHALL emit a warning that it is defaulting to `development` mode

### Requirement: All validation runs before the server binds to a port
The system SHALL complete all startup validation checks before calling `server.listen()`. A failed validation SHALL prevent the server from becoming reachable.

#### Scenario: Failed validation prevents port binding
- **WHEN** startup validation fails for any reason
- **THEN** `server.listen()` SHALL NOT be called and the process SHALL exit before accepting any connections
