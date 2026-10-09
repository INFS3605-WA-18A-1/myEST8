# myEST8 design system: the dispatch desk

myEST8 is where a Property Manager at a small Sydney Agency sees every repair that needs a decision and moves it one step on. They work on a 1366–1440 px laptop at the desk and on a phone between inspections. The design borrows from the world the repairs happen in: work-order dockets, a trade dispatch board, the Colorbond steel colours on Sydney roofs, and hi-vis yellow for the one thing that needs you now.

## Plan review

The first draft was a white SaaS kit: identical rounded cards with soft grey shadows, a big number with a small label in each stat card, and an all-caps eyebrow above sections. That fits any product. What changed and why:

- **Cards became dockets and rows.** Only a Ticket gets the docket shape, because a Ticket is a work order. Everything else is a plain row or a section with a hairline, so shape now encodes what a thing is.
- **Stat cards became a single count strip.** The counts are links into the queues, not decoration, and they cost 36 px instead of 100 px.
- **The accent became hi-vis yellow** (`--hivis`), used only for "needs your decision". It never appears as a decorative wash or on a button.
- **No shadows except on menus and dialogs.** Hierarchy comes from borders, spacing and weight.

## Colour

Named after Colorbond steel colours, so the palette belongs to this subject. Every pair below was measured; text pairs meet WCAG AA.

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--ink` (Monument) | `#323233` | Body text, the left rail | 12.8:1 on white |
| `--page` (Surfmist, tinted) | `#F1F0EA` | App background behind surfaces | ink 11.2:1 |
| `--surface` | `#FFFFFF` | Sections, rows, dockets, inputs | |
| `--muted` (Basalt) | `#6B6A66` | Secondary text, timestamps, hints | 5.4:1 on white, 4.7:1 on page |
| `--line` (Shale) | `#DEDCD4` | Hairlines and section borders (decorative) | |
| `--control` | `#8E8D88` | Input, select and checkbox borders | 3.3:1 on white (UI component minimum) |
| `--action` (Deep Ocean) | `#2D3B4E` | Primary buttons, links, focus ring, selected state | 11.4:1 both ways with white |
| `--hivis` | `#FFD100` | "Needs your decision" stripe, active nav bar, count chips for decisions | ink on it 8.8:1 |
| `--urgent` | `#B42318` on `--urgent-bg` `#FDECEA` | Urgent, errors, destructive actions | 6.6:1 / 5.8:1 |
| `--high` | `#9A4A0B` on `--high-bg` `#FDF1E3` | High Urgency, warnings, flags | 6.3:1 / 5.6:1 |
| `--done` (Cottage Green) | `#2F5A3E` on `--done-bg` `#E8F1EA` | Done, approved, confirmed | 7.9:1 / 6.9:1 |
| `--rail-text` | `#E8E6DE` on ink | Left rail text | 10.3:1 |
| `--rail-muted` | `#A8A7A2` on ink | Left rail counts and secondary text | 5.3:1 |

Routine Urgency is not coloured: it uses `--muted` text with a `--line` border. Colour is never the only signal; every badge carries its word.

## Type

- **Barlow Semi Condensed** (500, 600, 700): page titles, section headings, the logotype, docket numbers, table headers, nav items, buttons. Its signage roots suit a dispatch board, and the narrow width fits more in dense layouts.
- **Barlow** (400, 500, 600): everything else.
- Both are self-hosted from `@fontsource` and served from `/assets/fonts/`, so the demo works offline. Fallback: `system-ui, sans-serif`.
- Scale (px): 12 (meta), 13 (dense tables, badges), 14 (body), 16 (lead, section headings), 20 (page title), 26 (docket number on the Ticket page), 40 (landing headline only). Line height 1.45 for body, 1.2 for headings.
- `font-variant-numeric: tabular-nums` on money, times, counts and docket numbers.
- Sentence case everywhere. No all-caps labels and no letter-spaced eyebrows. Don't emphasise a single word in a headline. Don't join meta with middle dots: put meta in separate elements with a gap. Don't append arrows to link or button text.
- Keep text measure under 80 characters (`max-width: 72ch` on prose).

