# Lead the Ticket header with the next action

Status: needs-triage
Priority: P2
DesignDoc: PM flow 3–8

## What's wrong now

The Repair Cost is the largest figure at 26 px (`src/web/pages/ticket.ts:359`), even at $0.00 during quoting. The Job's next action sits below the header, and the Urgency form takes header space (`:352`).

## Acceptance criteria

- [ ] The header shows the next action (for example 'Choose a Quote' or 'Send the work order') as the primary button.
- [ ] Repair Cost is shown only once a Quote is chosen, next to the Max Repair Cost.
- [ ] Change Urgency moves into a menu.
