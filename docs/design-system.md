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
| `--action-divider` | | `rgb(255 255 255 / 0.4)` | The hairline in a split primary button, such as Add profile | decorative, no contrast target |
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
| `--viewer-backdrop` | | `rgb(19 33 46 / 0.85)` | The photo viewer: Night at 85% over the page | over Sand it blends to `#35404A` |
| `--viewer-control` | | `rgb(255 255 255 / 0.16)` | The circle behind the viewer's arrows and Close | white icon 6.4:1 |
| `--viewer-control-hover` | | `rgb(255 255 255 / 0.28)` | That circle on hover | white icon 4.6:1 (a graphic needs 3:1) |
| `--shadow-lift` | | `0 8px 24px rgb(19 33 46 / 0.18)` | The one shadow | |

- Routine Urgency is not coloured: `--muted` text on a `--line` hairline. Colour is never the only signal; every badge carries its word.
- Wattle is never text and never a button. It is 1.6:1 on white, so it only ever marks (a stripe, a bar, a chip behind Night text).
- The focus ring is Harbour everywhere except on the Night rail and in the photo viewer, where Harbour is too faint (2.3:1 on the rail, 1.4:1 on the viewer's blended backdrop), so those rings are `--rail-text`. Links inside a dark chat bubble take the bubble's own text colour, underlined, and so does their ring.

## Type

- **Display: Bricolage Grotesque** (variable, `@fontsource-variable/bricolage-grotesque`, the `opsz` file; the optical size axis is left to the browser). Page titles, section headings, docket numbers, the wordmark, landing headlines. Weight 600 for section headings, 700 for page titles and docket numbers. Letter-spacing -0.01em from 28px up. `--font-head`.
- **Text: Public Sans** (variable, `@fontsource-variable/public-sans`). Body, tables, forms, buttons, nav, badges. Weight 400 body, 500 nav and labels, 600 buttons and table headers. `--font-body`.
- Both are served from this server: `src/web/assets.ts` copies the two woff2 files from the packages (an allowlist under `/assets/fonts/`), `app.css` declares the `@font-face` rules, and `head()` preloads both.
- Scale (px): 12 meta; 13 dense tables and badges; 14 body; 16 lead and docket issue; 20 section heading; 28 page title and docket number (large); 40 docket number on the Ticket page; landing 48 to 72. Line height 1.45 body, 1.1 headings. Measure 72ch maximum. Tabular figures with the `num` class.

## Shape, space and elevation

- Radius: 4px on rows, badges, inputs and dockets; 6px on buttons and segmented controls; 8px on sections and alerts. Borders are 1px `--line`.
- **Squircles are for hover and press fills only.** A fill that answers the pointer on a row or link inside a card (Profiles' Tenant, Ticket, Tradie and unlinked rows, the Owner's name in its tab, the Add profile menu items) is a squircle: `corner-shape: squircle` with a 14px radius where the browser supports it, and a 10px rounded rectangle where it doesn't. The fill is inset from the card's edges, never a full-bleed stripe: Sand on hover, `--line` while pressed, over `--dur-fast` and `--ease-out`. Cards, sections, badges, buttons and dockets keep their radii, so shape still says what a thing is.
- **An icon beside text that may wrap sits on the first line** (an address chip, a contact link, a card's address, a Ticket on Profiles): the row aligns to the top and the 16px icon moves down by `(1lh - 16px) / 2`. Icons beside one line of text centre on it; every icon is within 1px of its text's centre.
- Spacing steps 4, 8, 12, 16, 24, 32. Content column max 1280px with 24px gutters (16px under 1024px).
- No shadow except `--shadow-lift`.
- **Motion answers an action and shows what changed.** A pressed button gives a little and springs back. A menu or dialog grows from the control that opened it and leaves faster than it came. Content swapped in place cross-fades. The Mine/All thumb slides to its new place, and the rail's current band moves to the new page where the browser supports view transitions. Motion is quick (120 to 360 ms) and springy only where something is pressed or opened. One page-load moment is allowed: the dashboard's glance bubbles settle in on the first visit of a browser session. Nothing loops, nothing enters on scroll, and tables, dense lists and the Schedule grid don't move. The durations and curves are the `--dur-*` and `--ease-*` tokens on `:root`. `prefers-reduced-motion` sets them to nothing and removes every transition, animation and view transition.
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
│ Profiles     │                                                           │
│ Settings     │                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
 220px rail, 1px Line on its right
```

- **Rail.** Night background with `--rail-text`, no border. The logo (key tag in Wattle, wordmark in Bricolage) links home. Eight places: Dashboard (`/`), Dispatch, Tickets, Archive, Approvals, Schedule (`/calendar`), then Profiles (`/profiles`, the households and Tradies) with no group heading (the group holds one item, and that item is already called Profiles), then Settings after a 12px gap (`.rail-gap`). Public Sans 500 15px, 40px tall, with a Phosphor icon (18px). The current item has a 4px Wattle bar on its left (an inset shadow on `.rail-indicator`, following the 6px radius), weight 600, white text and `aria-current="page"`. Where the browser supports view transitions, that band moves to the new page. Hover is `--rail-hover`; focus rings in `--rail-text`. A count that changed since the last page in this browser session pops once. Counts are plain `--rail-muted` numerals; only Tickets (new Maintenance Requests) and Approvals (Quotes waiting on a Property Owner and Reimbursement Requests to review; counts that mean "needs you", worked out by `loadNavCounts`) are a small Wattle chip with Night text. Zero is not shown. A page under a place keeps it current.
- At the foot, quieter: the demo's Phone simulator link and the Agency's name.
- **Page header.** There is no separate top bar. The first row of the content column holds the `<h1>` (`.page-title`, Bricolage 28px/700, 24px on phones) on the left and, on the right of the same row, the page's controls (the Mine/All segmented control), today's date in the Agency's time zone, and the user menu (name, Sign out). It is one grid for every page: the title and the date, bell and user menu always share the top row, so the title never wraps mid-word and the user menu never sits on a line of its own. The controls go between them when they fit and on their own row underneath when they don't. That is decided by the content column's width (a container query), so collapsing the rail counts. A Mine/All switch alone sits beside the title from 40rem; controls with a search or a select (Dispatch, Profiles, Schedule) need 68rem. On phones the user menu shows just the initials. `page()`'s signature is unchanged; `controls`, `subtitle` and `actions` render in the same places.
- **Loading and in-page navigation** (the last block of `app.js`). A 3px Harbour bar runs along the top of the window while a page or a form's reply is on its way; it creeps towards the end and the next page replaces it (shown still under `prefers-reduced-motion`). A form on its way (`aria-busy`) shows its buttons as busy. A link or GET form that stays on the same page and only changes the query (the Schedule's views, previous, next and Mine/All; Settings' sections; Mine/All toggles; trade filters; filter bars) fetches the page and swaps `#main`'s content in place, cross-fading where the browser supports view transitions: the address bar, the title and Back/Forward follow, focus returns to the control used, and the content dims only if the reply takes over 150 ms. Setup that enhances elements registers with `onContent(root => …)` so it runs again on the new content. A reply for another path, an error, or a page with a script of its own (Dispatch's map) loads as an ordinary page. Moving to another page cross-fades the same way, and the rail's current band slides across where view transitions can name it.
- **Hover fills the box.** Anything that is one target (a stacked table row, a queue row, a filter chip, a listing result, a Tradie to pick) takes Paper across its whole box on hover, not just an underline or a border; the row's title link is stretched over the row and the other controls in it sit above.
- **Flash** messages appear under the page header as one line (`role="status"` or `role="alert"`).
- **Collapse menu** (from 1024px, JavaScript only) folds the rail to a 64px strip of icons; each label stays the link's name and shows as a tooltip; a waiting count becomes a 6px Wattle dot. The choice is remembered in `localStorage` and applied in `head()` before first paint. Under 1024px the rail is an off-canvas drawer opened by the menu button in the page header.

### Count strip, count sentence and filters

- `filterBar({ action, filter, urgencies, trades, properties, hidden?, compact? })` is the one filter over a list (Tickets, Archive): a GET form of small labelled selects in a wrapping row that keeps Mine/All in a hidden field. `app.js` submits it on change and hides its Apply button; a Clear filters link shows once a filter is set. Pages read it with `listFilterOf(c)` (`src/web/list-filter.ts`), which drops unknown values.
- `countStrip(items)` is the dashboard's row of counts: each a tile linking into its queue, the number in Lexend 26px 600 under a 3px Harbour line, plain type with no underline; a zero turns Slate. Items take `{ label, count, href, decision?, tone? }`; a `tone` above zero adds a small dot beside the label: `attention` Wattle, `urgent` red (and a red number). Two tiles per row under 640 px, three from 640 px, and one row of six from 1024 px.
- `countSentence(items, { empty })` is the other pages' counts (Approvals and the desk pages). One sentence under the title in 16px: "2 Maintenance Requests to confirm, 1 Quote to choose and 1 Tradie to rate." Each count is a link into its queue. Items take `{ label, one?, count, href, decision? }`; `one` is the wording for a count of 1. Counts of zero are left out. A count that needs a decision is Night on a Wattle chip; the rest are Harbour links. When nothing is left the sentence says so ("Nothing needs you right now.").
- `aiFilled(content, { label?, edit? })` is the "Filled in by AI" style: `--info-bg` tint, 4px radius, a quiet label after the `sparkle` icon (14px, `aria-hidden`; "Filled in by AI" unless `label` says more), and an optional edit control. The sparkle is the one mark on every AI-written thing: the Summary, a drafted follow-up, an import's AI values, an email Haiku wrote in a message log. Use it only for text the AI wrote; text a person wrote or edited, and the Tenant's own words, are not tinted. A profile read that used a model puts the same label beside the sentence (`profileRead`), not above it.
- `profileRead(read)` is the sentence at the top of a Tenant, Property Owner, Building Manager or Tradie profile. The sentence is an `<h2>` in the display face at 20px/600, with no eyebrow. Under it, chips carry the numbers: concern is Ochre (`badge` warning), good is the done green (`badge` success), and a neutral chip is muted on a line. The words carry the meaning. When a judgment was used, the line is tinted `--info-bg` and the "Filled in by AI" label sits beside the sentence. No history is one quiet line, "No history yet", instead of the block.

### Dashboard: soft cards

One screen on a window at least 928 px tall (shorter ones scroll a little rather than squeeze the lists). "Hi, {first name}" and one line of what waits ("3 things need you today · 4 messages in the inbox") lead; under it two columns (1.2 : 1) of soft cards (22 px radius, no hairline, `--shadow-soft`).

```
┌ Hi, Alice   3 things need you today · 4 messages in the inbox ─────────────────────────────┐
├──────────────────────────────────────────┬─────────────────────────────────────────────────┤
│ Your day at a glance  (bubbles)          │ Inbox (Night)  latest 3, "Check all N messages" │
├──────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ Do next                                  │ Next 7 days (day chips + next visit)            │
│  Urgent Repairs (when any)               ├─────────────────────────────────────────────────┤
│  Maintenance Requests, then alerts       │ Tickets by stage (bar, counts, one row each)    │
└──────────────────────────────────────────┴─────────────────────────────────────────────────┘
```

- **Your day at a glance** (Sand-tan `#E4D9C6`): a legend (Open Tickets, Alerts, Maintenance Requests, Inbox, and Urgent Repairs when one needs a receipt, each with its count) and bubbles sized by count, within a cap: Open Tickets Harbour, Alerts clay `#E98B6D`, Requests Wattle, Inbox Night, Urgent red. Open Tickets, Quotes and Urgent open the Tickets list (`/tickets`, keeping `?filter=all` when the dashboard is on All). The list has no view that is only quote decisions or Urgent Repairs, so those two use that list. Requests opens `/requests`. Inbox and Alerts open a dialog over the dashboard. The legend items are the same links and openers. A small arrow under the count means the bubble opens a page; a tray means it opens a dialog. Hover grows the bubble slightly, and the focus ring is the 2px Harbour outline. Without JavaScript, Inbox and Alerts are anchors to their sections (`#inbox`, `#alerts`). The bubbles settle in once, on the first visit of a browser session, and they don't float. `prefers-reduced-motion` skips the entrance.
- **Inbox and Alerts dialogs** (`<dialog id="inbox-dialog">`, `<dialog id="alerts-dialog">`): the same rows the Inbox card and Do next already draw, so linking a sender, routing, dismissing and each alert's action still post as they do there. A Bricolage section heading, Close at the top right, `--shadow-lift`, 8px radius, a `--scrim` backdrop, at most 640px wide, and a full-screen sheet under 480px. The list scrolls inside. An empty Inbox says "The inbox is empty."; empty Alerts says "No alerts." Close, Escape, or a click on the backdrop closes it and returns focus to the bubble or legend item that opened it.
- **Do next**: Urgent Repairs first when there are any (white rows with a thin red edge), then Maintenance Requests (oldest first), then alerts. Each is a soft Sand row with its title (two lines at most), the street, its age and one or two actions: Confirm (a Harbour pill) and Review for a request; one outlined action for an alert. The Urgency and Trade badges stay on the Review page. With none of either, one quiet line says so.
- **Inbox** (Night card): the three newest messages as one-line previews (initials, sender, the start of the message, when), a count pill and a Wattle button, "Check all N messages", which opens every message with its actions (link the sender, route, dismiss) in a panel over the cards below it (from 928 px tall; in the flow on shorter and narrower windows). Newest first. The preview rows link to their message in the panel.
- **Next 7 days**: seven day chips (today filled with Night, a Harbour dot under a day with a visit), then the next visit as one line (day, Tradie, issue and street, time) and "+N more visits this week" linking to `/calendar`.
- **Tickets by stage**: a segmented bar and five counts (Quoting, With owner, Ready, Booked, Done) show where the open Tickets are, then one soft row per Ticket in workflow order: its number, the issue, the street, the age, what it waits on and Urgency when High or Urgent, and a five-segment progress marker filled up to its stage with the stage's name. Stage colours step from Harbour to a pale blue, then green for Done. The core works out the stage, Quote counts and decisions (`views.dashboard`); the page only draws them. With no open Tickets it is one empty state.
- Setup is not on the dashboard. While the Agency is unfinished the rail shows an outlined "Setup guide" link above Collapse menu, pointing at the next step still to do.
- Phone and narrow windows: one column, in the order Your day at a glance, Do next, Inbox, Next 7 days, Tickets by stage; nothing scrolls inside a card except the open message list.

### Tickets: soft cards

`/tickets` is one bar and two cards. The Archive keeps its table (`ticketTable`).

- **The bar**: stage tabs on the left (All open, then each stage that has a Ticket, with its count; Ready to close has a Wattle count) and the compact Urgency, Trade and Property selects (`filterBar` with `compact`, labels read by screen readers only). A tab is a link (`?stage=quoting`) that keeps Mine/All and the other filters; the selects keep the tab in a hidden field. A Clear link shows once a tab or filter is set. The filters sit under the tabs when the window is too narrow for one row.
- **New Maintenance Requests**: one light-blue card (`--info-bg`) per request: up to three photos (Flagged tag where a photo's metadata was flagged, then "+n"), the Summary, the address, Urgency, Trade and any flags, who reported it and when; Review and Confirm on the right (under the text on phones).
- **Open Tickets**: a grid of cards (four across on a wide window), most urgent first and then oldest: photo, number, unread and Urgency, Trade and Reported boxes, the issue, the address, a five-segment stage bar with the stage's name (the colours of the dashboard's Tickets by stage), and View ticket. A Ticket whose Jobs are all done or cancelled reads "Done · ready to close" and also has Close ticket, which asks first. A "Stages" legend sits under the grid.

### Dispatch: the map

`/dispatch` (`src/web/pages/dispatch.ts`, `static/dispatch-map.js`) shows where the Agency's Properties and Tradies are, so a Property Manager can see which Tradies are near a Property with work waiting. Leaflet 1.9.4 draws OpenStreetMap tiles; Leaflet's JS, CSS and images are served from `/assets` (`assets.ts` allowlists each file by name) so the map works offline apart from the tiles.

```
┌ pin key: ▲ Urgent  ◆ High  ● Routine  ○ No open Tickets  ■ Tradie ┐
├──────────────────────────────────────────────┬────────────────────┤
│ map  (24rem tall, 32rem from 1024px)         │ panel: the picked  │
│                                              │ Property or Tradie │
├──────────────────────────────────────────────┴────────────────────┤
│ Properties: Address  Suburb  Open Tickets  Worst urgency           │
├────────────────────────────────────────────────────────────────────┤
│ Tradie schedule: Tradie × today and the next six days              │
└────────────────────────────────────────────────────────────────────┘
```

- **Pins.** A Property is a 32 px pin: the shape is the worst open Ticket's Urgency (triangle Urgent, diamond High, filled circle Routine, open circle none) and the number inside is how many open Tickets it has. Colours are tokens (`--urgent`, `--high`, `--muted`, `--surface` with a `--muted` outline), so colour only backs up the shape. A Tradie is a 26 px `--ink` square with the initial of the business, drawn under the Property pins. The pin key above the map names each shape in words. The picked pin gets a 3 px Harbour ring and a Harbour dashed ring of the Tradie search radius (`TRADIE_SEARCH_RADIUS_KM`, 15, in `src/geo.ts`; the Settings page will make it the Agency's own). The map fits the ring when a Property is picked.
- **Panel, not a tooltip.** Beside the map from 1024 px, under it on phones. It shows the street address, the open Tickets (each links to `/tickets/:id`) and up to five nearest Tradies within the radius, nearest first, with distance, Trades and both ratings (myEST8 and Google, never combined). A Tradie's panel shows their ratings and bookings. Opening it moves focus to its heading; Close or Escape closes it and puts the focus back on the pin or link that opened it.
- **Table.** The map is not usable with a keyboard or a screen reader on its own, so the table is the same information: every Property (most urgent first) with the address as a link that picks it, the suburb, the open Tickets and the worst urgency. A Property the map could not place says **Address not found** (a warning badge) and its panel says why it lists no Tradies; its address is looked up again each time the page opens (`geocodeMissing`, at most 10 Properties and 10 Tradies per visit, a failing lookup never stops the page).
- **Keyboard.** Every pin is a focusable `role="button"` named by its address and tickets (or the Tradie's name and Trades): Tab to it, Enter or Space picks it. The map itself takes arrow keys and + / -. The scroll wheel zooms only after the map has been clicked or focused, so the page still scrolls.
- **Without JavaScript.** The map's place says it needs JavaScript. The table and a panel per Property work: a row's link goes to its panel (`:target`). The pin key is hidden.
- **Tradie schedule.** Rows are Tradies, columns today and the next six days in the Agency's time zone, from the same `calendar` bookings as the Calendar page. Each visit links to its Ticket and says Done, Reschedule requested or Not confirmed yet in words. Empty cells say "Nothing booked" to screen readers. There is no routing.
- **Pin data.** The page writes one `<script type="application/json" id="dispatch-data">` block with the tile source, the radius and the pins. `<`, `>`, `&` and U+2028/9 are written as `\uXXXX`, so an address cannot close the script or open a comment. The script builds every pin with DOM calls and `textContent`, never `innerHTML`; there are no inline handlers.
- **Tiles.** The tile URL template, attribution and maximum zoom are one value, `MAP_TILES` in `src/web/map-config.ts`, defaulting to OpenStreetMap's public tile server. OSM's tile policy is not for heavy production use: before wider use, change that one value to a provider the Agency has an account with.
- **Where Tradies are.** A Tradie's business address is geocoded like a Property's, and only a point in Australia is kept. Adding one from a Google listing stores the listing's address. **Look up missing addresses** fills in a Tradie who already has a listing and no address. The demo adds them the same way.

### Landing page (`/` signed out)

The front door is the dispatch desk at an editorial scale, built from the same tokens (`pages/landing.ts`, styles in `static/landing.css`, loaded only there). A three-line Lexend headline: "Tenants text the problem. / You decide. / myEST8 does the chasing.", where only "You decide." carries the Wattle stripe, because Wattle means "needs your decision" everywhere. Beside it, the one bold element: a Tenant's SMS thread with the words the intake agent used for the Trade and Urgency marked in Harbour's tint (the "Filled in by AI" colour), and the resulting Maintenance Request as a decision card. Two large (44 px) actions with the sign-up page's wording: **Create your Agency's account** (primary) and **Sign in**. Then the workflow as a dispatch log (weekday times, a numbered track, a Wattle "You" chip on the Property Manager's decisions), what waits for you against what myEST8 handles, and a closing Night band like the rail. The only motion is a "now" marker stepping down the workflow, with a Pause button; under reduced motion nothing moves. No stat blocks, no gradients.

**No plain text with an inline link on any public page.** Every link is a real button (`linkButton`) or sits in a nav bar. The public bar's `headerActions` are ghost small buttons: the landing page's bar has **Sign in** (ghost) and, from 640 px, **Create your Agency's account** (primary); `/login` and `/signup` carry only **Home**, so the sign-in page has exactly one control named Sign in. The sentence around a button ("Already have an account?") is plain text above it.

**Demo sign-ins** (demo deployments only) sit under the workflow, below a hairline, as a bordered list with one row per demo Property Manager: name and email as text, and a secondary button "Sign in as Alice Archer" (or Bob Baker). Each button is a `<form method="post" action="/login">` with hidden email, password and next fields, so one click signs in. The password is also written out as text, and none of it appears outside demo mode.

### Sign-in and sign-up pages (`/login`, `/signup`)

Both fill the viewport (`authPage()` in `src/web/auth-card.ts`, styles in `static/auth.css`, loaded only there). From 1024 px the page splits: a full-height Night panel on the left (5/12), where the rail will sit after sign-in, with the logo in the rail's colours, the landing page's three-line thesis (Wattle stripe on "You decide.") and "What happens next" as a numbered track, one step showing a Maintenance Request decision card; the form on white on the right (7/12), in a centred column 400 px wide on sign-in and 600 px on sign-up, under a Lexend 700 h1. The panel is sticky while the sign-up form scrolls. On phones and tablets it is one column: bar, form, Night panel, Night footer. The card fading in once is the only motion, and not under reduced motion. Under the form's 44 px submit button a hairline divides it from the other way in: a muted sentence and a full-width secondary button (**Create your Agency's account** on sign-in, **Sign in** on sign-up). The sign-up page's Share sentence and button sit under that.

After sign-up the onboarding wizard (`/welcome`) also fills the page, with no rail (`page({ fullPage: true })`). Its first step, connecting the Agency's email, can't be skipped: until email is connected every Property Manager page leads there (`requireEmailFirst`).

### Approvals: soft cards

`/approvals` (`pages/approvals.ts`) is one white panel (28 px radius, soft shadow) under the page title.

- **Stages**: a chevron bar summarising the lists that have rows (Waiting on a Property Owner in Harbour, No reply for 48 hours in Wattle, Reimbursement Requests in the info tint), each with its count in a small round chip and a line under it (the Quotes' total and the longest wait, "Reminder sent · needs you", the claims to review and the oldest). It is a summary, not navigation: the stages are not links, and nothing in the bar or the cards reacts to the pointer, so nothing looks clickable that is not. A stage is at most 22 rem wide. With only one list the bar is left out (the list's heading names it), and the line that would be under its stage sits in a white pill at the right of the heading, so the same name never shows twice.
- **Motion** says what the page is, work moving through stages: the bar draws itself left to right, one stage after another (0.55 s each); the cards then settle in; a Quote's red ring fills to how far over its limit it is (0.9 s); and the count of the stage that needs the Property Manager pulses softly. Under `prefers-reduced-motion` none of it moves.
- **Cards** (each list has a heading on a grey band (`#E6E4DF`) with a darker grey edge, 20 px bold, and its count in a Night chip, then a card for each approval): a tinted status panel on the left (red when the Property Owner has not replied for 48 hours, sand while the reminder is not due, Wattle-tinted for a receipt to review, info-tinted for a claim awaiting a receipt or with the Property Owner), then the Ticket or the claim with its address chip, then the figures. A Quote shows the Property Owner (initials and phone), the Quote as a tile and how far over the limit it is (a red ring with the percentage of the Max Repair Cost, the amount over, "$980.00 of $400.00"); "Show more" folds the date it was asked and the Max Repair Cost. A claim shows the Tenant, the Property Owner and the Amount as a tile (a dashed "Not given, waiting for the receipt" tile when there is none); the action it needs (Forward to Owner, or Mark reimbursed) stays in view in the card.
- **Nothing waiting**: the page is one sentence and, when filtered to Mine, a link to show all. With rows, the panel ends with a quiet "That's everything waiting on approval."
- **Phones**: each card is one column: the status panel, the main block, then each figure under its label. The stage bar's chevrons stack.
- Not included from the design: Sort and Filters (neither exists yet) and the call and email buttons on a row (the Property Owner's number is a link in its column).

### Ticket page: soft cards

`/tickets/:id` keeps every action it had; only the layout changed.

- **Header**: "‹ Tickets" above the title, the Urgency badge beside it, one line under it (the Trades, the address, when it was reported and by whom), then Share, Change Urgency and Close Ticket (once every Job is done or cancelled) as pills. The page header on every page now has the date with a calendar icon, an alerts bell (links to the dashboard's alerts) and the user's initials in a circle. `page()` takes `back` and `titleExtra` for the link and the badge.
- **Summary band**: inside a 2 px dark-yellow outline (`#C8961A`), a white Summary card (the "Filled in by AI" pill, the issue large, the address, the status and an underlined "Edit summary") with a stage ring on its right (the stage's name sits inside it, at most about 88 px wide), and under it a slim dashed strip, "+ Add another Job", that opens its form in place. The status is a quiet green dot and a word, not a pill, so it doesn't read as a button. The ring fills by how many of the Job's stages are done (stages that were not needed don't count), is green and says "Done" when all are, else names the stage the Job is at; under it "5 of 7 stages done, 2 not needed".
- **Main column**: the Job card (Trade and stage, tiles for the Tradie, the visit, the price and the Tenant's rating, then its next action and "More about this Job") beside What the Tenant reported (a 120 px photo with, beside it, their words and the four answer tiles two to a row) from 1280 px, stacked while a Job is open because its tables need the room. Then Progress.
- **Progress**: a green strip (stage chip, "5/5 Stages done", "Completed on", "Took N days") and the card: tools (print, edit the Summary, expand to fill the screen, Escape to close) and three tabs. Timeline is a board with a column for each stage that has events (Reported, Estimates, Site inspection with a quiet "Not needed" when skipped, Firm Quote, With Property Owner, Ready to book, Booked, Done), the events as small cards, scrolling sideways (drag it with the mouse, or use the slider under it); the Job tab is the stage tracker; Costs lists the Quotes with the Repair Cost, the Max Repair Cost and any Call-out Fees. Without JavaScript the three show one under another.
- **Side column** (from 1024 px, a square-cornered grey panel `#D9D6D0` as tall as the Summary band and the Jobs and report cards beside it, which stretch to match): People on this Ticket (initials: Tenant, Property Manager, each Tradie with a Work Order), two cost tiles with an icon chip (Repair Cost on light blue, Max Repair Cost on Sand; Rust-tinted when over the Max; "Costs" opens the Costs tab, "Change" goes to the Property), Call-out Fees owed under them, the Next card ("Needs you" and a Wattle edge when it waits on the Property Manager; when the Next step is rating the Tradie, the 1 to 5 round buttons are in it), the messages (kept to about 12 rem, scrolled to the newest, with "Show the whole conversation") and Ticket details as four small tiles. The Progress under both columns runs the full width; its Timeline board scrolls sideways with a visible slider.
- **Phones**: one column in the order Summary, Next, the Job and what the Tenant reported, Progress, messages, people, costs, details.

### Maintenance Request page: soft cards

`/requests/:id` (`pages/requests.ts`) has the Ticket page's look, built from the same pieces.

- **Header**: "‹ Tickets" above the title, the Urgency badge beside it, one line under it (the Trade, the address, when it was reported and by whom) and Share as a pill.
- **Summary band**: inside the 2 px dark-yellow outline, a white Summary card ("Filled in by AI", the issue large with its pencil, the address chip and "Waiting for you" as an amber dot and a word, not a pill) with a stage ring on its right that says "To confirm" ("Step 1 of 2, then it opens as a Ticket"; hidden on phones). Under it, three small tiles: Tenant, Reported and Property Manager.
- **Cards**: Photos (120 px thumbnails, the flagged line and the match result) beside The Tenant's answers (their words, then four answer tiles) from 1280 px; stacked below that.
- **Side column** (from 1024 px, a square-cornered grey panel `#D9D6D0`, as tall as the cards beside it): People on this request (initials for the Tenant and the Property Manager), To check when there is one, Decide (a Wattle edge and a "Needs you" chip; Urgency, Trade tile, Confirm as the one primary action, Reject folded away) and Follow up.
- **Phones**: one column in the order Summary, People, Decide, Follow up, Photos, answers.

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

### Dashboard: details that carry over

- "Do next" also lists the Tickets waiting on a Quote decision, as groups under the Maintenance Requests: Quotes to check, Site Inspections to book and Quotes to choose (a group with none is left out). They count together as the **Quotes** bubble, which opens the Tickets list.
- Next 7 days: today and the six days after it in the Agency's time zone, as a strip of seven day chips. Each chip links to that day (`/?day=YYYY-MM-DD#next-7-days`), keeping Mine or All. Choosing a chip loads only that section from `GET /next-7-days` (the same calendar window the dashboard already reads; Mine and All do not narrow those visits) and updates the address, so the greeting and the rest of the page stay. The chip's href is still the whole dashboard: if the section cannot be loaded, the browser follows it, and Back and Forward load the dashboard the usual way. Mine and All keep the chosen day and return to the strip (`#next-7-days`). The chosen day (today when `day` is missing or not one of the seven) is filled with Harbour's tint and marked `aria-current="date"`; today's chip carries the visually hidden word today, and keeps a Harbour ring when another day is chosen. A dot marks a day with a visit. Under the strip, a heading names the day ("Thursday 23 October") and only that day's visits are listed, including one that has already ended, in time order: the time (a column wide enough for 12:30 pm, so the issue starts at one edge), the Tradie, the issue and street, and a Site inspection badge when it is one. An empty day says "Nothing booked on Thursday." Open calendar links to that day (`/calendar?view=day&date=…`) and keeps All (`filter=all`). An invalid day, on the page or on `/next-7-days`, falls back to today.
- Setup is not on the dashboard. While the Agency is unfinished the rail shows an outlined "Setup guide" link above Collapse menu, pointing at the next step still to do (`loadSetupLink`).
- `countStrip` stays in the design system but the dashboard no longer uses it; the bubbles replace it.

### Dispatch: the queue and the map

`/dispatch` (`src/web/pages/dispatch.ts`, `static/dispatch-map.js`) shows where the Agency's Properties and Tradies are, so a Property Manager can see which Tradies are near a Property with work waiting. MapLibre GL JS (6.x) draws a light grey vector basemap and works out which pins overlap; the pins and groups are HTML buttons laid over it. MapLibre's module, worker and stylesheet are served from `/assets` (`assets.ts` allowlists each file by name, `vercel.json` ships them from `node_modules/maplibre-gl/dist/`), so only the basemap's style, tiles and fonts come from the network.

```
┌ map card (43rem from 1024px, 55vh on phones) ─┬ Today at a glance (4 soft tiles) ─┐
│  count chip; the picked Property or Tradie    ├ To dispatch (count, View queue)   │
│  floats over the map                          │  a soft card per Job, most urgent │
├───────────────────────────────────────────────┴───────────────────────────────────┤
│ Properties (count, All / Open tickets / High & urgent tabs, address search)       │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Cards are soft: white, 1px `--line`, 16px radius. The glance tiles are Paper-tinted (Ochre-tinted when Tradies are needed, Harbour-tinted when Jobs are ready to book, a red number for High or urgent). Each Job card has a Ticket box (number) beside what it needs. The tabs and search over the Properties table are JavaScript only (`dispatch-map.js`); without it the whole table shows. A row's arrow opens the Property's details over the map.

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
- **Table.** The map is not usable with a keyboard or a screen reader on its own, so the table is the same information: every Property (most urgent first) with the address as a link that picks it, the suburb, the open Tickets and the worst urgency. A Property the map could not place says **Address not found** (a warning badge) and its panel says why it lists no Tradies. Addresses are placed by Nominatim, OpenStreetMap's geocoder ([ADR 0012](adr/0012-nominatim-for-geocoding.md)), which may not know a rural or brand-new street; such a Property is still added, without a pin. Opening the page never looks addresses up; while any are missing, the page header's **Look up missing addresses** tries them again (`geocodeMissing`, at most 10 Properties and 10 Tradies a time; a failing lookup never stops the page). A Tradie with a Google listing and no address counts as missing: the lookup reads the listing, stores the address, then geocodes it.
- **Phones (under 640 px).** The map is 55vh (18 to 32rem) with the panel under it. The Properties tables stack: each row is a white block on Paper, the address first, then the suburb with the worst urgency at the end of its line, then the Tickets. They use their own `dispatch-stack` rules rather than `table({ stack })` in `ui.ts`, which can't carry the row header and `data-row` the picking needs. Nothing scrolls sideways at 390 px.
- **Keyboard.** Every pin and group is a real `<button>` marker named by its address and tickets (or the Tradie's name and Trades): Tab to it, Enter or Space picks it. A pin's button is the same element for as long as it stands alone, and a group's button goes when it splits. The map itself takes arrow keys and + / -; the compass, rotation and tilt are off with mouse, touch and keyboard, so it stays north-up and flat. The scroll wheel zooms only after the map has been clicked or focused, so the page still scrolls. Zoom controls are MapLibre's `NavigationControl` (+ and − only), top left.
- **Without JavaScript, WebGL or the basemap.** Without JavaScript the map's place says it needs JavaScript. With it, but without WebGL, or when MapLibre or the basemap's style fails to load, the script replaces the map with "The map could not load. The table below lists the same Properties, each with its Tickets and urgency." (a tile, sprite or font that fails after the style is in only leaves the basemap plain; the pins stay). The queue, the table and a panel per Property work in every case: a row's link goes to its panel (`:target`).
- **No Tradie schedule.** Who is booked when is the Schedule's (below); a Tradie's panel still lists their visits over the next 7 days.

### Schedule: Day, Week and Month

`/calendar` (`src/web/pages/calendar.ts`; `src/web/schedule-layout.ts` places the visits) shows every booked visit in the Agency's time zone. `?view=day|week|month&date=YYYY-MM-DD&filter=all`; Week is the default, and the older `?week=` still opens that week. It reads as a calendar a Property Manager already knows from Teams or Outlook, in this app's colours and type: the period is a title beside the arrows, each day is a column, and a visit is a compact block.

- **Toolbar.** One row. **Today** is an outlined button, then the previous and next arrows (icon buttons named "Previous week" and "Next week", and the same for a day or a month), then the period as a heading in Bricolage 20px: "12 – 18 October 2026", "26 October – 1 November 2026", "28 December 2026 – 3 January 2027" when the week spans two years, "Tuesday 13 October 2026" for a Day (the share text names that same day), "October 2026". On the right, Day / Week / Month (`Calendar views`, drawn as a switch) and Mine / All (`Whose visits`), then Share. Under 768 px the switch and filter wrap to a second row. Today is always there, even when the period shown is already this one.
- **Soft card layout.** The page is one white card (18px radius, soft shadow) in three columns. The Paper rail (17rem) holds the small month (Monday first, today a Night circle, the days in the period tinted, a Wattle dot under a day with a visit, each day linking to its Day), Showing and Visits tiles, the Visit types boxes (Work Orders, Site Inspections, Not confirmed yet, Reschedule requested; they hide blocks in the browser, so the group is hidden until app.js runs) and the Tradies rail. The middle is a Paper toolbar band (Today and the Day / Week / Month pills on the left, the period and arrows on the right) over the grid. The right column is the **Picked visit** panel: every visit's details are written in the page, hidden, and clicking a visit on the grid shows its card (status pill, issue, kind and Ticket number, time and length, date, Suggest new times for a reschedule request, the Tradie with Trades and myEST8 rating, Property, Property Manager under All, Job, time zone, and an Open Ticket button). It opens from 1280px and is always shown from 1600px; below 1280px a visit is a link to its Ticket. Under 1024px the rail drops under the grid. The Tradie, Property and Status filters (`?tradie=`, `?property=`, `?status=`, applied when changed) come first in the page header's controls, then Mine / All and Share.
- **Time grid.** Hour lines with the times in a 3.5rem gutter ("8 am", right-aligned just under the line) over 15-minute rows, 7 am to 7 pm, grown to the whole hours around any visit outside them (one range for the whole week). Half-hour lines are the same `--line` at lower opacity. Rows grow to fit what is on them; the hours, days and lanes are CSS subgrids of one grid, so everything lines up. The frame is at most `min(40rem, 100dvh - 16rem)` tall and opens scrolled to an hour before the first visit, or to 7 am (`data-schedule-open`, moved by `app.js`); without JavaScript it starts at the top of the working day. It scrolls inside its frame, a focusable region, never the page.
- **Week** (from 768 px). Seven day columns, Monday first. The weekday is Public Sans 12px in Slate, the date Bricolage 20px; both are centred, they stick to the top of the frame, and the date opens the Day. Today's date is a white numeral on a 32px Harbour circle (`aria-current="date"` on the date link, and not also on the column), and its column is tinted `--info-bg`. Saturday and Sunday sit on Paper. A visit is a white block with a 4px left edge linking to its Ticket: the time and the issue in bold, then the Tradie. The edge is Harbour, Ochre for a reschedule, Wattle when that reschedule waits on this Property Manager, and Done green when the visit is done. A Site inspection keeps the Harbour edge and adds a Harbour-on-`--info-bg` marker. An hour or less is one line, the start time and as much of the issue as fits; the link's accessible name still reads the full time, the issue and the Tradie. Visits that overlap (directly or through another) fold into one Harbour-on-`--info-bg` block over their time, "2 Jobs booked", that opens the Day. Under 768 px the Week is the list of days, restyled with the same date and circle, a run of empty days folded into one line.
- **Now.** A 2px Rust (`--urgent`) line across today's column, with an 8px dot in the gutter, placed by the server from the Agency's time zone. The line carries `data-now` (that instant, epoch milliseconds) and `data-today` (the Agency's date). It is drawn whenever today is on the grid, and `hidden` when the clock is outside the hours shown, so it can appear when those hours begin. `app.js` takes the offset between `data-now` and `Date.now()` once, does not move the line on load, and then moves it each minute by that server time plus the time since the page opened. It hides the line when the Agency's date is no longer `data-today`. It has no transition, so it does not animate, including under `prefers-reduced-motion`.
- **Day.** The same grid for one day, with the same line when the day is today, and a lane per visit running at once (greedy interval colouring), each lane at least 14rem. A visit is the Week's block with room for the rest of the card: the street and suburb ("12 King St, Newtown"), the Tradie's business name linking to their profile, the Property Manager when All is on, and "Reschedule requested" linking to the Ticket's suggested times. The issue links to the Ticket, and its accessible name includes the address. A visit alone at its time takes the whole width. A weekend day sits on Paper. Week blocks stay the short time, issue and Tradie.
- **Month.** The same toolbar. A table of weeks (column headers Mon to Sun), the days of the months either side on Paper with muted numbers, today's number a Harbour circle (`aria-current="date"` on that link, not the cell). A day lists up to two visits as pills with a 4px coloured edge (time and issue, one line); with more, or any that overlap, it says "N Jobs booked", opening the Day. On phones a booked day shows only the count, 44 px tall.
- **Tradies rail.** The Agency's Tradies on the left, busy ones first and then those free today by business name: initials in a Harbour circle, the business name, how many visits they have in the period shown ("2 visits this week", "No visits today"), and a green Free tag for a Tradie with no visit today (only when today is in the period; the heading then says "(N free today)"). Each is a link that filters the grid to that Tradie; the one filtered to, with a Harbour edge, links back to everyone. The list scrolls inside about 19rem.
- **Text equivalent.** The hour lines are `aria-hidden`; every visit is a list item in its day's list whose link or card names its time, issue and Tradie, so the grid reads as text in time order.
- **Pin data.** The page writes one `<script type="application/json" id="dispatch-data">` block with the basemap's style URL, the radius and the pins. `<`, `>`, `&` and U+2028/9 are written as `\uXXXX`, so an address cannot close the script or open a comment. `static/dispatch-map.js` is an ES module (MapLibre 6 ships ES modules only) that imports `/assets/maplibre-gl.mjs` once it runs, and MapLibre starts its worker from `/assets/maplibre-gl-worker.mjs` beside it. The script builds every pin with DOM calls and `textContent`, never `innerHTML`; there are no inline handlers.
- **Basemap.** A light grey vector map, so the pins carry the colour: OpenFreeMap's Positron style, `https://tiles.openfreemap.org/styles/positron` (`MAP_STYLE_URL` in `src/web/pages/dispatch.ts`, written into the pin data as `style`). It is free and needs no key, so there is nothing to configure and the map is the same in development, CI and production. MapLibre shows the credit OpenFreeMap requires, "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (each part linked), in the map's bottom-right corner; it comes from the style's own tile source, so it must not be hidden or replaced. OpenFreeMap serves the style, tiles, sprites and fonts from `tiles.openfreemap.org`; the app sends no Content-Security-Policy on its pages, so nothing needs allowing. If one is added, MapLibre needs `worker-src blob:` plus `connect-src` and `img-src` for `tiles.openfreemap.org` (and `blob:`/`data:` images). Never OpenStreetMap's own tile server (`tile.openstreetmap.org`): its usage policy is not for production apps. The browser tests answer the style request with a blank style, so they never wait on a tile download.
- **Where Tradies are.** A Tradie's business address is geocoded like a Property's, by Nominatim, and only a point in Australia is kept (`setTradieAddress`). Adding one from a Google listing stores the listing's address; the add form shows it, filled in, so it can be corrected, and the profile's Business address form sets it the same way. A Tradie already in the Agency with a Google listing and no address counts as missing: **Look up missing addresses** reads the listing, stores the address, then geocodes it (at most 10 Tradies a time; a Places failure is skipped and tried on the next press). The demo adds them the same way: a listing's address comes from the listing, and one not on Google is set with `setTradieAddress`.

### Landing page, sign-in and Tenant pages

- **Landing** (`landing.css`): bands alternate Paper and White; the closing band is Night with the logo in Wattle. The hero is a Bricolage headline (56 to 72px) on the left and the Tenant's thread becoming a Maintenance Request on the right. Only claims the app actually makes appear on the page.
- **Sign-in and sign-up** (`auth.css`): a split panel, Night with `--rail-text` type and the key tag in Wattle on the left, and the form on White on the right. Errors are specific sentences beside the field, announced with `aria-describedby`. No onboarding panel on sign-in.
- **Tenant pages** (`tenant.css`): a white column on Paper; the bar names the Agency and the page names the Property's street; the tracker's current stage carries the Wattle bar.
- **Offer visit times** is the chosen Tradie's step on their quote page (`/q/:token`), in that same column. It names the street, when the Tenant is usually home, and how long the visit takes, then a required Preferred time and up to two more (Another time, A third time). The button is "Offer visit times". When the Tenant has asked for other times, the form also shows what they said.
- **Book this visit** (`/v/:token`) is the Tenant's confirm page, the same column and bar. It names the Tradie and the street, and has one button, "Book Tuesday 27 Oct, 9:00 am". The Tradie's preferred time says "This is the Tradie's preferred time." Opening the link does not book the visit. **None of these work** asks "When are you usually home?" (Weekday mornings, Weekday afternoons, Saturdays, Any time) and an optional note, then "Ask for other times". Opening that link does not save anything. Once the visit is booked, every link from that email (any time, None of these work, the booked email's "Need another time?") shows the confirmed block, "✓ Booked: Tue 27 Oct, 9:00 am", then the offered times and "None of these work" as disabled buttons, then a secondary "Need another time?" that asks the Tradie for a new round. Opening the page does not start that round; the button does. The visit stays booked until a new time is picked. After asking, the block reads "✓ Asked for another time" and "Need another time?" is disabled; after None of these work, "✓ Asked for other times" with the times disabled.
- **Confirm this time** (`/v/confirm/:token`) is the page a Property Manager's booked or moved visit links to, the same column and bar. It names the visit and has one button, "Confirm Friday 13 Nov, 2:00 pm". Opening the link does not confirm. A secondary button, "Need another time?", asks for another time; opening that link does not start the ask. Once the Tenant confirms or asks, both links show the same page: the confirmed block ("✓ Confirmed: Fri 13 Nov, 2:00 pm", or "✓ Asked for another time"), then both buttons, disabled where they no longer apply. A moved visit names its current time, never the one in an old message.
- **Email buttons.** A line that is only a short label and a URL (40 characters or fewer) is a button: "Tue 27 Oct, 9:00 am", "None of these work", "Need another time?", "Confirm this time", "Offer visit times", "Say when you're home". "None of these work" and "Need another time?" are outlined (white fill, Harbour border and text); the others are filled. A label ending " (preferred)" loses that mark on the button and gains the caption "Tradie's preferred time" under it. The same words, without the mark, are the link's text.

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
- **Profile read** (`profileRead`): the sentence at the top of a person's profile, before the facts. See `profileRead` above.
- **Add a person:** Tenants, Property Owners, Building Managers and Tradies are added on their own page (`/tenants/new`, `/owners/new`, `/building-managers/new`, `/tradies/new`), the same form the list used to carry at the bottom. The page title is "Add a Tenant" (and the same shape for the others). The rail stays on the list. A ghost "Back to Tenants" (or the matching list) sits in the header. A refused save is that page again, with the reason and what was typed. The welcome wizard and Setup keep their own forms.
- **Links to records.** A link's shape says what it leads to; plain underlined text is kept for links inside a sentence.
  - `entityLink(kind, label, href)`: a record mentioned beside something else (the Property under a Ticket, a Ticket's Tenant, a Tradie on a Quote): a pill with a hairline, the record's icon in Harbour (`house-line` Property, `user` Tenant, `wrench` Tradie, `ticket` Ticket) and its name in Night; Harbour edge and `--info-bg` on hover.
  - `rowLink(label, href)`: the title of a row in a list (a Tradie, a Tenant, a Property): Night 600, underlined on hover only; in a stacked table it covers the whole row.
  - `contactLink('mobile' | 'email', value)`: a phone or envelope icon with the number or address, in Harbour.
- **Metrics.** Numbers a Property Manager compares in a table or beside a quote sit in a Paper chip with the number at 14 px 700 and its context quiet: `ratingChip` ("myEST8 ★ 4.7 (3)", an Ochre star; `named: false` under a column that already says whose; "Not on Google" dashed). Screen readers hear "myEST8 4.7 from 3 ratings". Dispatch lists a Tradie's ratings as plain text inside the Tradie entry instead, and there is no distance chip: a distance is text with a ruler.
- **Urgency.** `urgencyBadge`: Urgent is solid Rust with a warning octagon, High tinted Ochre with an up arrow, Routine quiet with no icon.
- **Searchable selects.** `field({ type: 'select', search: true })` (and the filter bar's Property) becomes a text box that filters the options as you type (app.js): every word must appear in the option's label or `keywords` (a Property's address, suburb and postcode via `propertyOptions`; a Tradie's business, Trades and own name via `tradieOptions`). Arrow keys move, Enter picks, Escape puts back what was picked. The select stays in the form, hidden, and holds the posted value; without JavaScript it is a plain select.
- **Address suggestions.** A Property's Address (`propertyPlaceFields`, on Properties, Setup and the welcome wizard) offers matching street addresses as it is typed (app.js, after 300 ms). Arrow keys move, Enter picks, Escape closes the list. The highlighted option is `aria-selected="true"` and the rest are `"false"`. Choosing one fills Address, Suburb and a hidden pin. Shortening the query below 3 characters, choosing a suggestion, Escape or leaving the field drops a reply that is still on its way, and the list is not opened while the field isn't focused. Without JavaScript it is a plain text box and the address is geocoded on save. Suggestions come from Photon ([ADR 0012](adr/0012-nominatim-for-geocoding.md)).
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
- **Confirmed block** (`doneBox`, `.tenant-done` in `tenant.css`): what a no-login page saved, in `--done` on `--done-bg` with a 1 px `--done` border, 8 px radius, 16 px 600, a tick before the words (hidden from screen readers) and `role="status"`. It stays on the page, unlike a flash. Every action page an email button opens uses it: "✓ Booked: Mon 16 Nov, 9:00 am", "✓ Confirmed: Mon 16 Nov, 9:00 am", "✓ Marked done on Tue 27 Oct", "✓ You declined this Quote Request.", and the upload thank-you.
- **Steps** (sequences only: the Ticket's Job progress, the Tenant tracker, the setup guide): 24 px circles. Done is `--done` with a tick (and a done line between done steps); current is Harbour with its number; to come is a white circle on a hairline with a muted number; skipped (`state: 'skipped'`: a stage that didn't happen and won't, such as "Not needed") is a muted dash in a dashed ring, never ticked and never current. A step is ticked only when it really happened, never because a later one began. The step on screen (`aria-current="step"`) also gets a 2 px Harbour ring 2 px out, so "you are here" still reads when that step is done and shows its tick (a wizard step you came back to).
- **Tabs** (`tabs`): Bricolage Grotesque, muted until current; the current one is Night 600 with a Harbour underline and `aria-current`. **Side tabs** (`sideTabs`, for Settings' sections): a column of 40 px Bricolage Grotesque 14 px links, the current one a white tab with a hairline and the Wattle bar; a sideways-scrolling row under 768 px.
- **Timeline:** Harbour dots on a `--line` rule, the time muted above each event, 12 px between events so it reads as a log.
- **Facts** (`dl`): a 10 rem label column, so a value sits near its label even in a wide column; in a box under 26 rem the label stacks over its value.
- **Photo grid** (`photoGrid`): thumbnails in 2, then 3, then 4 columns. Each is a square crop in a hairline box, with its caption (when it was taken, a metadata flag) under it in 12 px Slate. Every photo is a link to the full image in the same tab, and the list is marked `data-photo-grid`. With JavaScript a click opens the photo viewer; Ctrl-click, Cmd-click, Shift-click, Alt-click, the middle button and the context menu still do what the browser does. Without JavaScript it is that link, and Back returns.
- **Photo viewer** (the "photo viewer" block in `app.js`, one `<dialog class="photo-viewer">` reused by every grid): the whole page, Night at 85% (`--viewer-backdrop`), no border, radius or shadow. The photo is as large as the room left by the chrome, kept in proportion, 4 px radius, with the caption under it in 13 px `--rail-text` (8.6:1 on the blended backdrop). With more than one photo, Previous and Next are 48 px circles (`caret-left` and `caret-right`, white on `--viewer-control`) beside the photo, and a counter under the caption reads "2 of 5". The arrows wrap from the last photo to the first. Under 640 px the arrows leave the sides and share a footer row with the counter, so nothing covers the photo. Close (`x`, top right), Esc or a click on the backdrop closes it, and focus returns to the photo that opened it. Arrow keys, and a horizontal swipe of more than 48 px, move between photos. The dialog is named "Photo 2 of 5" and the counter is a polite live region. It fades and scales in. Previous and Next stay instant. The page behind does not scroll.
- **Chat** (simulator and message logs):
  - myEST8's messages on the left on Paper; the person's on the right on Harbour with white text. 8 px radius.
  - Links in a bubble take the bubble's text colour, underlined, so they read on Harbour and on every tone (the global link colour would be Harbour on Harbour); their focus ring is the text colour too.
  - The channel is a small badge, the time is muted, and text keeps its line breaks.
  - An email Haiku wrote (ADR 0011) says so after its time, muted like it: "· ✦ Written by AI", the 14 px filled `sparkle` then the words. A message sent as its template's text has no mark. No tint: the bubble stays the message.
- **Empty states** (`emptyState(text, action?)`): one sentence saying what will appear and the action to take, with no illustration. Give it the action whenever there is one. Standing alone on the page it is a white section (hairline, 8 px radius) with Night text; inside a section, a lane or a table cell it is just the muted sentence and the action, with no box in a box.
- **Disclosures** (`<details>`): the summary gets a pointer, a Slate marker and the focus ring. A page may style its own summary (a menu, a button); these rules have zero specificity so it wins.
- **Segmented control** (`segmented`): 36 px on desktop like a button, 44 px on touch; it keeps its own width in a column.

### Icons and logo

- **Icons** come from [Phosphor](https://phosphoricons.com) (MIT) through `icon(name, { weight?, size? })` in `src/web/icons.ts`, rendered inline in `currentColor` and always `aria-hidden`. The word beside an icon carries the meaning. Don't add another icon set or hand-draw icons.
- **One weight: regular.** The only exception is the 14 px tick inside a done step circle, which uses bold so it doesn't thin out at that size.
- Sizes: 18 px in the rail (`size-[18px]`), 16 px for the Phone simulator link, 20 px in alerts and flash messages (the default), 24 px for the menu button, 16 px for the user menu caret and timeline dots.
- The app's icons: Dashboard `squares-four`, Dispatch `map-pin`, Tickets `ticket`, Archive `archive`, Approvals `seal-check`, Schedule `calendar-blank`, Properties `house-line`, Tradies `wrench`, Tenants `users`, Property Owners `key`, Building Managers `buildings`, Settings `gear-six`, Phone simulator `device-mobile`, menu `list`, user menu `caret-down`, AI mark and Draft with AI `sparkle`, done `check-circle`, warning and error `warning-circle`, note `info`, timeline dot `circle` (fill).
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

### Server SMS phone

`serverSmsPanel({ from, number, current })` in `src/web/pages/server-sms.ts` is the one component for the server's SMS phone (textbee, ADR 0013). The welcome wizard's Channels step, the Setup page and Settings all render it when `ChannelConnectors.smsPhone` is set, so the three can't drift. The pages don't read the environment. While it is set, the typed number and code and `smsNumberPanel` are not shown.

- **Not connected:** "Tenants text +61 412 345 678. This is the server's SMS phone." The number is bold. **Connect SMS** is a primary small button. There is no code: the phone is the server's.
- **Connected** (`current` is that number): the number in bold, one line that it is the Agency's SMS number, and **Disconnect**, a secondary small button. Disconnect posts straight away. There is no confirmation page, because the phone stays the server's.
- A second Agency is told "This server's SMS number is connected to another Agency."
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
Business name, Contact name, Mobile, Email, Business address, Trades, Starting rating   [Add Tradie]
```

- **Results** are a list (`aria-label="Google listings"`) of links to `?google=<query>&place=<placeId>`, so choosing works without JavaScript. Each is a bounded entry like the Dispatch Tradie entry: a 1 px `--line` border, 6 px radius, 12 px padding, white (`.listing-result`). The name is Bricolage 16 px 600 and the address 14 px Slate. The chosen one is `aria-current="true"` with `--info-bg` and a Harbour border, and says "Chosen" with a tick so colour isn't the only signal.
- **The card** (`.listing-card`) has the same boundary and sits above the form: the name, the address, then `dl` rows for Phone, Website, Google rating and the Trades Jev suggests. A row is left out when Google has nothing for it. A landline is shown with "Not put in Mobile, because myEST8 texts that number."
- **The form** appears only once a listing is chosen or "Not on Google? Enter their details yourself" (`?manual=1`) is. Until then there is just the search and its results. The listing is a hidden `placeId`, never a radio group: the listing's id, or `none` for not on Google.
- **Filled in from the listing:** the business name; the Mobile when the phone is an Australian mobile (04… or +614…); the business address; the Trades Jev suggests, ticked. Under the Trades: "Suggested from their Google listing. Check them." or, when Jev suggested none or failed, "Choose their Trades." The contact name, the email and the starting rating are always the Property Manager's to give. An empty business address keeps the listing's own.
- **When Google fails** while loading a listing, the page shows "Google search isn't working right now. Try again, or mark the Tradie as not on Google." and the manual link. When Jev fails the form still fills in, with no Trades ticked.
- **A refused form** comes back to the same choice: the form posts to a URL that carries `google`, `place` or `manual`. The wizard shows the posted values again; Setup and the Tradies page redirect back (`listingParams` builds the address) and fill in from the listing again. Nothing is stored until Add Tradie.

### Editing a profile's details

A Tenant, Property, Tradie, Property Owner or Building Manager profile edits its details in place, by the same pen-to-edit pattern as the Summary on a Maintenance Request. `editPen()` and `detailsForm()` in `ui.ts` are the two parts; the profile pages use them, so don't copy their markup.

```
┌────────────────────────────────────────────┐
│ Max Repair Cost   Property Owner       [✎] │  the details, the pen at the side
│ $500.00           Olivia Owens             │
└────────────────────────────────────────────┘
        ── press the pen ──▶  /properties/3?edit=details#details
┌────────────────────────────────────────────┐
│ Address          Suburb                    │  the form takes the details' place
│ Property Owner   Property Manager  ...     │
│ [Save]  Cancel                             │
└────────────────────────────────────────────┘
```

- **The pen** is an `.icon-btn` (36 px, Harbour `pencil-simple`) with the accessible name and tooltip "Edit details". It is a link to `?edit=details#details`, so it works without JavaScript. It sits at the right of the details (`.details-head` beside `.details-body`); on a Tradie it sits beside the Trade badges.
- **The form** replaces the displayed details in the same `section` (`id="details"`), with the fields and pickers used to add the same record (a Property's `propertyFields()` is shared by both). Save is the primary button and Cancel a ghost link to the plain profile, in `.details-actions`. A Tradie's form leaves out the starting rating, and the Google listing and business address stay where they are. The rest of the page stays below it.
- **Saving** goes back to the profile with the "Details saved." flash. **A refused save** shows the same form again with the status 400: what was typed stays, and the error sits under its field (`aria-invalid`, `.field-error`). An error the form can't point at (a Tenant who has already left their Property) is a message above the details instead.
- **A shared address.** A mobile or email another person in the Agency also uses has a quiet note under it (`.shared-with`, 14px Slate): "Also Hana Ho (Tenant)". Two or more are "Also Hana Ho (Tenant) and Pete Park (Tradie)". Each name is a Harbour link to that profile. The note is on the Tenant, Tradie, Property Owner and Building Manager profiles, and only while the details are shown, not in the edit form.
- **Who can't be edited:** a Tenant who has left has no pen, and neither does a Property Owner or Building Manager who has been removed. Their history stays as it was.

### Removing a Tradie

A Tradie's profile (`/tradies/:id`, `pages/tradie.ts`) has **Remove Tradie** in the page's actions, before Back to Tradies.

- **The button** is `postButton` in the Danger variant (`--urgent` text on surface, small), with the same `data-confirm` ask as removing a Tenant: "Nina's Plumbing won't be offered for new Jobs. Their past Quotes and ratings stay on the Tickets they belong to." Confirming posts to `/tradies/:id/remove` and lands on `/tradies` with "Nina's Plumbing removed".
- **Refused** while they have an open Quote Request, a Quote waiting on a Property Owner, an approved Quote for a Job with no visit booked yet (it would be stranded in Ready to book), or a visit booked today or later. The reason names it ("Nina's Plumbing has a visit booked on Thursday 8 October at 9 am. Cancel or finish it first.") and shows as the profile's error flash.
- **Gone from** the Tradies list, Dispatch's entries and pins, Quote recommendations and the Ask for Quotes list, the Nominated Tradies picker (and every Property's Nominated Tradies), Free today on the Schedule, the spreadsheet import's matching and the weekly Google ratings refresh. Most read `people()` and `tradiesWithTrade()` in `profiles.ts`, which leave out a Tradie with `removed_at`; the refresh (`google-ratings.ts`) has its own query with the same condition.
- **Their profile** still opens from old links. An info alert says "Removed from the Agency on 8 October 2026." (long month, in the Agency's time zone), the Remove button and the Business address form are left out, and the Quotes, bookings and ratings stay.

### Property Owners and Building Managers

The lists are `/owners` and `/building-managers` (`pages/owners.ts`), in the Profiles group after Tenants. Each is the Tradies table: name (a row link to the profile), mobile, email, and Properties (the ones they own, or the ones they look after), stacking with labels on a phone. A person with neither a mobile the Agency can text nor an email gets a warning badge, "No way to reach", under their name. An email is enough; a mobile counts only while SMS is connected.

- **Add** is the same form Setup uses (`addPersonForm` in `onboarding-forms.ts`), posting to `/setup/owners?from=list` or `/setup/building-managers?from=list`. Saved, it comes back to the list. Setup, without `from=list`, is unchanged.
- **The profile** shows mobile and email with the pen, then the Properties as links, and for an Owner their approvals (newest first, each linking to its Ticket). Remove sits in the page actions before Back, Danger, and asks first: an Owner "won't be asked to approve repairs" and a Building Manager "won't be listed for Common Area issues."
- **Refused** while they still own or look after a Property. The flash names them ("Olivia Owens owns 12 King St, Newtown NSW 2042. Give it another Property Owner first.") and the profile stays.
- **Removed**, they drop out of the lists and pickers and their mobile and email stop matching inbound messages. The profile still opens, with the same "Removed from the Agency on …" alert as a Tradie, and no pen or Remove.
- **Can't be reached.** When choosing a Quote (or proceeding on an Estimate) would take the Repair Cost over the Max Repair Cost, and `channelFor` throws `UndeliverableError` for the Owner, the form says so before the button: "Oscar Ortiz can't be reached: no SMS channel is connected and they have no email address." **Add an email** links to their profile at `?edit=details#details`. Choosing or proceeding is refused with that same sentence, and nothing is saved. The same note stays on the approval after it has been asked. While the approval is still open, **Resend approval request** (a small secondary button, `POST /tickets/:id/approvals/:approvalId/resend`) sends the same request again; the flash is "Approval request resent to Olivia Owens". When the email fails after the approval is saved, the flash is one line: "Sent to the Property Owner for approval, but the email to Olivia Owens didn't go: <reason>. Use Resend approval request."

### Emails

`renderEmail({ agencyName, subject, text })` in `src/email-layout.ts` turns any template's plain text into the HTML email, so no template writes HTML. `notifications` sets it as `html` on every email (the Resend and SendGrid mailers send it with `text` as the alternative); SMS and WhatsApp stay plain text. The text is Claude Haiku's when it wrote the email and its text passed the checks, otherwise the template's (ADR 0011). Either way the same renderer draws it, so a composed email keeps the template's button lines and its subject.

```
 Sand ────────────────────────────────────────────────
 │  ┌────────────────────────────────────────────┐   │ 600px max, fluid below
 │  │ Harbour Realty        (Night, white 20px)  │   │
 │  ├────────────────────────────────────────────┤   │
 │  │ Thanks, Kevin. To get this sorted we need: │   │ paragraphs from blank lines
 │  │ ▌1. Is it getting worse? (yes or no)       │   │ Wattle edge: needs the Tenant
 │  │ ▌2. When are you usually home: ...         │   │
 │  │ ▌[ Upload photos ]                         │   │ Harbour button, no address shown
 │  └────────────────────────────────────────────┘   │
 │  Reply to this email to answer or ask a question. │ Slate 13px on Sand
 │  Sent through myEST8                              │
```

- **Tokens, as hex** (an email can't use `var()`; a test checks they equal `app.css`): Night `#13212E` for text and the header band, white on it; Sand `#F4EFE6` behind; white card with a 1px Line `#D8DEE4` border and 8px radius; Slate `#55636F` for the footer, detail labels and the preferred-time caption; Harbour `#1F5C8B` for the button (white on it, 6px radius, 44px tall); Wattle `#FFC233` for the edge. No other colour.
- **Type:** the system stack (`-apple-system`, Segoe UI, Roboto, Helvetica Neue, Arial), because the brand fonts won't load in mail clients. The Agency's name 20px 700, body 16px on 24px, footer and captions 13px. Sentence case.
- **The Agency heads it.** The Tenant or Tradie hears from their Agency; myEST8 is only "Sent through myEST8" in the footer. No images, no per-Agency colours.
- **Wattle marks what needs a reply.** The numbered questions and a button each sit on a 4px Wattle edge, as a dashboard row that needs a decision does. An email that asks for nothing has none. Wattle is still never text or a button.
- **Links only in buttons.** An email's HTML never shows a web address as text: not under a button, not in a sentence, not in the preheader. The address is only the button's `href`. Every address is a Harbour button, labelled by the sentence it finishes ("Upload photos", "Upload receipt", "Give your quote", "Follow progress"). A sentence ending `here: <url>` is a paragraph, then the button. A line that is only a label of 40 characters or fewer, a colon and an address is labelled with that text, so a visit time ("Tue 27 Oct, 9:00 am") and "None of these work" are the button's words, and that label is not also printed as a paragraph above the button. A longer line keeps the sentence's label. A template never puts an address in the middle of a sentence: it gives it a `<Label>: <url>` line. (The renderer still breaks such a sentence around a button, labelled "Open link" when the words say nothing; no template may reach that label, and a test renders every template to check.) Plain-text email, SMS and WhatsApp keep the address as text, since they have no buttons.
- **The page a button opens.** A button never acts by itself: it opens a no-login page, and that page's button posts the choice (no GET changes anything, ADR 0002). Once the choice is saved, the page shows it in the green confirmed block (`doneBox`, above), and every button from the same email opens the same state: the choices that no longer apply are disabled buttons, not removed, and "Need another time?" stays enabled only while asking is still allowed. Opening `pick=2` after `pick=1` was booked shows "✓ Booked: <the time of pick 1>" with the `pick=2` time disabled. The pages are `/v/:token` (book a time, None of these work, Need another time?), `/v/confirm/:token` (Confirm this time, Need another time?), and the Tradie's `/q/:token/decline`, `/q/:token/done`, `/q/:token/another`, `/q/:token/inspection-done` and `/q/:token/inspection-another`; a declined Quote Request's `/q/:token` shows the same block.
- **Outlined buttons** are white with a Harbour border and Harbour text. The renderer chooses that from the label: "None of these work", "Need another time?" and "Can't take this job". Every other button is the Harbour fill with white text, including "Give your quote", "Give your Firm Quote", "Offer visit times", "View job", "View inspection", "Mark job done", "Mark inspection done" and a visit time ("Tue 27 Oct, 9:00 am", "Confirm this time").
- **Details.** A run of two or more consecutive lines of `Label: value`, where the label is 24 characters or fewer and the value is not a URL, is a compact two-column table on the white card: the label in Slate, the value in Night. One such line stays a paragraph. A URL value is still a button, so `Give your quote: https://…` is not a details row. Plain text and SMS keep the lines. No Wattle on the table.
- **Tradie emails** are a short opening sentence, then that details block, then the buttons. A Quote Request lists Trade, Suburb, Urgency and Issue. An offer of visit times lists Address, Length, Tenant usually home and, when they wrote one, Tenant's note. A Work Order lists Address, When, Length, Tenant and Tenant contact; a moved visit lists Address, Was and Now. A Site Inspection lists Address, When and Tenant contact. A Firm Quote lists Address, Inspected on (once there was one) and What's needed. "Quote not chosen" and "Not done yet" stay short paragraphs, with no buttons.
- **Left-aligned on one inset:** the name, paragraphs, list, details, button and footer share a left edge. The details table is the one place with two columns; its label column is narrow, so the email still holds at 375px with no media query. Nothing is centred.
- **Markup:** table layout with `role="presentation"`, inline styles only, `lang="en-AU"`, a hidden preheader that is the first sentence, and `color-scheme: light` with a background on every cell so a client that darkens never leaves light text on nothing. All text is escaped.

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
- **Navigation (2026-11-02).** The five lists leave the rail. One Profiles item (`/profiles`, icon `address-book`) opens the households and Tradies. The lists stay, linked from that page. See Profiles below.
- **Navigation (2026-10-24).** Property Owners (`/owners`, icon `key`) and Building Managers (`/building-managers`, icon `buildings`) join Profiles, after Tenants. Each has the list, the pen and Remove that Tenants and Tradies already have.
- **Navigation (2026-10-19).** Requests folds into Tickets (new Maintenance Requests above open Tickets, one filter bar over both), closed Tickets move to Archive, and Properties, Tradies and the new Tenants sit under a Profiles heading. The rail's decision count moves from Requests to Tickets.
- **Navigation (2026-10-13, replacing the three-item rail of 2026-10-10).** Dashboard, Dispatch, Requests, Tickets, Approvals, Schedule, a gap, Properties, Tradies, a gap, Settings, plus the demo's Phone simulator at the foot of the rail. The user asked for each queue to have its own place, so Calendar is Schedule again rather than moving into Dispatch's Tradie schedule; the Setup pages still move into Settings tabs.
- **The Tenant's progress tracker.** The Ticket page links to it, so a Property Manager can see what the Tenant sees. A Site visit is Done only once the inspection has happened (before that, "booked for" its time); Booked asks the Tenant to confirm they'll be home or can let the tradie in until they have.
- **Staged quoting on the Ticket page (ADR 0009).** The stage tracker reads Estimates, Site inspection, Firm Quote, With Property Owner, Ready to book, Booked, Done (`JOB_TRACKER_STAGES`). Site inspection is "Not needed" when no Tradie needed one and left out when the Job proceeded on an Estimate; Firm Quote then reads "Proceeding on Estimate (cap $X)". Booked is ticked only once the Tenant has confirmed the visit ("Waiting on Tenant to confirm" until then). Each Tradie asked is a row of their own with a chip for where they are (Asked, Estimate in, Needs inspection, Inspection booked, Inspected, Firm Quote in, Declined, Closed) and their next action. A Tradie who hasn't replied ("No reply yet", or "No reply after a reminder") has a small secondary **Resend** button that sends their Quote Request message again with the same link (`POST /tickets/:id/quote-requests/:id/resend`, "Quote Request resent to Pete's Plumbing"); it is gone once they have given an Estimate, and a Quote Request exists only once its message went out. An active Work Order, and a Site Inspection that is not done, has two small secondary buttons, **Resend to Tenant** and **Resend to Tradie** (`POST /tickets/:id/work-orders/:id/resend`, "Visit email queued for Tom Tran"). The worker sends the current visit email again. Firm Quotes and Estimates are two tables that never share a price column, and a superseded Estimate stays listed, muted. Call-out Fees owed are a line of their own, never part of the Repair Cost. Mark inspected appears only once the visit has started.

## Profiles (`/profiles`)

One page for the people and places, in place of the five lists in the rail. Those lists stay (`/properties`, `/tenants`, `/owners`, `/building-managers`, `/tradies`). The sentence under the title links each count to its list. Tradies keeps a ghost "See all Tradies".

```
┌ Profiles   [⌕ Address, name or Trade] [Mine | All] [+ Add profile | ⌄] ──────────────┐
│ 1 Property, 2 Tenants, 1 Property Owner and 6 Tradies                                 │
├─────────────────────────────────────────────────────────────┬─────────────────────────┤
│ Households                                                  │ Tradies        See all  │
│ ┌ Owner  Olivia Owens  1 approval waiting ┐                 │ By their first Trade,   │
│ │ 12 King St, Newtown          ▭ Tap drips in the    High   │ with their myEST8 rating│
│ │  ├ Hana Ho                     kitchen                    │ Plumbing                │
│ │  └ Tom Tran  1 open Ticket   ▭ Door sticks     Routine    │  Pete's Plumbing ★ 4.0  │
│ │  Building Manager  Barry                                  │ Electrical              │
│ └───────────────────────────────────────────────────────────┘  Sparky Sam      ★ 4.3  │
│ Not linked to a Property                                    │  Not on the map         │
└─────────────────────────────────────────────────────────────┴─────────────────────────┘
```

- **Two columns from 1024px.** Households take about two thirds. The Tradies box takes the rest and scrolls with the page (it is taller than the window, so it is not sticky). On a phone they stack, Tradies after Households. Nothing scrolls sideways at 390px. Rows are 44px tall on phones and touch screens, and the name link covers the row.
- **The count sentence** is the page subtitle. Each count is a Harbour link: Properties, Tenants, Property Owners, Building Managers, Tradies. Tenants keeps `?filter=all` when All is on, because that list reads `filter`; the others do not. While a search is on, the sentence is plain text that names the search, because the numbers are matches.
- **Household card.** `--surface` on Sand, `--shadow-soft`, 8px radius, 24px top and 12px side padding; 28px between cards so each Owner tab, which rises 12px above its card, has air. On a wide screen the Property Owner is a tab on the card's top edge (4px radius, `--line` border), the name linking to `/owners/:id`. "N approvals waiting" is a Wattle chip that links to `/approvals`. On a phone the Owner is the first row of the card, with no border. The tab and the tree are the page's one bold element; everything else stays quiet.
  - **Two columns inside the card** once the card is 36rem wide (a container query): the place and its people on the left (5fr), the open Tickets on the right (6fr, at least 16rem). On a phone the Tickets follow the people under a hairline. The right side answers "what is wrong at this house" instead of standing empty.
  - **The place.** The address is Bricolage 16/600 and links to `/properties/:id`; the suburb sits beside it in Slate when the address does not already include it. Tenants hang off the address on 1px `--line` connectors drawn as borders; the stub runs into the row's fill, so the branch leads to the person. Each row links to `/tenants/:id` (the link covers the row), with muted text for that Tenant's open Tickets and an Ochre "Concern" chip only when a judgment already stored supports one. No Tenants is one quiet line and a Harbour "Add a Tenant". A Building Manager, when the Property has one, sits on their own line under a hairline, with no tree connector.
  - **The open Tickets**, High first: one row each, the Harbour `ticket` icon, the Ticket's words (its summary, or the Tenant's description) in 13px Night clamped to two lines with the whole text in `title`, then its Urgency badge at the end, the whole row a link to `/tickets/:id`. The icon and badge sit on the first line. After three, "N more open Tickets" links to the Property. None is one quiet line, "No open Tickets".
  - Record links (the address, the Owner, people, the Building Manager, Tradies, and anyone not linked to a Property) are Night, Public Sans 500 except the address which stays Bricolage 600. A link that is a whole row (people, Tickets, Tradies, the unlinked) takes the row's squircle fill on hover; the address and the Building Manager are links in a line and underline. Harbour stays on the count sentence, "See all Tradies", "Add a Tenant", "N more open Tickets" and Add profile.
- **Tradies box.** A section titled "Tradies", with one Slate line under the heading, "By their first Trade, with their myEST8 rating.", so the rows don't repeat it. Groups are 16px apart, each under its Trade in Bricolage 14/600. Each Tradie is one row with no hairlines: the business name (ellipsis, with the full name in `title`) linking to `/tradies/:id` and covering the row, and the myEST8 rating at the right as plain text, an Ochre star and tabular figures ("myEST8" stays for screen readers: "myEST8 4.0 from 3 ratings"). The Google rating is not on this page. "N open Jobs" (13px Slate) and an Ochre "Not on the map" chip sit on a second line, only when there is something to say. A row takes the squircle fill on hover, inset 8px from the box's edge.
- **Search** is one field in the header with a `magnifying-glass` inside and "Address, name or Trade" as its placeholder; Enter sends it (no button). While a search is on, a ghost "Clear" sits beside the field, the count sentence reads "Matching “Newtown”: 2 Properties and 3 Tenants" (or "Nothing matches “zzzz”"), and an empty column says so with a ghost "Clear search".
- **Not linked to a Property.** After the households, only when someone is in it: former Tenants, and Property Owners and Building Managers with no Property.
- **Add profile.** A `<details data-menu>` in the page header, the same disclosure as the user menu (it closes on a click elsewhere and on Escape). The summary is one Harbour button that looks split: a plus and "Add profile", then a chevron behind `--action-divider`. The whole control opens the menu, and the chevron turns while it is open. Hover darkens the whole control. Focus is one 2px Harbour ring. Property, Tenant, Property Owner, Building Manager and Tradie, each to its own `/new` page; the items take the squircle fill on hover. Adding a Property is `/properties/new`; the list's button goes there, and a refused save is that page again.
- **Mine and All** narrow the Properties, as on the other lists. Tradies, and people linked to no Property, are the Agency's either way. Search (`q`) keeps households whose address, suburb or anyone in them matches, and Tradies whose business name, contact name or Trade matches.
- **The rail** has one Profiles item (`address-book`), with no group heading. A Property, Tenant, Property Owner, Building Manager or Tradie page, including each `/new` page, keeps it current.

## Copy

- Use `CONTEXT.md` terms exactly: Property Manager, Tenant, Tradie, Property Owner, Maintenance Request, Ticket, Job, Quote, Quote Request, Work Order, Urgency, Urgent Repair, Repair Cost, Max Repair Cost, Building Manager, Common Area, Trade.
- Plain verbs, sentence case, no filler. An action keeps its name through the flow: a "Send Work Order" button produces "Work Order sent".
- Errors say what happened and how to fix it. Empty states invite the next action.
