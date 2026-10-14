# One query for the board's facts

Status: needs-triage
Priority: P3
DesignDoc: —

## What's wrong now

`boardOf` (`src/web/pages/dashboard.ts`) calls `actions.ticket()` once per open Ticket to count Quotes, Quote Requests and the visit.

## Acceptance criteria

- [ ] A `dashboard` view returns per-Ticket Quote counts, the open Quote Request count and the next visit in one pass.