## Shape, space and elevation

- Spacing scale (px): 4, 8, 12, 16, 24, 32. Section gap 16 on the dashboard, 24 elsewhere.
- Radius: 4 px for dockets, badges and inputs; 6 px for buttons; 8 px for sections. Never fully round, except avatars and count chips.
- Borders: 1 px `--line` around sections and between rows. No zebra striping.
- Shadow only on menus, dialogs and the phone frame in the simulator: `0 8px 24px rgb(50 50 51 / 0.18)`.
- Focus: `outline: 2px solid var(--action); outline-offset: 2px` on every interactive element. Never removed.
- Motion: only in response to an action (open a menu, expand a `<details>`, 150 ms ease-out), and none at all under `prefers-reduced-motion: reduce`. No entrance animations.

## Layout

### App shell (`page()`)

```
┌───────────┬──────────────────────────────────────────────────────────────┐
│ myEST8    │ Dashboard            [Mine | All]          Thu 9 Oct   Alice ▾│ 56px top bar
│           ├──────────────────────────────────────────────────────────────┤
│▌Dashboard │                                                              │
│ Calendar  │   page content (max-width 1280px, 24px gutters, 16 on phone) │
│ Setup   3 │                                                              │
│ Simulator │                                                              │
│           │                                                              │
│ Harbour   │                                                              │
│ Realty    │                                                              │
└───────────┴──────────────────────────────────────────────────────────────┘
 220px rail (ink)
```

- Left rail 220 px, `--ink` background, logotype at the top, nav items 40 px tall with an icon (inline SVG, 18 px, stroke 1.75) and an optional count. The active item gets a 4 px `--hivis` bar on its left edge and `--surface` text. The Agency name sits at the bottom of the rail.
- Top bar 56 px on `--surface` with a bottom hairline. It holds the page title (20 px semi-condensed 600), optional page controls passed by the page (the Mine/All segmented control on the dashboard), today's date in the Agency's time zone, and the Property Manager's name opening a menu with Sign out.
- Under 1024 px the rail becomes an off-canvas drawer opened by a menu button in the top bar. Content is single-column with 16 px gutters and never scrolls horizontally.
- Flash messages appear directly under the top bar as one line: `--done` for ok, `--urgent` for errors, `role="status"` or `role="alert"`.

### Dashboard: the dispatch board

The first frame at 1366×768 must show the decision queue, the Ticket pipeline and this week's bookings without scrolling.

```
┌ count strip: 4 Maintenance Requests to review   9 open Tickets   3 alerts   4 in the inbox   2 Urgent Repairs ┐  36px
├────────────────────────────┬─────────────────────────────────────────────────────────────────────────────┤
│ Needs your decision        │ Tickets by stage                                                            │
│▌[photo] 7 Wilson St        │ Quoting (3)        With Property Owner (1)   Ready to book (1)   Booked (3)  Done (1) │
│  Toilet keeps running      │ ┌#12┊docket┐       ┌#9┊docket┐               ┌#7┊docket┐          ...        │
│  High  Plumbing  2d   Review│ └──────────┘       └─────────┘               └─────────┘                     │
│▌Owner hasn't replied 52h   │                                                                             │
│▌Rate Drip Doctors          ├─────────────────────────────────────────────────────────────────────────────┤
│▌Inbox: unknown sender      │ This week   Mon  Tue  Wed  Thu  Fri  Sat   (bookings as small blocks)     │
└────────────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
 below the fold: Urgent Repairs table, Inbox detail with link/route/dismiss, all open Tickets table
```

