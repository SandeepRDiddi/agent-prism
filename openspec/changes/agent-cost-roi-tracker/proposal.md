## Why

Teams deploying agentic AI (Claude, Copilot, and others) have no unified visibility into how many agents are running, what they cost, or whether they are delivering measurable value versus human alternatives. Without this, AI adoption decisions are made blind — no cost accountability, no ROI signal.

## What Changes

- Add a real-time agent monitoring layer that tracks active agent sessions across supported AI platforms (Claude Code, GitHub Copilot, and extensible to others)
- Add cost tracking that aggregates token/compute spend per agent, per platform, and per time window
- Add an FTE comparison engine that converts agent activity into equivalent human-hours and maps that to a loaded FTE cost, yielding a live ROI metric
- Add a dashboard view (new page in the existing site) that surfaces agent count, cumulative cost, FTE equivalent, and net savings in real time

## Capabilities

### New Capabilities

- `agent-registry`: Tracks which agents are currently active, their platform, session start time, and current status (running, idle, completed)
- `cost-tracker`: Aggregates spend per agent session using platform-specific pricing models; supports Claude (token-based), Copilot (seat + usage), and a generic webhook/API ingest for other frameworks
- `fte-roi-engine`: Converts agent activity metrics (tasks completed, time spent, tokens consumed) into FTE-equivalent hours; compares against a configurable loaded FTE cost to produce real-time ROI and payback figures
- `agent-dashboard`: Real-time UI page showing live agent count, cost burn, FTE equivalent saved, and ROI trend — built on the existing site stack

### Modified Capabilities

<!-- No existing specs to modify -->

## Impact

- **New data layer**: Requires a lightweight backend (or edge function) to ingest agent telemetry and expose aggregated metrics via an API the dashboard can poll or subscribe to
- **Platform integrations**: Claude API usage data (via Anthropic usage API or webhook), GitHub Copilot seat/usage API, extensible plugin interface for other frameworks
- **Frontend**: New dashboard page added to the existing Next.js/static site; may require a real-time data connection (WebSocket or SSE) for live updates
- **Configuration**: Users must supply API keys / org tokens for each platform they want to track, plus FTE cost inputs (hourly rate, overhead multiplier)
- **No breaking changes** to existing sales storyline or navigation pages
