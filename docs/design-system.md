# myEST8 design system: the dispatch desk

myEST8 is where a Property Manager at a small Australian Agency sees every repair that needs a decision and moves it one step on. They work on a 1366-1440 px laptop at the desk and on a phone between inspections. The identity is green and gold: gum leaf and wattle, with the tradie's paper docket as the one object. Nothing is decorative; shape and colour carry meaning. The key-tag logo and the Phosphor icons are unchanged.

## What the identity commits to

- **Shape encodes type.** Only a Ticket is a docket. Everything else is a row or a section.
- **Harbour means act.** Primary buttons, links, focus and the selected state are Harbour. Done, approved and confirmed are a deep green (`--done`), never blue, so Harbour always means "act".
- **Wattle is the decision.** On the dashboard each row in "Needs your attention" has a 4px Wattle left edge. Wattle also marks the current rail item and the counts that need a decision. It is never text, never a button, never a wash.
- **Two shadows only.** `--shadow-soft`, a faint lift off Sand, on sections and the count strip; `--shadow-lift` on menus, dialogs and the phone frame. Hierarchy otherwise comes from borders, spacing and weight.
- Sentence case everywhere: no all-caps, no letter-spaced eyebrows, no middle-dot meta strings, no arrows on labels.

## Colour

"Harbour and Wattle": a crisp harbour blue for actions and a wattle yellow for anything that needs the Property Manager's decision, on cool neutrals. All colour is a token on `:root` in `src/web/static/app.css`; no literal colour appears outside that block (white is `var(--surface)`). The daisyUI theme `myest8` maps these tokens, and `TAILWIND_THEME` in `ui.ts` exposes them as utilities (`bg-page`, `text-muted`, `border-line`, `text-urgent`, `bg-info-bg`...). Every pair below was measured (WCAG 2 relative luminance); text pairs meet AA, most of them AAA.

| Token | Name | Hex | Role | Contrast |
|---|---|---|---|---|
| `--ink` | Night | `#13212E` | Body text, headings, the rail, the sign-in panel, the landing's closing band | 16.4:1 on white, 14.3:1 on Sand |
| `--page` | Sand | `#F4EFE6` | The page behind sections, lanes, the Trade badge (was Paper `#F2F4F6`; "Paper" elsewhere in this document means this token) | |
| `--surface` | | `#FFFFFF` | Sections, rows, dockets, inputs | |
| `--muted` | Slate | `#55636F` | Secondary text, timestamps, hints, Routine | 6.2:1 on white, 5.4:1 on Sand, 5.4:1 on info |
| `--line` | Line | `#D8DEE4` | Hairlines and section borders (decorative) | |
| `--control` | | `#7D8A95` | Input, select, checkbox and secondary button borders | 3.5:1 on white, 3.1:1 on Sand (UI component minimum 3:1) |
| `--action` | Harbour | `#1F5C8B` | Primary buttons, links, focus ring, selected state, Routine map pins | white on it 7.1:1; as text 7.1:1 on white, 6.2:1 on Sand |
| `--action-hover` | | `#174A70` | Primary button and link hover | white on it 9.3:1 |
| `--hivis` | Wattle | `#FFC233` | The decision stripe, the current rail item's bar, decision count chips, the logo on Night | Night on it 10.1:1 |
| `--info-bg` | | `#E8F0F7` | Info badges and alerts, "Filled in by AI" | Harbour on it 6.2:1, Night 14.2:1 |
| `--urgent` / `--urgent-bg` | Rust | `#B42318` / `#FDECEA` | Urgent, errors, destructive actions | 5.8:1 on its tint, 6.6:1 on white |
| `--high` / `--high-bg` | Ochre | `#9A4A0B` / `#FDF1E3` | High Urgency, warnings, flags | 5.6:1 on its tint, 6.3:1 on white |
| `--done` / `--done-bg` | | `#2F5A3E` / `#E8F1EA` | Done, approved, confirmed | 6.9:1 on its tint, 7.9:1 on white |
| `--rail` | Night | `#13212E` | The rail | |
| `--rail-text` | | `#E6EBF0` | Rail links and the wordmark in the rail | 13.6:1 on Night, 10.1:1 on the current item's band |
| `--rail-muted` | | `#9AA8B4` | Rail counts, the Phone simulator link, the Agency's name | 6.7:1 on Night |
| `--rail-hover` / `--rail-current` | | `rgb(255 255 255 / 0.05)` / `0.08` | Rail hover and current band | |
| `--scrim` | | `rgb(19 33 46 / 0.45)` | Behind the open drawer | |
| `--shadow-lift` | | `0 8px 24px rgb(19 33 46 / 0.18)` | The one shadow | |

- Routine Urgency is not coloured: `--muted` text on a `--line` hairline. Colour is never the only signal; every badge carries its word.
- Wattle is never text and never a button. It is 1.6:1 on white, so it only ever marks (a stripe, a bar, a chip behind Night text).
- The focus ring is Harbour everywhere except on the Night rail, where Harbour is 2.3:1, so rail links ring in `--rail-text`. Links inside a dark chat bubble take the bubble's own text colour, underlined, and so does their ring.

## Type

- **Display: Bricolage Grotesque** (variable, `@fontsource-variable/bricolage-grotesque`, the `opsz` file; the optical size axis is left to the browser). Page titles, section headings, docket numbers, the wordmark, landing headlines. Weight 600 for section headings, 700 for page titles and docket numbers. Letter-spacing -0.01em from 28px up. `--font-head`.
- **Text: Public Sans** (variable, `@fontsource-variable/public-sans`). Body, tables, forms, buttons, nav, badges. Weight 400 body, 500 nav and labels, 600 buttons and table headers. `--font-body`.
- Both are served from this server: `src/web/assets.ts` copies the two woff2 files from the packages (an allowlist under `/assets/fonts/`), `app.css` declares the `@font-face` rules, and `head()` preloads both.
- Scale (px): 12 meta; 13 dense tables and badges; 14 body; 16 lead and docket issue; 20 section heading; 28 page title and docket number (large); 40 docket number on the Ticket page; landing 48 to 72. Line height 1.45 body, 1.1 headings. Measure 72ch maximum. Tabular figures with the `num` class.

## Shape, space and elevation

- Radius: 4px on rows, badges, inputs and dockets; 6px on buttons and segmented controls; 8px on sections and alerts. Borders are 1px `--line`.
- Spacing steps 4, 8, 12, 16, 24, 32. Content column max 1280px with 24px gutters (16px under 1024px).
- No shadow except `--shadow-lift`.
- Motion only answers an action; no entrance animation; `prefers-reduced-motion` removes all transitions and animations.
- Focus: one 2px Harbour outline offset 2px on every control (`:focus-visible`). Touch targets are 44px on phones and touch screens.
- Every page works at 390px with no horizontal scroll; tables scroll inside their own frame or stack.

## Layout

### App shell (`page()`)

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ [tag] myEST8 │ Dashboard             [Mine | All]    Sun 18 Oct  Alice ▾  │ page header row
│ (Night)      │ ┌ 2 ┬ 1 ┬ 5 ┬ 0 ┬ 1 ┬ 0 ──────────────────────────────┐   │ count strip
│▌Dashboard    │ └───┴───┴───┴───┴───┴─────────────────────────────────┘   │
│ Dispatch     │ ┌ Needs your attention ──────┐ ┌ Urgent Repairs ──────┐   │
│ Requests   2 │ │▌ row                       │ │ Next 7 days          │   │
│ Tickets      │ │ Inbox                      │ │ Tickets by stage     │   │
│ Approvals  1 │  page content (max-width 1280px, 24px gutters, 16 phone)  │
│ Schedule     │                                                           │
│ Properties   │                                                           │
│ Tradies      │                                                           │
│ Settings     │                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
 220px rail, 1px Line on its right
