# myEST8 design system: the dispatch desk

myEST8 is where a Property Manager at a small Sydney Agency sees every repair that needs a decision and moves it one step on. They work on a 1366–1440 px laptop at the desk and on a phone between inspections. The design borrows from the world the repairs happen in: the key tag on every Agency's key board, work-order dockets, a trade dispatch board, Sydney's harbour blue for actions and wattle yellow for the one thing that needs you now.

## Plan review

The first draft was a white SaaS kit: identical rounded cards with soft grey shadows, a big number with a small label in each stat card, and an all-caps eyebrow above sections. That fits any product. What changed and why:

- **Cards became dockets and rows.** Only a Ticket gets the docket shape, because a Ticket is a work order. Everything else is a plain row or a section with a hairline, so shape now encodes what a thing is.
- **Stat cards became a single count strip.** The counts are links into the queues, not decoration, and they cost 36 px instead of 100 px.
- **The accent became Wattle** (`--hivis`, a wattle yellow), used only for "needs your decision". It never appears as a decorative wash or on a button.
- **The rebrand (Harbour and Wattle, October 2026)** replaced the Colorbond palette and Barlow with a harbour blue, Wattle, cool neutrals, Lexend and Red Hat Text, and the house-and-8 mark with the key tag. Token names kept their roles, so markup didn't change.
- **One memorable thing.** The Wattle stripe that marks a decision, echoed by the key tag in the rail. Everything else stays quiet: Night, Paper, hairlines and Harbour for actions.
- **No shadows except on menus and dialogs.** Hierarchy comes from borders, spacing and weight.

## Colour

"Harbour and Wattle": a crisp harbour blue for actions and a wattle yellow for anything that needs the Property Manager's decision, on cool neutrals. Every pair below was measured (WCAG 2 relative luminance); text pairs meet AA, most of them AAA.

| Token | Name | Hex | Role | Contrast |
|---|---|---|---|---|
| `--ink` | Night | `#13212E` | Body text, headings, the rail | 16.4:1 on white, 14.8:1 on Paper |
| `--page` | Paper | `#F2F4F6` | The page behind sections, lanes, the Trade badge | |
| `--surface` | | `#FFFFFF` | Sections, rows, dockets, inputs | |
| `--muted` | Slate | `#55636F` | Secondary text, timestamps, hints, Routine | 6.2:1 on white, 5.6:1 on Paper, 5.4:1 on info |
| `--line` | Line | `#D8DEE4` | Hairlines and section borders (decorative) | |
| `--control` | | `#7D8A95` | Input, select, checkbox and secondary button borders | 3.5:1 on white, 3.2:1 on Paper (UI component minimum 3:1) |
| `--action` | Harbour | `#1F5C8B` | Primary buttons, links, focus ring, selected state | white on it 7.1:1; as text 7.1:1 on white, 6.4:1 on Paper |
| `--action-hover` | | `#174A70` | Primary button and link hover | white on it 9.3:1 |
| `--hivis` | Wattle | `#FFC233` | The decision stripe, the current rail item's bar, decision count chips, the logo on Night | Night on it 10.1:1 |
| `--info-bg` | | `#E8F0F7` | Info badges and alerts, "Filled in by AI" | Harbour on it 6.2:1, Night 14.2:1 |
| `--urgent` / `--urgent-bg` | | `#B42318` / `#FDECEA` | Urgent, errors, destructive actions | 5.8:1 on its tint, 6.6:1 on white |
| `--high` / `--high-bg` | | `#9A4A0B` / `#FDF1E3` | High Urgency, warnings, flags | 5.6:1 on its tint, 6.3:1 on white |
| `--done` / `--done-bg` | | `#2F5A3E` / `#E8F1EA` | Done, approved, confirmed | 6.9:1 on its tint, 7.9:1 on white |
| `--rail` | Night | `#13212E` | The rail | |
| `--rail-text` | | `#E6EBF0` | Rail links and the wordmark in the rail | 13.6:1 on Night, 10.1:1 on the current item's band |
| `--rail-muted` | | `#9AA8B4` | Rail counts, the Phone simulator link, the Agency's name | 6.7:1 on Night |

- Routine Urgency is not coloured: `--muted` text on a `--line` hairline. Colour is never the only signal; every badge carries its word.
- Wattle is never text and never a button. It is 1.6:1 on white, so it only ever marks (a stripe, a bar, a chip behind Night text).
- The focus ring is Harbour everywhere except on the Night rail, where Harbour is 2.3:1, so rail links ring in `--rail-text`. Links inside a dark chat bubble take the bubble's own text colour, underlined, and so does their ring.
- No literal colours outside the token block in `app.css`, including white: use `var(--surface)`.

