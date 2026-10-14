# Tradie profile with history and both ratings

Status: needs-triage
Priority: P2
DesignDoc: Feature 5, 11

## What's wrong now

Quote history has no Property, Ticket link or outcome (`src/web/pages/tradie.ts:163-169`). Bookings don't link to their Ticket (`:182`). 'Not on Google' is shown in the large stat style (`:136`). PM ratings and Tenant answers share a table (`:149`). The Trade filter needs a button press (`:82`).

## Acceptance criteria

- [ ] myEST8 and Google ratings side by side, with 'Not on Google' in quiet text.
- [ ] Quote history with the Property, a Ticket link and the outcome.
- [ ] Scheduled and past Jobs link to their Tickets.
- [ ] PM ratings and Tenant answers are separate.
- [ ] A back link.
- [ ] The filter applies when it changes.
