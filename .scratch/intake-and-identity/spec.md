# A new identity and a complete intake flow

Status: ready-for-agent
Date: 2026-10-18

## Why

myEST8 looks like a navy-rail SaaS template, and its intake stops short of what a Property Manager actually needs: photos sent with the first message are dropped, the request shows the Tenant's raw text instead of a summary, Quote Requests can go to a single Tradie, and there is no way to get a Tradie on site to quote properly before the Agency commits to a price on a High repair.

This spec covers both: a new visual identity (the key-tag logo and the Phosphor icons stay exactly as they are) and the intake flow from first message to a chosen Quote, with a site-quote stage for High Jobs.

## Glossary additions (also in `CONTEXT.md`)

- **Summary**: one plain-English line describing a Maintenance Request's issue, written by AI from the Tenant's words and answers and editable by the Property Manager. Never adds facts the Tenant didn't give.
- **Site Quote**: a Tradie's visit to a Property to inspect the issue before giving a final Quote. Booked by the Property Manager on a High Job once initial Quotes are in. A Job with Site Quotes booked is "getting site quotes".
- **Initial Quote**: the Quote a Tradie gives from the description and photos, before any Site Quote. After the visit the same Quote is revised; the initial price stays on record.

---

## Part 1: The identity

### Subject and stance

A dispatch desk for Property Managers at small Australian agencies. Dense, decision-first, used between phone calls. The identity draws on green and gold (gum leaf, wattle) and the tradie's paper docket. Nothing is decorative; shape and colour carry meaning.

### Tokens

Replace the `:root` block and the daisyUI theme in `src/web/static/app.css`. Names and hexes:

| Token | Name | Hex | Role |
| --- | --- | --- | --- |
| `--ink` | Ironbark | `#1C2622` | Text, headings, the landing's closing band |
| `--page` | Gumleaf | `#ECEFE9` | The page behind sections, and the rail |
| `--surface` | White | `#FFFFFF` | Sections, rows, dockets, inputs |
| `--muted` | Bark | `#5C645E` | Secondary text, timestamps, hints, Routine |
| `--line` | Line | `#D4DAD1` | Hairlines and section borders |
| `--control` | | `#7A847C` | Input, select and secondary button borders |
| `--action` | Gum | `#27694B` | Primary buttons, links, focus, selected |
| `--action-hover` | | `#1E553C` | Hover and pressed |
| `--hivis` | Wattle | `#FFC233` | The decision bar, the current rail item, decision counts. Never text, never a button, never a wash |
| `--info-bg` | | `#E9F1EC` | "Filled in by AI" and info tints |
| `--urgent` / `--urgent-bg` | Rust | `#B23A1E` / `#FBEAE5` | Urgent, errors, destructive |
| `--high` / `--high-bg` | Ochre | `#9A5A0B` / `#FBF0DF` | High Urgency, warnings, flags |
| `--done` / `--done-bg` | Slate | `#3E5A72` / `#E7EEF4` | Done, approved, confirmed (kept off green so Gum always means "act") |
| `--rail` | | `var(--page)` | The rail is Gumleaf |
| `--rail-text` | | `var(--ink)` | |
| `--rail-muted` | | `var(--muted)` | |
| `--rail-hover` | | `rgb(28 38 34 / 0.06)` | |
| `--rail-current` | | `rgb(28 38 34 / 0.08)` | |
| `--scrim` | | `rgb(28 38 34 / 0.45)` | |
| `--shadow-lift` | | `0 8px 24px rgb(28 38 34 / 0.16)` | The one shadow: menus, dialogs, the phone frame |

Every text pair must meet WCAG AA. White on Gum is 6.6:1; Ironbark on Wattle 11.8:1; Bark on Gumleaf 5.4:1.

Shape: radius 4px on rows, badges, inputs and dockets; 6px on buttons and segmented controls; 8px on sections and alerts. Borders 1px `--line`. No shadow except `--shadow-lift`.

### Type

