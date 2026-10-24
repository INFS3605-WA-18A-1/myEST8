# B2. When none of the times work

Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md

## What to build
- The `/v/` page's "None of these work" asks "When are you usually home?" with the four `AVAILABILITY` options (saved with `profiles.setAvailability`) and an optional note ("Sunday 10 am works").
- The offer becomes `none_fit`. The Tradie gets `tradie.offer_times_again` with the Tenant's note and availability, and a new round starts.
- The Ticket shows "The Tenant asked for other times".


## Acceptance criteria

- [ ] Each behaviour above has a test at an agreed seam that failed first.
- [ ] The spec's verification steps for this issue pass.
- [ ] `npm run check` passes.
