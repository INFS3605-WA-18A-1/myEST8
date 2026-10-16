# Foundation: the dispatch-desk design system (ac2f5ea) vs the current tree

Sources, all read at commit `ac2f5ea` unless marked "current" (the working tree, which is branch `restore-dispatch-desk-design` at `8e9e849`; `ac2f5ea` is an ancestor of it, so `git diff ac2f5ea HEAD` is the change since the design).

Files read at `ac2f5ea`: `docs/design-system.md` (389 lines), `.scratch/dispatch-desk-redesign/spec.md`, `.scratch/web-app-improvements/spec.md`, `.scratch/web-app-improvements/screenshot-review.md`, the 27 issue titles under `.scratch/web-app-improvements/issues/`, `src/web/static/app.css` (3275 lines), `src/web/shell.ts`, `src/web/ui.ts` (1076 lines), `src/web/assets.ts`, `src/web/icons.ts`, `src/web/pm-pages.ts`, `src/web/static/app.js`.

Commit dates and messages:

| Commit | Date | Message (summary) |
|---|---|---|
| `27afd2d` | 2026-10-09 | Add the dispatch-desk design foundation: docs/design-system.md; left rail and top bar; ui.ts gains docket, countStrip, queueRow, segmented, lane, section; daisyUI theme maps colours to tokens; Barlow fonts replaced later |
| `6122d69` | 2026-10-09 | Redesign every page on the foundation: dashboard as dispatch board, Ticket view with next action first, week-grid calendar, Tradie profile, phone-frame simulator, setup, landing, sign-in/up, Tenant pages |
| `b46c009` | 2026-10-09 | Polish the dashboard and fix shared components: "Next 7 days" replaces the Mon-Sun week; decision rows about half height; primary link buttons readable; publicPage takes width and hero title; page controls to a second row on phones |
| `57fefc8` | 2026-10-09 | Name the dashboard's booking strip "Next 7 days" in the design system (doc only) |
| `b62a448` | 2026-10-09 | Fix one vocabulary and post-build decisions in the design system (doc only, +67 lines): stage labels, action names, flags, date format, large docket on Ticket page, decision-only hi-vis rows, one-Quote rule, phone gutters, no literal colours |
| `ac2f5ea` | 2026-10-14 | Add channel adapters, deploy scripts, and web app improvements (adds the 27 improvement issues, screenshot review, and `landing.css`, `auth.css`, `dispatch-map.js`, Leaflet assets, `docs/design-system.md` +105/-) |

The rebrand (Harbour and Wattle, October 2026) is recorded inside the design doc itself (section "Plan review") and in `.scratch/dispatch-desk-redesign/spec.md`. It replaced the Colorbond palette and Barlow.

---

## 1. Design principles and vocabulary (verbatim from docs/design-system.md, ac2f5ea)

Purpose (line 3): "myEST8 is where a Property Manager at a small Sydney Agency sees every repair that needs a decision and moves it one step on. They work on a 1366–1440 px laptop at the desk and on a phone between inspections."

Plan review (lines 7-14):
- "**Cards became dockets and rows.** Only a Ticket gets the docket shape, because a Ticket is a work order. Everything else is a plain row or a section with a hairline, so shape now encodes what a thing is."
- "**Stat cards became a single count strip.** The counts are links into the queues, not decoration, and they cost 36 px instead of 100 px."
- "**The accent became Wattle** (`--hivis`, a wattle yellow), used only for \"needs your decision\". It never appears as a decorative wash or on a button."
- "**One memorable thing.** The Wattle stripe that marks a decision, echoed by the key tag in the rail. Everything else stays quiet: Night, Paper, hairlines and Harbour for actions."
- "**No shadows except on menus and dialogs.** Hierarchy comes from borders, spacing and weight."

Colour rules (lines 39-42):
- "Routine Urgency is not coloured: `--muted` text on a `--line` hairline. Colour is never the only signal; every badge carries its word."
- "Wattle is never text and never a button. It is 1.6:1 on white, so it only ever marks (a stripe, a bar, a chip behind Night text)."
- "The focus ring is Harbour everywhere except on the Night rail, where Harbour is 2.3:1, so rail links ring in `--rail-text`."
- "No literal colours outside the token block in `app.css`, including white: use `var(--surface)`."

Type rules (lines 46-52):
- Lexend (400, 600, 700) for "the wordmark, page titles, section headings, buttons, nav, tabs, table headers, docket numbers."
- Red Hat Text (400, 500, 600, and 400 italic for placeholders) for "everything people read and type."
- "Sentence case everywhere. No all-caps labels and no letter-spaced eyebrows. Don't emphasise a single word in a headline. Don't join meta with middle dots: put meta in separate elements with a gap. Don't append arrows to link or button text."
- "Keep text measure under 80 characters (`max-width: 72ch` on prose)."
- `font-variant-numeric: tabular-nums` on money, times, counts and docket numbers.

Shape, space and elevation (lines 56-62):
- "Spacing scale (px): 4, 8, 12, 16, 24, 32. Section gap 16 on the dashboard, 24 elsewhere."
- "Radius: 4 px for dockets, rows, badges and inputs; 6 px for buttons, lanes and the segmented control; 8 px for sections and alerts. Never fully round, except avatars, count chips and step circles."
- "Borders: 1 px `--line` around sections and between rows. No zebra striping."
- "Shadow only on menus, dialogs, the Share sheet and the phone frame in the simulator: `0 8px 24px rgb(19 33 46 / 0.18)` (`--shadow-lift`)."
- "Focus: `outline: 2px solid var(--action); outline-offset: 2px` on every interactive element. Never removed."
- "Motion: only in response to an action (open a menu, expand a `<details>`, 150 ms ease-out), and none at all under `prefers-reduced-motion: reduce`. No entrance animations."
- "Touch targets: buttons, rail links, the segmented control and the menu button are 44 px on phones (under 640 px) and on touch screens (`pointer: coarse`)."

Decisions after the first build (lines 324-333):
- "**Ticket page header.** ... Repair Cost shows only once it is above $0. One **Next step** line names what the Ticket waits on and links to that Job. It gets the Wattle stripe only when the step is the Property Manager's decision. Change Urgency is a small menu beside Share, not a form in the header."
- "**Routine Urgency.** Routine shows as `--muted` text with a `--line` border. Ink text would read as more urgent than it is."
- "**Decision rows.** Only rows that need a decision get the Wattle stripe. A row component takes `decision: boolean`; the stripe is never hard-coded."
- "**One-Quote rule.** ... \"Choose once two Quotes are confirmed, or give a reason to go ahead with one.\" Choose stays enabled."
- "**Phone gutters.** 16 px below 1024 px."

Copy (lines 335-340): "Use `CONTEXT.md` terms exactly: Property Manager, Tenant, Tradie, Property Owner, Maintenance Request, Ticket, Job, Quote, Quote Request, Work Order, Urgency, Urgent Repair, Repair Cost, Max Repair Cost, Building Manager, Common Area, Trade." Also "Plain verbs, sentence case, no filler. An action keeps its name through the flow." "Errors say what happened and how to fix it. Empty states invite the next action."

Flags and checks (lines 311-316): flags are sentence case ("Check urgency", "Check trade", "No photos", "Flagged photos"). "A machine check never stands in for what a person said." The intake agent's photo check appears under its own label, "Photo check".

Dates (lines 320-322): format "Mon 12 Oct, 9:00 am"; three-letter months, "Sep" never "Sept"; "Relative ages read \"2 days ago\"." Times in the Agency's time zone everywhere.

Job stage vocabulary (lines 275-282, table): `quoting` = Quoting (`--action`); `awaiting_owner` = With Property Owner (`--high`); `approved` = Ready to book (`--action`); `scheduled` = Booked (`--action`); `done` = Done (`--done`); `cancelled` = Cancelled (muted). "A Ticket is Open or Closed."

