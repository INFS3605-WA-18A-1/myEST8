# Buttons for the Tenant's rating, the Owner's approval, and Reimbursement paid

Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md

These three emails ask for a typed reply today. Each gets buttons that open a no-login page, a POST to save, and the green confirmed state from issue 01. Typed replies keep working exactly as now (`src/intake.ts`).

| Email | Buttons | Page | The POST does what this does today |
|---|---|---|---|
| `tenant.fixed_properly` | Five, one per score: `1 star` … `5 stars` (the text keeps "Reply with a number from 1 (not at all) to 5 (perfectly)" for SMS) | GET shows the job (Tradie, Trade) with the chosen score and one "Rate N out of 5" button. Afterwards: "✓ Rated N out of 5", with the five scores shown and disabled | `scheduling.recordTenantRating(jobId, score)`, and stops the awaiting `fix_rating` reply, as answering by text does |
| `owner.approval_request`, `owner.approval_reminder` | **Approve**, and **Decline** (outlined, like "Can't take this job") | GET shows the Property, Trade, Tradie, quote price, Repair Cost against Max Repair Cost, and one button for the chosen answer. Afterwards: "✓ Approved" or "✓ Declined", with both buttons disabled | `quotes.recordOwnerAnswer(approvalId, 'yes' / 'no')` |
| `owner.urgent_repair_receipt` | **Mark as paid** | GET shows the Tenant, amount and Property, with one "Mark as paid" button. Afterwards: "✓ Marked paid on <date>", disabled | what the Property Manager's "mark reimbursed" does (`tickets.markUrgentRepairReimbursed`), including telling the Tenant (`tenant.reimbursed`) |

## Rules
- **Tokens:** each link carries an unguessable token, with the same rules as the existing ones (`newToken()` in `src/shared.ts`). The Owner's links must not reuse a Tenant's token, and the Tenant's rating link must not reuse a Tradie's.
  - Add a nullable `token` with a random default via an expand-only migration, as `supabase/migrations/20261024120000_work_order_tokens.sql` does, wherever no fitting token exists.
  - A rating link may reuse the Work Order's Tenant token if that is the Tenant's own.
- **Pages:** follow `src/web/pages/visit-confirm.ts`: `publicPage`, `tenant.css`, `missingLink` for an unknown token. An `ActionError` shows on the page with its status.
- **Choices after the fact:** a score, answer or paid state already recorded, by text or by button, shows confirmed, and its POST is refused with a clear message. A rating can't be changed. An approval that is no longer waiting says so.
- Add the routes in a new `src/web/pages/` file wired like `visitConfirmPages`, with `App` actions in `src/app.ts`.
- `CONTEXT.md`: no new terms are expected. If one is needed, add it.

## Acceptance criteria
- [ ] Template tests: each email's text has the button lines, and the rendered HTML has the buttons (Decline outlined).
- [ ] Action tests: each POST does exactly what the typed reply or the Property Manager's action does. A second POST is refused. GET changes nothing. An unknown token is a 404.
- [ ] Web tests: each page's before and after states, with disabled choices after.
- [ ] One browser test: the Tenant presses 4 stars from the email, confirms, and sees "Rated 4 out of 5". The Ticket shows the rating.
- [ ] `npm run check` passes.
