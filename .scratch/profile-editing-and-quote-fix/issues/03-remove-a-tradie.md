# Remove a Tradie from the Agency

Status: resolved
Spec: ../spec.md

## What's wrong

There's no way to delete a Tradie. Quotes, visits (work orders), ratings and Nominated Tradies all point at the Tradie (`tradie_id NOT NULL REFERENCES people`), so deleting the row would fail or wipe history the Agency needs.

## What to build

- **The column.** A migration adds `removed_at text` (nullable) to `people`. A removed Tradie keeps their row, so past Quotes, visits and ratings still show their name.
- **Removing.** On the Tradie's profile, a **Remove Tradie** button in the page's actions (outlined, red text: the design system's destructive style if it has one, otherwise follow the Tenant's Remove). It goes to a confirmation step, as removing a Tenant does, saying what happens: "Nina's Plumbing won't be offered for new Jobs. Their past Quotes and ratings stay on the Tickets they belong to." Confirming posts to `/tradies/:id/remove`.
- **Refused while they have work in progress:** an open Quote Request, a Quote waiting on a decision, or a visit booked today or later. The reason names it ("Nina's Plumbing has a visit booked on Thursday at 9 am. Cancel or finish it first."), shown on the profile the way a refused Tenant removal is.
- **What a removed Tradie no longer appears in:**
  - the Tradies list (`/tradies`)
  - Dispatch's Tradie entries and map pins
  - Quote recommendations and the Ask for Quotes list
  - the Nominated Tradies picker
  - Free today on the schedule
  - the spreadsheet import's matching

  Also take them out of every Property's Nominated Tradies. Use one query helper, or a single `removed_at IS NULL` place in `profiles`, rather than a condition copied into every list. Read how each list gets its Tradies first.
- **Their profile page** still opens from old links. It says "Removed from the Agency on 23 October 2026" and has no Remove button.
- **Their mobile and email** stop being matched for new inbound messages. A text from them goes to the inbox as unknown, not to a removed Tradie.
- **After removing:** to `/tradies` with "Nina's Plumbing removed".

## Acceptance criteria

- [x] Action tests:
  - removing sets `removed_at`, and the Tradie disappears from the lists, recommendations, Dispatch and Nominated Tradies
  - past Quotes and ratings still show them
  - refused with an open Quote Request, and refused with an upcoming visit, each with the reason
  - another Agency's Tradie is not found
  - an inbound message from a removed Tradie's mobile isn't matched to them
- [x] Page tests:
  - the Remove button and the confirmation step
  - confirming redirects with the flash
  - a refusal shows the reason on the profile
  - a removed Tradie's profile shows "Removed from the Agency on …" and no Remove button
- [x] The migration only adds a column, and `npm run check`'s migration tests pass.
- [x] `docs/design-system.md` and `CONTEXT.md` (if it defines Tradie lifecycle words) are updated.
- [x] `npm run check` passes.