Actions vocabulary (lines 288-305): Confirm, Reject (always with a reason), Review (opens a Maintenance Request), Change Urgency, Change Trade, Send Quote Requests, Confirm Quote, Choose this Quote, Send Work Order, Suggest new times, Use this time, Rate, Close Ticket, Mark messages read, Skip for now, Continue. "The confirmation repeats the verb: \"Work Order sent\"."

Spec principles for the improvement round (`.scratch/web-app-improvements/spec.md` lines 11-15): "Put the decision first", "Read order follows the work" (issue, then where, then status), "DesignDoc rules are visible in the UI", "Outsiders get plain words and the Agency's name", "Phones never scroll sideways. Wide tables stack."

Dispatch redesign spec (`.scratch/dispatch-desk-redesign/spec.md` lines 37-43): "No middle-dot joins"; "The mockup hard-codes colours inline; the build uses tokens and the shared components in `src/web/ui.ts`."; "Every interactive state ... is a real server action with progressive enhancement"; "Keyboard focus visible everywhere; 44px touch targets; works at 390px; `prefers-reduced-motion` respected."

Screenshot review (`screenshot-review.md`, 14 Oct 2026) findings that the foundation must answer: the Ticket header had $0.00 as the biggest number; decision rows cut addresses; the rail gave Schedule the wrong place; "Put the decision first" on every page. The review's candidates 6 ("Split ui.ts by concept") and 7 are open.

Doc inconsistency to know about: docs say alerts are 8 px (line 57) and also 6 px (line 210), and app.css uses 6 px (`.alert` at line 376).

---

## 2. Tokens (ac2f5ea)

### 2.1 Colour: `:root` in app.css (lines 64-92)

| CSS variable | Value | Name / role (comment in source) |
|---|---|---|
| `--ink` | `#13212e` | Night: body text, the rail (16.4:1 on white) |
| `--page` | `#f2f4f6` | Paper: page behind sections, lanes, Trade badge |
| `--surface` | `#ffffff` | sections, rows, dockets, inputs |
| `--muted` | `#55636f` | Slate: secondary text, timestamps, hints, Routine (6.2:1 on white) |
| `--line` | `#d8dee4` | Line: hairlines and section borders (decorative) |
| `--control` | `#7d8a95` | input, select, checkbox, secondary button borders (3.5:1 on white) |
| `--action` | `#1f5c8b` | Harbour: primary buttons, links, focus ring, selected state (white on it 7.1:1) |
| `--action-hover` | `#174a70` | Harbour darker: primary hover, link hover |
| `--hivis` | `#ffc233` | Wattle: decision stripe, current rail item bar, decision chips, logo on Night |
| `--info-bg` | `#e8f0f7` | Harbour tint: info badges and alerts, "Filled in by AI" |
| `--urgent` / `--urgent-bg` | `#b42318` / `#fdecea` | Urgent, errors, destructive |
| `--high` / `--high-bg` | `#9a4a0b` / `#fdf1e3` | High Urgency, warnings, flags |
| `--done` / `--done-bg` | `#2f5a3e` / `#e8f1ea` | Done, approved, confirmed |
| `--rail` | `#13212e` | the rail (Night) |
| `--rail-text` | `#e6ebf0` | rail links, wordmark (13.6:1) |
| `--rail-muted` | `#9aa8b4` | rail counts, Phone simulator link, Agency name (6.7:1) |
| `--rail-hover` | `rgb(255 255 255 / 0.05)` | rail link hover band |
| `--rail-current` | `rgb(255 255 255 / 0.08)` | current rail item band |
| `--rail-width` | `220px` | the rail, and the drawer on phones |
| `--rail-collapsed-width` | `64px` | the rail folded to icons |
| `--scrim` | `rgb(19 33 46 / 0.45)` | scrim behind the open drawer |
| `--shadow-lift` | `0 8px 24px rgb(19 33 46 / 0.18)` | the one shadow |
| `--font-body` | `'Red Hat Text', system-ui, sans-serif` | |
| `--font-head` | `'Lexend', system-ui, sans-serif` | |

Pairs listed in docs (lines 22-37) with contrast: Slate on Paper 5.6:1, Control 3.5:1 on white, Harbour white-on-it 7.1:1, Harbour hover 9.3:1, Night on Wattle 10.1:1, Urgent 6.6:1 on white, High 6.3:1, Done 7.9:1 on white, Harbour on info-bg 6.2:1.

No literal colour outside `:root` and the theme block: ac2f5ea app.css uses `rgb()` only for the two translucent rail tints, scrim and shadow.

### 2.2 daisyUI theme `myest8` (app.css lines 94-129)

`[data-theme='myest8'] { color-scheme: light; ... }` maps daisyUI variables to tokens:

| daisyUI var | Token |
|---|---|
| `--color-base-100` | `--surface` |
| `--color-base-200` | `--page` |
| `--color-base-300` | `--line` |
| `--color-base-content` | `--ink` |
| `--color-primary` / `-content` | `--action` / `--surface` |
| `--color-secondary` / `-content` | `--muted` / `--surface` |
| `--color-accent` / `-content` | `--hivis` / `--ink` |
| `--color-neutral` / `-content` | `--ink` / `--page` |
| `--color-info` / `-content` | `--action` / `--surface` |
| `--color-success` | `--done` |
| `--color-warning` | `--high` |
| `--color-error` | `--urgent` |
| `--radius-selector`, `--radius-field` | `4px` |
| `--radius-box` | `8px` |
| `--size-selector`, `--size-field` | `0.25rem` |
| `--border` | `1px` |
| `--depth`, `--noise` | `0` (flat) |

The theme is applied by `data-theme="myest8"` on `<html>` (ui.ts `THEME`, line 47).

### 2.3 Tailwind bridge (ui.ts `TAILWIND_THEME`, lines 54-95)

An `@theme inline reference` block gives Tailwind utilities for the tokens: `text-muted`, `border-line`, `bg-page`, `bg-surface`, `text-urgent`, `bg-info-bg`, `text-rail-text`, `ring-action`, etc. (`--color-ink`, `--color-page`, `--color-surface`, `--color-muted`, `--color-line`, `--color-control`, `--color-action`, `--color-action-hover`, `--color-info-bg`, `--color-hivis`, `--color-urgent(-bg)`, `--color-high(-bg)`, `--color-done(-bg)`, `--color-rail-text`, `--color-rail-muted`).

### 2.4 Dark mode

There is none. The theme sets `color-scheme: light` and there is no `prefers-color-scheme` or `[data-theme=dark]` rule in ac2f5ea app.css (checked: the only `@media` queries are size, motion and pointer). The rail is always Night, so it is dark in both cases by design. The doc's favicon description (line 232, "Night in a light browser theme and Wattle in a dark one") is inside `favicon.svg`, which I did not read.

### 2.5 Typography

Fonts (app.css lines 8-57): `@font-face` for Lexend 400, 600, 700 and Red Hat Text 400, 500, 600 and 400 italic, `font-display: swap`, files at `/assets/fonts/<name>-latin-<weight>-normal.woff2` (italic for the one italic). Self-hosted via `@fontsource/lexend` and `@fontsource/red-hat-text` (ac2f5ea assets.ts lines 36-44 allowlist those seven files). Head preloads `red-hat-text-latin-400-normal.woff2` and `lexend-latin-600-normal.woff2` (ui.ts head, lines 107-108).

Base (app.css lines 136-170, inside `@layer utilities { @layer app { ... } }`):
- `body`: 14px, line-height 1.45, Red Hat Text, `color: var(--ink)`, `background: var(--page)`, `min-height: 100vh`, antialiased.
- `h1, h2, h3`: Lexend, line-height 1.15.
- `.num`: `font-variant-numeric: tabular-nums`.
- Ordinary links: `:where(a:not(.btn))` Harbour, hover `--action-hover` (zero specificity so classes win).
- `::placeholder`: muted, italic, opacity 1.