```

- **Rail.** Night background with `--rail-text`, no border. The logo (key tag in Wattle, wordmark in Bricolage) links home. Ten places in three groups: Dashboard (`/`), Dispatch, Tickets, Archive, Approvals, Schedule (`/calendar`); then Properties, Tradies and Tenants under a quiet uppercase "Profiles" heading (`.rail-group`, hidden when the rail is collapsed, and naming the list with `aria-labelledby`); then Settings after a 12px gap. Public Sans 500 15px, 40px tall, with a Phosphor icon (18px). The current item has a 4px Wattle bar on its left (inset shadow, following the 6px radius), weight 600, white text and `aria-current="page"`; hover is `--rail-hover`; focus rings in `--rail-text`. Counts are plain `--rail-muted` numerals; only Tickets (new Maintenance Requests) and Approvals (Quotes waiting on a Property Owner and Reimbursement Requests to review; counts that mean "needs you", worked out by `loadNavCounts`) are a small Wattle chip with Night text. Zero is not shown. A page under a place keeps it current.
- At the foot, quieter: the demo's Phone simulator link and the Agency's name.
- **Page header.** There is no separate top bar. The first row of the content column holds the `<h1>` (`.page-title`, Bricolage 28px/700, 24px on phones) on the left and, on the right of the same row, the page's controls (the Mine/All segmented control), today's date in the Agency's time zone, and the user menu (name, Sign out). On phones the row wraps: menu button and title, then the controls and the user menu. `page()`'s signature is unchanged; `controls`, `subtitle` and `actions` render in the same places.
- **Flash** messages appear under the page header as one line (`role="status"` or `role="alert"`).
- **Collapse menu** (from 1024px, JavaScript only) folds the rail to a 64px strip of icons; each label stays the link's name and shows as a tooltip; a waiting count becomes a 6px Wattle dot. The choice is remembered in `localStorage` and applied in `head()` before first paint. Under 1024px the rail is an off-canvas drawer opened by the menu button in the page header.

### Count strip, count sentence and filters

- `filterBar({ action, filter, urgencies, trades, properties })` is the one filter over a list (Tickets, Archive): a GET form of small labelled selects in a wrapping row that keeps Mine/All in a hidden field. `app.js` submits it on change and hides its Apply button; a Clear filters link shows once a filter is set. Pages read it with `listFilterOf(c)` (`src/web/list-filter.ts`), which drops unknown values.
- `countStrip(items)` is the dashboard's row of counts: each a tile linking into its queue, the number in Lexend 26px 600 under a 3px Harbour line, plain type with no underline; a zero turns Slate. Items take `{ label, count, href, decision?, tone? }`; a `tone` above zero adds a small dot beside the label: `attention` Wattle, `urgent` red (and a red number). Two tiles per row under 640 px, three from 640 px, and one row of six from 1024 px.
- `countSentence(items, { empty })` is the other pages' counts (Approvals and the desk pages). One sentence under the title in 16px: "2 Maintenance Requests to confirm, 1 Quote to choose and 1 Tradie to rate." Each count is a link into its queue. Items take `{ label, one?, count, href, decision? }`; `one` is the wording for a count of 1. Counts of zero are left out. A count that needs a decision is Night on a Wattle chip; the rest are Harbour links. When nothing is left the sentence says so ("Nothing needs you right now.").
- `aiFilled(content, { label?, edit? })` is the "Filled in by AI" style: `--info-bg` tint, 4px radius, a quiet label after the `sparkle` icon (14px, `aria-hidden`; "Filled in by AI" unless `label` says more), and an optional edit control. The sparkle is the one mark on every AI-written thing: the Summary, a drafted follow-up, an import's AI values. Use it only for text the AI wrote; text a person wrote or edited, and the Tenant's own words, are not tinted.

### The docket (Tickets only)

```
┌────────────────────────────┐
│ #12  [High]        2 days  │  stub: number (Bricolage 20px) and Urgency
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │  the perforation
│ The cupboard under the sink│  issue (the Summary), 16px
│ 27 Llewellyn St            │  address, Slate
│ Plumbing   4 Quotes        │  stage line
└────────────────────────────┘
```

- White, 1px `--line` border, 4px radius, 12px padding. It sits in a Paper lane, like a slip on a tray.
- Reading order: the stub (number in Bricolage 700, the Urgency badge, the unread dot, the age at the right), the dashed perforation, then the issue at 16px (up to three lines; `lines` changes it), the address in Slate (one line, full text in its title), and the stage line (`meta`: Trades and what the Ticket waits on).
- `size: 'large'` is the Ticket page header: the same order with the number at 40px.
- A docket in its own right draws no Wattle; Tickets waiting on the Property Manager are listed in "Needs your attention". On the dashboard board a docket that waits on the Property Manager keeps a 3px Wattle edge.

### Dashboard

```
 count strip: six counts linking into their queues, under a 3 px Harbour line
 left, wider column (1.4 : 1)        right column
 Needs your attention (22 px)        Urgent Repairs (compact list)
 Inbox                               Next 7 days (day chips, then visits)
                                     Tickets by stage (lanes stacked)
```

- Count strip: Maintenance Requests to confirm, Tickets waiting on you (Quotes to check, Site Inspections to book and Quotes to choose together, linking to the first of them), Open Tickets, Alerts, In the inbox (each `attention`), and Urgent Repairs needing a receipt (`urgent`). Count numbers stay dark (Slate at zero); only Urgent Repairs turns red. Six equal tiles fill the content width: one row from 1024 px, three per row from 640 px to 1023 px, two per row under 640 px. A label wraps inside its tile and is never shortened. On the one row, a tile under 10.5 rem (beside the rail at 1024 px) sets the label at 12 px so the words still fit on two lines.
- Left, wider column, "Needs your attention" in 22 px type: Maintenance Requests to confirm (oldest first; an empty state when there are none), then Quotes to check, Site Inspections to book and Quotes to choose (each a group left out when empty), then Alerts (Tradies to rate among them). Each row has a 4 px Wattle left edge. A Maintenance Request row: 56 px photo thumbnail (or a "No photos" tile), the Summary, street, Urgency and Trade badges plus "Check urgency", "Flagged photos" or "No photos" flags, age, and two actions: **Confirm** (POST) and **Review** (link to `/requests/:issueId`). A Ticket row names its step as its action: Check Quotes, Book a Site Inspection, Choose a Quote. On phones the inbox follows in brief, each row linking down to its message.
- Under it, the Inbox: flat white message cards (who sent it and when with the reason on the right, the message in a tinted box, the best guess folded away, then **Pick a contact**, Route and **Dismiss** as outlined buttons). From 1024 px it scrolls inside its own box.
- Right: Urgent Repairs lead as a compact list (the issue linking to its Reimbursement Request, address · Tenant · reported time, the Reimbursement status badge, receipts), in a plain white card with a red heading and a thin red edge on each repair when there are any.
- Next 7 days: today and the six days after it in the Agency's time zone, as a strip of seven day chips. Each chip links to that day (`/?day=YYYY-MM-DD#next-7-days`), keeping Mine or All. The chosen day (today when `day` is missing or not one of the seven) is filled with Harbour's tint and marked `aria-current="date"`; today keeps a Harbour ring when another day is chosen. A dot marks a day with a visit. Under the strip, a heading names the day ("Thursday 23 October") and only that day's visits are listed, in time order: the time, the Tradie, the issue and street, and a Site inspection badge when it is one. An empty day says "Nothing booked on Thursday." Open calendar links to that day (`/calendar?view=day&date=…`).
- Tickets by stage: lanes stacked in workflow order (Quoting, With Property Owner, Ready to book, Booked, Done), a stage with no Tickets left out, each a white lane with a thin Harbour-tint outline and pale blue heading holding flat docket rows, scrolling inside 15 rem from 1024 px. With no open Tickets the board is one empty state.
- Phone: one column: count strip (two tiles per row), Needs your attention, Inbox, Urgent Repairs, Next 7 days, Tickets by stage.
- Setup is not on the dashboard. While the Agency is unfinished the rail shows an outlined "Setup guide" link above Collapse menu, pointing at the next step still to do (`loadSetupLink`).

