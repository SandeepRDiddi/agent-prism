## ADDED Requirements

### Requirement: View Sales Story button removed from navigation
The system SHALL NOT display a "View Sales Story" navigation link in the main application UI. The link targets `/storyline.html` and is a demo artifact that SHALL be removed from all client-facing pages.

#### Scenario: Main dashboard loads without Sales Story link
- **WHEN** a user navigates to the root path `/`
- **THEN** the rendered page SHALL NOT contain any anchor element linking to `/storyline.html` or containing the text "View Sales Story"

#### Scenario: ROI Dashboard loads without Sales Story link
- **WHEN** a user navigates to `/dashboard`
- **THEN** the rendered page SHALL NOT contain any anchor element linking to `/storyline.html` or containing the text "View Sales Story"

#### Scenario: Storyline page remains accessible but unlinked
- **WHEN** a user directly navigates to `/storyline.html`
- **THEN** the page SHALL still be served (it is not deleted), but it SHALL NOT be reachable via any navigation element in the main UI
