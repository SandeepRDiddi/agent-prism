## ADDED Requirements

### Requirement: Static file server path containment
The system SHALL verify that the resolved absolute path of every static file request is contained within the `public/` directory before reading and serving the file. Requests that resolve outside this directory SHALL be rejected with HTTP 403.

#### Scenario: Normal file request served
- **WHEN** a request is made for `/styles.css`
- **THEN** the resolved path is inside `public/` and the file is served normally

#### Scenario: Path traversal attempt rejected
- **WHEN** a request is made with a URL such as `/../../../etc/passwd` or `%2F..%2F..%2Fetc%2Fpasswd`
- **THEN** the server SHALL return HTTP 403 Forbidden and SHALL NOT read or return any file outside the `public/` directory

#### Scenario: Double-encoded traversal attempt rejected
- **WHEN** a request URL contains double-encoded sequences (e.g., `%252F..%252F`) that would resolve outside `public/` after URL decoding and path normalization
- **THEN** the server SHALL return HTTP 403 Forbidden

#### Scenario: Symlink within public served normally
- **WHEN** a symlink inside `public/` is requested and its target is also inside `public/`
- **THEN** the file SHALL be served normally

### Requirement: URL stripping of query strings before path resolution
The system SHALL strip query strings and fragments from the URL before computing the file path, so that `?../secret` cannot be used to confuse path resolution.

#### Scenario: Query string stripped before path resolution
- **WHEN** a request is made to `/styles.css?foo=bar`
- **THEN** only `styles.css` is used for path resolution; the query string is ignored and does not affect which file is served
