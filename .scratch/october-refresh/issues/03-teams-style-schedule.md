# A Teams-style schedule

Status: resolved
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

## Design plan

Checked against `docs/design-system.md`. The Schedule keeps this app's palette and type. It does not take Microsoft's blue, Segoe, or all-caps hour labels: the gutter stays "8 am", the same sentence case as "9:00 am" everywhere else (the design system forbids all-caps).

### Colour

- **Harbour** (`--action`): today's date circle, with a white numeral; the selected Day/Week/Month and Mine/All; a plain visit's 4px left edge (the block is a link, and Harbour means act). A Site inspection keeps that edge and adds a Harbour-on-`--info-bg` marker, the info pair `visitKind` already uses.
- **Wattle** (`--hivis`): the 4px left edge only, when a reschedule waits on this Property Manager (`is-decision`). Never text, never a button, never a wash.
- **Ochre** (`--high`): the left edge of someone else's reschedule (`is-reschedule`).
- **Done** (`--done`): the left edge of a finished visit (`is-done`), with the words still there. Colour is never the only signal.
- **Rust** (`--urgent`): the current-time line and the dot in the gutter. The only red.
- **Sand** (`--page`, called Paper in the design system): weekend columns, and the tray behind the grid.
- **`--info-bg`**: today's column, a light Harbour tint. Visit blocks stay white (`--surface`) on it.
- **Slate** (`--muted`): the weekday, the hour labels, the Tradie's name.
- **Line** (`--line`): the hour rules. Half-hour rules are the same line at lower opacity, so they read as fainter. No new token.

A visit with no flag (confirmed, or not confirmed yet) takes the Harbour edge; "Not confirmed yet" stays in words, because `bookingFlags` gives that state no colour of its own.

### Type

- Period title: Bricolage 20px, weight 600, Night. "12 – 18 October 2026", "Thursday 8 October", "October 2026".
- Weekday: Public Sans 12px, weight 500, Slate.
- Date numeral: Bricolage 20px, weight 600, tabular (`num`). Today: white on a 32px Harbour circle.
- Hour gutter: Public Sans 12px, Slate, tabular, right-aligned just under the hour line.
- Visit: Public Sans. Time and issue 600, Night; Tradie 400, Slate. An hour or less is one line: the start time and as much of the issue as fits. The full time, the Tradie and how the visit stands stay in the link's accessible name.

### Wireframe (Week, from 768px)

```
Schedule                                      Sun 18 Oct   Alice
[Today]  <  >   12 – 18 October 2026     [Day|Week|Month] [Mine|All]
1 visit booked

        Mon    Tue    Wed    Thu     Fri    Sat    Sun
        12     13     14    (15)     16     17     18     <- circle on today
 7 am  ─────────────────────────────────────────────
 8 am  - - - - - - - - - - - - - - - - - - - - - - - -    <- fainter
 9 am  ┌────────────┐            ·━━━━━━━━━━━━━━━        <- Rust, today only
       │ 9:00–11:00 │            (column tinted)
       │ Kitchen tap│            Sat–Sun on Paper
       │ Pete's Pl. │
       └────────────┘
```

The grid is a window on the working day. It opens scrolled to an hour before the first visit, or to 7 am, and scrolls inside its frame. The page does not scroll sideways.

### Alignment

- Toolbar: one row, items centred on the same line. Today (outlined), then the two icon buttons, then the period. The view switch and Mine/All sit on the right, with Share after them. Under 768px the switch and filter drop to a second row.
- Day headings: centred in the column. The weekday sits above the numeral. Every numeral occupies the same 32px box, so the seven dates share one line.
- Hour labels: right-aligned in the 3.5rem gutter, just under the hour rule, so the hour above does not show through the stuck day headings. Half-hour rules have no label.
- Visit blocks: 4px in from the column, 4px radius, 4px left edge, text left-aligned.

### What makes it a Teams-style calendar

The period is a title beside the arrows, not a sentence under the page name. Each day is a column headed by a small weekday and a large date; today is a filled circle and a tinted column. Time runs down a gutter, hour rules stronger than half-hours, and a red line marks now. Visits are compact rounded blocks with a coloured edge, not full cards. Overlaps stay as they are: the Week folds them into "N Jobs booked", the Day puts them in lanes.

## Acceptance criteria

- [x] Page tests (`test/web/`):
  - the toolbar's Today link, Previous and Next (with accessible names) and the period title, for each view
  - today's column and date are marked (`aria-current="date"`)
  - the current-time line is present on today and absent on other weeks
  - each visit block's accessible name has its time, issue and Tradie
  - every existing calendar test still passes, or is updated only where the markup it checked changed, never weakened
- [x] Browser test at 1366 px: the Week grid is visible with the toolbar on one row, and pressing Next then Today returns to this week. At 390 px: no sideways page scroll.
- [x] `docs/design-system.md`'s Schedule section describes the new look.
- [x] `npm run check` passes.
