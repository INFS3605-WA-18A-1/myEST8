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
| `--hivis` | Wattle | `#FFC233` | The decision stripe, the current rail item's bar, the count-strip chips, the logo on Night | Night on it 10.1:1 |
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
- Touch targets: buttons, rail links, the segmented control and the menu button are 44 px on phones (under 640 px) and on touch screens (`pointer: coarse`).

## Layout

### App shell (`page()`)

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ [tag] myEST8 │ Dashboard          [Mine | All]        Sat 10 Oct  Alice ▾ │ 60px top bar
│              ├───────────────────────────────────────────────────────────┤
│▌Dashboard    │                                                           │
│ Requests   3 │  page content (max-width 1280px, 24px gutters, 16 phone)  │
│ Tickets      │                                                           │
│ Approvals  2 │                                                           │
│ Schedule     │                                                           │
│              │                                                           │
│ Properties   │                                                           │
│ Tradies      │                                                           │
│ Settings     │                                                           │
│              │                                                           │
│ Phone        │                                                           │
│ simulator    │                                                           │
│ Harbour      │                                                           │
│ Realty       │                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
 220px rail (Night)
```

- Left rail 220 px on Night, the logo at the top (the key tag in Wattle, the wordmark in `--rail-text`) linking home. Two groups separated by a 16 px gap, not a heading. The work: **Dashboard** (`/`), **Requests** (`/requests`), **Tickets** (`/tickets`), **Approvals** (`/approvals`) and **Schedule** (`/dispatch`). The records: **Properties** (`/properties`), **Tradies** (`/tradies`) and **Settings** (`/settings`). Lexend 600 16 px, 40 px tall with an icon (Phosphor regular, 18 px). Requests and Approvals show a muted count for the Property Manager's own Properties (`shellInfo` reads `navCounts`), only when it is above zero. The current item is a lighter band with a 4 px Wattle bar on its left edge (an inset shadow, so it follows the 6 px radius) and `aria-current="page"`.
- At the foot of the rail, quieter (Red Hat Text 13 px, `--rail-muted`): the demo's **Phone simulator (demo)** link (`/demo`, demo deployments only) and the Agency's name.
- Top bar 60 px on `--surface` with a bottom hairline. It holds the page title (22 px Lexend 600, the page's only `<h1>`), optional page controls passed by the page (the Mine/All segmented control on the dashboard: links with `aria-current`, the current one filled with Harbour), today's date in the Agency's time zone, and the Property Manager's name opening a menu with Sign out.
- Under 1024 px the rail becomes an off-canvas drawer opened by a menu button in the top bar. Content is single-column with 16 px gutters and never scrolls horizontally.
- Flash messages appear directly under the top bar as one line: `--done` for ok, `--urgent` for errors, `role="status"` or `role="alert"`.
- Old places: `/calendar` redirects to `/dispatch`. `/setup` keeps channels, Property Owners, Building Managers and Tenants under Settings; Properties and Tradies have their own pages.

### Dashboard: the overview

The dashboard answers "what needs me now?" and links out; the long lists live on their own pages.

```
┌ count strip: 2 Maintenance Requests to confirm   5 open Tickets   1 alert   0 Urgent Repairs needing a receipt ┐
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Needs your decision                                                                                          │
│  Maintenance Requests to confirm                                                         See all requests   │
│▌[photo] 27 Llewellyn St, Marrickville NSW 2204           Confirm  Review                                     │
│  Alerts                                                                                                      │
│▌9 Albion St: FixIt Carpentry finished the Job. Rate the Tradie.                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Next 7 days                                                                               Open the schedule  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Each count links to its page: Requests, Tickets, Approvals, Requests#urgent-repairs.
- "Needs your decision" is full width, so addresses are never clipped. It shows at most 5 Maintenance Requests and 5 alerts, each row with the Wattle stripe.
- **Requests** (`/requests`): Maintenance Requests to confirm, the inbox (best guess in a `<details>`), and Urgent Repairs.
- **Tickets** (`/tickets`): the open Tickets as a table, or `?view=stage` for the five-lane board (Quoting, With Property Owner, Ready to book, Booked, Done) at full width.
- **Approvals** (`/approvals`): Ready for a Work Order, Waiting on the Property Owner, Collecting Quotes and Rate the Tradie. Each row's button names its next step.
- **Schedule** (`/dispatch`): the week of bookings. Empty days are narrow.

### Landing page (`/` signed out)

The front door says one thing and shows it once. A headline (Lexend 700, `clamp(36px, 5vw, 52px)`, line height 1.08, at most 620 px wide), one lead line naming who it is for, and two large (44 px) actions with the sign-up page's wording: **Create your Agency's account** (primary) and **Sign in**. No stat blocks, no feature cards, no gradients. In demo mode, the demo sign-ins sit under a hairline as plain text.