- Left column (360 px) "Needs your decision": one list of compact rows, each with a 4 px `--hivis` left stripe. Order: Maintenance Requests (oldest first), then alerts, then inbox items. A Maintenance Request row: 56 px photo thumbnail (or a "No photos" tile), address, one-line description, Urgency and Trade badges plus "Check urgency", "Flagged photos" or "No photos" flags, age, and two actions: **Confirm** (POST) and **Review** (link to `/requests/:issueId`).
- Right column, top: "Tickets by stage", five lanes in workflow order: Quoting, With Property Owner, Ready to book, Booked, Done. A Ticket sits in the lane of its least advanced open Job. Lanes scroll vertically inside a fixed height (about 300 px) so the board never pushes the calendar off the first frame.
- Right column, bottom: "This week", a seven-day strip of bookings for both Property Managers, linking to `/calendar`.
- Phone: one column in priority order: count strip (wrapping), Needs your decision, Tickets as a list grouped by stage, This week.

### The docket (Tickets only)

```
┌────┬┄┬──────────────────────────────┐
│#12 │┊│ 7 Wilson St, Newtown          │
│    │┊│ Toilet keeps running          │
│High│┊│ Plumbing   3 Quotes   2d   ●  │
└────┴┄┴──────────────────────────────┘
```

- White surface, 1 px `--line` border, radius 4 px.
- A 48 px stub on the left holds the Ticket number (semi-condensed 700, tabular) and the Urgency word. Stub fill: `--urgent-bg`, `--high-bg`, or `--page` for Routine, with matching text colour.
- A dashed 1 px `--control` line between stub and body suggests the perforation of a docket book. This is the memorable element: use it only for Tickets, on the dashboard board and as the Ticket page header.
- Body: address (13 px 600), issue (13 px, one line, ellipsis), meta row (12 px `--muted`): Trade, Job progress, age, and an unread dot in `--action` with visually hidden text "unread messages".

## Components

- **Buttons:**
  - Primary: `--action` fill, white text, 6 px radius, 32 px tall (36 px on phone).
  - Secondary: surface fill with a 1 px `--control` border and ink text.
  - Ghost: text only.
  - Danger: `--urgent` text on surface, red border on hover.
  - Labels are verbs that say what happens: "Confirm", "Send Quote Requests", "Send Work Order".
- **Badges:** 13 px, 2 px 6 px padding, 3 px radius, tinted backgrounds from the table above, word always present. Trade badges use `--page` fill with ink text.
- **Count chips:** for decisions, a pill with `--hivis` fill and ink text; otherwise `--page` fill with muted text.
- **Tables:** 13 px, 36 px rows, headers in semi-condensed 600 `--muted`, hairlines between rows, horizontal scroll only inside a wrapper.
- **Forms:**
  - Label above the control (13 px 500).
  - Controls 36 px tall with a `--control` border and 4 px radius.
  - Hint 12 px `--muted`; field error 12 px `--urgent` with `aria-describedby`.
  - Placeholders `--muted` and italic so they never look filled in.
  - Two-column field grids at 768 px and up.
- **Sections:** surface, 1 px `--line` border, 8 px radius, 16 px padding, heading 16 px semi-condensed 600 with optional actions on the right.
- **Steps** (sequences only: the Ticket's Job progress, the Tenant tracker, the setup guide): numbered circles 24 px. Done is `--done` with a tick; current is `--action`; to come is `--line`.
- **Chat** (simulator and message logs):
  - myEST8's messages on the left on `--page`; the person's on the right on `--action` with white text.
  - The channel is a small badge, the time is muted, and text keeps its line breaks.
- **Empty states:** one sentence saying what will appear and the action to take, with no illustration.

## Copy

- Use `CONTEXT.md` terms exactly: Property Manager, Tenant, Tradie, Property Owner, Maintenance Request, Ticket, Job, Quote, Quote Request, Work Order, Urgency, Urgent Repair, Repair Cost, Max Repair Cost, Building Manager, Common Area, Trade.
- Plain verbs, sentence case, no filler. An action keeps its name through the flow: a "Send Work Order" button produces "Work Order sent".
- Errors say what happened and how to fix it. Empty states invite the next action.
