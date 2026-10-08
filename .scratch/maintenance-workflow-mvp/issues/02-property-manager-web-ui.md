# Property Manager web UI: dashboard, Ticket view, Tradie profile

Status: ready-for-agent
Blocked by: 01

## Goal

The pages Property Managers use every day, working at phone width (spec: Dashboard and progress tracker).

## What exists

- `src/views.ts` composes everything the screens show: `dashboard` (Maintenance Requests, Tickets sorted by Urgency then reported time with mine/all, Urgent Repairs, Agency inbox, alerts, 14-day calendar), `ticket` (Jobs with recommendations, Quote Requests, side-by-side Quotes, approval, Work Order, timeline, message log, frequent issues, Repair Cost) and `tradie` (both ratings, every rating, previous Quotes, bookings).
- Every action is on `app.asPropertyManager(id)` in `src/app.ts`: confirm/reject Maintenance Requests, change Urgency, set Trade, add/cancel Jobs, close Ticket, mark read, route/link/dismiss inbox items, send Quote Requests, confirm/edit/choose Quotes, send Work Orders, suggest/accept times, free slots, calendar, rate Tradies.
- Action errors are `ActionError` (`src/shared.ts`) with a message meant for the Property Manager.

## Acceptance criteria

- [ ] Dashboard shows every section above, with "mine"/"all" and the "check urgency" / "check Trade" / "no photos" flags and photo check results.
- [ ] Inbox items show the agent's best guess and route in one click (`routeInboxItem`), link an unknown sender (`linkSender`) or dismiss.
- [ ] Ticket view shows Jobs, recommended Tradies with both ratings side by side and existing bookings, Quotes side by side, approval status, the Work Order, reschedule suggestions, timeline and message log.
- [ ] Choosing a Quote with fewer than two confirmed Quotes asks for a reason.
- [ ] `ActionError` messages are shown inline; other errors show a generic message.
- [ ] Every page works at 360px width with no horizontal scroll and is keyboard and screen-reader usable.

## Testing

- No new scenario tests: the views are already covered at the app-boundary seam. Add a light HTTP test per page (renders for a signed-in Property Manager) and a manual phone-width check.
