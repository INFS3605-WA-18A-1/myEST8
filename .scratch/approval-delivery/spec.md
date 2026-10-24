# An approval is only asked for when the Owner can be reached, and can be resent

Status: resolved

## Context

Two problems surfaced while testing on production (Ticket #1, 227/9 Rose Valley Way):

1. **Stuck approval.** Approval #1 was recorded as `requested`, and then the Property Owner's email failed: he had no email, and SMS isn't connected. No message ever went out, there's no way to resend, and the Ticket looked like it was waiting on the Owner. I unblocked it by hand by queueing the reminder job, which is how the Owner's YES got recorded. The cause is the same record-before-send bug that #54 fixed for Quote Requests. In `src/quotes.ts`:
   - `approveOrAskOwner` (~:288) commits the approval, along with `quotes`/`jobs` → `awaiting_owner` and the timeline events
   - then `afterDecision` (~:309) sends `owner.approval_request`
   - a throw there skips the reminder and leaves everything committed

## What to build (Part A of the plan)
Branch `approval-delivery`, from `dev`. One Grok agent. Copy the #54 pattern, but **don't** roll back after the fact: undoing an approval would mean reverting the quote, the Job, timeline rows and more. Instead:

1. **Check the Owner can be reached before anything is saved.** In `chooseQuote` (`src/quotes.ts` ~:970) and `proceedOnEstimate` (~:1005), when the cost is over the Max Repair Cost, call `notifications.channelFor(property.ownerId)` inside the transaction, before any write. This is the same check `sendQuoteRequests` does (~:694). An `UndeliverableError` refuses with "Kevin He can't be reached: <reason>." and nothing is committed. The Ticket already shows the "can't be reached … Add an email" note (`unreachedNote`, `src/web/pages/ticket.ts` ~:1353).
2. **If the email itself fails after saving** (Resend refuses, an outage): `afterDecision` catches the error. `UndeliverableError`/`ProviderRefusedError` use `userReason`; anything else is logged with `console.error`.
   - The approval stays: the quote really is with the Owner.
   - The **reminder is scheduled anyway**.
   - The Property Manager sees "Sent to the Property Owner for approval, but the email to Kevin He didn't go: <reason>. Use Resend approval request." This is returned to the routes at `ticket.ts` ~:181 and ~:216, as with `quoteRequestsSent`.
3. **`resendApprovalRequest(approvalId)`** in `src/quotes.ts`, wired in `src/app.ts`.
   - Open approvals only (`OPEN_APPROVAL`, ~:81); anything else is refused ("already answered").
   - It re-sends the full `owner.approval_request` (build its data in one helper shared with `afterDecision`), logs it, and leaves the status alone.
   - It schedules `quotes.owner_reminder` if none is pending.
4. **A "Resend approval request" button** in `approvalSection` (`ticket.ts` ~:1380), with a `POST /tickets/:id/approvals/:approvalId/resend` route. It's a small secondary `postButton` like `resendButton` (~:1091). The flash says "Approval request resent to Kevin He".
5. **Tests**, reusing `failSendsTo` (`test/quotes.test.ts:9`) and the #54 tests:
   - in `test/approval.test.ts`: an unreachable Owner refuses and commits nothing (quote still `open`, job `quoting`, no approval row); a provider failure keeps the approval, schedules the reminder and returns the warning; Resend re-sends with the full data and the same status, refuses an answered approval, and doesn't find another Agency's approval
   - in `test/web/ticket.test.ts`: the button and the two flashes
6. **Release:** PR → `dev` (merge when green) → release PR → `master` (I merge when green) → watch `deploy-prod` and `smoke`.


## Ground rules

Test-first in vertical slices (one failing test, the least code to pass, repeat), at the repo's existing seams only: action tests through `test/support/harness.ts`, page tests in `test/web/`. Expected values from worked examples; never weaken an existing test. Match the surrounding code's style, comment density and naming. `npm run check` passes before the spec is marked resolved. Ignore step 6 (release): Claude Code does that.