## Type

- **Lexend** (400, 600, 700): the wordmark, page titles, section headings, buttons, nav, tabs, table headers, docket numbers. Its 8 is built from round bowls like the key tag's cut-out, and it was drawn for reading ease.
- **Red Hat Text** (400, 500, 600, and 400 italic for placeholders): everything people read and type. Clear at 13 to 14 px in dense tables; letters people mistake stay distinct (Il1 0O 8B 5S).
- Both are self-hosted from `@fontsource/lexend` and `@fontsource/red-hat-text` and served from `/assets/fonts/` (an allowlist in `src/web/assets.ts`), so the demo works offline. The head preloads Red Hat Text 400 and Lexend 600. Fallback: `system-ui, sans-serif`.
- Scale (px): 12 (meta), 13 (dense tables, badges), 14 (body), 16 (lead, section headings), 20 (section), 22 (the top bar's title), 26 (page title, the docket number on the Ticket page), 36 to 52 (the landing headline only). Line height 1.45 for body, 1.15 for headings.
- `font-variant-numeric: tabular-nums` on money, times, counts and docket numbers.
- Sentence case everywhere. No all-caps labels and no letter-spaced eyebrows. Don't emphasise a single word in a headline. Don't join meta with middle dots: put meta in separate elements with a gap. Don't append arrows to link or button text.
- Keep text measure under 80 characters (`max-width: 72ch` on prose).

## Shape, space and elevation

- Spacing scale (px): 4, 8, 12, 16, 24, 32. Section gap 16 on the dashboard, 24 elsewhere.
- Radius: 4 px for dockets, rows, badges and inputs; 6 px for buttons, lanes and the segmented control; 8 px for sections and alerts. Never fully round, except avatars, count chips and step circles.
- Borders: 1 px `--line` around sections and between rows. No zebra striping.
- Shadow only on menus, dialogs, the Share sheet and the phone frame in the simulator: `0 8px 24px rgb(19 33 46 / 0.18)` (`--shadow-lift`).
- Focus: `outline: 2px solid var(--action); outline-offset: 2px` on every interactive element. Never removed.
- Motion: only in response to an action (open a menu, expand a `<details>`, 150 ms ease-out), and none at all under `prefers-reduced-motion: reduce`. No entrance animations.
- Touch targets: buttons, inputs, selects, rail links, the segmented control, the user menu and the menu button are 44 px on phones (under 640 px) and on touch screens (`pointer: coarse`).
- Control height: on a desktop every control on a line (button, input, select, file field, the segmented control) is 36 px, so a field and its button line up; `sm` buttons (32 px) are for rows and lanes, not beside a field.

## Layout

### App shell (`page()`)

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ [tag] myEST8 │ Dashboard          [Mine | All]        Sat 10 Oct  Alice ▾ │ 60px top bar
│              ├───────────────────────────────────────────────────────────┤
│▌Dashboard    │                                                           │
│ Dispatch     │  page content (max-width 1280px, 24px gutters, 16 phone)  │
│ Requests   2 │                                                           │
│ Tickets      │                                                           │
│ Approvals  1 │                                                           │
│ Schedule     │                                                           │
│              │                                                           │
│ Properties   │                                                           │
│ Tradies      │                                                           │
│              │                                                           │
│ Settings     │                                                           │
│              │                                                           │
│ Phone        │                                                           │
│ simulator    │                                                           │
│ Harbour      │                                                           │
│ Realty       │                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
 220px rail (Night)
```

- Left rail 220 px on Night, the logo at the top (the key tag in Wattle, the wordmark in `--rail-text`) linking home. Nine places in three groups with a 12 px gap between them: **Dashboard** (`/`), **Dispatch** (`/dispatch`), **Requests** (`/requests`), **Tickets** (`/tickets`), **Approvals** (`/approvals`) and **Schedule** (`/calendar`; `/schedule` redirects to it); then **Properties** (`/properties`) and **Tradies** (`/tradies`); then **Settings** (`/settings`). Lexend 600 16 px, 40 px tall with an icon (Phosphor regular, 18 px) and an optional count (Requests: Maintenance Requests waiting for review; Approvals: Quotes waiting on a Property Owner. Both are the Property Manager's own Properties, and are worked out once per request by `loadNavCounts` in `src/web/shell.ts`, so every signed-in page shows them; a count of zero is not shown). A page under a place keeps it current: a Ticket under Tickets, a Tradie's profile under Tradies, Setup and its imports under Settings. The current item is a lighter band with a 4 px Wattle bar on its left edge (an inset shadow, so it follows the 6 px radius) and `aria-current="page"`.
- At the foot of the rail, quieter (Red Hat Text 13 px, `--rail-muted`): the demo's **Phone simulator (demo)** link (`/demo`, demo deployments only) and the Agency's name.
- Top bar 60 px on `--surface` with a bottom hairline. It holds the page title (22 px Lexend 600, the page's only `<h1>`), optional page controls passed by the page (the Mine/All segmented control on the dashboard: links with `aria-current`, the current one filled with Harbour), today's date in the Agency's time zone, and the Property Manager's name opening a menu with Sign out.
- **Collapse menu** (from 1024 px, JavaScript only): a quiet button at the foot of the rail folds it to a 64 px strip of icons (`--rail-collapsed-width`; the open rail is `--rail-width`). Each label stays its link's accessible name and shows as a tooltip on hover or keyboard focus (Night, `--rail-text`, `--shadow-lift`); a waiting count becomes a 6 px Wattle dot on the icon, with the number in the tooltip; the wordmark and the Agency's name hide. The choice is remembered in this browser (`localStorage`), and `head()` applies it before the first paint so pages don't jump.
- Under 1024 px the rail becomes an off-canvas drawer opened by a menu button in the top bar. Content is single-column with 16 px gutters and never scrolls horizontally.
- Flash messages appear directly under the top bar as one line: `--done` for ok, `--urgent` for errors, `role="status"` or `role="alert"`.
- Old places: `/schedule` redirects to `/calendar`, and `/setup` and its imports highlight Settings; the redesign's phase 2 moves Setup's content into Settings tabs and redirects it. Settings today has side tabs for Agency, Channels, Team and Import that show what is set and lead into Setup's forms.

### Dashboard: the dispatch board

The first frame at 1366×768 shows the Ticket pipeline across the full width, with the decision queue and the next 7 days starting under it.

```
┌ count strip: 4 Maintenance Requests to review   9 open Tickets   3 alerts   4 in the inbox   2 Urgent Repairs ┐  36px
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Tickets by stage                                                                                          │
│ Quoting 3          With Property Owner 1   Ready to book 1      Booked 3            Done 1                 │
│ ┌────────────────┐ ┌────────────────┐      ┌────────────────┐   ┌────────────────┐  ┌────────────────┐     │
│ │Roof leaking in │ │Hot water system│      │Bedroom light   │   │Dishwasher won't│  │Door handle has │     │
│ │the back bedroom│ │is leaking      │      │switch is broken│   │drain           │  │come off        │     │
│ │42 Coogee Bay Rd│ │21 Glebe Point  │      │2/31 Australia  │   │5/40 Ocean Ave  │  │9 Albion St     │     │
│ │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│      │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│   │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│  │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│     │
│ │High Roofing    │ │High Plumbing   │      │Routine Electr. │   │Visit Thu 22 Oct│  │Routine         │     │
│ │1 of 2 Quotes in│ │#6     6 days ago│     │#11   3 days ago│   │#10   5 days ago│  │#8    6 days ago│     │
├────────────────────────────┬─────────────────────────────────────────────────────────────────────────────┤
│ Needs your decision        │ Next 7 days  today first, then the following six days (bookings as rows)  │
│▌[photo] 7 Wilson St        │                                                                             │
│  Toilet keeps running      │                                                                             │
└────────────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
 below the fold: Urgent Repairs table, Inbox detail with link/route/dismiss, all open Tickets table
```

- Top, full width: "Tickets by stage", five lanes in workflow order: Quoting, With Property Owner, Ready to book, Booked, Done. A lane is a Paper tray (6 px radius, hairline) with its title and a muted count, holding white dockets. A Ticket sits in the lane of its least advanced open Job; within a lane, Urgency then reported time. From 1024 px lanes scroll vertically inside 22 rem; with no open Tickets the board is one empty state.
- A board docket is read in the order the Property Manager reads it: the **issue** (Red Hat Text 600, 14 px, up to three lines), the **address** (13 px Slate, street and suburb on one line, the full address in its title), the perforation, then the **status**: the Urgency badge, the Trades and what the Ticket waits on ("No Quote Requests yet", "1 of 3 Quotes in", "2 Quotes to check", "Ready to choose" in Quoting; the visit time in Booked). A foot holds the number, the unread dot and the age. "2 Quotes to check" (unconfirmed Quotes in) and "Ready to choose" (two or more confirmed) get the 4 px Wattle stripe, as they wait on the Property Manager. The core works these out (`views.dashboard`); the page only renders them. On phones "Needs your decision" comes before the board.
- Under it, left (360 px) "Needs your decision": one list of compact rows, each with a 4 px Wattle left stripe. Order: Maintenance Requests (oldest first), then alerts, then inbox items. A Maintenance Request row: 56 px photo thumbnail (or a "No photos" tile), address, one-line description, Urgency and Trade badges plus "Check urgency", "Flagged photos" or "No photos" flags, age, and two actions: **Confirm** (POST) and **Review** (link to `/requests/:issueId`).
- Under it, right: "Next 7 days": today and the six days after it in the Agency's time zone, bookings for both Property Managers, empty days collapsed into one muted line, linking to `/calendar`. A rolling window always shows the coming work, where a Monday-to-Sunday week is often empty.
- Phone: one column: count strip (wrapping), Tickets as a list grouped by stage (lanes stacked, no inner scroll), Needs your decision, Next 7 days.

### Dispatch: the map

`/dispatch` (`src/web/pages/dispatch.ts`, `static/dispatch-map.js`) shows where the Agency's Properties and Tradies are, so a Property Manager can see which Tradies are near a Property with work waiting. Leaflet 1.9.4 draws the pins on a light grey basemap, and Leaflet.markercluster 1.5.3 groups the ones that overlap; their JS, CSS and images are served from `/assets` (`assets.ts` allowlists each file by name, `vercel.json` ships their `dist/`) so the map works offline apart from the tiles.

```
┌ pin key: ▲ Urgent  ◆ High  ● Routine  ○ No open Tickets  ■ Tradie  (3) Group of pins ┐
├──────────────────────────────────────────────┬────────────────────┤
│ map  (55vh on phones, 32rem from 1024px)     │ panel: the picked  │
│                                              │ Property or Tradie │
├──────────────────────────────────────────────┴────────────────────┤
│ Properties: Address  Suburb  Open Tickets  Worst urgency           │
├────────────────────────────────────────────────────────────────────┤
│ Tradie schedule: Tradie × today and the next six days              │
└────────────────────────────────────────────────────────────────────┘
```

- **Pins.** A Property is a 32 px pin: the shape is the worst open Ticket's Urgency (triangle Urgent, diamond High, filled circle Routine, open circle none) and the number inside is how many open Tickets it has. Colours are tokens (`--urgent`, `--high`, `--muted`, `--surface` with a `--muted` outline), so colour only backs up the shape. A Tradie is a 26 px `--ink` square with the initial of the business, drawn under the Property pins. The pin key above the map names each shape in words, the group disc included, and wraps on phones.
- **Groups.** Pins closer than about 40 px (Properties and Tradies alike) become one group until the map is zoomed in: a 36 px white disc with a 2 px Night ring and the number of pins in it, plus the worst Urgency's shape (18 px) on its shoulder when it holds an Urgent or High Property. It is a `role="button"` named "Group of 5 pins: 3 Properties and 2 Tradies, worst urgency high. Press Enter to zoom in."; a click or Enter zooms in to it. Pins still together at the deepest zoom (18, or the tiles' own limit) fan out instead. No coverage outline on hover.
- **The first view** fits the Agency's Properties (32 px padding, at most zoom 15), not every Tradie, so it opens on the streets that have work rather than all of Sydney.
- **Picking.** The picked pin gets a 3 px Harbour ring over a pale disc and is drawn above the others; a group holding it gets a Harbour outline. Picking a Property (from its pin or its row) zooms in only as far as needed for its pin to stand on its own, and draws the Tradie search radius (`TRADIE_SEARCH_RADIUS_KM`, 15, in `src/geo.ts`; the Settings page will make it the Agency's own) as a quiet ring: a 1.5 px Harbour dashed line at 55% opacity, no fill. The map never zooms out to fit the ring.
- **Panel, not a tooltip.** Beside the map from 1024 px, under it on phones. It shows the street address, the open Tickets (each links to `/tickets/:id`) and up to five nearest Tradies within the radius, nearest first, with distance, Trades and both ratings (myEST8 and Google, never combined). A Tradie's panel shows their ratings and bookings. Opening it moves focus to its heading; Close or Escape closes it and puts the focus back on the pin or link that opened it.
- **Table.** The map is not usable with a keyboard or a screen reader on its own, so the table is the same information: every Property (most urgent first) with the address as a link that picks it, the suburb, the open Tickets and the worst urgency. A Property the map could not place says **Address not found** (a warning badge) and its panel says why it lists no Tradies. Opening the page never looks addresses up; while any are missing, the top bar's **Look up missing addresses** tries them again (`geocodeMissing`, at most 10 Properties and 10 Tradies a time; a failing lookup never stops the page).
- **Phones (under 640 px).** The map is 55vh (18 to 32rem) with the panel under it. The Properties and Tradie schedule tables stack: each row is a white block on Paper, the address first, then the suburb with the worst urgency at the end of its line, then the Tickets; a Tradie's block lists only the days with visits, each naming its day. They use their own `dispatch-stack` rules rather than `table({ stack })` in `ui.ts`, which can't carry the row header and `data-row` the picking needs. Nothing scrolls sideways at 390 px.
- **Keyboard.** Every pin is a focusable `role="button"` named by its address and tickets (or the Tradie's name and Trades): Tab to it, Enter or Space picks it (the name and key are set wherever Leaflet makes the element, as it makes it again whenever a group splits or forms). The map itself takes arrow keys and + / -. The scroll wheel zooms only after the map has been clicked or focused, so the page still scrolls.
- **Without JavaScript.** The map's place says it needs JavaScript. The table and a panel per Property work: a row's link goes to its panel (`:target`). The pin key is hidden.
- **Tradie schedule.** Rows are Tradies, columns today and the next six days in the Agency's time zone, from the same `calendar` bookings as the Calendar page. Each visit links to its Ticket and says Done, Reschedule requested or Not confirmed yet in words. Empty cells say "Nothing booked" to screen readers. There is no routing.
- **Pin data.** The page writes one `<script type="application/json" id="dispatch-data">` block with the tile source, the radius and the pins. `<`, `>`, `&` and U+2028/9 are written as `\uXXXX`, so an address cannot close the script or open a comment. The script builds every pin with DOM calls and `textContent`, never `innerHTML`; there are no inline handlers.
- **Tiles.** A light grey basemap, so the pins carry the colour. `mapTiles()` in `src/web/map-config.ts` gives the URL template, subdomains, attribution and maximum zoom. The choice is CARTO Positron (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`, subdomains abcd, credited "&copy; OpenStreetMap contributors &copy; CARTO", both linked), which since 25 September 2026 CARTO serves only with an API key: set `CARTO_BASEMAPS_KEY` (free, no account: carto.com/basemaps/apikey) and it is added as `?key=`. **Without a key the map falls back** to Esri's keyless World Light Gray Base (to zoom 16, credited "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ") rather than show CARTO's "API key required" notice. The hosted start-up log lists the key under real or off; a start never waits for it. Never OpenStreetMap's own tile server (`tile.openstreetmap.org`): its usage policy is not for production apps.
- **Where Tradies are.** A Tradie's business address is set with `setTradieAddress` and geocoded like a Property's. There is no form for it yet (the Tradie forms are owned by onboarding); the demo seed sets them.

