# myEST8 design system: the dispatch desk

myEST8 is where a Property Manager at a small Australian Agency sees every repair that needs a decision and moves it one step on. They work on a 1366-1440 px laptop at the desk and on a phone between inspections. The identity is green and gold: gum leaf and wattle, with the tradie's paper docket as the one object. Nothing is decorative; shape and colour carry meaning. The key-tag logo and the Phosphor icons are unchanged.

## What the identity commits to

- **Shape encodes type.** Only a Ticket is a docket. Everything else is a row or a section.
- **Gum means act.** Primary buttons, links, focus and the selected state are Gum. Done, approved and confirmed are Slate, kept off green so Gum always means "act".
- **Wattle is the decision.** The one memorable element on the desk is the full-height 4px Wattle bar on the left edge of the "Needs you" section. Wattle also marks the current rail item and the counts that need a decision. It is never text, never a button, never a wash.
- **No shadow** except `--shadow-lift` on menus, dialogs and the phone frame. Hierarchy comes from borders, spacing and weight.
- Sentence case everywhere: no all-caps, no letter-spaced eyebrows, no middle-dot meta strings, no arrows on labels.

## Colour

All colour is a token on `:root` in `src/web/static/app.css`. No literal colour appears outside that block (white is `var(--surface)`). The daisyUI theme `myest8` maps these tokens, and `TAILWIND_THEME` in `ui.ts` exposes them as utilities (`bg-page`, `text-muted`, `border-line`, `text-urgent`, `bg-info-bg`...).

| Token | Name | Hex | Role |
| --- | --- | --- | --- |
| `--ink` | Ironbark | `#1C2622` | Text, headings, the logo mark, the landing's closing band |
| `--page` | Gumleaf | `#ECEFE9` | The page behind sections, and the rail |
| `--surface` | White | `#FFFFFF` | Sections, rows, dockets, inputs |
| `--muted` | Bark | `#5C645E` | Secondary text, timestamps, hints, Routine |
| `--line` | Line | `#D4DAD1` | Hairlines and section borders (decorative) |
| `--control` | | `#7A847C` | Input, select and secondary button borders |
| `--action` | Gum | `#27694B` | Primary buttons, links, focus, selected |
| `--action-hover` | | `#1E553C` | Hover and pressed |
| `--hivis` | Wattle | `#FFC233` | The decision bar, the current rail item, decision counts |
| `--info-bg` | | `#E9F1EC` | "Filled in by AI" and info tints |
| `--urgent` / `--urgent-bg` | Rust | `#B23A1E` / `#FBEAE5` | Urgent, errors, destructive |
| `--high` / `--high-bg` | Ochre | `#9A5A0B` / `#FBF0DF` | High Urgency, warnings, flags |
| `--done` / `--done-bg` | Slate | `#3E5A72` / `#E7EEF4` | Done, approved, confirmed |
| `--rail`, `--rail-text`, `--rail-muted` | | Gumleaf, Ironbark, Bark | The rail |
| `--rail-hover` / `--rail-current` | | `rgb(28 38 34 / 0.06)` / `0.08` | Rail hover and current band |
| `--scrim` | | `rgb(28 38 34 / 0.45)` | Behind the open drawer |
| `--shadow-lift` | | `0 8px 24px rgb(28 38 34 / 0.16)` | The one shadow |

Every text pair meets WCAG AA (4.5:1 for text, 3:1 for control borders and icons). Measured: white on Gum 6.6:1; Ironbark on Wattle 11.8:1; Ironbark on White about 16:1; Bark on Gumleaf 5.4:1 and on White 6.0:1; Gum on `--info-bg` 5.9:1; each of Rust, Ochre and Slate on its own tint at least 4.5:1. Colour is never the only signal: badges carry the word.

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
- Focus: one 2px Gum outline offset 2px on every control (`:focus-visible`). Touch targets are 44px on phones and touch screens.
- Every page works at 390px with no horizontal scroll; tables scroll inside their own frame or stack.

## Layout

### App shell (`page()`)

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ [tag] myEST8 │ Dashboard             [Mine | All]    Sun 18 Oct  Alice ▾  │ page header row
│ (Gumleaf)    │ 2 Maintenance Requests to confirm and 1 Quote to choose.   │ count sentence
│▌Dashboard    │ ┌▌Needs you ──────────────────────────────────────────┐   │
│ Dispatch     │ │▌ row                                                │   │
│ Requests   2 │ │▌ row                                                │   │
│ Tickets      │ └─────────────────────────────────────────────────────┘   │
│ Approvals  1 │  page content (max-width 1280px, 24px gutters, 16 phone)  │
│ Schedule     │                                                           │
│ Properties   │                                                           │
│ Tradies      │                                                           │
│ Settings     │                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
 220px rail, 1px Line on its right