```
From a Tenant's first text to
the finished repair.                                  headline, left aligned
For Property Managers at small Agencies. ...          lead, 60ch
[Create your Agency's account] [Sign in]

One repair, start to finish                  [Pause]
 1 A Tenant texts the problem       ┌───────────────────────────┐
 2 It becomes a Maintenance Request │                           │
▌3 The Property Manager confirms ◀──│   the stage's picture     │  band moves down
 4 It becomes a Ticket              │   (chat bubble, row,      │  the titles
 5 Quote Requests go to Tradies     │    docket, Quote ...)     │
 6 A Quote comes back               │                           │
 7 The Work Order goes out          └───────────────────────────┘
 8 The Job is done, and the Tenant sees it
```

- **The workflow is the page's one moving thing,** and the one exception to "motion only answers an action". It is a server-rendered `<ol>` of eight stages, so it reads in order with no CSS, no JS and in a screen reader. Each stage has a title and a small picture built from the real components (`chatBubble`, `urgencyBadge`, `docket` without `href`, `steps`). Pictures hold no links or buttons.
- CSS plays it: each stage gets 2.6 s of a 20.8 s loop (`--i` sets its delay). A white band (4 px radius, hairline) slides down the titles; the current number fills with Harbour; the picture fades into the pane (white, 8 px radius, at least 360 px tall). At "The Property Manager confirms" the band's left edge becomes the 4 px Wattle stripe and the picture is a decision row with Confirm: the same signal a decision row has on the dashboard, so Wattle still only means "needs your decision".
- Phones (under 768 px): the pane sits above the titles.
- **Pause:** the loop runs longer than 5 s, so a Pause/Play button (WCAG 2.2.2) sits beside the heading. It is `hidden` in the markup and shown by app.js, which also holds the paused state (`data-paused` on the section).
- **Less motion:** under `prefers-reduced-motion: reduce` nothing moves. Every stage shows with its picture, in two columns from 768 px, and the Pause button stays hidden.

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

- White surface, 1 px `--line` border, 4 px radius, 8 px padding. It sits in a Paper lane, so it reads as a slip on a tray.
- The stub along the top holds the Ticket number (Lexend 600, tabular) and the Urgency badge (Urgent and High tinted, Routine quiet).
- A dashed hairline under the stub suggests the perforation of a docket book. Use the docket only for Tickets, on the dashboard board and as the Ticket page header (`size: 'large'`: a 26 px number, 8 px radius).
- Body: address (14 px 600, one line), issue (14 px, up to two lines), meta row (12 px `--muted`): Trade, Job progress, age, and an unread dot in Harbour with visually hidden text "unread messages".

## Components

All of these are in `src/web/ui.ts`; pages use them instead of hand-building markup.