### Landing page (`/` signed out)

The front door is the dispatch desk at an editorial scale, built from the same tokens (`pages/landing.ts`, styles in `static/landing.css`, loaded only there). A three-line Lexend headline: "Tenants text the problem. / You decide. / myEST8 does the chasing.", where only "You decide." carries the Wattle stripe, because Wattle means "needs your decision" everywhere. Beside it, the one bold element: a Tenant's SMS thread with the words the intake agent used for the Trade and Urgency marked in Harbour's tint (the "Filled in by AI" colour), and the resulting Maintenance Request as a decision card. Two large (44 px) actions with the sign-up page's wording: **Create your Agency's account** (primary) and **Sign in**. Then the workflow as a dispatch log (weekday times, a numbered track, a Wattle "You" chip on the Property Manager's decisions), what waits for you against what myEST8 handles, and a closing Night band like the rail. The only motion is a "now" marker stepping down the workflow, with a Pause button; under reduced motion nothing moves. No stat blocks, no gradients.

**No plain text with an inline link on any public page.** Every link is a real button (`linkButton`) or sits in a nav bar. The public bar's `headerActions` are ghost small buttons: the landing page's bar has **Sign in** (ghost) and, from 640 px, **Create your Agency's account** (primary); `/login` and `/signup` carry only **Home**, so the sign-in page has exactly one control named Sign in. The sentence around a button ("Already have an account?") is plain text above it.

**Demo sign-ins** (demo deployments only) sit under the workflow, below a hairline, as a bordered list with one row per demo Property Manager: name and email as text, and a secondary button "Sign in as Alice Archer" (or Bob Baker). Each button is a `<form method="post" action="/login">` with hidden email, password and next fields, so one click signs in. The password is also written out as text, and none of it appears outside demo mode.

### Sign-in and sign-up pages (`/login`, `/signup`)

Both fill the viewport (`authPage()` in `src/web/auth-card.ts`, styles in `static/auth.css`, loaded only there). From 1024 px the page splits: a full-height Night panel on the left (5/12), where the rail will sit after sign-in, with the logo in the rail's colours, the landing page's three-line thesis (Wattle stripe on "You decide.") and "What happens next" as a numbered track, one step showing a Maintenance Request decision card; the form on white on the right (7/12), in a centred column 400 px wide on sign-in and 600 px on sign-up, under a Lexend 700 h1. The panel is sticky while the sign-up form scrolls. On phones and tablets it is one column: bar, form, Night panel, Night footer. The card fading in once is the only motion, and not under reduced motion. Under the form's 44 px submit button a hairline divides it from the other way in: a muted sentence and a full-width secondary button (**Create your Agency's account** on sign-in, **Sign in** on sign-up). The sign-up page's Share sentence and button sit under that.