Scale actually used (px, from the CSS):

| Use | Size / weight / family | Selector (line) |
|---|---|---|
| Body | 14 / 400 / Red Hat | body (143) |
| Lead / section heading | 16 / 600 / Lexend | `.section-title` (526); `.rail-link` 16 / 600 Lexend |
| Section (lane title) | 14 / 600 Lexend | `.lane-title` (1074) |
| Top bar title | 22 / 600 Lexend; 20 under 640 | `.topbar-title` (1358) |
| Page title | 26 / 600 Lexend; 22 under 640 | `.page-title` (in the 1598 block) |
| Hero (landing) | `clamp(36px, 5vw, 52px)` / 700 / line-height 1.08 | `.page-title.is-hero` |
| Docket issue | 15 / 600 / lh 1.3 | `.docket-issue` (855) |
| Docket issue, large | 14 / 400 | `.docket.is-large .docket-issue` (832) |
| Docket address | 13, Slate | `.docket-address` (861) |
| Docket number | 14 / 600 Lexend | `.docket-number` (804) |
| Docket number, large | 26 / 700 Lexend | `.docket.is-large .docket-number` (816) |
| Docket status / meta / foot | 12, Slate | `.docket-status` (866), `.docket-meta` (894), `.docket-foot` (881) |
| Badge | 13 / 500 Red Hat, lh 1.35; in dockets 12 | `.badge` (331) |
| Count chip | 12 / 600, 22px circle | `.count-chip` (409) |
| Count label | 14 | `.count-strip` (912) |
| Button | 14 / 600 Lexend; `.btn-lg` 16 | `.btn` (245), `.btn-lg` (265) |
| Input | 14 Red Hat; 16 under 640 | (456-496) |
| Field label | 14 / 600 | `.field-label` (438) |
| Field hint | 12 Slate | `.field-hint` (445) |
| Field error | 12 / 500 urgent | `.field-error` (450) |
| Table | 13 Red Hat; `thead` 13 / 600 Lexend | `.table` (556), `.table :where(thead, tfoot)` (566) |
| Alert | 14 | `.alert` (374) |
| Queue title | 14 / 600 | `.queue-title` (1021) |
| Queue detail | 14 | `.queue-detail` (1035) |
| Queue meta | 12 Slate | `.queue-meta` (1051) |
| Segmented / tab | 14 Lexend 600 (segmented), tabs 14 / 500, active 600 | `.segmented-item` (950), `.tabs-border > .tab` (660) |
| Side tab | 15 / 500 Lexend, active 600 | `.side-tab` (685) |
| Rail quiet link (Phone simulator) | 13 / 500 Red Hat | `.rail-link.is-quiet` (1205) |
| Rail count, rail agency | 13 Red Hat | `.rail-count` (1230), `.rail-agency` (1236) |
| Page subtitle | 14 Slate, max 72ch | `.page-subtitle` (in the 1598 block) |
| Stat tile value | 20 / 600 Lexend; label 12 | `.stat-tile-value` (746), `.stat-tile-label` (742) |
| Public footer | 12 Slate | `.public-footer` (1552) |
| Chat bubble | 14, pre-wrap; header/footer 12 Slate | `.chat-bubble` (638), `.chat-header, .chat-footer` (625) |
| Timeline | `text-xs` (12) Slate time, `text-sm` (14) title | timeline markup in ui.ts |
| Logo | `.logo.is-md` 22px; `.is-sm` 18px. Logo word Lexend, `my` 400, `EST8` 700 | (`.logo`, lines 1677-1721) |
| Skip link | 16 default | `.skip-link` (203) |

Measure: `.page-subtitle` 72ch (1598 block). Line-clamp classes `line-clamp-1|2|3` (app.css 217-240) back `clip()` and `docket`.

### 2.6 Spacing, radius and shadow in use

- Spacing scale in the doc: 4, 8, 12, 16, 24, 32. In CSS the values used are 4, 6, 8, 10, 12, 14 (button padding), 16, 18 (lg button), 20, 24, 32.
- Content gutters: `.app-content` padding 24 (16 under 1024px), `gap: 24px`, max-width `80rem` (1280px), `margin-inline: auto` (app.css ~1598-1620).
- `.app-body-stack` gap 24 (`.app-body-stack`).
- Topbar: min-height 60, padding `10px 24px` (`8px 16px` under 1024), gap 12.
- `.app-flash` padding `12px 24px 0` (16 under 1024).
- Rail: padding `20px 12px 16px`, gap 4; `.rail-logo` margin-bottom 16; `.rail-gap` margin-top 12; `.rail-foot` margin-top auto, padding-top 16; `.rail-link` min-height 40, padding `0 12px`, gap 10.
- Section: `padding 16px`, `gap 12px` inside, `section-head` gap `8px 16px`, `section-body` gap 12.
- Table cells: `height 36px`, padding `8px 12px`.
- Docket: `padding 10px`, `gap 6px`; large docket `padding 12px 16px`, `gap 8px`.
- Queue row: `padding 10px 10px 10px 12px`, gap 12; `.queue-thumb` 56 px square; `.queue-main` gap 6.
- Lane: `.lane-head` padding `8px 8px 0`; `.lane-body` padding 8, gap 8, `max-height: 22rem` from 1024px (app.css 1088-1100).
- Count strip: `min-height 44px`, padding `4px 16px`, gap `4px 20px`; `.count-item` min-height 36, gap 8.
- Segmented: padding 3, gap 2; items min-height 32 (40 on phones/coarse), padding-inline 12 (16 on phones).
- Empty state padding 16; stat tile padding `12px 16px`.
- Public pages: `.public-main` padding `24px 16px 32px`, gap 24; `.public-bar-inner` min-height 56, padding `12px 16px`, max-width 560 (narrow 400, wide 1120; wide gutters 24 from 768).
- Radii: dockets 4 (`--radius-field`); docket large 8; queue rows 4; badges 4; inputs 4; buttons 6; lanes 6; segmented 6; rail links 6; menu button 6; sections 8 (`--radius-box`); stat tiles 8; empty state 8; alerts 6 (`.alert`, line 376); side-tab 6; chat bubbles 8; photo tiles `rounded-box` (8); count chips 999px (pill); unread dot 50%; steps circles 24px.
- Shadow: only `--shadow-lift` on the user menu panel (1481), the Share panel (1781), the Ticket page's Change Urgency menu (2927), and the collapsed-rail tooltip (1312).

### 2.7 Icons

Phosphor via `icon(name, { weight?, size? })` in icons.ts (lines 40-51): inline SVG, `fill="currentColor"`, viewBox 0 0 256 256, `class="${size} shrink-0"`, `aria-hidden="true" focusable="false"`. Default `size-5` (20px). Width/height attributes derived from the size class so no-JS pages still size correctly (lines 43-47). Weight type `IconWeight = 'thin'|'light'|'regular'|'bold'|'fill'|'duotone'`. Missing icon names throw (lines 22, 28).

Icon map (ui.ts `NAV_ICON` lines 1046-1057, `ICON` lines 1035-1043):
- dashboard `squares-four`, dispatch `map-pin`, requests `tray`, tickets `ticket`, approvals `seal-check`, schedule `calendar-blank`, properties `house-line`, tradies `wrench`, settings `gear-six`, simulator `device-mobile` (16px).
- Rail icons 18px (`size-[18px]`). `ICON`: menu `list` (24px), chevron `caret-down` (16px), success `check-circle`, error `warning-circle`, info `info`, dot `circle` fill (16px), sidebar `sidebar-simple` (18px, Collapse menu button).

### 2.8 Logo

