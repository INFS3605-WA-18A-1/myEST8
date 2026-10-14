# Compare Quotes side by side

Status: needs-triage
Priority: P1
DesignDoc: Story 10, logic rule 6

## What's wrong now

Quotes render as a grid of cards that only go two-up from `sm` (`src/web/pages/ticket.ts:658`). Each card carries its own confirm or choose form, so heights differ and rows don't line up. No card shows the myEST8 or Google rating, or the median Quote (`ticket.ts:664-677`); those live only in the Recommended Tradies table, which disappears once the Job leaves quoting (`src/quotes.ts:398`).

## Acceptance criteria

- [ ] Quotes for a Job show as a comparison table: one column per Quote, rows for Price, Proposed time, myEST8 rating, Google rating (side by side, never combined), Confirmed, and the PDF.
- [ ] Each column has one Confirm or Choose action, aligned across columns.
- [ ] Choose stays disabled until two Quotes are confirmed, unless a single-quote reason is recorded.
- [ ] Under 640 px the table stacks one Quote per block.
