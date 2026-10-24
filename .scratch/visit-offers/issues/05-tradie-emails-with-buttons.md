# Buttons and a clearer layout on every email to a Tradie

Status: ready-for-agent
Blocked by: 04
Spec: ../spec.md

## Why

Emails to Tradies are one or two run-on sentences. Actions are either "Reply DONE", "Reply NO" or "reply with a ballpark price", or a bare link the renderer labels "Open link". After issues 01–04 the Tenant's visit emails have proper buttons; the Tradie's should too, with the job's details laid out so a Tradie can read them at a glance on a phone.

## What to build

### 1. A details block in the renderer
In `src/email-layout.ts`, a run of two or more consecutive lines of the form `<Label>: <value>`, where the value is not a URL and the label is 24 characters or fewer, renders as a compact two-column details table: label in Slate, value in Night, on the white card. Plain-text email and SMS keep the lines as they are.
- This must not clash with the `<label>: <url>` button lines from issues 01–02: a URL value is still a button.
- Worked examples go in `test/email-layout.test.ts`.

### 2. Every `tradie.*` template in `src/templates.ts`
Each uses a short opening sentence, then a details block, then buttons. Primary buttons are filled Harbour. "Can't take this job", "Need another time?" and "None of these work" are outlined, a renderer rule decided by the label as in issue 04.

| Template(s) | Details | Buttons |
|---|---|---|
| `tradie.quote_request`, `tradie.quote_reminder` | Trade, Suburb, Urgency, Issue (the Tenant's words, already untrusted data) | **Give your quote** → `/q/:token`; **Can't take this job** (outlined) → a decline confirm page `/q/:token/decline` (GET shows one POST "Decline this job"; the POST does what replying NO does today) |
| `tradie.offer_times`, `tradie.offer_times_again` | Address, Length, Tenant usually home, Tenant's note (when given) | **Offer visit times** → `/q/:token` |
| `tradie.work_order` | Address, When, Length, Tenant, Tenant contact | **View job** → `/q/:token`; **Mark job done** → a confirm page (POST does what replying DONE does today); **Need another time?** (outlined) → starts a new offer round (issue 03) |
| `tradie.visit_moved` | Address, Was, Now | **View job**; **Need another time?** (outlined) |
| `tradie.inspection` | Address, When, Tenant contact | **View inspection** → `/q/:token`; **Mark inspection done** → confirm page (POST = replying DONE today); **Need another time?** (outlined) |
| `tradie.firm_quote_request`, `tradie.firm_quote_reminder`, `tradie.firm_quote_link` | Address, Inspected on, What's needed | **Give your Firm Quote** → `/q/:token` |
| `tradie.not_chosen`, `tradie.done_too_early` | Short paragraphs only, no buttons | — |

**Rules for the buttons and pages:**
- Every link uses the Quote Request's existing token (`/q/:token`). Add routes beside the existing quote-page routes in `src/web/pages/quote-form.ts`.
- **No GET changes state.** Every action is a one-button POST page in the `publicPage` / `tenant.css` style.
- Each action page shows the current state if it's already done, for example "Already marked done on Mon 26 Oct".
- Replying by email (DONE, NO, a price, another time) still works exactly as before.

### 3. Docs
`docs/design-system.md`'s Emails section gets the details block and the list of button labels, with which are outlined.

## Acceptance criteria

- [ ] Renderer tests:
  - a details block from `Label: value` lines
  - a URL value still a button
  - "Can't take this job" and "Need another time?" outlined
- [ ] Template and action tests:
  - each `tradie.*` template's text has the details lines and links listed above
  - the decline POST does what replying NO does
  - Mark done does what replying DONE does
  - Need another time starts an offer round
  - GETs change nothing
  - an already-done job shows its state
- [ ] One browser test: a Work Order email's View job, Mark job done and Need another time? reach their pages, and Mark job done records completion.
- [ ] Screenshots of the quote request, Work Order and inspection emails at 600 px and 375 px, reviewed.
- [ ] `npm run check` passes.
