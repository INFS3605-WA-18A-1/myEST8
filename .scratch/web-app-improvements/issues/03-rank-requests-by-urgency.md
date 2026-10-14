# Rank Maintenance Requests by Urgency, then submission time

Status: needs-triage
Priority: P1
DesignDoc: Story 9, logic rule 3

## What's wrong now

The query sorts Maintenance Requests by `reported_at, id` only (`src/tickets.ts:665`), and the dashboard re-sorts them oldest first (`src/web/pages/dashboard.ts`, `decisions()`). Tickets are already sorted Urgency first (`tickets.ts:677`). `docs/design-system.md` says 'oldest first', which disagrees with the DesignDoc.

## Acceptance criteria

- [ ] Maintenance Requests sort by Urgency (Urgent, High, Routine), then submission time, on the dashboard and on `/requests`.
- [ ] `docs/design-system.md` is updated to say so.