### Dispatch: the queue and the map

`/dispatch` (`src/web/pages/dispatch.ts`, `static/dispatch-map.js`) shows where the Agency's Properties and Tradies are, so a Property Manager can see which Tradies are near a Property with work waiting. MapLibre GL JS (6.x) draws a light grey vector basemap and works out which pins overlap; the pins and groups are HTML buttons laid over it. MapLibre's module, worker and stylesheet are served from `/assets` (`assets.ts` allowlists each file by name, `vercel.json` ships them from `node_modules/maplibre-gl/dist/`), so only the basemap's style, tiles and fonts come from the network.

```
┌ Need Tradies │ Ready to book │ High or Urgent │ Visits today ───────┐
├ To dispatch: a card per Job waiting, most urgent first ────────────┤
├──────────────────────────────────────────────┬────────────────────┤
│ map  (55vh on phones, 32rem from 1024px)     │ panel: the picked  │
│                                              │ Property or Tradie │
├──────────────────────────────────────────────┴────────────────────┤
│ Properties: Address  Suburb  Open Tickets  Worst urgency           │
└────────────────────────────────────────────────────────────────────┘
```

- **At a glance.** Four stats: Jobs that need Tradies to quote, Jobs ready to book (a Quote approved, no Work Order), open High or Urgent Tickets, and today's visits.
- **To dispatch.** A card per Job waiting on the Property Manager, most urgent then oldest first, with a Wattle edge: what it needs (Needs Tradies to quote, Ready to book), the Ticket's issue, its Urgency, Trade and Property (the Property's chip picks it on the map). A Job with fewer than two Quote Requests lists up to six Tradies of its Trade not asked yet, nominated first then nearest, each as a Tradie entry (below) with its checkbox, the first ones ticked, and **Send Quote Requests**. A Job with an approved Quote names the Tradie and price, offers their next three free times (each fills the start) and **Send Work Order**. Both post to `/dispatch/jobs/:id/…` and refuse as the Ticket page does.
- **Tradie entry** (`tradieEntry` in `pages/dispatch.ts`). One Tradie is one clearly bounded block, the same in a Property's panel and in a Job's Ask for Quotes list, so everything about a business sits inside its own block and the eye can't join one Tradie's rating to the next one's name.

```
┌──────────────────────────────────────────────────┐
│ [▣]  Cool Appliance Repairs                6.5 km │  name, distance at the right
│      Appliances                                   │  Trades
│      ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬───────────────────────── │  distance ruler
│      myEST8 ★ 4.3 (3)   Google ★ 4.3 (72)         │  the two ratings
└──────────────────────────────────────────────────┘
```

  - A `<li>` with a 1 px `--line` border, 6 px radius, 12 px padding on `--surface`, no shadow, 8 px between entries. Separate boxes rather than hairline rows in one list: in the 24rem panel and on a phone each entry reads as a thing of its own, and in the Ask for Quotes list a ticked entry can take its own tint and Harbour edge.
  - Left column (28 px): a Night square with an 8 px radius and the filled wrench glyph, the look of the map's Tradie pins, so a row visibly matches its pin. In the Ask for Quotes list the checkbox takes its place. Everything else is in the right column, on one left edge.
  - **Name** first: Bricolage Grotesque 16 px 600, Night, underlined on hover, linking to `/tradies/:id` (in the Ask for Quotes list it is label text, with the Nominated badge after it). The distance is at the right of the same line, plain text in tabular numerals ("6.5 km", 14 px 600), not a chip. A Tradie whose distance is not known says "Distance unknown" there in Slate.
  - **Trades** under it as words ("Appliances, Plumbing"), Slate 14 px.
  - **Distance ruler:** a 4 px `--line` track the width of the text column with a Harbour fill as long as the distance's share of the search radius (`TRADIE_SEARCH_RADIUS_KM`), so who is close shows at a glance. It is `aria-hidden`; the distance in words carries the meaning. With no known distance there is no ruler.
  - **Ratings** last: two labelled pairs in plain text, "myEST8 ★ 4.3 (3)" and "Google ★ 4.3 (72)" (Slate source and count, Night score, an Ochre star), "Not on Google" when there is no listing, "myEST8: no rating yet" when none. Never combined. Screen readers hear "myEST8 4.3 from 3 ratings". They wrap onto two lines when the column is too narrow.
  - **Ask for Quotes:** the whole entry is the checkbox's `<label>` (the name's `::after` stretches over the entry), so a click anywhere ticks it; the checkbox is named by the business name and described by the distance, Trades and ratings. A link inside a label is a control inside a control, so the quiet **Profile** link sits outside the `<label>`, at the end of the ratings line and above the stretched click area. A ticked entry takes `--info-bg` and a Harbour border; keyboard focus is the checkbox's usual Harbour ring.

