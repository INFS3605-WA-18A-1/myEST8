# A preferred time, and buttons on every visit email

Status: ready-for-agent
Blocked by: 03
Spec: ../spec.md

## Why

Testing in production (2026-10-24) the Tenant got `tenant.visit_moved` after the Property Manager moved a visit from the Ticket: "Your visit from Proximity Plumbing has moved to Mon, 26 Oct, 8:00 am. Reply YES to confirm or tell us if you need another time." It had no buttons, because the template has no link. Issues 01–03 give the Tradie-offers flow buttons, but every path where the Property Manager books or moves a visit still sends plain "Reply YES" text. The Property Manager also asked that the Tradie mark one offered time as their **preferred** time.

## What to build

1. **Preferred time.** The Tradie's "Offer visit times" form (`/q/:token`) asks for a **preferred time** (required) and **up to 2 more** (optional), instead of up to 3 equal times.
   - Store which one is preferred on the offer: an additive column, or the first of `starts`, documented.
   - The Tenant's `tenant.choose_visit_time` email shows the preferred time first, as its own button with "Tradie's preferred time" written under or beside it. The others follow, then the outlined **None of these work**. Picking any of them works the same.
   - The `/v/` confirm page for the preferred time says "the Tradie's preferred time".
   - SMS text lists the preferred one first, marked "(preferred)".
   - Re-offer rounds (issue 02) ask for a preferred time too.
2. **Buttons on every visit email to a Tenant.** Every template that tells a Tenant about a booked or moved visit gets two buttons instead of "Reply YES …". That covers `tenant.visit_time`, `tenant.visit_moved`, the Property Manager-booked and Property Manager-moved paths in `src/scheduling.ts` (`sendWorkOrder` when the Property Manager books, `acceptTime`, any move), and `tenant.inspection` for Site Inspections.
   - **Confirm this time**: a primary button linking to a no-login page (`/v/…` style, or a work-order token page: add an additive token column on `work_orders` if needed). The page shows the visit and one **POST** button, "Confirm Monday 26 Oct, 8:00 am". Confirming records `recordVisitConfirmation`, stops waiting for a YES, and shows "Confirmed".
   - **Need another time?**: an outlined button, starting a new round of Tradie offers (issue 03's reschedule), or the existing Site Inspection reschedule for inspections.
   - The plain text stays readable, and **replying YES or asking for another time by email still works** as before (the `visit` answer kind).
   - An already-confirmed or moved visit's link shows its current state instead of a stale button.
3. **Resend a visit's emails.** The Ticket's visit section (Work Order and Site Inspection) gets two small secondary buttons, **Resend to Tenant** and **Resend to Tradie**, like the Quote Request **Resend** from #54.
   - Each POST schedules a worker task, `scheduling.resend_visit_emails` with `{ workOrderId, to: 'tenant' | 'tradie' }`, and flashes "Visit email queued for <name>". The task re-sends the **current** email for that visit with today's templates, and is logged like any message:
     - the Tenant's visit email with Confirm and Need another time
     - or the Tradie's Work Order or inspection email
   - The task does nothing for a cancelled or completed visit.
   - The task exists so the same resend can be triggered by queueing a `tasks` row and running the worker, without a Property Manager session.
4. **Renderer:** reuse the `<label>: <url>` button lines and the outlined style from issues 01–02. Add a rule so "Need another time?" is outlined like "None of these work", decided by the renderer and not hard-coded per template. No GET changes state.

## Acceptance criteria

- [ ] Action tests:
  - an offer stores the preferred time
  - the Tenant's choose-time email lists the preferred first with its note
  - a Property Manager-booked visit and a Property Manager-moved visit each email the Tenant with the Confirm and Need another time links
  - confirming through the page records the confirmation and stops the YES wait
  - Need another time starts a new offer round
  - replying YES still confirms
- [ ] Resend tests:
  - the `scheduling.resend_visit_emails` task re-sends the current Tenant or Tradie email with the new templates and logs it
  - it does nothing for a cancelled or completed visit
  - the Ticket's Resend buttons queue it with the flash
- [ ] Page tests:
  - the Tradie form's preferred field is required
  - the confirm page's GET changes nothing
  - its POST confirms
  - a stale link shows the current state
- [ ] Renderer tests: the preferred note, and "Need another time?" outlined.
- [ ] A browser test: the Property Manager moves a visit from the Ticket, the Tenant's email has both buttons, Confirm leads to the confirm page, and pressing it shows Confirmed on the Ticket.
- [ ] Screenshots of the choose-time email with the preferred time, and of the moved-visit email, at 600 px and 375 px, reviewed.
- [ ] `npm run check` passes.
