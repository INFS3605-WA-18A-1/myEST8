# Owner reminder shows the full repair cost

Status: needs-triage
Priority: P1
DesignDoc: Logic rule 7

## What's wrong now

The approval request shows the full repair cost, but the 24-hour reminder shows only the Quote price (`src/templates.ts:132`).

## Acceptance criteria

- [ ] The reminder repeats the full repair cost and the Max Repair Cost.