- **Pins.** No key: each pin's shape says what it is. A Property is a house on a disc, sized and coloured by its worst open Ticket's Urgency (Urgent 44 px `--urgent`, High 38 px `--high`, Routine 32 px `--action`, none 26 px white with a `--control` edge and a Slate house), with its number of open Tickets on an Night chip at its shoulder. A Tradie is a wrench on a 28 px Night rounded square, drawn under the Property pins. Every pin's accessible name says the same in words (the address, its open Tickets and worst Urgency; or the Tradie and their Trades). The glyphs come from the page's `#dispatch-pin-icons` template, so they are the app's Phosphor icons.
- **Groups.** Pins closer than about 40 px (Properties and Tradies alike) become one group until the map is zoomed in: a 36 px white disc with a 2 px Night ring and the number of pins in it; the ring is 3 px Rust or Ochre when it holds an Urgent or High Property. It is a `role="button"` named "Group of 5 pins: 3 Properties and 2 Tradies, worst urgency high. Press Enter to zoom in."; a click or Enter zooms in to it, to the zoom where it splits (animated, or at once under `prefers-reduced-motion`), and the focus stays on the map. MapLibre's GeoJSON source does the grouping (`cluster: true`, radius 40 px, none past zoom 17) and counts the Properties and Tradies and the worst Urgency in each group; the groups are redrawn as HTML markers when the map settles at a zoom. Pins at the very same spot are not fanned out: the table has them all.
- **The first view** fits the Agency's Properties (32 px padding, at most zoom 15), not every Tradie, so it opens on the streets that have work rather than all of Sydney.
- **Picking.** The picked pin gets a 3 px Harbour ring on a pale disc behind it and is drawn above the others; a group holding it gets a Harbour outline. Picking a Property (from its pin or its row) zooms in only as far as needed for its pin to stand on its own, and draws the Tradie search radius (`TRADIE_SEARCH_RADIUS_KM`, 15, in `src/geo.ts`; the Settings page will make it the Agency's own) as a quiet ring: a 1.5 px Harbour dashed line at 55% opacity, no fill, drawn by MapLibre as a line layer that reads `--action`. The map never zooms out to fit the ring.
- **Panel, not a tooltip.** Beside the map from 1024 px, under it on phones. It shows the street address, the open Tickets (each links to `/tickets/:id`, with its Jobs' stages; one waiting on dispatch links to its card) and up to five nearest Tradies within the radius who do the Trades its open Jobs need (any Trade when it has none), nearest first, each as a Tradie entry (below). A Tradie's panel shows their ratings (the same labelled pairs) and bookings. The side column is 24rem wide from 1024px, so an entry's two ratings fit on one line. Opening it moves focus to its heading; Close or Escape closes it and puts the focus back on the pin or link that opened it.
- **Table.** The map is not usable with a keyboard or a screen reader on its own, so the table is the same information: every Property (most urgent first) with the address as a link that picks it, the suburb, the open Tickets and the worst urgency. A Property the map could not place says **Address not found** (a warning badge) and its panel says why it lists no Tradies. Addresses are placed by Nominatim, OpenStreetMap's geocoder ([ADR 0012](adr/0012-nominatim-for-geocoding.md)), which may not know a rural or brand-new street; such a Property is still added, without a pin. Opening the page never looks addresses up; while any are missing, the page header's **Look up missing addresses** tries them again (`geocodeMissing`, at most 10 Properties and 10 Tradies a time; a failing lookup never stops the page).
- **Phones (under 640 px).** The map is 55vh (18 to 32rem) with the panel under it. The Properties tables stack: each row is a white block on Paper, the address first, then the suburb with the worst urgency at the end of its line, then the Tickets. They use their own `dispatch-stack` rules rather than `table({ stack })` in `ui.ts`, which can't carry the row header and `data-row` the picking needs. Nothing scrolls sideways at 390 px.
- **Keyboard.** Every pin and group is a real `<button>` marker named by its address and tickets (or the Tradie's name and Trades): Tab to it, Enter or Space picks it. A pin's button is the same element for as long as it stands alone, and a group's button goes when it splits. The map itself takes arrow keys and + / -; the compass, rotation and tilt are off with mouse, touch and keyboard, so it stays north-up and flat. The scroll wheel zooms only after the map has been clicked or focused, so the page still scrolls. Zoom controls are MapLibre's `NavigationControl` (+ and − only), top left.
- **Without JavaScript, WebGL or the basemap.** Without JavaScript the map's place says it needs JavaScript. With it, but without WebGL, or when MapLibre or the basemap's style fails to load, the script replaces the map with "The map could not load. The table below lists the same Properties, each with its Tickets and urgency." (a tile, sprite or font that fails after the style is in only leaves the basemap plain; the pins stay). The queue, the table and a panel per Property work in every case: a row's link goes to its panel (`:target`).
- **No Tradie schedule.** Who is booked when is the Schedule's (below); a Tradie's panel still lists their visits over the next 7 days.

### Schedule: Day, Week and Month

`/calendar` (`src/web/pages/calendar.ts`; `src/web/schedule-layout.ts` places the visits) shows every booked visit in the Agency's time zone. `?view=day|week|month&date=YYYY-MM-DD&filter=all`; Week is the default, and the older `?week=` still opens that week. It reads as a calendar a Property Manager already knows from Teams or Outlook, in this app's colours and type: the period is a title beside the arrows, each day is a column, and a visit is a compact block.

- **Toolbar.** One row. **Today** is an outlined button, then the previous and next arrows (icon buttons named "Previous week" and "Next week", and the same for a day or a month), then the period in Bricolage 20px: "12 – 18 October 2026", "Thursday 8 October", "October 2026". On the right, Day / Week / Month (`Calendar views`, drawn as a switch) and Mine / All, then Share. Under 768 px the switch and filter wrap to a second row. Today is always there, even when the period shown is already this one.
- **Time grid.** Hour lines with the times in a 3.5rem gutter ("8 am", right-aligned just under the line) over 15-minute rows, 7 am to 7 pm, grown to the whole hours around any visit outside them (one range for the whole week). Half-hour lines are the same `--line` at lower opacity. Rows grow to fit what is on them; the hours, days and lanes are CSS subgrids of one grid, so everything lines up. The frame is at most `min(40rem, 100dvh - 16rem)` tall and opens scrolled to an hour before the first visit, or to 7 am (`data-schedule-open`, moved by `app.js`); without JavaScript it starts at the top of the working day. It scrolls inside its frame, a focusable region, never the page.
- **Week** (from 768 px). Seven day columns, Monday first. The weekday is Public Sans 12px in Slate, the date Bricolage 20px; both are centred, they stick to the top of the frame, and the date opens the Day. Today's date is a white numeral on a 32px Harbour circle (`aria-current="date"` on the column and the date), and its column is tinted `--info-bg`. Saturday and Sunday sit on Paper. A visit is a white block with a 4px left edge linking to its Ticket: the time and the issue in bold, then the Tradie. The edge is Harbour, Ochre for a reschedule, Wattle when that reschedule waits on this Property Manager, and Done green when the visit is done. A Site inspection keeps the Harbour edge and adds a Harbour-on-`--info-bg` marker. An hour or less is one line, the start time and as much of the issue as fits; the link's accessible name still reads the full time, the issue and the Tradie. Visits that overlap (directly or through another) fold into one Harbour-on-`--info-bg` block over their time, "2 Jobs booked", that opens the Day. Under 768 px the Week is the list of days, restyled with the same date and circle, a run of empty days folded into one line.
- **Now.** A 2px Rust (`--urgent`) line across today's column, with an 8px dot in the gutter, placed by the server from the Agency's time zone. `app.js` moves it each minute. It has no transition, so it does not animate, including under `prefers-reduced-motion`.
- **Day.** The same grid for one day, with the same line when the day is today, and a lane per visit running at once (greedy interval colouring), each lane at least 14rem. The visits are the same blocks as the Week; a visit alone at its time takes the whole width. A weekend day sits on Paper.
- **Month.** The same toolbar. A table of weeks (column headers Mon to Sun), the days of the months either side on Paper with muted numbers, today's number a Harbour circle. A day lists up to two visits as pills with a 4px coloured edge (time and issue, one line); with more, or any that overlap, it says "N Jobs booked", opening the Day. On phones a booked day shows only the count, 44 px tall.
- **Free today.** When today falls in the period, a panel lists the Tradies with no visit that day. "Free" is the whole Agency, not only Mine: a visit on a colleague's Property still takes the Tradie off the list. From 1024 px the panel is a 20rem column to the right of the grid, the same height cap as the grid's frame, and the entries scroll inside it. Under 1024 px it sits above the grid, and the entries are a row that scrolls sideways inside the panel, never the page. The heading is "Free today" and the count. Each Tradie is one bounded entry, the Dispatch Tradie entry without the distance or the Google rating: a 28px Harbour circle of initials (hidden from assistive tech; the name says who it is), the business name in Bricolage 16px 600 linking to `/tradies/:id`, their Trades in words (Slate 14px), and the myEST8 rating as plain text ("myEST8 ★ 4.0 (1)", an Ochre star). Order is the fixed Trade list, then the business name. With none free the panel says "Every Tradie has a visit today." With no Tradies it says "No Tradies yet." and links to add one (`/tradies#add-tradie`). On any other period the panel is absent, with no empty box.
- **Text equivalent.** The hour lines are `aria-hidden`; every visit is a list item in its day's list whose link or card names its time, issue and Tradie, so the grid reads as text in time order.
- **Pin data.** The page writes one `<script type="application/json" id="dispatch-data">` block with the basemap's style URL, the radius and the pins. `<`, `>`, `&` and U+2028/9 are written as `\uXXXX`, so an address cannot close the script or open a comment. `static/dispatch-map.js` is an ES module (MapLibre 6 ships ES modules only) that imports `/assets/maplibre-gl.mjs` once it runs, and MapLibre starts its worker from `/assets/maplibre-gl-worker.mjs` beside it. The script builds every pin with DOM calls and `textContent`, never `innerHTML`; there are no inline handlers.
- **Basemap.** A light grey vector map, so the pins carry the colour: OpenFreeMap's Positron style, `https://tiles.openfreemap.org/styles/positron` (`MAP_STYLE_URL` in `src/web/pages/dispatch.ts`, written into the pin data as `style`). It is free and needs no key, so there is nothing to configure and the map is the same in development, CI and production. MapLibre shows the credit OpenFreeMap requires, "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (each part linked), in the map's bottom-right corner; it comes from the style's own tile source, so it must not be hidden or replaced. OpenFreeMap serves the style, tiles, sprites and fonts from `tiles.openfreemap.org`; the app sends no Content-Security-Policy on its pages, so nothing needs allowing. If one is added, MapLibre needs `worker-src blob:` plus `connect-src` and `img-src` for `tiles.openfreemap.org` (and `blob:`/`data:` images). Never OpenStreetMap's own tile server (`tile.openstreetmap.org`): its usage policy is not for production apps. The browser tests answer the style request with a blank style, so they never wait on a tile download.
- **Where Tradies are.** A Tradie's business address is set with `setTradieAddress` and geocoded like a Property's, by Nominatim. There is no form for it yet (the Tradie forms are owned by onboarding); the demo seed sets them.

### Landing page, sign-in and Tenant pages

- **Landing** (`landing.css`): bands alternate Paper and White; the closing band is Night with the logo in Wattle. The hero is a Bricolage headline (56 to 72px) on the left and the Tenant's thread becoming a Maintenance Request on the right. Only claims the app actually makes appear on the page.
- **Sign-in and sign-up** (`auth.css`): a split panel, Night with `--rail-text` type and the key tag in Wattle on the left, and the form on White on the right. Errors are specific sentences beside the field, announced with `aria-describedby`. No onboarding panel on sign-in.
- **Tenant pages** (`tenant.css`): a white column on Paper; the bar names the Agency and the page names the Property's street; the tracker's current stage carries the Wattle bar.

## Components

All of these are in `src/web/ui.ts`; pages use them instead of hand-building markup.

- **Buttons** (`button`, `linkButton`, `postButton`): Public Sans 600, 6 px radius. Sizes `sm` 32 px (rows and lanes), `md` 36 px (default), `lg` 44 px (a page's main way in, as on the landing page); every size is 44 px on phones and touch screens.
  - Primary: Harbour fill, white text, `--action-hover` on hover.
  - Secondary: surface fill with a 1 px `--control` border and Night text.
  - Ghost: Harbour text, no box, Paper on hover: a quiet action ("See all Tickets", "Sign out") that still reads as one. Inside a message it takes the message's colour.
  - daisyUI's `btn-secondary` is drawn as Secondary too, so there is one bordered look.
  - Danger: `--urgent` text on surface, red border on hover.
  - Labels are verbs that say what happens: "Confirm", "Send Quote Requests", "Send Work Order". No arrows.
- **Badges:** 13 px Public Sans 500, 1 px 8 px padding, 4 px radius, tinted from the token pairs, word always present. Trade and channel badges are Night on Paper; info is Harbour on `--info-bg`. A badge sitting straight on the Paper page takes `badge(text, tone, { outline: true })`: a white fill and a hairline, the tone's text kept, as a neutral badge's own fill is Paper and would read as loose text.
- **Count chips:** 22 px circles, Public Sans 12 px 600, tabular. For decisions, Wattle with Night text; otherwise Paper with Night text.
- **Outlined badge:** `badge(text, tone, { outline: true })` is a white fill with a border in the tone's own colour; the word still carries the meaning. It marks "Site quote" visits next to repair visits.
- **Filled in by AI:** see `aiFilled` above.
- **Links to records.** A link's shape says what it leads to; plain underlined text is kept for links inside a sentence.
  - `entityLink(kind, label, href)`: a record mentioned beside something else (the Property under a Ticket, a Ticket's Tenant, a Tradie on a Quote): a pill with a hairline, the record's icon in Harbour (`house-line` Property, `user` Tenant, `wrench` Tradie, `ticket` Ticket) and its name in Night; Harbour edge and `--info-bg` on hover.
  - `rowLink(label, href)`: the title of a row in a list (a Tradie, a Tenant, a Property): Night 600, underlined on hover only; in a stacked table it covers the whole row.
  - `contactLink('mobile' | 'email', value)`: a phone or envelope icon with the number or address, in Harbour.
- **Metrics.** Numbers a Property Manager compares in a table or beside a quote sit in a Paper chip with the number at 14 px 700 and its context quiet: `ratingChip` ("myEST8 ★ 4.7 (3)", an Ochre star; `named: false` under a column that already says whose; "Not on Google" dashed). Screen readers hear "myEST8 4.7 from 3 ratings". Dispatch lists a Tradie's ratings as plain text inside the Tradie entry instead, and there is no distance chip: a distance is text with a ruler.
- **Urgency.** `urgencyBadge`: Urgent is solid Rust with a warning octagon, High tinted Ochre with an up arrow, Routine quiet with no icon.
- **Searchable selects.** `field({ type: 'select', search: true })` (and the filter bar's Property) becomes a text box that filters the options as you type (app.js): every word must appear in the option's label or `keywords` (a Property's address, suburb and postcode via `propertyOptions`; a Tradie's business, Trades and own name via `tradieOptions`). Arrow keys move, Enter picks, Escape puts back what was picked. The select stays in the form, hidden, and holds the posted value; without JavaScript it is a plain select.
- **Address suggestions.** A Property's Address (`propertyPlaceFields`, on Properties, Setup and the welcome wizard) offers matching street addresses as it is typed (app.js, after 300 ms). Arrow keys move, Enter picks, Escape closes the list. Choosing one fills Address, Suburb and a hidden pin. Without JavaScript it is a plain text box and the address is geocoded on save. Suggestions come from Photon ([ADR 0012](adr/0012-nominatim-for-geocoding.md)).
- **Nominated Tradies** (`tradiePicker`): one searchable Tradie select per Tradie, each with Remove, and **Add Tradie** for another; it starts with one empty select so it works without JavaScript, and empty ones post nothing (`nominatedFrom`).
- **Queue rows** (`queueRow`): 4 px radius, hairline, 12 px padding. The title with the actions (Confirm, Review) at the end of its line, then the detail, then the badges with the age pushed to the end of their row. On phones (under 640 px) the actions move to their own line under the badges, so the title keeps the row's width. On the dashboard a decision row gets a 4 px Wattle left edge; elsewhere a row draws no Wattle.
- **Lanes** (`lane`): a Paper tray of white dockets; the count is a muted number beside the title.
- **Tables** (`table`): 13 px, 36 px rows, headers in Public Sans 600 Night, hairlines between rows, horizontal scroll only inside the table's frame. On phones (under 640 px) a table can stack instead:
  - `stack: true`: each row becomes a white block, the first cell leading and the rest in a wrapping row, headers hidden. For cells that explain themselves (badges, an age): the Tickets list.
  - `stack: 'labelled'`: the same block, but each value after the first sits beside its column's header in one aligned label column (8 rem, 13 px Slate), like a facts list. For plain values (names, money, counts): Properties, Tradies. A column with an empty header (actions) stays unlabelled.
  - In a labelled row only the lead line of the first cell is 14 px 600 (a contact name under a business name keeps its own weight), and the label hangs in the cell's left edge so a value made of several pieces (a number and its words, badges) stays together.
  - On wider screens a stacked table's cells line up on their first line's baseline, so a badge sits level with the text beside it.
  - `rowHeader: true` makes each row's first cell a `<th scope="row">` (an address, a Tradie), drawn like the cells beside it. `rowAttributes[i]` gives row i its attributes (`data-row`, `data-selected`, `aria-*`): values are escaped, `true` writes a bare attribute, `false` leaves it out, and only plain lower-case names are allowed. A row with `data-selected` is tinted `--info-bg` (and, stacked, outlined in Harbour).
- **Forms:**
  - Label above the control (14 px 600). A field's box has no padding above or below, so a button bottom-aligned beside it lines up with the control.
  - Controls 36 px tall (44 px on phones and touch screens) with a `--control` border and 4 px radius; text is 16 px on phones so iOS doesn't zoom.
  - Under the control, the error first, then the hint. Hint 12 px `--muted`; field error 12 px `--urgent`, both tied to the control with `aria-describedby`. An error also marks the control `aria-invalid` and turns its border `--urgent`, for every kind of field (text, select, textarea, file, checkbox); a file field's Choose file button stays Paper.
  - Placeholders are `--muted` upright text, lighter than typed text, so they never look filled in.
  - Two-column field grids at 768 px and up.
- **Sections:** surface, 1 px `--line` border, 8 px radius, 16 px padding, no shadow, heading 20 px Bricolage Grotesque 600 with optional actions on the right.
- **Alerts** (`alert`, `flashMessage`): 8 px radius, the tone's pair (info is Night on `--info-bg` with a Harbour icon), an icon and the tone's word for screen readers. Links inside take the alert's text colour, underlined.
- **Steps** (sequences only: the Ticket's Job progress, the Tenant tracker, the setup guide): 24 px circles. Done is `--done` with a tick (and a done line between done steps); current is Harbour with its number; to come is a white circle on a hairline with a muted number; skipped (`state: 'skipped'`: a stage that didn't happen and won't, such as "Not needed") is a muted dash in a dashed ring, never ticked and never current. A step is ticked only when it really happened, never because a later one began. The step on screen (`aria-current="step"`) also gets a 2 px Harbour ring 2 px out, so "you are here" still reads when that step is done and shows its tick (a wizard step you came back to).
- **Tabs** (`tabs`): Bricolage Grotesque, muted until current; the current one is Night 600 with a Harbour underline and `aria-current`. **Side tabs** (`sideTabs`, for Settings' sections): a column of 40 px Bricolage Grotesque 14 px links, the current one a white tab with a hairline and the Wattle bar; a sideways-scrolling row under 768 px.
- **Timeline:** Harbour dots on a `--line` rule, the time muted above each event, 12 px between events so it reads as a log.
- **Facts** (`dl`): a 10 rem label column, so a value sits near its label even in a wide column; in a box under 26 rem the label stacks over its value.
- **Chat** (simulator and message logs):
  - myEST8's messages on the left on Paper; the person's on the right on Harbour with white text. 8 px radius.
  - Links in a bubble take the bubble's text colour, underlined, so they read on Harbour and on every tone (the global link colour would be Harbour on Harbour); their focus ring is the text colour too.
  - The channel is a small badge, the time is muted, and text keeps its line breaks.
- **Empty states** (`emptyState(text, action?)`): one sentence saying what will appear and the action to take, with no illustration. Give it the action whenever there is one. Standing alone on the page it is a white section (hairline, 8 px radius) with Night text; inside a section, a lane or a table cell it is just the muted sentence and the action, with no box in a box.
- **Disclosures** (`<details>`): the summary gets a pointer, a Slate marker and the focus ring. A page may style its own summary (a menu, a button); these rules have zero specificity so it wins.
- **Segmented control** (`segmented`): 36 px on desktop like a button, 44 px on touch; it keeps its own width in a column.

### Icons and logo

- **Icons** come from [Phosphor](https://phosphoricons.com) (MIT) through `icon(name, { weight?, size? })` in `src/web/icons.ts`, rendered inline in `currentColor` and always `aria-hidden`. The word beside an icon carries the meaning. Don't add another icon set or hand-draw icons.
- **One weight: regular.** The only exception is the 14 px tick inside a done step circle, which uses bold so it doesn't thin out at that size.
- Sizes: 18 px in the rail (`size-[18px]`), 16 px for the Phone simulator link, 20 px in alerts and flash messages (the default), 24 px for the menu button, 16 px for the user menu caret and timeline dots.
- The app's icons: Dashboard `squares-four`, Dispatch `map-pin`, Tickets `ticket`, Archive `archive`, Approvals `seal-check`, Schedule `calendar-blank`, Properties `house-line`, Tradies `wrench`, Tenants `users`, Settings `gear-six`, Phone simulator `device-mobile`, menu `list`, user menu `caret-down`, AI mark and Draft with AI `sparkle`, done `check-circle`, warning and error `warning-circle`, note `info`, timeline dot `circle` (fill).
- **The logo** is `logo({ size })` in `src/web/ui.ts`: the key tag beside the wordmark. The rail and the public bar both use it; nothing else hand-builds it.
  - **The key tag:** a house-shaped tag with the key ring's hole at the top and an 8 cut out, the tag every Agency hangs on its key board. One solid shape (an even-odd path on a 256 grid, `currentColor`), so it holds at 16 px and works as an app icon as it is. It is only ever Night, White or Wattle: Night on the Paper rail and the white public bar, White or Wattle on Night bands; Night on Wattle for an app tile.
  - **The wordmark:** "myEST8" in Bricolage Grotesque, "my" at 400 and "EST8" at 700, so the pun reads without decoration. Night on light surfaces, White on Night.
  - Sizes: `md` (default) is a 28 px tag with 22 px type; `sm` is a 20 px tag with 18 px type.
  - The tag is `aria-hidden`, so the logo's accessible name is "myEST8". In the rail it is the link home.
  - Don't recolour the tag outside Night, White and Wattle, outline it, or put it on a busy background.
- **Favicon:** `/assets/favicon.svg`, the key tag alone, Night in a light browser theme and Wattle in a dark one (`prefers-color-scheme` inside the SVG), linked from every page's head.

### Share

`shareButton({ title, text, url, label?, note?, channels?, align? })` in `src/web/share.ts` passes a link on. Links only: no server routes and no requests.

- **The button** is a secondary small button with `share-network` and "Share", or a label that says who it's for ("Send this page to them", "Share this page").
- **The panel** is a `<details>` disclosure with the menu shadow. It holds the title (which is also the email subject), an optional muted note, the link in a read-only field, then Email (`mailto:`) and SMS (`sms:?&body=`) as 40 px rows. On screens under 640 px it is a sheet along the bottom, 16 px clear of the edges.
- **With JavaScript** (the "share" block in `app.js`), the panel gains:
  - Copy link, confirmed by "Link copied" in an `aria-live` line. If the clipboard is refused, the link is selected so it can be copied by hand.
  - More options…, which opens the phone's own share sheet, only where `navigator.share` exists.
  - A close button. Escape, a click elsewhere or picking a channel also closes it, and only one panel is open at a time.
- **Without JavaScript** the disclosure still opens, with the plain links and the field to copy from.
- **Where it appears:**
  - Sign-up: the sign-up page, for the colleague who should create the Agency's account. Colleagues join an existing Agency from the setup guide, not by signing up.
  - Schedule: the day, week or month on screen, always with its `?view=` and `?date=`.
  - Dashboard: the list of Maintenance Requests to review, shown when there are any.
  - Maintenance Request and Ticket pages: that page.
  - The Tenant's tracker: the tracker, to send to someone they live with.
- **Copy:** Property Manager pages carry the note "Only Property Managers in your Agency can open this link" (`COLLEAGUES_ONLY`). The tracker warns that anyone with the link can see the page.
- **Links** are absolute, built by `shareUrl(c, path?)` from the address the request came to, with any `?ok=` or `?error=` flash dropped.

### Following up with a Tenant

The **Follow up with <first name>** panel is a `section` (`#follow-up`) on the Maintenance Request review (`pages/requests.ts`, `followUpForm`). It sits under Decide in the side column from 1024px and under the Summary on a phone, like Decide. The column isn't sticky: with a draft open it is taller than a laptop screen, and a sticky column that tall hides its foot.

```
┌ Follow up with Ruby ──────────────────┐
│ What do you want to say to Ruby?      │  notes, 4 rows, hint under it
│ ┌───────────────────────────────────┐ │
│ └───────────────────────────────────┘ │
│ [✦ Draft with AI]                     │  Secondary
│ ┌ ✦ Written by AI. Check it ────────┐ │  `aiFilled`, only when the AI wrote it
│ │ Message to Ruby                   │ │
│ │ ┌───────────────────────────────┐ │ │  the draft, 8 rows, editable
│ │ └───────────────────────────────┘ │ │
│ └───────────────────────────────────┘ │
│ [Send to Ruby]                        │  Secondary
└───────────────────────────────────────┘
```

- **One form, two buttons.** The notes and the draft are in the same form, so the notes stay in their field for a redraft. Draft with AI posts to `/requests/:id/follow-up/draft` and the page comes back with the draft (no redirect), at `#follow-up`; Send posts the same fields to `/follow-up/send` through the button's `formaction` and redirects with "Follow-up sent to <Tenant>". Nothing is sent until Send.
- **Both buttons are Secondary.** Confirm is the review's one primary action. Draft with AI carries the `sparkle` icon.
- **The AI mark.** A draft the AI wrote is wrapped in `aiFilled` with the label "Written by AI. Check it before you send." When the AI isn't there or fails, the notes are the draft: no tint, no sparkle, and an info alert says "AI drafting isn't available right now. Your notes are below: edit them and send, or try again." Text kept after a refused send is the Property Manager's by then, so it isn't tinted either.
- **A refused field** (blank notes, blank or over-long text) comes back as a 400 with the page and the error under the field (`aria-invalid`, `aria-describedby`), keeping what was typed. A refusal that isn't about a field (the request has left intake) redirects with the reason as the flash.

### SMS number

`smsNumberPanel(actions, { from, current })` in `src/web/pages/sms-number.ts` is the one component for an Agency's SMS number. The welcome wizard's Channels step, the Setup page and Settings all render it, so the three can't drift.

- **Two paths, side by side** (stacked under 768 px): "Create a new number" and "Register a Twilio number". Each is a `section` card with its own plain explanation and its own button. Don't merge them into one form.
- **Create** is a primary button. If the server can't buy numbers, the button is disabled, with a one-line muted reason for the person who runs the server underneath it (`data-sms-create-unavailable`). "Register" still works.
- **Register** is a short form (Account SID, Auth Token), then a radio list of the numbers that can send and receive texts, or a note that there are none with a link to buy one in Twilio. "Use different details" starts over.
- **Connected** shows the number in bold and one line about who owns it, then "Release this number" (created) or "Disconnect this number" (registered), a secondary small link button.
- **Releasing and disconnecting** go through a confirmation page (`/sms-number/release`) that says what happens. Releasing a created number can't be undone, so its text says so, and "Keep it" sits next to the confirm button.
- Results come back as the page's flash, and the page returns to the anchor `#sms`.

### Importing from a spreadsheet

Each setup step that creates many records (Property Owners, Building Managers, Tradies, Properties, Tenants) has "Add many from a spreadsheet" on `/setup`, folded like the "Add" forms, and the guide's Tradies and Properties steps have the same uploads (`importPanel()` in `onboarding-forms.ts`). The guide lists them in the order they must happen: Property Owners, then Properties, then Tenants.

- **Panel:** one sentence on what happens, a file field (`.xlsx` or `.csv`, with the row and size limits as its hint), "Upload and review", and "Download template" with the `download-simple` icon. In the guide's stack of three, the upload buttons are secondary so "Continue" stays the one primary button.
- **Review page** (`/setup/imports/<token>`, `pages/import.ts`), titled "Review Properties":
  - A summary line of badges with their words: "3 ready", "1 needs a fix", "1 duplicate".
  - **Columns**: each column of the sheet, sample values, a "Goes to" select, and how it was matched: "Matched by name", "Matched by AI", "You chose", "Empty, ignored", or "AI not sure" with its guess. An unsure column is ignored until the Property Manager chooses, and a warning alert says so; the section is open only then.
  - **Rows**: Add (checkbox), Row (the spreadsheet's row number), Status ("Ready", "Needs a fix", "Duplicate" as badges), Notes ("Already added: …", "Adds … as a new Property Owner"), then the fields. A flagged cell is an input on `--high-bg` with its problem under it in `--high`; a cell that links to a record (Property Owner, Property, Property Manager, Building Manager) is a select of the Agency's records. Duplicates start unticked and are muted.
  - The buttons repeat the step's noun: "Add 3 Properties", then "Check changes" and "Discard upload". The count updates as rows are ticked (`// === import ===` in `app.js`); a line beside it says how many ticked rows still need a fix.
  - Adding Properties does not look up their addresses. The flash says so: "Look up missing addresses on Dispatch places them, at most 10 a press." Dispatch places at most 10 Properties and 10 Tradies each time that button is pressed.
- **"Filled in by AI"** is the one bold mark: a Harbour chip on `--info-bg` with the `sparkle` icon, on every value the AI supplied and on columns it matched. Values worked out by a fixed rule ("From the address", "No rating in the sheet, so 3") are muted notes instead; when every row has the same one, it's said once under the column heading.
- AI answers below the confidence threshold are never applied: the column is ignored, or the cell is flagged with "The AI isn't sure. Its guess: Carpentry."

### Adding a Tradie from their Google listing

`addTradieSection()` in `onboarding-forms.ts` is the one component for adding a Tradie. The welcome wizard's Tradies step, Setup's Tradies section and the Tradies page all render it, so the three can't drift. Don't copy its markup into a page.

```
First, find their Google listing
[ Business name and suburb          ] [Search Google]
┌─────────────────────────────────────────────────┐
│ Pete's Plumbing                      ✓ Chosen    │  results, one link each
│ 4 Illawarra Rd, Marrickville NSW 2204            │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│ Flow Bros Plumbing                               │
└─────────────────────────────────────────────────┘
Not on Google? Enter their details yourself
┌─────────────────────────────────────────────────┐
│ Pete's Plumbing                                  │  the listing's card
│ Phone  Website  Google rating  Trades Jev suggests│
└─────────────────────────────────────────────────┘
Business name, Contact name, Mobile, Email, Trades, Starting rating   [Add Tradie]
```

- **Results** are a list (`aria-label="Google listings"`) of links to `?google=<query>&place=<placeId>`, so choosing works without JavaScript. Each is a bounded entry like the Dispatch Tradie entry: a 1 px `--line` border, 6 px radius, 12 px padding, white (`.listing-result`). The name is Bricolage 16 px 600 and the address 14 px Slate. The chosen one is `aria-current="true"` with `--info-bg` and a Harbour border, and says "Chosen" with a tick so colour isn't the only signal.
- **The card** (`.listing-card`) has the same boundary and sits above the form: the name, the address, then `dl` rows for Phone, Website, Google rating and the Trades Jev suggests. A row is left out when Google has nothing for it. A landline is shown with "Not put in Mobile, because myEST8 texts that number."
- **The form** appears only once a listing is chosen or "Not on Google? Enter their details yourself" (`?manual=1`) is. Until then there is just the search and its results. The listing is a hidden `placeId`, never a radio group: the listing's id, or `none` for not on Google.
- **Filled in from the listing:** the business name; the Mobile when the phone is an Australian mobile (04… or +614…); the Trades Jev suggests, ticked. Under the Trades: "Suggested from their Google listing. Check them." or, when Jev suggested none or failed, "Choose their Trades." The contact name, the email and the starting rating are always the Property Manager's to give.
- **When Google fails** while loading a listing, the page shows "Google search isn't working right now. Try again, or mark the Tradie as not on Google." and the manual link. When Jev fails the form still fills in, with no Trades ticked.
- **A refused form** comes back to the same choice: the form posts to a URL that carries `google`, `place` or `manual`. The wizard shows the posted values again; Setup and the Tradies page redirect back (`listingParams` builds the address) and fill in from the listing again. Nothing is stored until Add Tradie.

## Vocabulary

Each screen uses the same words for the same thing. `src/web/ui.ts` owns these labels; pages import them instead of writing their own.

### Job stages

The same labels and the same order appear in the dashboard lanes, the Ticket page's step indicator and every status badge.

| Status | Label | Shown as |
|---|---|---|
| `quoting` | Quoting | info badge |
| `site_quoting` | Site quotes | info badge; Tradies visit the Property before the final Quote |
| `awaiting_owner` | With Property Owner | Ochre badge. As a step, it reads "Not needed" (skipped) when the Repair Cost stayed within the Max Repair Cost. |
| `approved` | Ready to book | info badge |
| `scheduled` | Booked | info badge |
| `done` | Done | done (green) badge |
| `cancelled` | Cancelled | muted badge; collapsed on the Ticket page |

A Ticket is Open or Closed.

### Actions

| Action | Notes |
|---|---|
| Confirm | |
| Reject | Always with a reason |
| Review | Opens a Maintenance Request |
| Change Urgency | |
| Change Trade | |
| Send Quote Requests | |
| Confirm Quote | |
| Choose this Firm Quote | Firm Quotes only; an Estimate is never chosen |
| Check Estimate | Folds the correct-and-confirm form on the Tradie's row |
| Proceed on Estimate | With a Not-to-exceed Cap; offered only when it can work |
| Enter a Firm Quote they sent | For a Firm Quote that came by email or PDF |
| Send Work Order | |
| Draft with AI | With the `sparkle` icon. The follow-up panel |
| Send to <Tenant's first name> | Sends the follow-up as it is in the field |
| Suggest new times | |
| Use this time | |
| Rate | |
| Close Ticket | |
| Mark messages read | |
| Skip for now | Setup guide |
| Continue | Setup guide |

The confirmation repeats the verb: "Work Order sent".

### Flags and checks

Flags are sentence case: "Check urgency", "Check trade", "No photos", "Flagged photos".

A machine check never stands in for what a person said:

- The intake agent's photo check appears under its own label, "Photo check". Its result shows as a badge with its reason in muted text.
- It never appears inside "What the Tenant reported".

### Dates and times

- Format: "Mon 12 Oct, 9:00 am". Use three-letter months, with "Sep", never "Sept".
- Times show in the Agency's time zone everywhere, including the Tenant's tracker.
- Relative ages read "2 days ago".

### Decisions made after the first build

- **Ticket page header.** It follows the docket's stub, perforation and number, but it is built on the Ticket page rather than with `docket()`. It reads issue first, then the address (linked to the Property), then Tenant, status, reported and Max Repair Cost. Repair Cost shows only once it is above $0. One **Next step** line names what the Ticket waits on and links to that Job. It may use a Wattle bar only when the step is the Property Manager's decision. The Ticket's tools sit in the docket header, at its top right from 1024 px: Share, Change Urgency (a small menu, not a form) and **Close Ticket**, which appears only when it can work, once every Job is done or cancelled.
- **Routine Urgency.** Routine shows as `--muted` text with a `--line` border. Ink text would read as more urgent than it is.
- **Decision rows.** On the dashboard, decision rows in "Needs your attention" each carry a 4px Wattle left edge; elsewhere a row draws no stripe.
- **One-Quote rule.** The rule is visible on the Ticket page next to Choose: "Choose once two Quotes are confirmed, or give a reason to go ahead with one." Choose stays enabled. Without a reason, the server's message explains what's missing.
- **Phone gutters.** 16 px below 1024 px.
- **Literal colours.** No literal colour values outside the token block in `app.css`, including white. Use `var(--surface)`.
- **Navigation (2026-10-19).** Requests folds into Tickets (new Maintenance Requests above open Tickets, one filter bar over both), closed Tickets move to Archive, and Properties, Tradies and the new Tenants sit under a Profiles heading. The rail's decision count moves from Requests to Tickets.
- **Navigation (2026-10-13, replacing the three-item rail of 2026-10-10).** Dashboard, Dispatch, Requests, Tickets, Approvals, Schedule, a gap, Properties, Tradies, a gap, Settings, plus the demo's Phone simulator at the foot of the rail. The user asked for each queue to have its own place, so Calendar is Schedule again rather than moving into Dispatch's Tradie schedule; the Setup pages still move into Settings tabs.
- **The Tenant's progress tracker.** The Ticket page links to it, so a Property Manager can see what the Tenant sees. A Site visit is Done only once the inspection has happened (before that, "booked for" its time); Booked asks the Tenant to confirm they'll be home or can let the tradie in until they have.
- **Staged quoting on the Ticket page (ADR 0009).** The stage tracker reads Estimates, Site inspection, Firm Quote, With Property Owner, Ready to book, Booked, Done (`JOB_TRACKER_STAGES`). Site inspection is "Not needed" when no Tradie needed one and left out when the Job proceeded on an Estimate; Firm Quote then reads "Proceeding on Estimate (cap $X)". Booked is ticked only once the Tenant has confirmed the visit ("Waiting on Tenant to confirm" until then). Each Tradie asked is a row of their own with a chip for where they are (Asked, Estimate in, Needs inspection, Inspection booked, Inspected, Firm Quote in, Declined, Closed) and their next action; Firm Quotes and Estimates are two tables that never share a price column, and a superseded Estimate stays listed, muted. Call-out Fees owed are a line of their own, never part of the Repair Cost. Mark inspected appears only once the visit has started.

## Copy

- Use `CONTEXT.md` terms exactly: Property Manager, Tenant, Tradie, Property Owner, Maintenance Request, Ticket, Job, Quote, Quote Request, Work Order, Urgency, Urgent Repair, Repair Cost, Max Repair Cost, Building Manager, Common Area, Trade.
- Plain verbs, sentence case, no filler. An action keeps its name through the flow: a "Send Work Order" button produces "Work Order sent".
- Errors say what happened and how to fix it. Empty states invite the next action.
