# B1. The Tradie offers times, and the Tenant picks (core)

Status: resolved
Spec: ../spec.md

## What to build
- **Data:** a new table `visit_offers`, added in an additive migration:
  - `id`, `agency_id`, `job_id`, `ticket_id`, `tradie_id`
  - `round` (1, 2, …)
  - `starts jsonb` (2–3 ISO times) and `duration_minutes`
  - `status` (`offered` / `picked` / `none_fit` / `superseded`)
  - `picked_start`, `tenant_note`
  - `token` (`newToken()`, `src/shared.ts:70`)
  - `created_at`, `answered_at`
- **Trigger:** when a quote becomes `approved` (`approveQuote`, `src/quotes.ts` ~:243), myEST8 asks the chosen Tradie to offer times. This replaces "wait for the Property Manager to book". A new template `tradie.offer_times` links to their existing `/q/:token` page (`src/web/pages/quote-form.ts`).
- **The Tradie's page** gets an "Offer visit times" form:
  - up to 3 start date-times, pre-filled from the Firm Quote's `availableDates`/`proposedTime`
  - the length, from `durationDays`, or 2 hours for an Estimate
  - the Tenant's usual availability shown beside it
  - each time checked with `isFree` (`src/scheduling.ts`)
- **The Tenant's email:** a new template `tenant.choose_visit_time`. Each time is its own line, `<time label>: <link>`, plus "None of these work: <link>".
  - **Renderer change** (`src/email-layout.ts`, `paragraphRows`/`BUTTON_LABELS`): a line of the form `<label>: <url>`, with a label of 40 characters or fewer, becomes a button **labelled with that text**. The plain-text email and SMS read the same lines.
- **Picking is safe from mail scanners.** Each link opens `/v/:token?pick=N`, a no-login page in `src/web/tenant-pages.ts` style (`publicPage`, `tenant.css`, a rate limit like `/t/*` in `src/web/server.ts`). The page shows **one POST button**, "Book Tuesday 27 Oct, 9:00 am". A GET never books, because scanners open links.
- **Replying by email still works:** "1", "2", "Tuesday", "none". It's a new `pending_answers` kind, `visit_offer`, with options from the offer, read by the classifier (`src/intake.ts`, `answerOptions`/`handleAnswer`).
- **On a pick:** `sendWorkOrder(..., { start, durationMinutes })` with `visit_confirmed = 1`, because the Tenant chose it.
  - The Tradie gets `tradie.work_order`, and the Owner gets `owner.work_booked`.
  - The Tenant gets a plain "Booked for Tue 27 Oct, 9:00 am" with **no YES needed**, plus a "Need another time?" button.
  - The Ticket shows it.


## Acceptance criteria

- [x] Each behaviour above has a test at an agreed seam that failed first.
- [x] The spec's verification steps for this issue pass.
- [x] `npm run check` passes.
