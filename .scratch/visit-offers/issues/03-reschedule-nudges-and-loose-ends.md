# B3. Rescheduling a booked visit, nudges, and loose ends

Status: resolved
Blocked by: 02
Spec: ../spec.md

## What to build
- **Rescheduling:** "Need another time?" on the booked email and on the tracker (`/t/:token`, replacing "reply YES to our message", `CONFIRM_VISIT` at `tenant-pages.ts` ~:373) goes to the same page and starts a new round. A Tradie asking for another time does the same. The existing visit stays booked until a new time is picked, then it moves: reuse `acceptTime`'s move logic (`scheduling.ts` ~:411).
- **Nudges:** using the existing `alerts` pattern (`quotes.alerts`, `scheduling.alerts`):
  - the Tradie hasn't offered times within 24 h → a reminder; at 48 h → an alert for the Property Manager
  - the Tenant hasn't picked within 24 h → a reminder; at 48 h → an alert
- **Property Manager override:** the Ticket's and Dispatch's existing "Book a time" forms still work at any point, and booking supersedes any open offer. The Ticket also gets "Ask <Tradie> to offer times", to start a round by hand. That's how today's Ticket #1, with its pending reschedule, would continue.
- **Loose ends fixed along the way:** the Owner is told when a visit moves (`owner.work_moved`), and the Tradie is told when the Tenant picks.
- **Docs:** ADR 0015 records "Tradies offer visit times, Tenants pick", amending the scheduling part of the design, and `docs/design-system.md` covers the `/v/` page and the button lines.


## Acceptance criteria

- [x] Each behaviour above has a test at an agreed seam that failed first.
- [x] The spec's verification steps for this issue pass.
- [x] `npm run check` passes.
