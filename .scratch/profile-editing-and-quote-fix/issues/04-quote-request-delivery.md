# A Quote Request is "sent" only once its message went out, and can be resent

Status: ready-for-agent
Spec: ../spec.md

## What's wrong

In production (2026-10-23 11:40:30 UTC), Asking for Quotes for Job 1 recorded Quote Requests #1 (Sydney Inline Plumbing) and #2 (Proximity Plumbing, `kevin.he3@student.unsw.edu.au`) as `sent`. Then the first message failed, and no message went to either Tradie. Two problems remain after issue 01:

1. **`sendQuoteRequests` records first and sends after** (`src/quotes.ts`: the requests are inserted with `status 'sent'` in a transaction, and `notifications.send` runs after it commits). If a send fails (the provider refuses, Resend is briefly down, a network error), the request still says `sent` with no message behind it. Asking that Tradie again is then refused: "has already been asked to quote". The Job is stuck, and the Property Manager can't tell why the Tradie never replied.
2. **No way to resend** a Quote Request when a Tradie says it never arrived.

## What to build

- **A failed send leaves no Quote Request.** After the transaction, each Tradie's message is sent in turn. If it throws, that Tradie's just-created Quote Request is deleted (it has nothing attached yet), they're added to `unreached` with a reason, and the others are still sent.
  - For `UndeliverableError` and `ProviderRefusedError`, the reason is their `userReason`.
  - Any other error gives "the message couldn't be sent", and the error is logged with `console.error` (stack included) so it shows in production's logs.

  The page's message names them, as issue 01 does. If every send fails, the result is the same refusal as "none reachable": nothing recorded.
- **Resend.** A new action, `resendQuoteRequest(quoteRequestId)`, scoped to the Agency.
  - It only works on a request still waiting on an Estimate (`sent` or `reminded`), sends the same Quote Request message again with the same link, logs it like any message, and leaves the status as it is.
  - It's refused otherwise ("Nina's Plumbing has already replied").
  - If the send fails, it's an error flash naming the reason (formAction already handles `UndeliverableError`/`ProviderRefusedError`).
- **On the Ticket page,** wherever a Quote Request still waiting on an Estimate is listed with "No reply yet" / "No reply after a reminder" (`NO_REPLY` in `src/quotes.ts` and the Ticket page), add a small **Resend** button: a POST form with its own route on the Ticket page, using the design system's small secondary button. After it, "Quote Request resent to Proximity Plumbing".
- `docs/design-system.md` mentions Resend where the Quote Request statuses are described.

## Acceptance criteria

- [ ] Quote tests:
  - one Tradie's send throws a provider error: their Quote Request isn't recorded, the other's is recorded and sent, and the result names the failed one with the reason
  - every send throws: nothing recorded, and a refusal
  - an unexpected error is logged and the Tradie reported, not a 500
  - after a failed send, the same Tradie can be asked again without "already been asked"
- [ ] Resend tests:
  - a `sent` request is sent again with the same link (token) and logged, and its status is unchanged
  - a request that has an Estimate is refused
  - another Agency's request is not found
- [ ] A page test: Resend on the Ticket page redirects with "Quote Request resent to …", and the message went out.
- [ ] `npm run check` passes.