`logo({ size: 'sm'|'md' })` (ui.ts 1074-1076): `<span class="logo is-${size}">` with a 256-grid evenodd path (`LOGO_MARK`, line 1065-1066) and a `logo-word` with `<span class="logo-my">my</span>EST8`. `md` (default) 28px mark, 22px type; `sm` 20px mark, 18px type. Mark `currentColor`; Harbour on public bar (`.logotype .logo-mark` color action, 1534), Wattle in the rail (`.rail-logo .logo-mark` color hivis, 1155). Accessible name "myEST8" via `aria-hidden` mark.

### 2.9 Assets (assets.ts, ac2f5ea)

Served under `/assets/`: `tailwind.js` (`@tailwindcss/browser`), `daisyui.css`, `app.css`, `landing.css`, `auth.css`, `app.js`, `leaflet.js`, `leaflet.css`, `dispatch-map.js`, `favicon.svg`; fonts allowlisted under `/assets/fonts/`; Leaflet images under `/assets/images/` (`layers.png`, `layers-2x.png`, `marker-icon.png`, `marker-icon-2x.png`, `marker-shadow.png`). Cache: 1 hour for assets, one year immutable for fonts.

---

## 3. App shell

### 3.1 Server side

`src/web/shell.ts` (ac2f5ea, 34 lines):
- `export type NavCounts = { requests: number; approvals: number }` (line 9).
- `export type ShellInfo = { agencyName: string; today: string; counts?: NavCounts }` (line 12).
- `export function loadNavCounts(): MiddlewareHandler<WebEnv>` (lines 19-24): sets `c.set('navCounts', await c.var.actions.navCounts())` on every path except `/files/`.
- `export function shellInfo(c: Context<WebEnv>): ShellInfo` (lines 27-34): agency name, today as `"Fri 9 Oct"` in the Agency's time zone (`Intl.DateTimeFormat('en-AU', ...)`), and `counts: c.var.navCounts`. Synchronous.

`src/web/pm-pages.ts` (ac2f5ea) lines 16-34: `pmPages(o: { demo: boolean; channels?: ChannelModes | undefined })` routes: `/welcome`, `/tickets` (list and Ticket), `/approvals`, `/calendar` (calendarPages), `/schedule` (303 redirect to `/calendar` keeping the query), `/dispatch` (dispatchPages), `/properties`, `/tradies`, `/setup`, `/settings`, `/requests`, `/` (dashboard). Mounted behind `requirePropertyManager`.

### 3.2 Rail, top bar and content: ui.ts functions (ac2f5ea)

