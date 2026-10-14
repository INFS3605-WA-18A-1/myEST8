# Make alerts and approvals actionable

Status: needs-triage
Priority: P2
DesignDoc: Stories 11, 14

## What's wrong now

Alert rows put a badge where the action belongs (`src/web/pages/dashboard.ts` `alertRow`). The rating form is five bare 1–5 buttons (`ticket.ts:846`). Approvals has only a `tel:` link and an unlinked Property in the receipts table (`src/web/pages/approvals.ts:66,81`).

## Acceptance criteria

- [ ] The 'Rate the Tradie' alert opens the rating form, with labelled choices (1 Poor … 5 Excellent).
- [ ] Approvals gets 'Send reminder' for owners who haven't replied.
- [ ] The receipts table links the Property, or moves to Urgent Repairs.
