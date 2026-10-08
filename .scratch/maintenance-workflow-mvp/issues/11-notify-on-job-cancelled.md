# Tell the Tradie and Tenant when a scheduled Job is cancelled

Status: needs-info

## Goal

When a Property Manager cancels a Job that already has a Work Order, the Tradie and the Tenant should probably be told, so nobody turns up for a cancelled visit.

## What exists

- `src/tickets.ts` `cancelJob` cancels the Job, closes its open Quote Requests (`quotes.jobCancelled`) and frees the calendar slot (`scheduling.jobCancelled`). Nobody is notified.
- The spec's template list has no "visit cancelled" template for Tradies or Tenants.

## Open question

- Should myEST8 send a cancellation message, and to whom (Tradie with a Work Order, Tradies with open Quote Requests, the Tenant, the Property Owner)? The wording needs fixed templates like every other message.

## Acceptance criteria (once decided)

- [ ] New templates in `src/templates.ts`, sent through `src/notifications.ts`.
- [ ] Cancelling a scheduled Job sends them; cancelling a Job still getting Quotes follows the decision for open Quote Requests.

## Testing

- Scenario test at the app boundary: cancel a scheduled Job and assert the messages sent.