- `NAV` (lines 122-136): three groups. Group 1: Dashboard `/`, Dispatch `/dispatch`, Requests `/requests`, Tickets `/tickets`, Approvals `/approvals`, Schedule `/schedule`. Group 2: Properties `/properties`, Tradies `/tradies`. Group 3: Settings `/settings`. Groups are separated by `.rail-gap` (margin-top 12).
- `SIMULATOR` (line 139): `{ key: 'simulator', label: 'Phone simulator (demo)', href: '/demo' }`, shown only when `demo` is true, in `.rail-foot`.
- `railLink(item, active, count, cls = 'rail-link')` (lines 142-144): `<a class="rail-link">` with `aria-current="page"` when active; icon, then `<span class="rail-label">` containing the label and, when count is truthy, `<span class="rail-count num">N<span class="sr-only"> waiting</span></span>`.
- `rail(active, agencyName, counts, demo)` (lines 155-172): `<aside id="rail" class="rail" aria-label="Sections">`, `<a class="rail-logo">` home, `<nav aria-label="Main" class="rail-menu">`, the groups, the optional simulator, then `<button class="rail-toggle" data-rail-toggle aria-controls="rail" aria-expanded="true">` (Collapse menu, icon `sidebar-simple`), then `<p class="rail-agency">`.
- `userMenu(name)` (lines 175-180): `<details class="user-menu" data-menu>` with `summary` = name + caret, panel with a ghost small "Sign out" post button (`/logout`).
- `topBar(title, { menu, controls?, today?, pm? })` (lines 187-200): `<header class="topbar">`, optional `menu-button` (`data-drawer-toggle`, `aria-label="Menu"`, list icon), `<h1 class="topbar-title">` (the page's only h1), `.topbar-controls`, `.topbar-end` with `<time class="topbar-date">` and the user menu.
- `contentHead(subtitle, actions)` (lines 203-209): `.page-head` with `.page-subtitle` (or an empty span) and `.page-actions`.
- `page(o)` (lines 217-260), full signature:

```ts
export function page(o: {
  title: string;
  pm?: { name: string } | null;
  active?: NavKey;
  flash?: Flash | null;
  body: Html;
  subtitle?: Html | string;
  actions?: Html;
  controls?: Html;            // top bar, e.g. segmented Mine/All
  shell?: ShellInfo;
  navCounts?: Partial<Record<NavKey, number>>;
  demo?: boolean;             // default true
  fullPage?: boolean;         // no rail: the onboarding wizard
}): Html
```
  Output: `<html lang="en-AU" data-theme="myest8">`, skip link to `#main`, `<div class="app-shell has-rail" data-shell>` (grid at 1024px+), rail, `.app-main` with topbar, `.app-flash` (flash message), `<main id="main" class="app-content">` with page head and `.app-body-stack` (gap 24), and `.drawer-scrim` (`data-drawer-scrim`) when signed in.
- `publicPage(o)` (lines 273-320): for signed-out pages. Bar `.public-bar` with `.public-bar-inner` (`is-narrow|is-wide` modifiers), logotype at left (or `brand` + small logo at right, ac2f5ea only), `headerActions` at right, `<main id="main" class="public-main">` with flash, `.page-head` (h1 `page-title`, optional `is-hero`), body, `<footer class="public-footer">` (default line "Questions? Reply to the message your Property Manager sent you.").
  Full signature: `{ title; flash?; body; subtitle?; width?: 'narrow'|'default'|'wide'; wide?: boolean; titleSize?: 'page'|'hero'; headerActions?; footer?; css?: string[]; brand?: string }`.
- `flashFrom(url)`, `withFlash(path, kind, message)`, `flashMessage(flash)` (lines 323-342): `role="alert"` for errors, `role="status"` otherwise, `data-flash`, `alert alert-soft alert-error|alert-success`, icon, sr-only "Error: " / "Done: ".
- `head(title, { css? })` (lines 101-115): meta, title "`<title> - myEST8`", favicon, inline script that adds class `js` and (from localStorage `rail`) `rail-collapsed` before paint, preloads, `daisyui.css`, `app.css`, extra css, `tailwind.js`, TAILWIND_THEME, `app.js` (defer).

### 3.3 Responsive behaviour (app.css, ac2f5ea)

| Width | Behaviour | Where |
|---|---|---|
| under 640 px (`40rem`) or `pointer: coarse` | touch targets 44 px (buttons, rail links, menu button, segmented items, inputs 44 px, 16px input text) | `.btn` (268-272), `.rail-link` (1185-ish), `.menu-button` (1430ff), inputs (492-510) |
| 640 px and up | topbar date shows (`.topbar-date` display inline) | 1411 |
| under 768 px (`47.99rem`) | side tabs become a horizontal scrolling row; `.steps` etc. | 709 |
| 768 px and up | public wide gutters 24; two-column field grids (doc) | 1512 (`min-width: 48rem`) |
| under 1024 px (`63.99rem`) | rail is off-canvas drawer when JS is on (`html.js .rail { position: fixed; transform: translateX(-100%); width var(--rail-width); max-width 85vw; z-index 40 }`), scrim (`--scrim`, z 35), menu button shown, topbar controls on a second full-width row, app-content padding 16 | 1336ff, 1573, 1586, 1614, 1639 |
| 1024 px and up (`64rem`) | `.app-shell.has-rail` grid `var(--rail-width) minmax(0,1fr)` with 150ms transition; rail sticky, `height: 100vh`; collapse button shown (`html.js .rail-toggle`); `lane-body` max-height 22rem | 1111-1133, 1263ff |
| collapsed (`html.rail-collapsed`, 1024px+) | grid `var(--rail-collapsed-width)` (64px); labels become tooltips (`--rail`, `--shadow-lift`, left: calc(100% + 8px)); waiting counts become 6px Wattle dot at the icon corner; logo word and agency name hidden | 1269-1322 |
| no JS, under 1024 px | `.rail-menu`, `.rail-nav` wrap as a row above content | 1336-1342 |

Layout of the signed-in page (doc diagram, lines 69-88): 220px rail on Night at left; 60px top bar on Surface with a bottom hairline; content max 1280px with 24px gutters (16 phone).

Page header pattern: the title lives in the top bar (`h1.topbar-title`, 22px Lexend). `page({ subtitle, actions, controls })` puts a `.page-subtitle` (14px Slate) and `.page-actions` in `.page-head` under the top bar, inside `.app-content`. The Mine/All control is `segmented()` passed as `controls`, in `.topbar-controls`.

### 3.4 Flash, drawer and menus (app.js, ac2f5ea)

app.js (262 lines) adds: confirm dialogs for `form[data-confirm]`; double-submit guard (`data-submitting`, `aria-busy`, released after 8s); dismissable flash with `×` (`btn btn-ghost btn-sm btn-square`), "ok" fades after 8s unless hovered or focused; removes `?ok=` / `?error=` from the URL; drawer toggle (`data-drawer-toggle`, `data-drawer-scrim`) with focus moved to first rail link and returned to the toggle; Escape closes drawer or open menus; collapse button `[data-rail-toggle]` with `rail` in localStorage and "Collapse menu" / "Expand menu" label; user menu closes on outside click or Escape; `// === share ===` (Copy link, native share, close, one panel open); `// === landing ===` (pause button, only when motion allowed); `// === import ===` (ticked-row count in "Add N Properties"); `// === autosubmit ===` (`data-autosubmit` GET forms submit on select change).

---

## 4. Reusable components in ui.ts (ac2f5ea) and how they compare with the current tree

Status key: **SAME** = identical exported signature in the current `src/web/ui.ts`; **CHANGED** = exported in both but the signature or output changed (what changed is given); **ABSENT** = not exported in the current tree.

Current-tree line numbers are for `src/web/ui.ts` at HEAD (identical to the working tree).

### 4.1 Types and constants

- `Html = HtmlEscapedString | Promise<HtmlEscapedString>` (17). SAME.
- `Flash = { kind: 'ok' | 'error'; message: string }` (18). SAME.
- `NavKey` (19-29) = `'dashboard' | 'dispatch' | 'requests' | 'tickets' | 'approvals' | 'schedule' | 'properties' | 'tradies' | 'settings' | 'simulator'`. **CHANGED**: current = `'dashboard' | 'requests' | 'tickets' | 'approvals' | 'dispatch' | 'properties' | 'tradies' | 'settings' | 'simulator'` (16). `schedule` removed, and `dispatch` now means the Schedule.
- `Variant`, `Tone`, `FieldType`, `ButtonSize` (`'sm'|'md'|'lg'`) (366). SAME.
- `export { ROLE_LABEL } from '../onboarding.ts'` (line 15). **ABSENT** in current.
- `JOB_STAGES` (485-492). SAME (same order and labels; current line 455).
- `ROLE_LABEL` re-export: absent in current.

### 4.2 Layout

- `head(title, { css? })` (101-115). **ABSENT** as an export. Current has a private `head(title)` (no `css` option, no collapse script). ac2f5ea exports it.
- `page({...})` (217-260). **CHANGED**. ac2f5ea adds `fullPage?: boolean` (no rail for the onboarding wizard) and renders the collapse button and `NAV` with a `schedule` place. Current: `signedIn` replaces `withRail`, no `fullPage`, and `NAV` has two groups (Dashboard, Requests, Tickets, Approvals, Dispatch-labelled-Schedule; then Properties, Tradies, Settings). Signature current (lines 195-...): same options minus `fullPage`.
- `publicPage({...})` (273-320). **CHANGED**. ac2f5ea adds `css?: string[]` (extra stylesheets: `landing.css`, `auth.css`) and `brand?: string` (a Tenant's Agency name in the bar). Current has neither (line 249).
- `flashFrom`, `withFlash`, `flashMessage` (323-342). SAME.
- `alert(body, tone = 'info', { title? })` (351-361). SAME. Tones: `neutral|info|success|warning|error`; `warning` and `error` are `role="alert"`.

### 4.3 Buttons and links

- `button(label, { variant?, type?, name?, value?, size?, block?, disabled? })` (373-378). SAME. Variant map: primary `btn-primary`, secondary `btn-outline`, danger `btn-danger`, ghost `btn-ghost` (VARIANT, line 363).
- `linkButton(label, href, { variant?, size?, block? })` (381-383). SAME; default variant `secondary`.
- `postButton(action, label, { variant?, size?, fields?, confirm? })` (386-395). SAME. `confirm` sets `data-confirm`, asked by app.js. Renders `<form method="post" class="inline-flex">` with hidden inputs.
- Classes (app.css): `.btn` 36px, Lexend 600 14px, radius 6, padding-inline 14, gap 6, `box-shadow: none`; `.btn-sm` 32px (padding 10); `.btn-lg` 44px (padding 18, 16px text); all 44px under 640px or `pointer: coarse`. `.btn-primary` Harbour fill, surface text, hover `--action-hover`. `.btn-outline` surface fill, 1px `--control` border, Night text, hover page fill and Night border. `.btn-danger` urgent text on surface, border turns urgent and bg `--urgent-bg` on hover. `.btn-ghost` Night text, hover page fill. Disabled: page fill, line border, muted text (app.css 245-330).

### 4.4 Sections and headings

- `card({ title?, actions?, body, id? })` (411-413). SAME. Same markup as `section()`.
- `section({ title, actions?, body, id? })` (416-418). SAME.
- `sectionHeader(title, actions?)` (421-426). SAME.
- Markup: `<section class="section">`, `.section-head` (`h2.section-title` 16/600 Lexend, `.section-actions`), `.section-body` (gap 12, 14px). CSS: surface, 1px `--line`, radius 8, padding 16, no shadow (app.css 509-545).

### 4.5 Badges and status

- `badge(text, tone = 'neutral')` (431-433). SAME. Classes `badge badge-soft badge-{neutral|info|success|warning|error}` + `whitespace-nowrap`.
- `urgencyBadge(urgency)` (441-445). SAME. `urgent` = error tone (urgent text on urgent-bg), `high` = warning tone (high on high-bg), anything else = `badge-muted` (muted text, line border, surface fill).
- `statusBadge(status, { job? })` (517-524). SAME. Job stage words via `JOB_STAGES` (quoting, With Property Owner, Ready to book, Booked, Done, Cancelled). `job: true` forces the stage word on Job statuses (`approved` = Ready to book); otherwise `approved` is "Approved". `STATUS_LABEL` maps `maintenance_request` = Maintenance Request, `urgent` = Urgent Repair, `declined_by_owner` = Declined by Property Owner.
- `jobStageLabel(status)` (495-497). SAME.
- `JOB_TONE` (500-507): quoting info, awaiting_owner warning, approved info, scheduled info, done success, cancelled muted.

### 4.6 Empty states, tables, forms

- `emptyState(text, action?)` (527-532). SAME. `.empty-state` padding 16, 1px line border, radius 8; `p` muted.
- `table(headers, rows, { caption?, align?, stack? })` (541-558). **CHANGED**. ac2f5ea adds `stack?: boolean` (under 640px each row is a block with the header hidden; cells' widths set in app.css `.table-frame.is-stacked`, lines 2461-2495). Current: no `stack` option, cells always `min-w-28`, frame has no `is-stacked`. Markup otherwise: `<div class="table-frame"><table class="table table-sm">`; CSS 36px rows, Lexend 600 headers, hairlines, no zebra.
- `field({ label, name, type?, value?, required?, placeholder?, options?, hint?, multiple?, accept?, step?, id?, autocomplete?, min?, max?, rows?, checked?, error? })` (567-624). SAME. Markup `.fieldset` > `label.field-label` + control + `.field-error` / `.field-hint` with aria-describedby and aria-invalid. Checkbox variant uses daisyUI `checkbox checkbox-primary checkbox-sm`. Textarea min-height 5.5rem; select/input 40px (44px phones).
- `stat({ label, value, hint?, tone? })` (629-635). SAME. `.stat-tile` (padding 12/16, radius 8, surface, line border).
- `statGroup(items)` (638-640). SAME. Grid 2 columns, `sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]`.

### 4.7 Sequences, navigation and messages

- `steps(items, { vertical?, horizontal?, current? })` (649-677). SAME. daisyUI steps; done = `step-primary` with `data-content="✓"` and `--done`; current = Harbour; to come = white circle on hairline, muted number; `aria-current="step"`; sr-only "(done)", "(next)" / "(this step)". Vertical under 1024 or always with `vertical`.
- `chatBubble({ side, header, text, footer?, tone? })` (703-710). SAME. `end` bubbles Harbour with surface text (`.chat-end .chat-bubble` action fill); `start` bubbles Paper with Night text; links in bubbles take the bubble's text colour, underlined. Text strings go through `linkified()` (lines 682-692).
- `tabs(items, label = 'Views')` (718-728). SAME. `nav.tabs.tabs-border` with `aria-current`; the active tab has Night 600 text and a Harbour underline.
- `sideTabs(items, label = 'Sections')` (735-741). SAME. `nav.side-tabs > ul > li > a.side-tab`; active tab is a surface tab with 1px line border and a 4px Wattle inset bar (`box-shadow: inset 4px 0 0 var(--hivis)`).
- `timeline(items)` (747-763). SAME. daisyUI vertical compact timeline; Harbour dots (`ICON.dot`); `hr` lines in `--line`.
- `photoGrid(items)` (766-781). SAME. 2/3/4 columns; `rounded-box border-line bg-page`; `alt` defaults to "Photo n of m"; each opens full size in a new tab.
- `dl(items)` (789-799). **CHANGED** in markup, same signature. ac2f5ea renders `dl.facts` / `.facts-row` / `.facts-term` / `.facts-value`: label column 8 to 12rem, labels stacking over values in boxes narrower than about 26rem (container query, app.css 2369ff). Current renders Tailwind utilities: `dl.divide-y.divide-line.text-sm`, each row `grid grid-cols-1 gap-1 ... sm:grid-cols-3 sm:gap-4`, `dt.font-medium.text-muted`, `dd.sm:col-span-2`.
- `clip(text, { lines? })` (811-813). SAME. `clipped()` (802-805) is the private helper: `line-clamp-N` with full text in `title`.
- `ticketCell({ ticketId, issue, address?, propertyHref?, unread? })` (821-834). **ABSENT** in current. ac2f5ea: a Ticket in a table row: the issue as the link to the Ticket, `#id` number quiet, unread dot with "N unread", then the address (link to the Property when `propertyHref`). Used in stacked tables (`.ticket-cell`, `.ticket-cell-head`, `.ticket-cell-issue`, `.ticket-cell-number`, `.ticket-cell-unread`, `.ticket-cell-address`; app.css ~2407-2495).

### 4.8 Dockets, rows, lanes, count strip, segmented

- `docket({ number, href?, urgency, address, street?, issue, meta, age?, unread?, decision?, size? })` (849-893). **CHANGED**. ac2f5ea has `age?` and `decision?`. Current signature: `{ number; href?; urgency; address; street?; issue; meta; unread?; size? }` (784-). Current also drops the default-size split into "status" and "foot": ac2f5ea default docket order is **issue (3 lines), address, perforation, status (urgency badge + meta), foot (number, unread dot, age)**. Current order is **stub (number + urgency badge), perforation, body (address, issue up to 2 lines, meta with unread dot)**. `size: 'large'` (Ticket page header) is the same idea in both (stub with 26px number, then address then issue).
  - ac2f5ea classes: `.docket` (padding 10, gap 6, surface, 1px line, radius 4, `text-decoration: none`, `a.docket:hover` border control), `.docket-stub`, `.docket-number` (14/600 Lexend), `.docket.is-large` (padding `12px 16px`, radius 8, gap 8), `.docket.is-large .docket-number` (26/700), `.docket.is-decision` (4px Wattle left border, lines 837-842), `.docket-perf` (dashed `--control` line, opacity 0.6), `.docket-body` (gap 2), `.docket-issue` (15/600, lh 1.3), `.docket-address` (13, muted), `.docket-status` (12, gap `4px 10px`), `.docket-foot` (12, muted), `.docket-meta` (12, gap `2px 12px`), `.unread-dot` (8px Harbour circle).
  - Current `.docket`: padding 8, gap 4, no `.docket-status` / `.docket-foot` split (app.css 793-830).
- `countStrip(items)` (899-908). **CHANGED**. ac2f5ea items take `decision?: boolean` (Wattle chip when true, Paper otherwise, `.count-chip.is-decision`, app.css 425). Current items are `{ label; count; href }` only (816), and the CSS sets every chip to Wattle: `.count-strip .count-chip { background: var(--hivis); }` (app.css 423-425). This is the opposite of the ac2f5ea rule ("Decision counts take the Wattle chip; the others a quiet one").
- `queueRow({ href?, thumb?, title, detail?, badges?, meta?, actions?, decision? })` (917-941). SAME signature and markup (`article.queue-row`, `.is-decision` 4px Wattle left border, `.queue-thumb` 56px, `.queue-head` title + `.queue-actions`, `.queue-detail`, `.queue-badges` + `.queue-meta` with `margin-left: auto`).
- `segmented(items)` (944-948). SAME. `nav.segmented` (surface, 1px `--control` border, radius 6, padding 3); active `.segmented-item` Harbour fill with surface text.
- `lane({ title, count, body })` (955-963). SAME. `section.lane` (Paper tray, 1px line, radius 6), `h3.lane-title` 14/600, `.lane-count` muted, `.lane-body` is `tabindex="0" role="region"`, scrolls at 1024px+ (max-height 22rem). Note: current app.css `.lane` present (line 1033) and `.lane-body` present (1062); the `max-height` rule was not checked.

### 4.9 Formatting helpers (non-visual, same in current)

- `formatMoney(cents | null)` (966-968): AUD via `Intl`, em dash for null. SAME.
- `formatWhen(iso, tz = 'Australia/Sydney')` (994-998): "Mon 12 Oct, 9:00 am". SAME.
- `formatTime(iso, tz)` (1001-1004): "9:00 am". SAME.
- `formatDay(iso, tz)` (1007-1011): "Wed 7 Oct". SAME.
- `formatAge(iso, now = new Date())` (1014-1023): "just now", "N minutes|hours|days ago". SAME.
- `humanise(value)` (1026-1029): "awaiting_owner" -> "Awaiting owner". SAME.
- `logo({ size?: 'sm'|'md' })` (1074-1076). SAME signature; markup unchanged in ui.ts diff; the current app.css also styles `.logo`.

### 4.10 Components that are ac2f5ea-only (absent or changed in current)

- ABSENT: `head` (export), `ROLE_LABEL` re-export, `ticketCell`.
- CHANGED signature: `page` (`fullPage`), `publicPage` (`css`, `brand`), `table` (`stack`), `docket` (`age`, `decision`), `countStrip` (`decision`), `NavKey` (`schedule`).
- CHANGED behaviour: `dl` (markup), `rail` (collapse button, three groups, icons), `railLink` (`rail-label` wrapper, "waiting" sr-only text in count).
- Everything else in the export list is SAME (button family, card, section, sectionHeader, badge, urgencyBadge, statusBadge, jobStageLabel, emptyState, field, stat, statGroup, steps, chatBubble, tabs, sideTabs, timeline, photoGrid, clip, queueRow, segmented, lane, flashFrom, withFlash, flashMessage, alert, formatters, humanise, logo, and the `Html`/`Flash`/`Variant`/`Tone`/`FieldType`/`ButtonSize` types).

### 4.11 shell.ts (current vs ac2f5ea)

- `NavCounts` type: **ABSENT** (current `ShellInfo.counts` is `Partial<Record<NavKey, number>>`, shell.ts line 10).
- `loadNavCounts()` middleware: **ABSENT** in current.
- `shellInfo(c)`: **CHANGED**: current is `async` and awaits `actions.navCounts()` itself (shell.ts 13-19), so each page calls it (no request-scoped cache).

---

## 5. app.css structure (ac2f5ea, 3275 lines)

Order of sections, with starting lines:

1. Header comment (1-6).
2. `@font-face` x7, Lexend 400/600/700 and Red Hat Text 400/500/600 + 400 italic (8-57).
3. Tokens `:root` (59-92): colours, rail sizes, scrim, shadow, font stacks.
4. `[data-theme='myest8']` daisyUI mapping (94-129).
5. `@layer utilities { @layer app { ... } }` opens at 136. Everything below sits inside that layer pair (the comment at 131-135 explains why: beats daisyUI, loses to Tailwind utilities).
   - Base: html, body, headings, links, `.text-muted`, `.num`, `:focus-visible`, placeholder, reduced-motion rule (136-200).
   - `.skip-link`, `.truncate-words`, `.line-clamp-1|2|3` (203-240).
   - Buttons `.btn`, `.btn-sm`, `.btn-lg`, `.btn-primary`, `.btn-outline`, `.btn-danger`, `.btn-ghost`, `:disabled` (241-330).
   - Badges `.badge`, `.badge-soft.*` (331-373).
   - Alerts `.alert`, `.alert-soft.*`, `.alert a` (374-407).
   - Count chips `.count-chip`, `.is-decision` (408-430).
   - Forms `.fieldset`, `.field-label`, `.field-hint`, `.field-error`, `.input`, `.select`, `.textarea`, `.file-input`, `.checkbox`, error and focus states, phone 16px text (431-508).
   - Sections `.section`, `.section-head`, `.section-title`, `.section-actions`, `.section-body` (509-548).
   - Tables `.table-frame`, `.table`, `:where(th, td)` (549-578).
   - Steps `.steps`, `.step`, `.step-primary`, done line (579-624).
   - Chat `.chat-header/footer`, `.chat-start/.chat-end .chat-bubble`, `.chat-bubble a` (625-658).
   - Tabs `.tabs-border > .tab`, side tabs `.side-tabs`, `.side-tab` (659-730).
   - Timeline (721-731) and stat tiles `.stat-tile*` (732-760), empty state (761-775).
   - Dockets `.docket*`, `.unread-dot` (776-911).
   - Count strip `.count-strip`, `.count-item` (912-941), segmented `.segmented*` (942-978).
   - Queue rows `.queue-*` (979-1058).
   - Lanes `.lane*` (1059-1110).
   - Shell `.app-shell`, `.app-main`, `.rail*` (1111-1262), collapse and tooltip rules (1263-1335).
   - Drawer under 1024px, `.drawer-scrim` (1336-1345ish, plus 1600-1640).
   - Topbar `.topbar*`, `.menu-button`, `.user-menu*` (1348-1496).
   - Public bar `.public-bar*`, `.logotype`, `.public-main`, `.public-footer` (1497-1562).
   - App content `.app-content`, `.app-flash`, `.app-body-stack`, `.page-head`, `.page-title`, `.page-subtitle`, `.page-actions` (1563-1617).
6. `/* === Icons and logo === */` (1677-1721): `.logo`, `.logo-mark`, `.logo-my`, `.logo.is-md|is-sm`, rail focus ring in rail text.
7. `/* === share === */` (1722-1930): `details[data-share]` (`.share`, `.share-panel`, `.share-head`, `.share-url`, `.share-option`, `.share-copy-button`, `.share-close`, `.share-status`), sheet on phones under 640px.
8. `/* === landing === */` (1931-1933): comment only; styles are in `static/landing.css` (1043 lines, loaded only on the landing page).
9. `/* === import === */` (1934-2084): `.import-*` (spreadsheet review: `.import-panel`, `.import-summary`, `.import-table`, `.import-ai`, `.import-fix`, `.import-steps`, `.import-template`, ...).
10. `/* === dispatch === */` (2085-2543): `.dispatch-map`, `.dispatch-map-section`, `.dispatch-panel*`, `.dispatch-list`, `.dispatch-schedule`, `.dispatch-board`, `.dispatch-day`, `.map-pin*` (urgency shapes), Leaflet overrides (`.leaflet-container`, `.leaflet-marker-icon`), `.property-facts`, `.dl` helpers, `.ticket-cell` and stacked tables (2407-2543).
11. `/* === Request review page === */` (2544-2744): `.request-review`, `.request-lead`, `.request-facts`, `.request-checks`, `.request-decide`, `.request-reject-form`, `.request-list`.
12. Property profile (2745-2784): `.property-facts`, `.property-contact`.
13. `/* === Tenant pages === */` (2785-2837): `.tenant-issue`, `.tenant-chosen`, `.tracker-now`, `.tracker-share`, `.ticket-*`? (upload and tracker layout; Agency name leads the bar).
14. `/* === Ticket page === */` (2838-3037): `.ticket-head`, `.ticket-stub`, `.ticket-perf`, `.ticket-next` (Wattle stripe when decision), `.ticket-next-label`, `.ticket-menu` (Change Urgency), `.quote-compare` / `.quote-column` / `.quote-check` / `.quote-price` / `.quote-state` / `.quote-tradie` / `.quote-ratings` (Quotes side by side), `.ticket-older` (older messages fold).
15. Schedule and Dispatch bookings (3038-3188): `.booking`, `.booking-time`, `.booking-issue`, `.booking-tradie`, `.booking-meta`, `.booking-reschedule`, `.booking-list`, `.schedule-week`, `.schedule-day`, `.schedule-day-title`, `.schedule-quiet`, `.is-today`, `.has-visits`, `.is-empty`, `.is-booked`, `.is-done`, `.is-reschedule`.
16. `/* Dashboard page */` (3189-3275): `.dashboard-decisions`, decision rows (360px column), inbox (`.inbox-item*`, `.is-selected`).

Notable custom class families (for re-implementation):
- Shell: `app-shell has-rail`, `app-main`, `rail`, `rail-logo`, `rail-menu`, `rail-nav`, `rail-gap`, `rail-foot`, `rail-link` (+ `is-quiet`, `[aria-current=page]` Wattle inset bar), `rail-label`, `rail-count`, `rail-agency`, `rail-toggle`, `drawer-open`, `drawer-scrim`, `rail-collapsed` (html), `topbar`, `topbar-title`, `topbar-controls`, `topbar-end`, `topbar-date`, `menu-button`, `user-menu`, `user-menu-panel`, `app-content`, `app-flash`, `app-body-stack`, `page-head`, `page-title` (+ `is-hero`), `page-subtitle`, `page-actions`, `public-bar`, `public-bar-inner` (+ `is-narrow|is-wide`), `public-main`, `public-footer`, `logotype`, `skip-link`.
- Components: `btn` (+ `btn-primary|outline|danger|ghost|sm|lg`), `badge badge-soft badge-{...}` (+ `badge-muted`), `alert alert-soft alert-{info|success|warning|error}`, `count-chip` (+ `is-decision`), `count-strip`, `count-item`, `count-label`, `segmented`, `segmented-item`, `tabs tabs-border tab tab-active`, `side-tabs`, `side-tab`, `steps steps-vertical|horizontal step step-primary`, `chat chat-start|chat-end chat-bubble`, `timeline timeline-vertical timeline-compact timeline-snap-icon timeline-middle`, `stat-tile*`, `empty-state`, `section*`, `table table-sm table-frame is-stacked`, `fieldset`, `field-label`, `field-hint`, `field-error`, `input|select|textarea|file-input|checkbox`, `docket` (+ `is-large`, `is-decision`), `docket-stub|perf|body|issue|address|status|foot|meta|number`, `unread-dot`, `queue-row` (+ `is-decision`), `queue-thumb|main|head|title|detail|badges|actions|meta`, `lane lane-head lane-title lane-count lane-body`, `line-clamp-1|2|3`, `truncate-words`, `num`, `text-muted`, `sr-only`, `share*`, `logo logo-mark logo-my logo-word`, `ticket-cell*`, `facts facts-row facts-term facts-value` (ac2f5ea only in the CSS; current uses Tailwind utilities in `dl`).
- Page-scoped (ac2f5ea only, not present in current app.css): `dispatch-*`, `map-pin-*`, `leaflet-*`, `import-*`, `request-*`, `quote-*`, `booking-*`, `schedule-*`, `dashboard-decisions`, `inbox-item*`, `tenant-*`, `tracker-*`, `ticket-head`, `ticket-next*`, `ticket-menu*`, `ticket-older`.

---

## 6. Biggest visual differences: current tree vs ac2f5ea design

Current = HEAD `8e9e849` on `restore-dispatch-desk-design`, working tree clean. Comparisons are from `git diff ac2f5ea HEAD` for `ui.ts`, `shell.ts`, `pm-pages.ts`, `assets.ts`, `app.js`, `app.css`, and from direct reads of the current files where noted.

1. **Tokens are unchanged.** `:root` values (app.css 65-88 current vs 65-88 ac2f5ea) and the daisyUI theme are identical. Fonts unchanged. So colour and type foundations match; differences are in structure and components.
2. **Rail navigation and naming.** Current rail has two groups (Dashboard, Requests, Tickets, Approvals, then "Schedule" linking to `/dispatch`; then Properties, Tradies, Settings). ac2f5ea has Dashboard, Dispatch, Requests, Tickets, Approvals, Schedule; gap; Properties, Tradies; gap; Settings. Current has no Dispatch place at all (the map is gone; `/dispatch` is the calendar). `/calendar` now 301s to `/dispatch`; ac2f5ea `/schedule` 303s to `/calendar`.
3. **Rail icon.** Current's Schedule-labelled item uses `calendar-blank`; the `map-pin` (Dispatch) icon is gone (`NAV_ICON` in ui.ts: `dispatch: calendar-blank`).
4. **Rail collapse is gone.** No `rail-toggle` button, no 64px icon strip, no tooltips, no waiting dot. Current `--rail-collapsed-width` and `--rail-width` vars are removed from `:root` (current app.css 64-89 lists no `--rail-width`); the rail width is hard-coded `220px` in `.app-shell.has-rail` (current app.css ~1093-1101). app.js has no `rail` localStorage block.
5. **Rail groups are separated by 16px, not 12px** (current `.rail-nav + .rail-nav:not(.rail-foot) { margin-top: 16px }`, app.css 1142-1144).
6. **Rail counts** show only above zero in both, but current omits the `sr-only` "waiting" text and the collapsed-state dot (no collapsed state).
7. **Dockets.** Reading order is inverted in the current tree: the stub (`#number` and urgency badge) comes first, then the address, then the issue (up to 2 lines), then the meta. ac2f5ea reads issue, address, perforation, status, foot (design doc lines 125, 182-185). Current `.docket` padding 8 / gap 4 (ac2f5ea 10 / 6). The Wattle stripe on dockets (`.docket.is-decision`) and the `decision` / `age` props are gone, so Tickets on the board never carry a decision stripe.
8. **Count strip chips.** Current makes every chip Wattle (`.count-strip .count-chip { background: var(--hivis) }`, app.css 423-425). ac2f5ea makes only decision counts Wattle, others Paper. This dilutes "Wattle means needs your decision" (doc line 11).
9. **Tables lost the stacked mode.** `table()` has no `stack` option; no `.is-stacked` rules; no `ticketCell()`. Phones get the scrolling-frame table only (ac2f5ea design says tables stack on phones, doc line 15 of the spec: "Phones never scroll sideways. Wide tables stack.").
10. **Label/value lists (`dl`).** ac2f5ea uses a container-query `.facts` layout with an 8-12rem label column; current uses Tailwind grid with `sm:grid-cols-3` (label beside value from 640px, stacking below). Visually similar but different breakpoints and sizes.
11. **Public pages.** `publicPage` lost `brand` (a Tenant's Agency name leads the bar with a small logo at the right) and `css`. Tenants' pages therefore show only the logotype; the design's "The Agency's name leads the bar" is gone.
12. **Onboarding has the rail.** `page({ fullPage: true })` is gone, so the onboarding wizard now takes `pm` and shows the rail, against the design (doc line 168: "no rail").
13. **Landing, auth and dispatch CSS.** ac2f5ea keeps landing (`static/landing.css`, 1043 lines) and sign-in/up (`static/auth.css`) in separate stylesheets loaded per page, plus `dispatch-map.js` and Leaflet. Current has `landing.css`, `auth.css`, `dispatch-map.js` removed from the static folder and assets allowlist; landing styles sit in the main `app.css` (section at 1791). Leaflet is gone, so the Dispatch map and its pins (`map-pin-*`) do not exist.
14. **Public bar `.public-bar-inner`** keeps the same widths (560 / 400 / 1120) but the wide landing layout relies on styles now in `app.css`.
15. **Shell counts.** `NavCounts` and `loadNavCounts` middleware are gone; `shellInfo` is async and queries counts per call. The Approvals and Requests counts in the rail therefore cost a query on each page render rather than one per request. (Visual output the same.)
16. **app.js.** Current has no rail collapse, no `data-autosubmit` handler (Tradies' Trade filter needs its own button), and adds `data-copy-for` and direct-upload handlers (`// === copy ===`, `// === direct upload ===`).
17. **Design doc.** Current `docs/design-system.md` has 317 lines (ac2f5ea 389). Its headings differ: "Dashboard: the overview" replaces "Dashboard: the dispatch board"; "Dispatch: the map" and "Sign-in and sign-up pages" sections are absent. The doc still names Dispatch in the rail (line 92 in ac2f5ea), so it is out of step with the code.
18. **Not checked in detail (so not claimed):** the full current app.css page-scoped sections (landing 1791-2254, import 2255ff, ticket and dashboard blocks), exact `.lane-body` max-height in the current tree, and the current `favicon.svg`.

Known gaps in the design itself at ac2f5ea (for the re-implementer):
- Alert radius: doc says 8 px (line 57) and 6 px (line 210); CSS uses 6 px (app.css 376).
- The doc's rail shows "Schedule" with a `/schedule` link (line 92); the code's `NAV` has `/schedule` (ui.ts 129) and `pm-pages` redirects it. Consistent in ac2f5ea; the current tree differs (point 2 above).
- Doc says "Shadow only on menus, dialogs, the Share sheet and the phone frame" (line 59). CSS also applies `--shadow-lift` to the collapsed-rail tooltip (1312), which is a tooltip, not a menu.
- `docs/design-system.md` line 62 says "buttons, rail links, the segmented control and the menu button are 44 px on phones (under 640 px)". CSS does the same (`@media (max-width: 40rem), (pointer: coarse)`).
