# Tradies offer visit times, Tenants pick

## Context

2. **Visit scheduling.** Today the Property Manager picks every visit time:
   - `sendWorkOrder`, `src/scheduling.ts:307`, takes `options.start ?? quote.proposedTime`
   - the Firm Quote's `availableDates` and `durationDays` are collected but never used
   - the Tenant only hears about the time after it's fixed, and can only reply YES or a free-text "another time"

   Your "Can I reschedule to Sunday 10 am instead?" was correctly recorded as a Tenant reschedule request, but nobody replied to you, "Sunday 10 am" isn't used, the Tradie isn't asked, and the Property Manager has to notice and rebook by hand. You want email buttons, and a flow where the **Tradie offers times and the Tenant picks**. If none fit, **the Tenant says when they're home and the Tradie offers again.**

## The flow

New flow, after a Quote is approved (Owner YES, or within the Max Repair Cost):

```
Quote approved ─▶ Tradie: "Offer 2–3 visit times" (link to their /q/ page)
                     │ offers times (sees the Tenant's usual availability)
                     ▼
Tenant email: [Tue 27 Oct, 9:00 am] [Wed 28 Oct, 1:00 pm] [None of these work]
     │ picks one                              │ none work
     ▼                                        ▼
Work Order booked automatically       Tenant says when they're usually home
Tradie, Owner, Tenant and PM told     (+ a note, e.g. "Sunday 10 am")
                                              ▼
                                      Tradie asked to offer again (sees the note)
Property Manager can book or override at any point (existing Book form).
```


### Non-goals
- Site Inspections stay Property Manager-booked as today.
- No calendar sync, no Tradie app, no SMS links beyond the plain URL.


## Ground rules

- **Test-first, one vertical slice at a time,** at the repo's existing seams only:
  - action and intake tests through `test/support/harness.ts`
  - page tests in `test/web/`
  - renderer unit tests in `test/email-layout.test.ts`
  - at most one browser test per issue in `test/e2e/`

  Expected values come from worked examples. Never weaken an existing test. If an existing test asserted the old Property-Manager-books-first flow and the issue changes it, update it to the new flow and list it in the report.
- **Design:** follow `docs/design-system.md` and update it. Reuse existing helpers:
  - `publicPage`, `tenant.css`
  - `formAction`, `postButton`, `field`
  - `sendWorkOrder`, `isFree`, `acceptTime`
  - `expectAnswer`, `answerOptions`
  - `renderEmail`
- **Pages work without JavaScript,** keyboard reachable, with no sideways scroll at 390 px.
- **Migrations only add.** Name them after the latest in `supabase/migrations/`.
- **No GET request ever changes state** (mail scanners open links).
- `npm run check` passes before an issue is marked resolved.

## Verification


- **Each issue:** test-first at the agreed levels, with `npm run check` green before every PR and CI green before every merge.
  - action/intake tests through `test/support/harness.ts`
  - page tests in `test/web/`
  - renderer unit tests in `test/email-layout.test.ts`
  - one browser test per issue
- **Part A in production:** choose an over-cap quote for an Owner with no email → the refusal with the "Add an email" link, and nothing changed. With an email → the request arrives. Press **Resend approval request** → it arrives again.
- **Part B end-to-end** (browser test, and then a production walkthrough with your shared inbox):
  1. approve a quote → the Tradie gets "Offer visit times"
  2. the Tradie offers 3 times on `/q/`
  3. the Tenant's email shows 3 time buttons plus "None of these work"
  4. open a time button → the confirm page → press Book → a Work Order at that time, and the Tradie and Owner are emailed
  5. repeat with "None of these work" and a note → the Tradie sees the note and offers again
- The renderer test checks that `<label>: <url>` becomes a button labelled `<label>`, and that a GET to `/v/` never books.
