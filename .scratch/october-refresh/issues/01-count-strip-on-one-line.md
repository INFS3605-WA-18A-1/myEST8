# The dashboard's count strip on one line

Status: resolved
Branch: dashboard-week-and-kpis
Spec: ../spec.md

## What's wrong now

The dashboard's count strip has six counts (Maintenance Requests to confirm, Tickets waiting on you, Open Tickets, Alerts, In the inbox, Urgent Repairs needing a receipt; see `docs/design-system.md`, Dashboard). On a laptop some of them wrap onto a second row or overflow their tile, so the strip reads as a ragged grid rather than one line of numbers.

## What to build

- From 1024 px, all six counts sit on **one row** of equal-width tiles, filling the content width. Labels may wrap inside their own tile, but a tile never overflows and the row never wraps. Shorten a label only if one line of two is impossible at 1024 px, and keep the vocabulary in `docs/design-system.md`.
- From 640 px to 1023 px: three per row, so two even rows.
- Under 640 px: two per row (or stacked, if two don't fit at 390 px without overflow).
- Find the cause in the CSS (`src/web/static/app.css`, the count strip and `stat-tile` rules, and `src/web/pages/dashboard.ts`) rather than adding overrides on top.

## Acceptance criteria

- [x] Browser test (`test/e2e/`), demo dashboard at 1366 px and 1024 px: the six count tiles share one `top` offset, and none has `scrollWidth > clientWidth`. At 390 px the page has no sideways scroll.
- [x] The existing dashboard page tests still pass: the counts, their links and their numbers are unchanged.
- [x] `docs/design-system.md`'s Dashboard section describes the new breakpoints.
- [x] `npm run check` passes.
