# Asking for Quotes fails with a 500 when the Agency has no SMS channel

Status: ready-for-agent
Spec: ../spec.md

## What's wrong

`POST /dispatch/jobs/1/quote-requests` returned 500 in production (2026-10-23 11:40 UTC):

```
Error: Kevin Estate has no sms channel connected
  at deliver (src/notifications.ts:46)  ← send (:97) ← sendQuoteRequests (src/quotes.ts:641) ← src/web/pages/dispatch.ts:163
```

`route()` in `src/notifications.ts` picks SMS whenever the person has a mobile. It never checks whether the Agency has an SMS channel connected. `deliver()` then throws a plain `Error`, which isn't a refusal the page can show, so it's a 500. Any message to anyone with a mobile fails the same way while SMS isn't connected: a Quote Request, a visit confirmation, an Owner's approval.

## What to build

- **Route only on channels the Agency has.** The order stays the same: the channel they last wrote in on (within the reply window), then SMS, then email. A channel the Agency hasn't connected is skipped: a Tradie with a mobile and an email gets email when SMS isn't connected.
- **When no connected channel reaches the person** (for example only a mobile and no SMS), throw the existing classified `UndeliverableError` from `src/ports.ts`, with a reason a Property Manager can act on: "can't reach Nina's Plumbing: no SMS channel is connected and they have no email address". Not a plain `Error`.
- **`channelFor`** (used to show which channel a message will go by) uses the same rule.
- **`sendQuoteRequests`** sends to every Tradie it can reach, and doesn't stop at the first it can't. If some couldn't be reached, the Property Manager is told which and why. Requests to the others still go out and are recorded. If none could be reached, nothing is recorded and the page says why. Either way, never a 500. Check how the Ticket page's own Quote Request form calls this too, and keep both working.

## Acceptance criteria

- [ ] Notification tests:
  - SMS isn't connected, and a person with a mobile and an email gets email
  - only a mobile and no SMS gives `UndeliverableError` with the reason
  - `channelFor` agrees with what is sent
- [ ] Quote tests:
  - with SMS off, Quote Requests reach the Tradies with email, and the page names any Tradie it couldn't reach, without failing the rest
  - none reachable gives a refusal message, not a 500
- [ ] A page test posting to `/dispatch/jobs/:jobId/quote-requests` with SMS off returns a redirect with the flash, not a 500.
- [ ] `npm run check` passes.
