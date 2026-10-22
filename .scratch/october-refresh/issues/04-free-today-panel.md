# Free today as a panel, not a dropdown

Status: resolved
Branch: schedule-teams-calendar
Blocked by: 03 (same page, done first)
Spec: ../spec.md

## What's wrong now

The schedule's summary has "Free today (N)" as a bare `<details>` dropdown of names (`summary()` and `freeToday()` in `src/web/pages/calendar.ts`). It is unformatted, hidden by default, and says nothing about what each Tradie does.

## What to build

- **A Free today panel** beside the grid from 1024 px, like the people pane next to a Teams calendar. Under 1024 px it sits above the grid as a row of chips that scrolls sideways inside itself, never the page.
- **One entry per free Tradie**, in the bounded-entry style of Dispatch's Tradie entries (#21):
  - initials in a small circle
  - the business name, linked to their profile
  - their Trades in words
  - their myEST8 rating
- **Order**: by Trade, then by name.
- **Heading**: "Free today" and the count. With none free: "Every Tradie has a visit today." With no Tradies at all: a link to add one.
- **When it shows**: only when today is in the period shown, as now. On another period, nothing, with no empty box.
- Extend `freeToday` to return what the panel needs (id, business name, Trades, rating) from data the page already loads, or one more action call. Keep "free" meaning what it means now.

## Acceptance criteria

- [x] Page tests (`test/web/`):
  - this week shows the panel with each free Tradie's name (linked), Trades and rating, and leaves out a Tradie booked today
  - with everyone booked, "Every Tradie has a visit today."
  - next week shows no panel
- [x] Browser test: at 1366 px the panel sits beside the grid, and at 390 px it is above the grid with no sideways page scroll.
- [x] `docs/design-system.md` describes the panel.
- [x] `npm run check` passes.