After sign-up the onboarding wizard (`/welcome`) also fills the page, with no rail (`page({ fullPage: true })`). Its first step, connecting the Agency's email, can't be skipped: until email is connected every Property Manager page leads there (`requireEmailFirst`).

### The docket (Tickets only)

```
┌────────────────────────────┐
│ #12  [High]                │  stub: number and Urgency badge
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │  the perforation
│ 27 Llewellyn St            │
│ The cupboard under the sink│
│ Plumbing   4 Quotes   ●    │
└────────────────────────────┘
```

- White surface, 1 px `--line` border, 4 px radius, 12 px padding. It sits in a Paper lane, so it reads as a slip on a tray.
- The stub along the top holds the Ticket number (Lexend 600, tabular) and the Urgency badge (Urgent and High tinted, Routine quiet).
- A dashed hairline under the stub suggests the perforation of a docket book. Use the docket only for Tickets, on the dashboard board and as the Ticket page header (`size: 'large'`: a 26 px number, 8 px radius).
- Body: address (14 px 600, one line), issue (14 px, up to two lines), meta row (12 px `--muted`): Trade, Job progress, age, and an unread dot in Harbour with visually hidden text "unread messages".

## Components

All of these are in `src/web/ui.ts`; pages use them instead of hand-building markup.

