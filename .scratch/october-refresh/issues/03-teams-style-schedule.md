# A Teams-style schedule

Status: ready-for-agent
Branch: schedule-teams-calendar
Spec: ../spec.md

## What's wrong now

`/calendar` (`src/web/pages/calendar.ts`, with `src/web/schedule-layout.ts` placing visits; see `docs/design-system.md`, Schedule) already has Day, Week and Month with an hour grid. It doesn't read like the calendar Property Managers use all day in Microsoft Teams or Outlook: the header, the day headings, the visit blocks and the sense of "now" are weak.

## What to build

Restyle the calendar in the Teams/Outlook calendar idiom, within this app's design system. Keep its colours and type; don't copy Microsoft's.

**Toolbar.** One row:
- **Today** (outlined), then the previous and next arrows (icon buttons with accessible names), then the period as the title ("20 – 26 October 2026", "Thursday 23 October", "October 2026")
- on the right, the Day / Week / Month switch and the Mine / All filter
- on phones it wraps to two rows

**Week and Day grid.**
- **Day headings** in each column: the weekday small, the date large. Today's date sits in a filled Harbour circle, and its column is lightly tinted. Weekend columns sit on Paper.
- **Hour gutter**: times on the left ("8 AM"), aligned to the hour lines, with half-hour lines fainter than hour lines.
- **Now.** A thin red current-time line across today's column, with a dot at the gutter. It is placed by the server from the Agency's time zone, so it works without JavaScript; `app.js` may move it each minute. It doesn't animate under `prefers-reduced-motion`.
- **Visit blocks.** Rounded blocks with a 3–4 px coloured left edge, the time and the issue in bold, then the Tradie. The colour shows how the visit stands, using the colours `bookingFlags`/`visitKind` already give, plus a Site inspection marker. Short visits show one line, truncated with the full text in the accessible name.
- **The grid** opens scrolled to about an hour before the first visit or 7 am, so working hours are in view. That's a server-set anchor or `scrollTop` set by `app.js`, and the page never scrolls sideways.
- **Overlapping visits** keep today's rules (Week folds them into "N Jobs booked", Day puts them in lanes), restyled to match.

**Month.** Same toolbar. Today's date is in a Harbour circle, and visits are shown as small coloured-edge pills.

**Keep:** every URL and query parameter (`view`, `date`, `filter`, the older `week`), the text equivalent (each visit a list item naming its time, issue and Tradie), the list of days under 768 px (restyled to match), and everything `schedule-layout.ts` computes.

Before building, write a short design plan (tokens and an ASCII wireframe of the Week view) into this issue under `## Design plan`, and check it against the design system. Then build it. Screenshot Week, Day and Month at 1366 px and Week at 390 px, and fix what looks off.

## Acceptance criteria

- [ ] Page tests (`test/web/`):
  - the toolbar's Today link, Previous and Next (with accessible names) and the period title, for each view
  - today's column and date are marked (`aria-current="date"`)
  - the current-time line is present on today and absent on other weeks
  - each visit block's accessible name has its time, issue and Tradie
  - every existing calendar test still passes, or is updated only where the markup it checked changed, never weakened
- [ ] Browser test at 1366 px: the Week grid is visible with the toolbar on one row, and pressing Next then Today returns to this week. At 390 px: no sideways page scroll.
- [ ] `docs/design-system.md`'s Schedule section describes the new look.
- [ ] `npm run check` passes.
