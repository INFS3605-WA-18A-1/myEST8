# Property profile around its Tickets and Max Repair Cost

Status: needs-triage
Priority: P2
DesignDoc: Feature 5

## What's wrong now

The profile shows details first and open Tickets last, with no Ticket history (`src/web/pages/properties.ts:65-74`). Max Repair Cost is buried in a `dl`. Contacts run together on one line (`:101`). Nothing is editable. The list has no search or filter.

## Acceptance criteria

- [ ] Open Tickets first, then the Ticket history.
- [ ] Max Repair Cost as a headline fact beside current Repair Costs.
- [ ] Contacts on separate lines, with tenancy start dates.
- [ ] An edit path.
- [ ] Search and Mine/All on the list.