- **Buttons** (`button`, `linkButton`, `postButton`): Lexend 600, 6 px radius. Sizes `sm` 32 px (rows and lanes), `md` 36 px (default), `lg` 44 px (a page's main way in, as on the landing page); every size is 44 px on phones and touch screens.
  - Primary: Harbour fill, white text, `--action-hover` on hover.
  - Secondary: surface fill with a 1 px `--control` border and Night text.
  - Ghost: Harbour text, no box, Paper on hover: a quiet action ("See all Tickets", "Sign out") that still reads as one. Inside a message it takes the message's colour.
  - daisyUI's `btn-secondary` is drawn as Secondary too, so there is one bordered look.
  - Danger: `--urgent` text on surface, red border on hover.
  - Labels are verbs that say what happens: "Confirm", "Send Quote Requests", "Send Work Order". No arrows.
- **Badges:** 13 px Red Hat Text 500, 1 px 8 px padding, 4 px radius, tinted from the token pairs, word always present. Trade and channel badges are Night on Paper; info is Harbour on `--info-bg`.
- **Count chips:** 22 px circles, Lexend 12 px 600, tabular. For decisions, Wattle with Night text; otherwise Paper with Night text.
- **Count strip:** one row (44 px) in a section box: chip and label pairs that link into the queues.
- **Queue rows** (`queueRow`): 4 px radius, hairline, 12 px padding. The title with the actions (Confirm, Review) at the end of its line, then the detail, then the badges with the age pushed to the end of their row. Only a row with `decision: true` gets the 4 px Wattle stripe on its left.
- **Lanes** (`lane`): a Paper tray of white dockets; the count is a muted number beside the title.
- **Tables** (`table`): 13 px, 36 px rows, headers in Lexend 600 Night, hairlines between rows, horizontal scroll only inside the table's frame. On phones (under 640 px) a table can stack instead:
  - `stack: true`: each row becomes a white block, the first cell leading and the rest in a wrapping row, headers hidden. For cells that explain themselves (badges, an age): the Tickets list.
  - `stack: 'labelled'`: the same block, but each value after the first sits beside its column's header in one aligned label column (8 rem, 13 px Slate), like a facts list. For plain values (names, money, counts): Properties, Tradies. A column with an empty header (actions) stays unlabelled.
  - On wider screens a stacked table's cells line up on their first line's baseline, so a badge sits level with the text beside it.
- **Forms:**
  - Label above the control (14 px 600).
  - Controls 36 px tall (44 px on phones and touch screens) with a `--control` border and 4 px radius; text is 16 px on phones so iOS doesn't zoom.
  - Under the control, the error first, then the hint. Hint 12 px `--muted`; field error 12 px `--urgent`, both tied to the control with `aria-describedby`. An error also marks the control `aria-invalid` and turns its border `--urgent`, for every kind of field (text, select, textarea, file, checkbox); a file field's Choose file button stays Paper.
  - Placeholders `--muted` and italic so they never look filled in.
  - Two-column field grids at 768 px and up.
- **Sections:** surface, 1 px `--line` border, 8 px radius, 16 px padding, no shadow, heading 16 px Lexend 600 with optional actions on the right.
- **Alerts** (`alert`, `flashMessage`): 8 px radius, the tone's pair (info is Night on `--info-bg` with a Harbour icon), an icon and the tone's word for screen readers. Links inside take the alert's text colour, underlined.
- **Steps** (sequences only: the Ticket's Job progress, the Tenant tracker, the setup guide): 24 px circles. Done is `--done` with a tick (and a done line between done steps); current is Harbour with its number; to come is a white circle on a hairline with a muted number.
- **Tabs** (`tabs`): Lexend, muted until current; the current one is Night 600 with a Harbour underline and `aria-current`. **Side tabs** (`sideTabs`, for Settings' sections): a column of 40 px Lexend 14 px links, the current one a white tab with a hairline and the Wattle bar; a sideways-scrolling row under 768 px.
- **Timeline:** Harbour dots on a `--line` rule, the time muted above each event.
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
- The app's icons: Dashboard `squares-four`, Dispatch `map-pin`, Requests `tray`, Tickets `ticket`, Approvals `seal-check`, Schedule `calendar-blank`, Properties `house-line`, Tradies `wrench`, Settings `gear-six`, Phone simulator `device-mobile`, menu `list`, user menu `caret-down`, done `check-circle`, warning and error `warning-circle`, note `info`, timeline dot `circle` (fill).
- **The logo** is `logo({ size })` in `src/web/ui.ts`: the key tag beside the wordmark. The rail and the public bar both use it; nothing else hand-builds it.
  - **The key tag:** a house-shaped tag with the key ring's hole at the top and an 8 cut out, the tag every Agency hangs on its key board. One solid shape (an even-odd path on a 256 grid, `currentColor`), so it holds at 16 px and works as an app icon as it is. It is Harbour on the white public bar and Wattle on the Night rail; Night on Wattle for an app tile.
  - **The wordmark:** "myEST8" in Lexend, "my" at 400 and "EST8" at 700, so the pun reads without decoration. Night on light, `--rail-text` on the rail.
  - Sizes: `md` (default) is a 28 px tag with 22 px type; `sm` is a 20 px tag with 18 px type.
  - The tag is `aria-hidden`, so the logo's accessible name is "myEST8". In the rail it is the link home.
  - Don't recolour the tag outside Harbour, Night and Wattle, outline it, or put it on a busy background.
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
  - Calendar: the week on screen, always with its `?week=` date.
  - Dashboard: the list of Maintenance Requests to review, shown when there are any.
  - Maintenance Request and Ticket pages: that page.
  - The Tenant's tracker: the tracker, to send to someone they live with.
- **Copy:** Property Manager pages carry the note "Only Property Managers in your Agency can open this link" (`COLLEAGUES_ONLY`). The tracker warns that anyone with the link can see the page.
- **Links** are absolute, built by `shareUrl(c, path?)` from the address the request came to, with any `?ok=` or `?error=` flash dropped.

### Importing from a spreadsheet

Each setup step that creates many records (Property Owners, Building Managers, Tradies, Properties, Tenants) has "Add many from a spreadsheet" on `/setup`, folded like the "Add" forms, and the guide's Tradies and Properties steps have the same uploads (`importPanel()` in `onboarding-forms.ts`). The guide lists them in the order they must happen: Property Owners, then Properties, then Tenants.

- **Panel:** one sentence on what happens, a file field (`.xlsx` or `.csv`, with the row and size limits as its hint), "Upload and review", and "Download template" with the `download-simple` icon. In the guide's stack of three, the upload buttons are secondary so "Continue" stays the one primary button.
- **Review page** (`/setup/imports/<token>`, `pages/import.ts`), titled "Review Properties":
  - A summary line of badges with their words: "3 ready", "1 needs a fix", "1 duplicate".
  - **Columns**: each column of the sheet, sample values, a "Goes to" select, and how it was matched: "Matched by name", "Matched by AI", "You chose", "Empty, ignored", or "AI not sure" with its guess. An unsure column is ignored until the Property Manager chooses, and a warning alert says so; the section is open only then.
  - **Rows**: Add (checkbox), Row (the spreadsheet's row number), Status ("Ready", "Needs a fix", "Duplicate" as badges), Notes ("Already added: …", "Adds … as a new Property Owner"), then the fields. A flagged cell is an input on `--high-bg` with its problem under it in `--high`; a cell that links to a record (Property Owner, Property, Property Manager, Building Manager) is a select of the Agency's records. Duplicates start unticked and are muted.
  - The buttons repeat the step's noun: "Add 3 Properties", then "Check changes" and "Discard upload". The count updates as rows are ticked (`// === import ===` in `app.js`); a line beside it says how many ticked rows still need a fix.
- **"Filled in by AI"** is the one bold mark: a Harbour chip on `--info-bg` with the `sparkle` icon, on every value the AI supplied and on columns it matched. Values worked out by a fixed rule ("From the address", "No rating in the sheet, so 3") are muted notes instead; when every row has the same one, it's said once under the column heading.
- AI answers below the confidence threshold are never applied: the column is ignored, or the cell is flagged with "The AI isn't sure. Its guess: Carpentry."

## Vocabulary

Each screen uses the same words for the same thing. `src/web/ui.ts` owns these labels; pages import them instead of writing their own.

### Job stages

The same labels and the same order appear in the dashboard lanes, the Ticket page's step indicator and every status badge.

| Status | Label | Shown as |
|---|---|---|
| `quoting` | Quoting | `--action` badge |
| `awaiting_owner` | With Property Owner | `--high` badge. As a step, it appears only when the Job needed approval. |
| `approved` | Ready to book | `--action` badge |
| `scheduled` | Booked | `--action` badge |
| `done` | Done | `--done` badge |
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
| Choose this Quote | |
| Send Work Order | |
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

- **Ticket page header.** It keeps the docket's stub, perforation and 26 px number, but it is built on the Ticket page rather than with `docket()`. It reads issue first, then the address (linked to the Property), then Tenant, status, reported and Max Repair Cost. Repair Cost shows only once it is above $0. One **Next step** line names what the Ticket waits on and links to that Job. It gets the Wattle stripe only when the step is the Property Manager's decision. Change Urgency is a small menu beside Share, not a form in the header.
- **Routine Urgency.** Routine shows as `--muted` text with a `--line` border. Ink text would read as more urgent than it is.
- **Decision rows.** Only rows that need a decision get the Wattle stripe. A row component takes `decision: boolean`; the stripe is never hard-coded.
- **One-Quote rule.** The rule is visible on the Ticket page next to Choose: "Choose once two Quotes are confirmed, or give a reason to go ahead with one." Choose stays enabled. Without a reason, the server's message explains what's missing.
- **Phone gutters.** 16 px below 1024 px.
- **Literal colours.** No literal colour values outside the token block in `app.css`, including white. Use `var(--surface)`.
- **Navigation (2026-10-13, replacing the three-item rail of 2026-10-10).** Dashboard, Dispatch, Requests, Tickets, Approvals, Schedule, a gap, Properties, Tradies, a gap, Settings, plus the demo's Phone simulator at the foot of the rail. The user asked for each queue to have its own place, so Calendar is Schedule again rather than moving into Dispatch's Tradie schedule; the Setup pages still move into Settings tabs.
- **The Tenant's progress tracker.** The Ticket page links to it, so a Property Manager can see what the Tenant sees.

## Copy

- Use `CONTEXT.md` terms exactly: Property Manager, Tenant, Tradie, Property Owner, Maintenance Request, Ticket, Job, Quote, Quote Request, Work Order, Urgency, Urgent Repair, Repair Cost, Max Repair Cost, Building Manager, Common Area, Trade.
- Plain verbs, sentence case, no filler. An action keeps its name through the flow: a "Send Work Order" button produces "Work Order sent".
- Errors say what happened and how to fix it. Empty states invite the next action.
