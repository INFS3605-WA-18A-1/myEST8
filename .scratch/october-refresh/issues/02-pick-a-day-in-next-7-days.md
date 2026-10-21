# Pick a day in Next 7 days

Status: resolved
Branch: dashboard-week-and-kpis
Blocked by: 01 (same file, done first)
Spec: ../spec.md

## What's wrong now

Next 7 days (`nextSevenDays` in `src/web/pages/dashboard.ts`) shows seven day chips, which can't be pressed, above one list of every visit in the week. You can't ask "who's on site Thursday?" without reading the whole list.

## What to build

- Each day chip is a link: `/?day=YYYY-MM-DD#next-7-days`, or whatever the dashboard's path is. Chips work without JavaScript, and the page keeps its other state.
- The chosen day (today by default, or with no valid `day` in range) is marked `aria-current="date"` and filled. Today keeps a distinct mark when it isn't the chosen day.
- Under the strip, only the chosen day's visits, in time order. For each visit:
  - the time
  - the Tradie (business name, linked to their profile)
  - the issue and street (linked to the Ticket)
  - a Site inspection badge when it is one

  Reuse `visitRow` and the existing booking helpers.
- A heading for the list names the day: "Thursday 23 October". With no visits: "Nothing booked on Thursday." plus the Open calendar link to that day (`/calendar?view=day&date=…`).
- A `day` outside today to six days ahead, or one that isn't a date, falls back to today. It is never an error.
- Optional enhancement in `app.js`: switch days without a page reload, keeping the URL in step. Only if it stays small. The links must work alone.

## Acceptance criteria

- [x] Page tests (`test/web/`):
  - each chip links to its day
  - with no `day`, today is current and only today's visits are listed
  - `?day=` a booked day lists only that day's visits, each with the Tradie and the Ticket link
  - an empty day shows "Nothing booked on …" and links to that day's calendar
  - an out-of-range or junk `day` falls back to today
- [x] Browser test: on the demo dashboard, pressing a later chip with a visit shows that visit and not today's, by mouse and by keyboard (Tab, then Enter).
- [x] `docs/design-system.md`'s Next 7 days line is updated.
- [x] `npm run check` passes.
