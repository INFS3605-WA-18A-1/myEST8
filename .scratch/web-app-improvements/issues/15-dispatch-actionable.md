# Make Dispatch lists actionable

Status: needs-triage
Priority: P2
DesignDoc: Logic rule 5

## What's wrong now

Panels say 'Ticket 12' and clip the issue (`src/web/pages/dispatch.ts:131,198`). Both ratings are joined into one muted string (`:142,166-171`). There is no Mine/All filter. The table lists every Property, and `geocodeMissing()` runs on every load (`:44`).

## Acceptance criteria

- [ ] Tickets are named by issue.
- [ ] Both ratings sit side by side.
- [ ] Mine/All filters the pins and tables.
- [ ] The table defaults to Properties with open Tickets.
- [ ] Geocoding moves out of the page load (on save, or a background job).