- Display: **Bricolage Grotesque** (variable, package `@fontsource-variable/bricolage-grotesque`). Page titles, section headings, docket numbers, the wordmark, landing headlines. Weight 600 for section headings, 700 for page titles and docket numbers. Letter-spacing -0.01em from 28px up. Optical size axis left to the browser.
- Text: **Public Sans** (variable, package `@fontsource-variable/public-sans`). Body, tables, forms, buttons, nav, badges. Weight 400 body, 500 nav and labels, 600 buttons and table headers.
- Scale (px): 12 meta, 13 dense tables and badges, 14 body, 16 lead and docket issue, 20 section heading, 28 page title and docket number large, 40 docket number on the Ticket page; landing 48 to 72. Line height 1.45 body, 1.1 headings. Measure 72ch max. Tabular figures via `.num`.
- Sentence case everywhere. No all-caps, no letter-spaced eyebrows, no middle-dot meta strings, no arrows appended to labels.
- Served like today's fonts: woff2 copied from the packages by `src/web/assets.ts`, `@font-face` in `app.css`, the two variable files preloaded in `head()`. The Lexend and Red Hat Text packages and their `@font-face` rules are removed.

### Layout

- **Rail**: Gumleaf background, Ironbark text, a 1px Line on its right. The current item has a 4px Wattle bar on its left and weight 600; hover is `--rail-hover`. Counts are plain Bark numerals; only Requests and Approvals counts that mean "needs you" are a small Wattle chip with Ironbark text. Logo renders Ironbark on the rail. Collapse (64px icons at ≥1024) and the phone drawer keep their current behaviour and JS.
- **Page header**: the separate white top bar goes. Each page's first row in the content column holds the `<h1>` in Bricolage 28px/700 on the left and, on the right of the same row, the date, the Mine/All segmented control if the page has one, and the user menu. On phones the row wraps: title, then controls.
- **Count sentence**: the dashboard's count strip becomes one sentence under the title in 16px: "2 Maintenance Requests to confirm, 1 Quote to choose and 1 Tradie to rate." Each count is a link; counts that need a decision are Ironbark on a Wattle chip; zero items are left out; when nothing needs the Property Manager the sentence says so.
- **Needs you**: the decision queue is one section with a full-height 4px Wattle bar on its left edge (the section's own border-left, not a stripe per row). Rows inside are hairline-separated, not cards. This bar is the one memorable element on the desk; nothing else on the page is Wattle except the rail's current item.
- **Docket** (Tickets only): white, 4px radius, the dashed perforation stays. Reading order: number (Bricolage) and Urgency badge in the stub, then the issue (Summary) at 16px, then the address in Bark, then the stage line. The large variant on the Ticket page sets the number at 40px.
- **Sections**: white, 1px Line, 8px radius, 16px padding; heading 20px/600 with the heading's actions on the same row. Tables 13px, 36px rows, no zebra, `stack` or `labelled` on phones as today. Badges 13px tinted with the word; Routine is Bark text with a Line border.
- **Landing** (`landing.css`): bands alternate Gumleaf and white; the closing band is Ironbark with the logo in Wattle. Hero: headline in Bricolage 56–72px on the left, the Tenant's thread becoming a Maintenance Request on the right, as now, re-set in the new tokens. The workflow stages and copy are updated to the new flow (see Part 2): photos checked on arrival, a Summary filled in by AI, Quote Requests to at least two Tradies, Site Quotes for High repairs, the Property Manager's decisions. Only claims the app actually makes are allowed on the page.
- **Auth** (`auth.css`): the split panel becomes Gumleaf with Ironbark type on the left, the form on white on the right. Errors are specific sentences beside the field they concern, announced with `aria-describedby`; no onboarding panel on sign-in.
- **Tenant pages** (`tenant.css`): white column on Gumleaf; the bar names the Agency and the page names the Property's street; the tracker's current stage carries the Wattle bar.

### Rules carried forward

- Shape encodes type: docket = Ticket only; everything else is a row or a section.
- One primary button per area; action names say the outcome ("Send Quote Requests", "Book site quotes").
- Colour is never the only signal; badges carry the word.
- No entrance animation; `prefers-reduced-motion` respected; one orchestrated moment only on the landing workflow (existing).
- No literal colours outside the token block; no new icon set; the logo mark is only ever Ironbark, White or Wattle.

### Files

- `src/web/static/app.css`: tokens, daisyUI theme, `@font-face`, rail, page header, count sentence, needs-you section, docket, queue row, sections, tables, badges.
- `src/web/static/landing.css`, `auth.css`, `tenant.css`.
- `src/web/ui.ts`: `page()` (header into content, no `topBar`), `rail`, `countStrip` replaced by `countSentence`, `docket`, `queueRow`, `TAILWIND_THEME` aliases, `head()` preloads. `LOGO_MARK`, `logo()` and `icons.ts` unchanged.
- `src/web/assets.ts`: font files from the two new packages.
- `package.json`: add `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/public-sans`; remove `@fontsource/lexend` and `@fontsource/red-hat-text`.
- `docs/design-system.md` rewritten; `.design-sync/conventions.md` corrected to the new tokens and fonts.

---

## Part 2: The intake flow

```
Tenant message (SMS / email / WhatsApp)
  → classifier: message class, Urgency, Trade
  → Urgent: Urgent Repair path (unchanged)
  → otherwise: photos on the message are saved as the issue's photos (EXIF-checked)
  → guided questions (location, started, worsening, availability)
  → Summary written by AI
  → photos already in: image match, then Maintenance Request
    photos not in: upload link; Maintenance Request after upload or after 48h marked "no photos"
  → Property Manager confirms (may edit Summary, Urgency, Trade) → Ticket + Job (quoting)
  → Quote Requests to 2+ Tradies (up to 4 recommended, Nominated first, top 3 preselected)
  → initial Quotes read and confirmed by the Property Manager
  → Ticket Urgency High and 2+ Quotes confirmed → prompt to book Site Quotes
      booked → Job is site_quoting; visits on the calendar; Tradies revise their Quotes after the visit
      skipped → choose
    Routine → choose
  → choose a Quote → Owner approval if over Max Repair Cost → Work Order books the repair
```

### Data model

One migration, `supabase/migrations/20261018090000_intake_summary_and_site_quotes.sql`:

```sql
ALTER TABLE issues ADD COLUMN summary text;
ALTER TABLE issues ADD COLUMN summary_by text;            -- 'ai' | 'property_manager' | NULL
ALTER TABLE issues ADD COLUMN photos_on_arrival integer NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN kind text NOT NULL DEFAULT 'repair';   -- 'repair' | 'site_quote'
ALTER TABLE work_orders ADD COLUMN quote_request_id bigint REFERENCES quote_requests(id);
ALTER TABLE quotes ADD COLUMN initial_price_cents integer;
ALTER TABLE quotes ADD COLUMN initial_proposed_time text;
ALTER TABLE quotes ADD COLUMN revised_at text;
```

Statuses are text columns, so the TypeScript unions change:

- `JobStatus` (`src/tickets.ts`): `'quoting' | 'site_quoting' | 'awaiting_owner' | 'approved' | 'scheduled' | 'done' | 'cancelled'`.
- `STAGES` (`src/views.ts`): `['quoting', 'site_quoting', 'awaiting_owner', 'approved', 'scheduled', 'done']`. Labels: Quoting, Site quotes, With Property Owner, Ready to book, Booked, Done.
- Tenant tracker stages (`tickets.tracker`): `reported, confirmed, getting_quotes, site_visit, approved, booked, done, closed`; `site_visit` only appears when the Job had Site Quotes.
- `Issue` gains `summary: string | null`, `summaryBy: 'ai' | 'property_manager' | null`, `photosOnArrival: number`.
- Work Order views gain `kind`. Every query that finds "the Job's Work Order" for the repair (`workOrderForJob`, `activeWorkOrderForJob`, `visitsOfTickets`, `alerts`, `markDone`, `recordTenantRating`, `rateTradie`) filters `kind = 'repair'`; the calendar, `isFree`, `findSlots`, `bookings` and `itemsWaitingOn` include both kinds.
- Timeline kinds added: `summary_edited`, `site_quotes_booked` ({ jobId, visits: [{ tradie, visitStart }] }), `site_quotes_skipped` ({ jobId }), `site_quote_done` ({ jobId, tradie }), `quote_revised` ({ jobId, tradie, fromCents, toCents }).

### Summariser port

`src/ports.ts`:

```ts
export interface Summariser {
  /** One line, at most 160 characters, plain English, only facts in the input. */
  summarise(input: {
    description: string;
    answers: { location: string | null; started: string | null; worsening: string | null };
    trade: Trade;
    photoCount: number;
  }): Promise<{ summary: string }>;
}
```

- `src/adapters/claude-summariser.ts`: Claude Haiku (same model id and HTTP client as `claude-classifier.ts`). System prompt forbids new facts, names, prices and advice; asks for one sentence ≤160 characters in Australian English; strips quotes and trailing full stops are fine. On any failure throw; the worker task retries and the request can still be confirmed without a Summary (the page falls back to the description).
- `src/demo/mock-apis.ts`: `mockSummariser` builds "<first sentence of description, trimmed to 120 chars> (<location>)" when a location is known. Deterministic.
- `src/demo/runtime.ts`: choose the Claude summariser when `ANTHROPIC_API_KEY` is set, else the mock; hosted mode treats it like the classifier (real when the key exists, else `ALLOW_MOCKS`).
- `src/context.ts` `Ports` and `src/app.ts` `createApp` take `summariser`. Test fakes in `test/support/fakes.ts` get a `fakeSummariser`.

### Intake changes (`src/intake.ts`)

- `startIssue`: when `msg.fileIds` holds images, save them as the issue's photos through the same path `intake.upload` uses (EXIF check per photo, `photos` rows), and set `photos_on_arrival`. Non-image attachments are ignored for this purpose.
- `finishGuidedQuestions`: after re-classifying Urgency and Trade and ruling out Urgent, schedule `intake.summarise`. Then, if the issue already has photos: set status `checking`, schedule `intake.match_photos`, and send `tenant.upload_link` with `{ uploadLink, alreadyHave: n }` whose text says photos were received and more can be added. If it has none: `awaiting_photos` and the upload link as today. The 48h `intake.no_photos` fallback stays for issues with no photos.
- `intake.match_photos` ends by moving the issue to `maintenance_request` as it does today.
- New worker task `intake.summarise` ({ issueId }): reads the issue, calls the Summariser, stores `summary` with `summary_by = 'ai'` unless `summary_by = 'property_manager'` already (never overwrite an edit). Scheduled after the guided answers and again from `intake.upload` when new photos arrive before confirmation.
- `tickets.confirmMaintenanceRequest(agencyId, issueId, edits?: { summary?: string })`: stores a non-empty edited summary with `summary_by = 'property_manager'` and records `summary_edited`. `asPropertyManager.editSummary(issueId | ticketId, summary)` for editing without confirming.

### Quote Requests (`src/quotes.ts`)

- `recommend(agencyId, jobId)`: returns at most **4** Tradies: the Property's Nominated Tradies with the Trade first, then the rest by the existing ranking (myEST8 rating, Google rating, median Quote). Each carries `nominated: boolean`, `preselected: boolean` (the first three).
- `MIN_QUOTE_REQUESTS = 2`: `sendQuoteRequests` refuses fewer than two Tradies ("Send Quote Requests to at least two Tradies") unless the Agency has fewer than two Tradies with the Trade who haven't been asked, in which case one is allowed. The page shows the reason when it allows one.
- Quote Requests already sent plus new ones count together: a second round may add a single Tradie.
- `recordTradieReply` on a Job in `site_quoting` whose Tradie already has a Quote: the Quote is **revised**. The first time, `initial_price_cents` and `initial_proposed_time` are copied from the current values; then `price_cents`/`proposed_time` are replaced, `confirmed` cleared, `revised_at` set, and `quote_revised` recorded. The Quote Request stays `quoted`.
- `quotingDecision` (`src/views.ts`) gains `'book_site_quotes'`: a Job in `quoting` on a Ticket whose Urgency is `high`, with ≥ `MIN_QUOTES` confirmed Quotes and no Site Quotes yet booked or skipped. For such a Job `choose_quote` is still allowed (the PM may choose without visits) but the dashboard's decision row and the Ticket's Next block lead with "Book site quotes". A Job in `site_quoting` shows `check_quotes` when a revised Quote is unconfirmed, else `choose_quote` once every booked Site Quote is done or the PM has marked quotes final.
- Choosing a Quote closes any active Site Quote Work Orders for the other Tradies on that Job (status `cancelled`) and tells them with `tradie.not_chosen`.

### Site Quotes (`src/scheduling.ts`)

- `bookSiteQuotes(agencyId, jobId, visits: { tradieId: number; start: string; durationMinutes?: number }[])`: the Job must be `quoting` or `site_quoting`; each Tradie must have a confirmed Quote on the Job; each slot must be free for the Tradie (default 60 minutes). Creates `work_orders` rows with `kind = 'site_quote'` and `quote_request_id`, moves the Job to `site_quoting`, records `site_quotes_booked`, sends `tradie.site_quote` (full address, time, Summary, photos by email) and one `tenant.site_quotes` message listing the visits (asks YES to confirm each, as `tenant.visit_time` does for one). Site Quote visits take reschedule and confirmation exactly as repair visits (`recordRescheduleRequest`, `recordVisitConfirmation`, `suggestTimes`, `acceptTime`).
- `siteQuoteSlots(agencyId, jobId)`: for each Tradie with a confirmed Quote, up to three free one-hour slots in the next 14 days inside the Tenant's availability (via `findSlots`). The page uses these to prefill.
- `skipSiteQuotes(agencyId, jobId)`: records `site_quotes_skipped`; the Job stays `quoting`; `quotingDecision` no longer offers `book_site_quotes`. Stored as a timeline event (no new column).
- `markSiteQuoteDone(workOrderId)`: the Tradie replied DONE on a Site Quote visit, or the PM marked it: the visit is `done`, `site_quote_done` recorded, and a reminder `tradie.site_quote_reminder` is scheduled 48h later if no revised Quote has arrived. `markDone` dispatches on `kind`.
- `markQuotesFinal(agencyId, jobId)`: PM says the visits are over; the Job moves back to `quoting` so choosing proceeds (any active Site Quote visits are cancelled and the Tradies told). Choosing a Quote directly from `site_quoting` is also allowed once every booked visit is done.
- Tradie replies while the Job is `site_quoting`: a price → revised Quote; DONE → `markSiteQuoteDone`; a reschedule → as for repairs. The classifier's `relatedItem` refs already include `work_order:ID` and `quote_request:ID`; `itemsWaitingOn` includes Site Quote visits with the summary "Site quote: <trade> at <address>, <time>".

### Templates (`src/templates.ts`)

- `tenant.upload_link` gains optional `alreadyHave?: number`: "Thanks, we have your N photo(s). Add more here if it helps: <link>".
- `tenant.site_quotes` ({ visits: { tradieBusinessName, visitStart }[] }): "Before we fix it, <n> tradies will come to look and quote: <name> on <time>; <name> on <time>. Reply YES if those times work, or tell us if you need another time."
- `tradie.site_quote` ({ propertyAddress, trade, summary, visitStart, visitEnd }): "Site quote for <agency>: <trade> at <address>, <time>. Issue: <summary>. Reply with your revised price after the visit, DONE if your price stands, or tell us if you need another time."
- `tradie.site_quote_reminder` ({ propertyAddress, trade }): "Reminder from <agency>: after your visit to <address>, please send your revised price for the <trade> job, or DONE if your quote stands."
- `tradie.quote_request` uses the Summary when one exists, else the description (still stripped of contact details).

### Pages

- **Requests list and detail** (`src/web/pages/requests.ts`, decision rows in `dashboard.ts`): ranked Urgency then age. The row/page leads with the Summary ("Filled in by AI" tint, pencil to edit; falls back to the description with no tint). Then one photo strip: thumbnails, "N photos, sent with the message" or "uploaded", metadata result, image-match result in words. Then the Tenant's answers. Then Decide: Confirm (primary), Change Urgency / Trade, Reject with reason.
- **Ticket** (`src/web/pages/ticket.ts`): stage tracker across the top under the docket header; a "Next" block naming the one action for the Ticket (Send Quote Requests / Check Quotes / Book site quotes / Choose a Quote / Waiting on the Owner / Send the Work Order / Rate the Tradie / Close). Quote Requests listed while quoting (sent, reminded, quoted, declined). Quote comparison table: Tradie, initial price, after-visit price (or "no visit"), proposed time, myEST8 rating, Google rating, PDF, Choose. Site quotes section: each visit with Tradie, time, visit state, Mark done; actions "Book site quotes" (form with the prefilled slots per Tradie, each optional), "Skip site quotes", "Quotes are final". The send-Quote-Requests form lists up to four recommended Tradies with the first three ticked and Nominated marked.
- **Calendar and Dispatch** (`calendar.ts`, `dispatch.ts`, `bookings.ts`): Site Quote visits show an outlined "Site quote" badge; the calendar's day column lists which Tradies have no booking that day ("Free today").
- **Dashboard** (`dashboard.ts`): count sentence; Needs you section with rows for Maintenance Requests, Quotes to check, Site quotes to book, Quotes to choose, Tradies to rate; the duplicated Inbox / All open Tickets blocks below the fold are removed; lanes gain Site quotes.
- **Tenant tracker** (`tenant-pages.ts`): names the Agency and Property; shows the Site Quote visits with times; `site_visit` stage.
- **Sign-in** (`auth.ts`, `auth-card.ts`): specific error text, labelled fields, no onboarding panel.

### Demo

`src/demo/stories.ts`: one High story (e.g. "hot water system leaking into the laundry, 7 Wilson St") that has two confirmed initial Quotes and Site Quotes booked for tomorrow, so the dashboard shows "Book site quotes" on another and the calendar shows Site quote badges. Simulator presets include a Tradie's revised price reply.

---

## Tests

- Unit (`test/*.test.ts`, harness `createHarness`/`world()`): photos on the first message become issue photos and skip `awaiting_photos`; `intake.summarise` stores a Summary and never overwrites a PM edit; `sendQuoteRequests` refuses one Tradie when two are available and allows one when only one is; `recommend` caps at four with Nominated first; the High gate yields `book_site_quotes`; `bookSiteQuotes` creates `site_quote` Work Orders, moves the Job, notifies; a Tradie's price during `site_quoting` revises the Quote keeping the initial; `markDone` on a Site Quote visit doesn't mark the Job done; choosing cancels the others' visits; the tracker shows `site_visit`.
- Web (`test/web/*.test.ts`, `webWorld()`): the request page shows the Summary and the photo strip; the Ticket page shows the Next block, the comparison table and the site-quote actions; the dashboard shows the count sentence and the Needs you section.
- E2E (`test/e2e/site-quotes.spec.ts`): High request → confirm → send Quote Requests to two → two replies → confirm both → Book site quotes → calendar shows the visits → revised price → choose.

## Non-goals

- Changing the Urgent Repair path or the NSW wording.
- Tradie or Owner accounts.
- Payment or invoicing.
- Changing the logo mark or the icon set.