- **Buttons** (`button`, `linkButton`, `postButton`): Lexend 600, 6 px radius. Sizes `sm` 32 px (rows and lanes), `md` 36 px (default), `lg` 44 px (a page's main way in, as on the landing page); every size is 44 px on phones and touch screens.
  - Primary: Harbour fill, white text, `--action-hover` on hover.
  - Secondary: surface fill with a 1 px `--control` border and Night text.
  - Ghost: text only, Paper on hover.
  - Danger: `--urgent` text on surface, red border on hover.
  - Labels are verbs that say what happens: "Confirm", "Send Quote Requests", "Send Work Order". No arrows.
- **Badges:** 13 px Red Hat Text 500, 1 px 8 px padding, 4 px radius, tinted from the token pairs, word always present. Trade and channel badges are Night on Paper; info is Harbour on `--info-bg`.
- **Count chips:** 22 px circles, 12 px 600. For decisions, Wattle with Night text; otherwise Paper with Night text.
- **Count strip:** one row (44 px) in a section box: chip and label pairs that link into the queues.
- **Queue rows** (`queueRow`): 4 px radius, hairline, 10 px padding. The title with the actions (Confirm, Review) at the end of its line, then the detail, then the badges with the age pushed to the end of their row. Only a row with `decision: true` gets the 4 px Wattle stripe on its left.
- **Lanes** (`lane`): a Paper tray of white dockets; the count is a muted number beside the title.
- **Tables:** 13 px, 36 px rows, headers in Lexend 600 Night, hairlines between rows, horizontal scroll only inside the table's frame.
- **Forms:**
  - Label above the control (14 px 600).
  - Controls 40 px tall (44 px on phones) with a `--control` border and 4 px radius; text is 16 px on phones so iOS doesn't zoom.
  - Hint 12 px `--muted`; field error 12 px `--urgent` with `aria-describedby`, and the control's border turns `--urgent`.
  - Placeholders `--muted` and italic so they never look filled in.
  - Two-column field grids at 768 px and up.
- **Sections:** surface, 1 px `--line` border, 8 px radius, 16 px padding, no shadow, heading 16 px Lexend 600 with optional actions on the right.
- **Alerts** (`alert`, `flashMessage`): 6 px radius, the tone's pair (info is Night on `--info-bg` with a Harbour icon), an icon and the tone's word for screen readers. Links inside take the alert's text colour, underlined.
- **Steps** (sequences only: the Ticket's Job progress, the Tenant tracker, the setup guide): 24 px circles. Done is `--done` with a tick (and a done line between done steps); current is Harbour with its number; to come is a white circle on a hairline with a muted number.
- **Tabs** (`tabs`): Lexend, muted until current; the current one is Night 600 with a Harbour underline and `aria-current`. **Side tabs** (`sideTabs`, for Settings' sections): a column of 40 px links, the current one a white tab with a hairline and the Wattle bar; a sideways-scrolling row under 768 px.
- **Timeline:** Harbour dots on a `--line` rule, the time muted above each event.
- **Chat** (simulator and message logs):
  - myEST8's messages on the left on Paper; the person's on the right on Harbour with white text. 8 px radius.
  - Links in a bubble take the bubble's text colour, underlined, so they read on Harbour and on every tone (the global link colour would be Harbour on Harbour); their focus ring is the text colour too.
  - The channel is a small badge, the time is muted, and text keeps its line breaks.
- **Empty states:** one sentence saying what will appear and the action to take, with no illustration.

### Icons and logo

- **Icons** come from [Phosphor](https://phosphoricons.com) (MIT) through `icon(name, { weight?, size? })` in `src/web/icons.ts`, rendered inline in `currentColor` and always `aria-hidden`. The word beside an icon carries the meaning. Don't add another icon set or hand-draw icons.
- **One weight: regular.** The only exception is the 14 px tick inside a done step circle, which uses bold so it doesn't thin out at that size.
- Sizes: 18 px in the rail (`size-[18px]`), 16 px for the Phone simulator link, 20 px in alerts and flash messages (the default), 24 px for the menu button, 16 px for the user menu caret and timeline dots.
- The app's icons: Dashboard `squares-four`, Requests `tray`, Tickets `ticket`, Approvals `seal-check`, Schedule `calendar-blank`, Properties `house-line`, Tradies `wrench`, Settings `gear-six`, Phone simulator `device-mobile`, menu `list`, user menu `caret-down`, done `check-circle`, warning and error `warning-circle`, note `info`, timeline dot `circle` (fill).
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
- **The panel** is a `<details>` disclosure with the menu shadow. It holds the title (which is also the email subject), an optional muted note, the link in a read-only field, then Email (`mailto:`), SMS (`sms:?&body=`) and WhatsApp (`wa.me`, new tab) as 40 px rows. On screens under 640 px it is a sheet along the bottom, 16 px clear of the edges.
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

- **Ticket page header.** It uses `docket()` at a large size: a 26 px number in the stub. It is never hand-built, so the dashboard docket and the header stay one object at two sizes.
- **Routine Urgency.** Routine shows as `--muted` text with a `--line` border. Ink text would read as more urgent than it is.
- **Decision rows.** Only rows that need a decision get the Wattle stripe. A row component takes `decision: boolean`; the stripe is never hard-coded.
- **One-Quote rule.** The rule is visible on the Ticket page next to Choose: "Choose once two Quotes are confirmed, or give a reason to go ahead with one." Choose stays enabled. Without a reason, the server's message explains what's missing.
- **Phone gutters.** 16 px below 1024 px.
- **Literal colours.** No literal colour values outside the token block in `app.css`, including white. Use `var(--surface)`.
- **Navigation (2026-10-12, replaces 2026-10-10).** The rail grew to the places a Property Manager actually goes: Dashboard, Requests, Tickets, Approvals, Schedule, Properties, Tradies and Settings, plus the demo's Phone simulator at the foot. The dashboard is now an overview; its long lists moved to Requests and Tickets. Tenants, Property Owners, Messages and Reports are candidates for later. Previously: Dashboard, Dispatch and Settings. Calendar's bookings move into Dispatch's Tradie schedule and the dashboard's week strip; the Setup pages move into Settings tabs.
- **The Tenant's progress tracker.** The Ticket page links to it, so a Property Manager can see what the Tenant sees.

## Copy

- Use `CONTEXT.md` terms exactly: Property Manager, Tenant, Tradie, Property Owner, Maintenance Request, Ticket, Job, Quote, Quote Request, Work Order, Urgency, Urgent Repair, Repair Cost, Max Repair Cost, Building Manager, Common Area, Trade.
- Plain verbs, sentence case, no filler. An action keeps its name through the flow: a "Send Work Order" button produces "Work Order sent".
- Errors say what happened and how to fix it. Empty states invite the next action.