```

- **Rail.** Gumleaf background, Ironbark text, a 1px `--line` on its right. The logo (key tag in Ironbark, wordmark in Bricolage) links home. Nine places in three groups with a 12px gap: Dashboard (`/`), Dispatch, Requests, Tickets, Approvals, Schedule (`/calendar`); Properties, Tradies; Settings. Public Sans 500 15px, 40px tall, with a Phosphor icon (18px). The current item has a 4px Wattle bar on its left (inset shadow, following the 6px radius), weight 600 and `aria-current="page"`; hover is `--rail-hover`. Counts are plain Bark numerals; only Requests and Approvals (counts that mean "needs you", worked out by `loadNavCounts`) are a small Wattle chip with Ironbark text. Zero is not shown. A page under a place keeps it current.
- At the foot, quieter: the demo's Phone simulator link and the Agency's name.
- **Page header.** There is no separate top bar. The first row of the content column holds the `<h1>` (`.page-title`, Bricolage 28px/700, 24px on phones) on the left and, on the right of the same row, the page's controls (the Mine/All segmented control), today's date in the Agency's time zone, and the user menu (name, Sign out). On phones the row wraps: menu button and title, then the controls and the user menu. `page()`'s signature is unchanged; `controls`, `subtitle` and `actions` render in the same places.
- **Flash** messages appear under the page header as one line (`role="status"` or `role="alert"`).
- **Collapse menu** (from 1024px, JavaScript only) folds the rail to a 64px strip of icons; each label stays the link's name and shows as a tooltip; a waiting count becomes a 6px Wattle dot. The choice is remembered in `localStorage` and applied in `head()` before first paint. Under 1024px the rail is an off-canvas drawer opened by the menu button in the page header.

### Count sentence and "Needs you"

- `countSentence(items, { empty })` replaces the count strip (`countStrip` stays as an alias). One sentence under the title in 16px: "2 Maintenance Requests to confirm, 1 Quote to choose and 1 Tradie to rate." Each count is a link into its queue. Items take `{ label, one?, count, href, decision? }`; `one` is the wording for a count of 1. Counts of zero are left out. A count that needs a decision is Ironbark on a Wattle chip; the rest are Gum links. When nothing is left the sentence says so ("Nothing needs you right now.").
- `needsYou({ title?, actions?, body })` is the decision queue: one section with a full-height 4px Wattle bar on its own left edge (the section's `border-left`, not a stripe per row). `queueRow`s inside are hairline-separated, not cards. A row draws no Wattle of its own; its `decision` option is kept for callers. Nothing else on the page is Wattle except the rail's current item and decision counts.
- `aiFilled(content, { label?, edit? })` is the "Filled in by AI" style: `--info-bg` tint, 4px radius, a quiet "Filled in by AI" label, and an optional edit control. Use it only for text the AI wrote (a Summary); text a person wrote or edited, and the Tenant's own words, are not tinted.

### The docket (Tickets only)

```
┌────────────────────────────┐
│ #12  [High]        2 days  │  stub: number (Bricolage 20px) and Urgency
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │  the perforation
│ The cupboard under the sink│  issue (the Summary), 16px
│ 27 Llewellyn St            │  address, Bark
│ Plumbing   4 Quotes        │  stage line
└────────────────────────────┘
```

- White, 1px `--line` border, 4px radius, 12px padding. It sits in a Gumleaf lane, like a slip on a tray.
- Reading order: the stub (number in Bricolage 700, the Urgency badge, the unread dot, the age at the right), the dashed perforation, then the issue at 16px (up to three lines; `lines` changes it), the address in Bark (one line, full text in its title), and the stage line (`meta`: Trades and what the Ticket waits on).
- `size: 'large'` is the Ticket page header: the same order with the number at 40px.
- A docket draws no Wattle. Tickets waiting on the Property Manager are listed in "Needs you".

### Dashboard

The count sentence under the title, then the "Needs you" section (Maintenance Requests, Quotes to check, Site quotes to book, Quotes to choose, Tradies to rate), then Tickets by stage in lanes (a Gumleaf tray, 6px radius, of white dockets; the lanes follow `JOB_STAGES`, including Site quotes) and Next 7 days. On phones: one column.

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
- **Groups.** Pins closer than about 40 px (Properties and Tradies alike) become one group until the map is zoomed in: a 36 px white disc with a 2 px Ironbark ring and the number of pins in it, plus the worst Urgency's shape (18 px) on its shoulder when it holds an Urgent or High Property. It is a `role="button"` named "Group of 5 pins: 3 Properties and 2 Tradies, worst urgency high. Press Enter to zoom in."; a click or Enter zooms in to it. Pins still together at the deepest zoom (18, or the tiles' own limit) fan out instead. No coverage outline on hover.
- **The first view** fits the Agency's Properties (32 px padding, at most zoom 15), not every Tradie, so it opens on the streets that have work rather than all of Sydney.
- **Picking.** The picked pin gets a 3 px Gum ring over a pale disc and is drawn above the others; a group holding it gets a Gum outline. Picking a Property (from its pin or its row) zooms in only as far as needed for its pin to stand on its own, and draws the Tradie search radius (`TRADIE_SEARCH_RADIUS_KM`, 15, in `src/geo.ts`; the Settings page will make it the Agency's own) as a quiet ring: a 1.5 px Gum dashed line at 55% opacity, no fill. The map never zooms out to fit the ring.
- **Panel, not a tooltip.** Beside the map from 1024 px, under it on phones. It shows the street address, the open Tickets (each links to `/tickets/:id`) and up to five nearest Tradies within the radius, nearest first, with distance, Trades and both ratings (myEST8 and Google, never combined). A Tradie's panel shows their ratings and bookings. Opening it moves focus to its heading; Close or Escape closes it and puts the focus back on the pin or link that opened it.
- **Table.** The map is not usable with a keyboard or a screen reader on its own, so the table is the same information: every Property (most urgent first) with the address as a link that picks it, the suburb, the open Tickets and the worst urgency. A Property the map could not place says **Address not found** (a warning badge) and its panel says why it lists no Tradies. Opening the page never looks addresses up; while any are missing, the page header's **Look up missing addresses** tries them again (`geocodeMissing`, at most 10 Properties and 10 Tradies a time; a failing lookup never stops the page).
- **Phones (under 640 px).** The map is 55vh (18 to 32rem) with the panel under it. The Properties and Tradie schedule tables stack: each row is a white block on Gumleaf, the address first, then the suburb with the worst urgency at the end of its line, then the Tickets; a Tradie's block lists only the days with visits, each naming its day. They use their own `dispatch-stack` rules rather than `table({ stack })` in `ui.ts`, which can't carry the row header and `data-row` the picking needs. Nothing scrolls sideways at 390 px.
- **Keyboard.** Every pin is a focusable `role="button"` named by its address and tickets (or the Tradie's name and Trades): Tab to it, Enter or Space picks it (the name and key are set wherever Leaflet makes the element, as it makes it again whenever a group splits or forms). The map itself takes arrow keys and + / -. The scroll wheel zooms only after the map has been clicked or focused, so the page still scrolls.
- **Without JavaScript.** The map's place says it needs JavaScript. The table and a panel per Property work: a row's link goes to its panel (`:target`). The pin key is hidden.
- **Tradie schedule.** Rows are Tradies, columns today and the next six days in the Agency's time zone, from the same `calendar` bookings as the Calendar page. Each visit links to its Ticket and says Done, Reschedule requested or Not confirmed yet in words. Empty cells say "Nothing booked" to screen readers. There is no routing.
- **Pin data.** The page writes one `<script type="application/json" id="dispatch-data">` block with the tile source, the radius and the pins. `<`, `>`, `&` and U+2028/9 are written as `\uXXXX`, so an address cannot close the script or open a comment. The script builds every pin with DOM calls and `textContent`, never `innerHTML`; there are no inline handlers.
- **Tiles.** A light grey basemap, so the pins carry the colour. `mapTiles()` in `src/web/map-config.ts` gives the URL template, subdomains, attribution and maximum zoom. The choice is CARTO Positron (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`, subdomains abcd, credited "&copy; OpenStreetMap contributors &copy; CARTO", both linked), which since 25 September 2026 CARTO serves only with an API key: set `CARTO_BASEMAPS_KEY` (free, no account: carto.com/basemaps/apikey) and it is added as `?key=`. **Without a key the map falls back** to Esri's keyless World Light Gray Base (to zoom 16, credited "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ") rather than show CARTO's "API key required" notice. The hosted start-up log lists the key under real or off; a start never waits for it. Never OpenStreetMap's own tile server (`tile.openstreetmap.org`): its usage policy is not for production apps.
- **Where Tradies are.** A Tradie's business address is set with `setTradieAddress` and geocoded like a Property's. There is no form for it yet (the Tradie forms are owned by onboarding); the demo seed sets them.

