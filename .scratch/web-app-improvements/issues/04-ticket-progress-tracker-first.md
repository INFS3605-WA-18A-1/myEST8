# Put the Ticket's progress tracker at the top

Status: needs-triage
Priority: P1
DesignDoc: Feature 12

## What's wrong now

The Timeline is the fourth card in the Ticket page's side column, after Photos, the report and Ticket details (`src/web/pages/ticket.ts:322`). On phones it ends up below every Job card.

## Acceptance criteria

- [ ] The Ticket page opens with a horizontal stage tracker (the tenant tracker's stages) under the header docket.
- [ ] The detailed timeline stays in the side column.