### Landing page, sign-in and Tenant pages

- **Landing** (`landing.css`): bands alternate Gumleaf and White; the closing band is Ironbark with the logo in Wattle. The hero is a Bricolage headline (56 to 72px) on the left and the Tenant's thread becoming a Maintenance Request on the right. Only claims the app actually makes appear on the page.
- **Sign-in and sign-up** (`auth.css`): a split panel, Gumleaf with Ironbark type on the left and the form on White on the right. Errors are specific sentences beside the field, announced with `aria-describedby`. No onboarding panel on sign-in.
- **Tenant pages** (`tenant.css`): a white column on Gumleaf; the bar names the Agency and the page names the Property's street; the tracker's current stage carries the Wattle bar.

## Components

All of these are in `src/web/ui.ts`; pages use them instead of hand-building markup.

- **Buttons** (`button`, `linkButton`, `postButton`): Public Sans 600, 6 px radius. Sizes `sm` 32 px (rows and lanes), `md` 36 px (default), `lg` 44 px (a page's main way in, as on the landing page); every size is 44 px on phones and touch screens.
  - Primary: Gum fill, white text, `--action-hover` on hover.
  - Secondary: surface fill with a 1 px `--control` border and Ironbark text.
  - Ghost: Gum text, no box, Gumleaf on hover: a quiet action ("See all Tickets", "Sign out") that still reads as one. Inside a message it takes the message's colour.
  - daisyUI's `btn-secondary` is drawn as Secondary too, so there is one bordered look.
  - Danger: `--urgent` text on surface, red border on hover.
  - Labels are verbs that say what happens: "Confirm", "Send Quote Requests", "Send Work Order". No arrows.
- **Badges:** 13 px Public Sans 500, 1 px 8 px padding, 4 px radius, tinted from the token pairs, word always present. Trade and channel badges are Ironbark on Gumleaf; info is Gum on `--info-bg`. A badge sitting straight on the Gumleaf page takes `badge(text, tone, { outline: true })`: a white fill and a hairline, the tone's text kept, as a neutral badge's own fill is Gumleaf and would read as loose text.
- **Count chips:** 22 px circles, Public Sans 12 px 600, tabular. For decisions, Wattle with Ironbark text; otherwise Gumleaf with Ironbark text.
- **Outlined badge:** `badge(text, tone, { outline: true })` is a white fill with a border in the tone's own colour; the word still carries the meaning. It marks "Site quote" visits next to repair visits.
- **Filled in by AI:** see `aiFilled` above.
- **Queue rows** (`queueRow`): 4 px radius, hairline, 12 px padding. The title with the actions (Confirm, Review) at the end of its line, then the detail, then the badges with the age pushed to the end of their row. On phones (under 640 px) the actions move to their own line under the badges, so the title keeps the row's width. A row draws no Wattle; decision rows sit inside `needsYou`, which carries the one bar.
- **Lanes** (`lane`): a Gumleaf tray of white dockets; the count is a muted number beside the title.
- **Tables** (`table`): 13 px, 36 px rows, headers in Public Sans 600 Ironbark, hairlines between rows, horizontal scroll only inside the table's frame. On phones (under 640 px) a table can stack instead:
  - `stack: true`: each row becomes a white block, the first cell leading and the rest in a wrapping row, headers hidden. For cells that explain themselves (badges, an age): the Tickets list.
  - `stack: 'labelled'`: the same block, but each value after the first sits beside its column's header in one aligned label column (8 rem, 13 px Bark), like a facts list. For plain values (names, money, counts): Properties, Tradies. A column with an empty header (actions) stays unlabelled.
  - In a labelled row only the lead line of the first cell is 14 px 600 (a contact name under a business name keeps its own weight), and the label hangs in the cell's left edge so a value made of several pieces (a number and its words, badges) stays together.
  - On wider screens a stacked table's cells line up on their first line's baseline, so a badge sits level with the text beside it.
  - `rowHeader: true` makes each row's first cell a `<th scope="row">` (an address, a Tradie), drawn like the cells beside it. `rowAttributes[i]` gives row i its attributes (`data-row`, `data-selected`, `aria-*`): values are escaped, `true` writes a bare attribute, `false` leaves it out, and only plain lower-case names are allowed. A row with `data-selected` is tinted `--info-bg` (and, stacked, outlined in Gum).
- **Forms:**
  - Label above the control (14 px 600). A field's box has no padding above or below, so a button bottom-aligned beside it lines up with the control.
  - Controls 36 px tall (44 px on phones and touch screens) with a `--control` border and 4 px radius; text is 16 px on phones so iOS doesn't zoom.
  - Under the control, the error first, then the hint. Hint 12 px `--muted`; field error 12 px `--urgent`, both tied to the control with `aria-describedby`. An error also marks the control `aria-invalid` and turns its border `--urgent`, for every kind of field (text, select, textarea, file, checkbox); a file field's Choose file button stays Gumleaf.
  - Placeholders are `--muted` upright text, lighter than typed text, so they never look filled in.
  - Two-column field grids at 768 px and up.
- **Sections:** surface, 1 px `--line` border, 8 px radius, 16 px padding, no shadow, heading 20 px Bricolage Grotesque 600 with optional actions on the right.
- **Alerts** (`alert`, `flashMessage`): 8 px radius, the tone's pair (info is Ironbark on `--info-bg` with a Gum icon), an icon and the tone's word for screen readers. Links inside take the alert's text colour, underlined.
- **Steps** (sequences only: the Ticket's Job progress, the Tenant tracker, the setup guide): 24 px circles. Done is `--done` with a tick (and a done line between done steps); current is Gum with its number; to come is a white circle on a hairline with a muted number. The step on screen (`aria-current="step"`) also gets a 2 px Gum ring 2 px out, so "you are here" still reads when that step is done and shows its tick (a wizard step you came back to).
- **Tabs** (`tabs`): Bricolage Grotesque, muted until current; the current one is Ironbark 600 with a Gum underline and `aria-current`. **Side tabs** (`sideTabs`, for Settings' sections): a column of 40 px Bricolage Grotesque 14 px links, the current one a white tab with a hairline and the Wattle bar; a sideways-scrolling row under 768 px.
- **Timeline:** Gum dots on a `--line` rule, the time muted above each event, 12 px between events so it reads as a log.
- **Facts** (`dl`): a 10 rem label column, so a value sits near its label even in a wide column; in a box under 26 rem the label stacks over its value.
- **Chat** (simulator and message logs):
  - myEST8's messages on the left on Gumleaf; the person's on the right on Gum with white text. 8 px radius.
  - Links in a bubble take the bubble's text colour, underlined, so they read on Gum and on every tone (the global link colour would be Gum on Gum); their focus ring is the text colour too.
  - The channel is a small badge, the time is muted, and text keeps its line breaks.
- **Empty states** (`emptyState(text, action?)`): one sentence saying what will appear and the action to take, with no illustration. Give it the action whenever there is one. Standing alone on the page it is a white section (hairline, 8 px radius) with Ironbark text; inside a section, a lane or a table cell it is just the muted sentence and the action, with no box in a box.
- **Disclosures** (`<details>`): the summary gets a pointer, a Bark marker and the focus ring. A page may style its own summary (a menu, a button); these rules have zero specificity so it wins.
- **Segmented control** (`segmented`): 36 px on desktop like a button, 44 px on touch; it keeps its own width in a column.

### Icons and logo

- **Icons** come from [Phosphor](https://phosphoricons.com) (MIT) through `icon(name, { weight?, size? })` in `src/web/icons.ts`, rendered inline in `currentColor` and always `aria-hidden`. The word beside an icon carries the meaning. Don't add another icon set or hand-draw icons.
- **One weight: regular.** The only exception is the 14 px tick inside a done step circle, which uses bold so it doesn't thin out at that size.
- Sizes: 18 px in the rail (`size-[18px]`), 16 px for the Phone simulator link, 20 px in alerts and flash messages (the default), 24 px for the menu button, 16 px for the user menu caret and timeline dots.
- The app's icons: Dashboard `squares-four`, Dispatch `map-pin`, Requests `tray`, Tickets `ticket`, Approvals `seal-check`, Schedule `calendar-blank`, Properties `house-line`, Tradies `wrench`, Settings `gear-six`, Phone simulator `device-mobile`, menu `list`, user menu `caret-down`, done `check-circle`, warning and error `warning-circle`, note `info`, timeline dot `circle` (fill).
- **The logo** is `logo({ size })` in `src/web/ui.ts`: the key tag beside the wordmark. The rail and the public bar both use it; nothing else hand-builds it.
  - **The key tag:** a house-shaped tag with the key ring's hole at the top and an 8 cut out, the tag every Agency hangs on its key board. One solid shape (an even-odd path on a 256 grid, `currentColor`), so it holds at 16 px and works as an app icon as it is. It is only ever Ironbark, White or Wattle: Ironbark on the Gumleaf rail and the white public bar, White or Wattle on Ironbark bands; Ironbark on Wattle for an app tile.
  - **The wordmark:** "myEST8" in Bricolage Grotesque, "my" at 400 and "EST8" at 700, so the pun reads without decoration. Ironbark on light surfaces, White on Ironbark.
  - Sizes: `md` (default) is a 28 px tag with 22 px type; `sm` is a 20 px tag with 18 px type.
  - The tag is `aria-hidden`, so the logo's accessible name is "myEST8". In the rail it is the link home.
  - Don't recolour the tag outside Ironbark, White and Wattle, outline it, or put it on a busy background.
- **Favicon:** `/assets/favicon.svg`, the key tag alone, Ironbark in a light browser theme and Wattle in a dark one (`prefers-color-scheme` inside the SVG), linked from every page's head.

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
- **"Filled in by AI"** is the one bold mark: a Gum chip on `--info-bg` with the `sparkle` icon, on every value the AI supplied and on columns it matched. Values worked out by a fixed rule ("From the address", "No rating in the sheet, so 3") are muted notes instead; when every row has the same one, it's said once under the column heading.
- AI answers below the confidence threshold are never applied: the column is ignored, or the cell is flagged with "The AI isn't sure. Its guess: Carpentry."

## Vocabulary

Each screen uses the same words for the same thing. `src/web/ui.ts` owns these labels; pages import them instead of writing their own.

### Job stages

The same labels and the same order appear in the dashboard lanes, the Ticket page's step indicator and every status badge.

| Status | Label | Shown as |
|---|---|---|
| `quoting` | Quoting | info badge |
| `site_quoting` | Site quotes | info badge; Tradies visit the Property before the final Quote |
| `awaiting_owner` | With Property Owner | Ochre badge. As a step, it appears only when the Job needed approval. |
| `approved` | Ready to book | info badge |
| `scheduled` | Booked | info badge |
| `done` | Done | Slate badge |
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

- **Ticket page header.** It follows the docket's stub, perforation and number, but it is built on the Ticket page rather than with `docket()`. It reads issue first, then the address (linked to the Property), then Tenant, status, reported and Max Repair Cost. Repair Cost shows only once it is above $0. One **Next step** line names what the Ticket waits on and links to that Job. It may use a Wattle bar only when the step is the Property Manager's decision. The Ticket's tools sit in the docket header, at its top right from 1024 px: Share, Change Urgency (a small menu, not a form) and **Close Ticket**, which appears only when it can work, once every Job is done or cancelled.
- **Routine Urgency.** Routine shows as `--muted` text with a `--line` border. Ink text would read as more urgent than it is.
- **Decision rows.** Decision rows live in the "Needs you" section, which carries the one Wattle bar; no row or docket draws its own stripe.
- **One-Quote rule.** The rule is visible on the Ticket page next to Choose: "Choose once two Quotes are confirmed, or give a reason to go ahead with one." Choose stays enabled. Without a reason, the server's message explains what's missing.
- **Phone gutters.** 16 px below 1024 px.
- **Literal colours.** No literal colour values outside the token block in `app.css`, including white. Use `var(--surface)`.
- **Navigation (2026-10-13, replacing the three-item rail of 2026-10-10).** Dashboard, Dispatch, Requests, Tickets, Approvals, Schedule, a gap, Properties, Tradies, a gap, Settings, plus the demo's Phone simulator at the foot of the rail. The user asked for each queue to have its own place, so Calendar is Schedule again rather than moving into Dispatch's Tradie schedule; the Setup pages still move into Settings tabs.
- **The Tenant's progress tracker.** The Ticket page links to it, so a Property Manager can see what the Tenant sees.

## Copy

- Use `CONTEXT.md` terms exactly: Property Manager, Tenant, Tradie, Property Owner, Maintenance Request, Ticket, Job, Quote, Quote Request, Work Order, Urgency, Urgent Repair, Repair Cost, Max Repair Cost, Building Manager, Common Area, Trade.
- Plain verbs, sentence case, no filler. An action keeps its name through the flow: a "Send Work Order" button produces "Work Order sent".
- Errors say what happened and how to fix it. Empty states invite the next action.
