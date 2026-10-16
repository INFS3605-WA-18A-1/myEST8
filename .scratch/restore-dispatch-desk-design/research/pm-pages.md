# Property Manager pages: design (ac2f5ea) vs current tree (HEAD)

Scope: every Property Manager page in the "dispatch desk" design commit `ac2f5ea` and how the current working tree (HEAD `8e9e849`, clean at start) differs. Read-only; nothing was edited or committed.

Conventions
- `DES:path:line` = `git show ac2f5ea:path`. `CUR:path:line` = working tree.
- Breakpoints: `sm` 640px, `md` 768px, `lg` 1024px. The design's "1024px" rules are `lg:` classes; `static/dispatch-map.js` uses `64rem`.
- ui.ts components are named as exported. "Decision" = the Wattle stripe (`is-decision`).
- `ac2f5ea` is an ancestor of HEAD, so HEAD is later. Several design pages were partly reverted or moved (Dispatch map removed, dashboard simplified, Schedule moved to `/dispatch`). The branch name `restore-dispatch-desk-design` suggests the goal is to bring them back.

Route map at a glance

| Path | DES (design) | CUR (working tree) |
|---|---|---|
| `/` | Dashboard: decisions, Tickets by stage, Next 7 days, Inbox, Urgent Repairs | Dashboard: decisions (requests, alerts), Next 7 days only |
| `/tickets` | List with Open/Closed tabs and urgency strip (`tickets.ts`) | List or "By stage" toggle (`ticket-list.ts`) |
| `/tickets/:id` | Ticket with docket header and Next step strip | Ticket with plain header |
| `/requests`, `/requests/:id` | List by urgency; review in two columns | List (oldest first); review stacked |
| `/approvals` | Owners holding Quotes, and Urgent Repairs awaiting a receipt | Job groups (Ready, Owner, Quoting, Rate) |
| `/calendar` (DES Schedule; `/schedule` 303s to it) | Schedule week with Mine/All | `/calendar` 301s to `/dispatch` (CUR `pm-pages.ts:29`) |
| `/dispatch` | Dispatch map, panels, Tradie schedule (`dispatchPages`) | Schedule (`calendarPages`, `pm-pages.ts:28`), no map |
| `/properties`, `/properties/:id` | Directory and profile | Directory and add form only, no profile |
| `/tradies`, `/tradies/:id` | Directory with trade filter, profile | Directory with Google search and add form, profile |
| `/settings?tab=` | Four tabs: Agency, Channels, Team, Import | One page with two links |
| `/setup/imports/:token` | Review (unchanged core) | Review (same core, different back-links) |

Nav rail: DES `ui.ts` items are Dashboard, Dispatch (`/dispatch`), Requests, Tickets, Approvals, Schedule (`/schedule`), Properties, Tradies, Settings. CUR `ui.ts:110-119` has Dashboard, Requests, Tickets, Approvals, Schedule (key `dispatch`, href `/dispatch`), Properties, Tradies, Settings. There is no Dispatch entry in CUR. The name "Dispatch" now means Schedule, and the path `/dispatch` is used for the Schedule.

Wording change: DES says "Maintenance Requests to review"; CUR says "Maintenance Requests to confirm". The design vocabulary has "review".

---------------------------------------------------------------------

## 1. Dashboard `/` (`?filter=all`)

Purpose: the one screen where a Property Manager sees what needs a decision, where every open Ticket sits, and the next seven days.

### DES layout (`DES:src/web/pages/dashboard.ts`)

Routes (L104-211): `GET /`, `POST /requests/:issueId/{confirm,reject,urgency}`, `POST /inbox/:itemId/{link,route,dismiss}`, `GET /files/:id`. `back()` (L220-223) returns `/` or `/?filter=all`. `requestBack()` (L229-233) honours a hidden `return` field that must match `REQUEST_RETURN` (L98), so the forms return to `/requests` or a review.

Top to bottom:
1. `finishSetupBanner` (L129).
2. `countStrip` (L130-136), five items: Maintenance Requests to review (decision, `#requests`), Open Tickets (`#tickets`), Alerts (decision, `#alerts`), In the inbox (decision, `#inbox`), Urgent Repairs needing a receipt (`#urgent-repairs`).
3. Page controls: Mine/All `segmented` (L124-127). No subtitle.
4. Desk grid (L137): `dashboard-desk grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start`.
   - Decisions column `.dashboard-decisions`, `lg:col-start-1 lg:row-start-2`. `decisions()` (L250-282) is a `section` "Needs your decision" (id `decisions`) with three blocks:
     - `#requests`: h3 "Maintenance Requests to review", a `shareButton` when any exist, then `requestRow` (L289-301) per request. Each is a `queueRow` with `decision: true`. Thumb 56×56 (`img loading=lazy`) or no thumb. Title = description, detail = street (`streetOf`, L304-306), badges = `urgencyBadge` + trade badge + `requestFlags(r)`, meta = `ageOf` ("2 days ago", L493-499). Actions: Confirm (`postButton`, sm) and Review (secondary, sm). Empty: "No Maintenance Requests waiting for you."
     - `#alerts`: h3 "Alerts", then `alertRow` (L309-340), one per kind. `invite_more_tradies`: title "Only N confirmed Quotes after 72 hours", action "Ask more Tradies" to `ticket#job-N-tradies`. `owner_no_reply`: title "<owner>, the Property Owner, hasn't replied since <when>", action "Call <phone>" (`tel:`) or muted "No phone number on file". `rating_due`: "<business> finished the Job", action "Rate the Tradie" to `ticket#job-N`. Empty: "No alerts."
     - `#inbox` (only when items exist): h3 "In the inbox", then `inboxRow` (L343-353). Title = message text, detail = sender, badge = reason, meta = time, href `#inbox-<itemId>` (anchor to the full item lower on the page).
   - Board column `.lg:col-span-2 lg:row-start-1`. `ticketsByStage()` (L363-383): section "Tickets by stage" (id `tickets`), header link "See all Tickets" (ghost, sm). Body: `grid gap-3 lg:grid-cols-5` of five `lane` components (L370-379), titled by `STAGE_TITLE` (L89-95): Quoting, With Property Owner, Ready to book, Booked, Done. Each lane shows its count and "Nothing at this stage." when empty. Each Ticket is a `docket` (`ticketDocket`, L399-417): number, urgency, `street` (address without the state and postcode), issue, meta (trades, `quotingStatus` from L386-397 such as "2 Quotes to check", "Ready to choose", "No Quote Requests yet", "1 of 3 Quotes in", then "Visit <when>"), age, unread, and `decision` when a decision is waiting. With no open Tickets at all it is one `emptyState`: "No open Tickets. Confirming a Maintenance Request opens one." (Mine variant adds "on your Properties").
   - Next 7 days column `lg:col-start-2 lg:row-start-2`. `nextSevenDays()` (L426-456): section "Next 7 days" (id `next-7-days`) with "Open calendar" (ghost, sm). Rows: today first, always shown, with a `Today` badge and `rounded bg-page` highlight and `aria-current="date"`. Empty days after today collapse into one muted line, "Nothing booked Fri 9 – Mon 12 Oct" (`dayRange`, L484-488). Each row is `sm:grid-cols-[7rem_minmax(0,1fr)]`. Each booking (`bookingLine`, L469-476) is time, the Tradie's business name (to `/tradies/:id`), and the street (to `/tickets/:id`).
5. Inbox section (L142, id `inbox`), with a count badge. `inboxList`/`inboxItem` (L524-573): an `article.inbox-item` (`.is-unknown` when no sender is known), blockquote text and reason badge, sender and time line, a `details.inbox-item-guess` "Looks like: <guessSummary>" (L579-590) with a `dl` of answers, then actions. Unknown sender: a `form.inbox-item-link` with a select ("Link sender to", "Choose a person") and "Link sender". Low confidence: "Route with best guess". Always: "Dismiss" (ghost).
6. Urgent Repairs section (L143, id `urgent-repairs`): table (Property, Tenant, Issue, Status badge, Receipts, Reported). Status words from `URGENT_REPAIR_STATUS` (L65-69).

Mobile: DOM order is decisions (L138), board (L139), Next 7 days (L140), then Inbox and Urgent Repairs. The board is one column below `lg`, and the lanes are blocks. From `lg` the decisions column sits at 360px on the left of the board and Next 7 days.

### CUR (`CUR:src/web/pages/dashboard.ts`, 252 lines)
- Same routes, with `back()` always going to `/requests` (L161-164) and `streamOf` on `/files`.
- `countStrip` has four items (L53-58), none flagged as decisions. Counts link to `/requests`, `/tickets` and `/approvals`.
- Decisions section (L59-83): h3 "Maintenance Requests to confirm" (first 5, "Showing 5 of N", L21/L69-71) with a "See all requests" link. Then h3 "Alerts" (first 5, L76-79). No inbox and no board.
- Next 7 days (L177-207) is the same algorithm, but its header link is "Open the schedule" to `/dispatch`. The row helpers are `dayRow`/`bookingLine` (L210-227).
- Uses `requestRow` and `alertRow` from `CUR:requests.ts` (L228-270). Those differ from the design: title is the address, detail the description, flags are plain warning badges ("Check urgency", "Check trade", "Flagged photos"), thumb is 48px with a "No photos" placeholder.
- No board, no inbox, no Urgent Repairs on the dashboard (they moved to `/requests`, CUR `requests.ts:104-105`).
- No Share button.

### Design-only vs needs data
- Design-only (markup, CSS): desk grid, decisions/alerts/inbox markup, decision chips on `countStrip` (needs a `decision` prop, which HEAD `ui.ts` `countStrip` lacks), 56px thumbs, two-line request rows, `lane` board, `docket` age and decision.
- Needs data: the board needs each Ticket's `stage`, `trades`, `quoting` counts, `decision` and `nextVisit`. DES builds these in `DES:src/views.ts:103-150` (`board`), using `stageOf`/`quotingDecision` (L30-42), `modules.quotes.quotingOf`, `modules.scheduling.visitsOfTickets`, `tickets.jobsOfTickets`, `tickets.issuesWithUnread`. **None of these exist at HEAD** (`git grep` finds them only in `ac2f5ea`). CUR `ticket-list.ts:92-101` (`boardOf`) instead calls `actions.ticket()` once per Ticket (N+1; see issue 26).
- Needs `requestFlags`, `doubtsPhotos`, `passedChecks` from `src/web/request-checks.ts`. That module exists only in `ac2f5ea` (81 lines). It is a pure module, so it can be ported.
- Sort: DES dashboard keeps the core's order (oldest first, L245-249), whereas DES `/requests` sorts by urgency (`byUrgency`). Issue 03 asks for urgency on both.

---------------------------------------------------------------------

## 2. Tickets list `/tickets`

Purpose: every Ticket, open or closed, most urgent then oldest, with a quick filter.

### DES (`DES:src/web/pages/tickets.ts`, 116 lines)
- `GET /tickets?filter=mine|all&status=open|closed&urgency=urgent|high|routine` (L22-67). `URGENCY_FILTERS` at L16.
- Subtitle: "Most urgent first, then the earliest reported." When an urgency filter is on: "<Urgency> <status> Tickets. Show every Urgency" (link, L40-42).
- Controls: Mine/All `segmented` (L43-46).
- `tabs` labelled "Status" (L48-54): Open and Closed, each with a count.
- `countStrip` (L55-62): one item per urgency, each a toggle. Urgent is a decision chip when its count is above zero.
- `ticketTable` (L88-116): `table` with `stack: true`, so each row is a block below 640px. Headers: Issue | Urgency | (Property Manager when All) | Jobs | Reported. Issue cell is `ticketCell` (ui.ts L821-846): issue link, quiet `#<id>`, unread dot and words, and the address linked to the Property. Urgency badge plus "Check Urgency" warning. Jobs: `statusBadge` per Job. Closed Tickets show `statusBadge('closed')`. Caption: "Open Tickets, most urgent and oldest first" (or Closed).
- Empty: "No <urgency> <status> Tickets on your Properties." with "See every Property Manager's" (Mine only).
- Counts come from `actions.tickets()` → `DES:views.ts:204-225`, which returns `{counts:{open,closed,urgent,high,routine}, tickets}` for the same Properties.

### CUR (`CUR:src/web/pages/ticket-list.ts`, 144 lines)
- `GET /tickets?filter&view=stage` (L29-64). Controls: Mine/All (L47-50) and a second segmented control, "List | By stage" (L52-57). No tabs, no countStrip, no subtitle, no closed Tickets, no urgency filter.
- List (`ticketsTable`, L69-87): `table` (no `stack`, since HEAD `ui.ts` `table` has no `stack`). Columns: Property (plain link to `/properties/:id`), PM when All, Issue, Urgency + "Check urgency", Jobs, Unread (badge), Reported. Caption "Open Tickets, most urgent and oldest first".
- By stage (`board`, L114-128): lanes `md:grid-cols-2 xl:grid-cols-5` (design: `lg:grid-cols-5`). Docket meta = trades + quote count + age. No `decision` flag, no next visit, no `ticketCell`.
- Data: `actions.dashboard()` (open Tickets only). No closed Tickets, no urgency filter.

### Design-only vs needs data
- Design-only: tabs, urgency countStrip, stacked table, `ticketCell`. `ticketCell` is absent in HEAD `ui.ts` and its `ticket-cell*` CSS (11 hits in DES css, 0 in HEAD css).
- Needs data: `tickets.list(agencyId, propertyIds)` for all statuses (DES `views.ts:204`). **HEAD has only `openTickets` (`tickets.ts` ~L684)**. Also the per-Ticket quote count without N+1 (issue 26).

---------------------------------------------------------------------

## 3. Ticket `/tickets/:id`

Purpose: take one Ticket from issue to Work Order to rating: the Next step, Quotes compared, approvals, visits, timeline and messages.

### DES (`DES:src/web/pages/ticket.ts`, 1290 lines)
Routes (L76-206): `GET /:id`, and `POST` for urgency, close, read, jobs (add, trade, cancel, quote-requests), quotes (confirm, choose), work-order, work-orders/:id/accept (returns to `?suggest=`), jobs/:id/rate. Actions run through `onPost` (L222-238) and `formAction`.

Page header actions (L94-99): Share (`COLLEAGUES_ONLY`), `urgencyMenu` (L493-508), `closeControl` (L473-485).
- `urgencyMenu`: `details.ticket-menu` labelled "Change Urgency", with a High/Routine form ("Urgent issues never become Tickets.").
- `closeControl`: "Close Ticket" (`postButton` with confirm) when every Job is done or cancelled. Otherwise a disabled button and "Close once every Job is done or cancelled (N still open)". Closed shows a `Closed` badge.

Body (`ticketBody`, L319-330): header, then `lg:grid-cols-3` with Jobs in `lg:col-span-2` and a side column.

1. Header `ticketHeader` (L338-372), a large docket. `ticket-head` with a `ticket-stub` (coloured by urgency: high uses `bg-high-bg text-high`, otherwise `bg-page text-ink`) holding `#<id>` at 26px and the Urgency word. Then a dashed `ticket-perf`. Body: h2 = description (text-xl), address link (`/properties/:id`). Right: Repair Cost at 22px only when above zero (red with "Over the Max Repair Cost, with the Property Owner's approval"). Meta line: Tenant, `statusBadge`, `<time>` "Reported N days ago", Max Repair Cost (`num`), "Check Urgency" warning.
2. Next step strip `nextStepLine` (L381-389): `p.ticket-next` (`.is-decision` gets the Wattle stripe) with label "Next step" and a link to the anchor of the first decision. Job label shown when there are several Jobs. `nextStep` (L391-399) prefers the first decision, then the first waiting item, then the close step. `jobStep` (L402-448) writes the words, for example "Check 2 Quotes from A and B", "Choose a Quote: 2 confirmed", "Waiting on Quotes from X, asked 2 days ago", "Waiting on the Property Owner to approve $X", "Send the Work Order to X", "Find a new time: the Tenant asked for another", "Visit <when> with X", "Rate X".
3. Jobs (`jobCard`, L536-546): `section#job-<id>`, title "Plumbing Job" or "Job 2: Plumbing", `statusBadge` and "Check Trade". Body: `jobSteps` (horizontal `steps`: Quoting → Property Owner approval if needed → Booked → Done), then `nextAction` by status (L578-593), then `jobMore`.
   - quoting (`quotingAction`, L600-614): declined alert; `tradeForm` when Trade needs checking; `quotesSection` (comparison, below); `quoteRequestsWaiting` (who has been asked, and how long ago); "Ask more Tradies" in a `details`, holding `recommendationsSection` (L659-680): ranked table with myEST8 and Google as separate columns, median Quote, "Ask" checkbox. The first round ticks the top three. Button "Send Quote Requests".
   - awaiting_owner: `approvalSection` (L894-913), the Repair Cost and the Max Repair Cost, and the reminder words.
   - approved: `workOrderForm` (L915-946): Start (`datetime-local`, hint from the Quote's proposed time), Length (hours, default 2, step 0.5), "Send Work Order", plus free-slot badges.
   - scheduled: `workOrderDetails` (L948-972): Visit range, Tradie link, "Confirmed the visit" or "Not confirmed yet", "Suggest new times" link (`?suggest=<woId>`), reschedule alert. `suggestionsPanel` (L974-1010): up to three free slots with "Move here" buttons, and a "Pick another time" form.
   - done: `ratingSection` (L1012-1027): 1–5 buttons labelled "1" to "5", with the tenant's rating shown.
   - `jobMore` (L617-638): a collapsed "More about this Job" holding Trade, Quote Requests, Quotes, approval, the finished Work Order, and "Cancel Job" (ghost, with confirm).
   - Quotes comparison `quotesSection` (L789-813): `ul.quote-compare` inside `.quote-compare-frame`, with a `--quote-rows` CSS variable. One `li.quote-column` per Quote (`quoteColumn`, L816-847): `.quote-tradie` link, `p.quote-price`, cells for Proposed time and Ratings (myEST8 and Google, from the Quote's recommendation), `.quote-state` badges (Confirmed / Needs checking, PDF attached, "Chosen with one Quote: reason"), `.quote-action`. Actions line up across columns: `confirmForm` (L850-875) in `details.quote-check` "Check and confirm" (price required, proposed time, "Confirm Quote"), or `chooseForm` (L877-892) "Choose this Quote" with a reason textarea when fewer than two are confirmed. Below 640px each Quote is a block (CSS).
4. Side column: `reportCard` (L511-528) holds the photos grid (`photoGrid` with `photoCaption`) and the Tenant's answers `dl` (Where, Started, Getting worse, Usually home). `detailsCard` (L459-470): Property Manager, "Frequent issues here", and "Photo check" (`badge` + reason). `timelineCard` (L1042-1045): a `collapsible` open by default, with `timelineGroups` (L1051-1064) and `describeGroup` (L1067-1092) turning runs of events into one line. `messagesCard` (L1189-1204): `collapsible` with "Messages (N unread)", "Mark messages read", the latest six `chatBubble`s, and older messages in `details.ticket-older`.

Mobile: header, then Jobs (their DOM order is first), then the side column. Quote comparison becomes blocks below 640px.

### CUR (`CUR:src/web/pages/ticket.ts`, 1032 lines)
- Same route set (`ticketPages` L90). Same `onPost`/`formAction` pattern. Same action words.
- `ticketHeader` (L346-378) is a plain `header.flex` card, not a docket. h2 = **property address**, p = description (DES reverses this). Repair Cost is always shown at 26px, even at $0.00 (L356-359), which is issue 11's complaint. No stub, no perforation, no Next step strip (`nextStep` does not exist in CUR).
- Urgency is an inline `urgencyForm` (L417-427) in the header, not a menu.
- Side column (L332-340) has `photosCard` (L431-439), `reportCard` (L441-453), `detailsCard`, `timelineCard`, `messagesCard`. The photo check moved into `reportCard` (`imageCheck`, L455-459).
- Jobs: `jobCard` (L467-478) as `section`. `jobSteps` (L498), `nextAction` (L511), `quotingAction` (L529), `jobMore` (present), `ratingSection`, `approvalSection`, `workOrderForm` and `workOrderDetails` are present (outline L498-860).
- Quotes: `quotesSection` (L669-681) is a `ul` of `quoteCard` articles (L684-698): a header with the name and status, price, "Proposed time: ...", badges, then the confirm and choose forms. **This is a stack of cards, not a comparison table** (issue 01 unfixed). No ratings per Quote.

### Design-only vs needs data
- Design-only: docket header, Next step strip and `nextStep`/`jobStep` text, urgency menu, comparison table (`quote-compare*` CSS, 0 hits in HEAD css), Quote ratings columns, `photosCard` folded into `reportCard`.
- Needs data: `propertyId` on `views.ticket` (DES `views.ts:418-445` returns it; CUR `views.ts:110-134` does not). Everything else already comes from `jobView`, `workOrderForJob`, `recommendations`, `freeSlots`, `suggestTimes` (present at HEAD).

---------------------------------------------------------------------

## 4. Requests `/requests` and `/requests/:issueId`

Purpose: confirm or reject a Maintenance Request, change its Urgency, and check the automatic checks, answers and photos first.

### DES (`DES:src/web/pages/requests.ts`, 231 lines)
List (`GET /requests`, L24-51):
- Subtitle "Maintenance Requests that passed the automatic checks and are waiting for you to confirm or reject."
- Mine/All.
- `countStrip` (L42-46): Maintenance Requests to review (decision), Check Urgency (count), No photos (count). All link to `#requests`.
- `section` "Waiting for review" (id `requests`) with `requestList` (L91-106): `queueRow` per request. Title = **address**, detail = description, badges = urgency + trade + `requestFlags`, meta = "<tenant>, <age>", `decision: true`, actions Confirm (primary, sm) and Review.
- Sort: `byUrgency` (L85-88): Urgent, High, Routine, then oldest first. Issue 03 is fixed here (but not on the DES dashboard).
- Empty: "No Maintenance Requests waiting for you."

Review (`GET /requests/:issueId`, L53-79, `review()` L112-136):
- Page actions: "Back to Requests" (ghost, sm) and Share.
- `div.request-review` (two columns from `lg`):
  - `section.request-lead` (#request, L114-127): h2 "What the Tenant reported", `p.request-issue` (the description at large size), `p.request-address` (link to `/properties/:id`), and `dl.request-facts` with Tenant, Reported, Property Manager.
  - `div.request-side` (L127-130): **Checks** (`checks()` L170-178): flagged items as `request-flag is-<tone>` with a warning icon, then passed items as quiet `request-check-passed` with a check icon (`passedChecks`). "Nothing to check." only when neither exists. **Decide** (`decide()` L196-231).
  - `div.request-details` (L131-134): "The Tenant's answers" (`facts`: Where, Started, Getting worse, Usually home; "Not answered" in muted text) and "Photos" (`photoGrid` with captions; flagged captions get `request-photo-flagged`; empty text depends on `noPhotos`).
- Decide: if `doubtsPhotos(r)`, Confirm is a `details.request-confirm-check` whose summary looks like the primary button. Its body says "The photos were flagged by the checks. Look at them before you confirm." and offers "Confirm anyway". This works without JavaScript. Otherwise a plain Confirm block button. Then `form.request-urgency` (hidden `return` = the review, select, "Change Urgency", hint "Urgent makes this an Urgent Repair..."). Then a Trade fact badge. Then `details.request-reject` "Reject this Maintenance Request…" holding a textarea "Reason for the Tenant" (3 rows) and a danger "Reject" button, with `return=/requests`.
- CSS (`request-side` sticky beside the lead at `lg`). On phones the order is lead, Checks, Decide, then answers and photos.
- Also in DES: a second `requestRow` (L228-248, 48px thumb, title = address), exported "shared with the dashboard". The dashboard uses its own (`dashboard.ts:289`, 56px). The two have diverged.

### CUR (`CUR:src/web/pages/requests.ts`, 360 lines)
- List (L70-109): no subtitle, no countStrip. One section "Maintenance Requests to confirm" (#requests) with `requestRow` (L228-248): title = **address**, detail = description, badges = urgency + trade + plain text warnings ("Check urgency", "Check trade", "Flagged photos"), meta = `ageOf`, actions Confirm (primary) and Review. Thumb 48px.
- **Sort is oldest first only** (L78), so issue 03 is not fixed.
- Also on this page: Inbox (L104) and Urgent Repairs (L105), moved from the dashboard.
- Review (L111-137, `review()` L142-176): stacked sections, no two-column layout. "The report" (`dl`: Property, Tenant, PM, Reported, Trade, Urgency, Description), "Answers" (`dl`), "Photos" (`photoGrid`, `photoCaption` L179-183, no flagged emphasis), "Checks" (flag badges plus `imageCheck` L195-199, the image match reason), "Decide" (L202-223).
- Decide: a three-column grid. Confirm, then Reject as a visible form with the textarea (no disclosure), then the Urgency form (no hidden `return` field). No "Confirm anyway" path, no Trade fact. No `request-*` CSS.
- Review loads via `actions.dashboard({filter:'all'})` and `find` (L114), not a dedicated `request()` view. This works but is wasteful.

### Design-only vs needs data
- Design-only: review layout and CSS (`request-*`, 0 hits in HEAD css), disclosures, `byUrgency`, `countStrip` with decision chips, the list title change.
- Needs: `src/web/request-checks.ts` ported from DES (pure: `requestFlags`, `passedChecks`, `doubtsPhotos`, `photoCaption`, `hasFlaggedPhotos`). HEAD `ui.ts` `Tone` import is the only dependency. Data (`photos`, `imageMatch`, `noPhotos`, `checkUrgency`, `checkTrade`, `answers`) is already in CUR `views.dashboard` (`CUR:views.ts:39-72`).

---------------------------------------------------------------------

## 5. Approvals `/approvals`

Purpose (DES): the work held up **outside the Agency**: Quotes that need a Property Owner's yes because they take the Repair Cost over the Max Repair Cost, and Urgent Repairs waiting on a Tenant's receipt.

### DES (`DES:src/web/pages/approvals.ts`, 104 lines)
- Subtitle "Work held up until a Property Owner says yes, or a Tenant sends a receipt." Mine/All.
- `countStrip` (L59-63): "Quotes waiting on a Property Owner" (decision, `#owners`), "No reply for 48 hours" (decision, when any are silent), "Urgent Repairs waiting on a receipt" (`#receipts`).
- If there is nothing at all: one `emptyState` "Nothing is waiting on a Property Owner or a receipt." with "See every Property Manager's" (Mine only). Otherwise only the lists that have rows appear.
- Section "Waiting on a Property Owner" (`#owners`, L75-89), caption "longest waiting first". Columns: Ticket # (link) + Trade, Property (link), Property Owner name + `tel:` phone, Quote price + Tradie business name, "Over the limit" (bold) + "<repair cost> against <max>", Waiting (age without "ago"), Reminder (badge: "Reminder sent" warning or "Reminder not due yet" neutral, plus "No reply for 48 hours" error when silent).
- Section "Urgent Repairs waiting on a receipt" (`#receipts`, L91-104): Property (linked when it matches a Property), Tenant, Property Owner, Issue, Reported, Waiting.

### CUR (`CUR:src/web/pages/approvals.ts`, 138 lines)
A different page. It groups the Tickets' Jobs from `actions.dashboard()`:
- "Ready for a Work Order" (approved Jobs), "Waiting on the Property Owner" (awaiting_owner, with "No reply" plus name and phone when the owner alert fires), "Collecting Quotes" (quoting, "N of 3 Quotes in"), and "Rate the Tradie".
- Empty: one sentence (L116). Mine/All (L110-113). No countStrip, no Reminder column, no price or over-limit, no receipts list.
- The nav count (`CUR:views.ts:79-88`) is approved Jobs plus alerts. The DES count is owners waiting (`DES:views.ts:191-202`).

### Design-only vs needs data
- Needs data: `actions.approvals({filter})` → `DES:views.ts:227-248`. `waitingOnOwner` comes from `modules.quotes.waitingOnOwner`, which **does not exist at HEAD** (`DES:quotes.ts:463-500`). It needs approvals with status requested or reminded, the Quote price, `repairCost` (exists at HEAD), `maxRepairCostCents` (exists), owner mobile, `reminded` and a 48-hour `silent` flag. `waitingOnReceipt` is the existing `tickets.urgentRepairs` filtered to `reminder_sent`, with the owner name.
- The old "Ready for a Work Order" and "Collecting Quotes" groups are not in the design (they live on the dashboard board).
- Size: medium. Markup is small. The query is the work.

---------------------------------------------------------------------

## 6. Schedule (`/calendar` in DES, `/dispatch` in CUR)

Purpose: every booked visit across the Agency, a week at a time, so nobody double-books a Tradie.

### DES (`DES:src/web/pages/calendar.ts`, 135 lines), mounted at `/calendar`
- `GET /calendar?week=YYYY-MM-DD&filter=mine|all` (L26-66). Mine shows the Property Manager's own Properties (`propertyManagerId`, L34). All shows everyone's.
- Subtitle "Week of Monday 12 October 2026" (L36/L45). Mine/All `segmented` (L46-49).
- Page actions (L50-57): `weekNav` (L119-126): Previous week, This week (ghost, hidden on the current week), Next week. Then Share ("Jobs booked, week of ..."), `COLLEAGUES_ONLY`.
- Body (L58-63): when Mine hides visits, a muted line "N more visits this week on other Property Managers' Properties. Show all."
- `weekList` (L81-102): `ol.schedule-week` with seven `li.schedule-day` items (`is-booked`, `is-empty`, `is-today`). Each has an `h2.schedule-day-title` (short day, sr-only long day, `Today` badge) and either `ul.booking-list` or "Nothing booked". Runs of empty days get a `li.schedule-quiet` "Nothing booked Tue 13 – Wed 14" (shown below `lg`; hidden from `lg`, where empty days are narrow columns instead).
- Booking card `bookingCard` (`DES:src/web/bookings.ts:21-31`): `li.booking` (`is-reschedule`, `is-done`), `p.booking-time` (range, with day prefix in list view), `a.booking-issue` (issue, two-line clamp, to the Ticket), `a.booking-tradie` (business name to profile), `p.booking-place` (street and suburb, full address as title), PM name when All, and `visitNote` (L38-49): "Done", "Reschedule requested" (link to `?suggest=`), "Not confirmed yet", or nothing when confirmed.
- Helpers `bookingsByDay` (L63-71), `shortDay`, `longDay`, `dayRange` (L74-88).

### CUR (`CUR:src/web/pages/calendar.ts`, 212 lines), mounted at `/dispatch`
- Subtitle "Week of <date> <year>", `weekNav` (L123-130) and Share. **No Mine/All, no hidden-visits note.**
- Body (L49-53): one `div.schedule-week` grid with an inline `--cols` style: booked days `minmax(0,1fr)`, empty days `minmax(0,0.5fr)`, at `lg` only. `dayColumn` (L133-144): a `section` per day with `Today` text, the day label, and `bookingItem` cards, or "Nothing booked".
- No folding of empty days on phones. Seven stacked sections instead.
- `bookingItem` (L77-109): whole-card overlay link, time range, tradie link (z-10), address, trade and PM initials, "Done" / "Reschedule requested" / "Not confirmed yet". Classes `booking-*` do not exist in HEAD css.
- Trades come from `bookingTrades` (L65-70), which calls `actions.ticket()` for each Ticket (N+1).

### Data
- DES `Booking` (`DES:scheduling.ts` toView, ~L141-163) includes `trade`, `issue`, `suburb`, `visit` (from `visitOf`, L45-49), `propertyId`, `propertyManagerId`, plus the fields both have.
- CUR `toView` (`CUR:scheduling.ts:124-140`) has none of `trade`, `issue`, `suburb`, `visit`, `propertyId`, `propertyManagerId`. The data is available inside `place(row)` (HEAD keeps `job` and `ticket` there, as `tellTenantVisitTime` shows), so this is a small change to `toView`.

### Design-only vs needs data
- Design-only: folding, Mine/All control and note, `bookingCard`/`visitNote`, `booking-*`/`schedule-*` CSS, the day column widths.
- Needs data: the Booking fields above. Mine/All filters on `propertyManagerId`, so that field is needed.
- Not in the design either: issue 09 asks for Tradie rows with free time (merging Dispatch's Tradie schedule). DES Schedule does not do that. The DES Dispatch does (see section 7).

---------------------------------------------------------------------

## 7. Dispatch (map) `/dispatch`: design only

Purpose: the Agency's Properties and Tradies on a map, with a panel for the one picked, a table of every Property, and the Tradie schedule for the next seven days.

### DES (`DES:src/web/pages/dispatch.ts`, 319 lines), with `DES:src/web/static/dispatch-map.js` (177 lines), `DES:src/web/map-config.ts` (24 lines) and `DES:src/geo.ts` (32 lines)

Routes: `GET /dispatch` (L45-87), `POST /dispatch/addresses` (L90-98) which calls `geocodeMissing()` and flashes "Found N addresses…" or "No more addresses found…".

Top to bottom:
1. Page subtitle "N of M Properties and N of M Tradies on the map" (L59-62). Action: "Look up missing addresses" (`postButton`, sm), shown only while some Property or Tradie has no location (L53-54, L72).
2. `div.dispatch-board` (L74-77):
   - Map section `section.dispatch-map-section` (L105-119): sr-only h2; legend `ul.dispatch-legend` with five keys (Urgent triangle, High diamond, Routine filled circle, No open Tickets open circle, Tradie square). The JS fills the shapes (`dispatch-map.js:49-51`). `#dispatch-map.dispatch-map` region labelled "Each pin is a Property or a Tradie: Tab to a pin and press Enter…". Fallback text "The map needs JavaScript. The table below…".
   - Leaflet map: default view Sydney `[-33.8688, 151.2093]` at zoom 10 (js L126), then `fitBounds` to the pins with `maxZoom 15` (js L169). Property pins are 32px with their open Ticket count. Tradie pins are 26px with their initial. Markers are buttons (Enter and Space pick them, js L147-155). Wheel zoom turns on only after the map is focused (js L128-130).
   - `aside#dispatch-side` (L125-131): a hint `p.dispatch-panel-empty` ("Pick a Property or a Tradie on the map, or a Property in the table…"), then one `section.dispatch-panel[data-panel]` per Property (`propertyPanel` L141-164) and per Tradie (`tradiePanel` L166-178). Only the one picked is shown. Panel head has the name (h2, focusable), suburb and worst urgency, and a Close button (`hidden` until selected).
     - Property panel: "Open Tickets" (`ticketCell` + urgency badge). "Nearest Tradies, within 15 km": up to five, each with business name link, distance (`num`, one decimal), trades and both ratings. Messages for "Address not found", "No Tradies work within 15 km", or "No Tradie has a business address yet".
     - Tradie panel: business name, name and trades, ratings, "No business address yet, so this Tradie is not on the map.", "Booked" (`bookingCard` with day and no Tradie, next 7 days), "Open the profile".
     - Ratings (`ratings()` L181-192): "myEST8 4.0 (3 ratings)" and "Google 4.8 (120 reviews)" as separate spans, never combined. "Not on Google" and "Google: no rating yet" as needed.
   - Picking a Property draws a 15 km ring (`L.circle`, `dispatch-ring`) and fits the map to it (js L76-79). Escape or Close clears (js L93-105, L116-118). `#panel-…` in the URL picks on load (js L174-176). With no JavaScript a row's link jumps to `:target`.
3. `section#properties` "Properties" (L78, `propertyTable` L199-249): Properties with open Tickets only, most urgent first. Columns: Address (row header `th`, link that picks the panel, and "Address not found" badge), Suburb, Open Tickets (`ticketCell` list), Worst urgency. Properties with none fold into `details.dispatch-more` "Show the N Properties with no open Tickets" (address and suburb only). Empty: "No Properties yet. Add one in Settings…".
4. `section#tradie-schedule` "Tradie schedule" (L79, `scheduleTable` L263-299): a table of Tradie × today plus six days. Each cell is a `bookingCard` list (no Tradie name, since it is the row) or sr-only "Nothing booked". Only Tradies with a booking appear; every Tradie is in `details.dispatch-more` "Show all N Tradies". Empty: "No Tradie is booked in the next 7 days."
5. Data block `script#dispatch-data` (`pinData` L306-319): JSON with the tile config, radius, Properties with location, and located Tradies. HTML-escaped so no address can close the script.

Mobile: map first, full width, then the panel stacked under it (JS scrolls it into view below 1024px, js L89-90). Tables scroll inside their frame.

`map-config.ts`: OpenStreetMap tiles `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, attribution, `maxZoom 19`. The comment says to move to a provider before production.

`geo.ts`: `TRADIE_SEARCH_RADIUS_KM = 15`, `distanceKm` (haversine) and `nearest(from, items, radius, limit)`.

### CUR
- `/dispatch` is the Schedule. There is no `pages/dispatch.ts`, `src/geo.ts`, `web/bookings.ts`, `web/map-config.ts` or `static/dispatch-map.js`. `views.dispatch` is absent (`DES:views.ts:323-360`).
- Tradies have no location. HEAD `people` table (`supabase/migrations/20261010000000_initial_schema.sql` L40-59) has no `lat`, `lng` or `business_address`. Properties do have `lat`/`lng` (L68-79).
- Leaflet is in `package.json` (HEAD L36) but not served: `CUR:src/web/assets.ts` has no leaflet entries (DES `assets.ts:19-50` adds them).

### Backend needed
- Migration for Tradie `business_address`, `lat`, `lng` (`people`). `profiles.setTradieAddress` (DES `profiles.ts` ~L528-537) and `profiles.geocodeMissing` (~L539-566). `ports.places.geocode` exists at HEAD, so the lookup itself is present.
- Tradie add/edit form field for the business address (CUR `tradieFields` in `onboarding-forms.ts` has none).
- `views.dispatch` (`DES:views.ts:323-360`): Properties (location, suburb, open Tickets, `worstUrgency`) and Tradies (location, trades, both ratings). Composable from existing HEAD queries.
- Serve Leaflet from `/assets`, as DES `assets.ts` does.

### Design-only
- Page markup, legend, panels and tables, `dispatch-map.js` (copied as is), `map-config.ts`, `geo.ts`, and the `dispatch-*`, `map-pin*` CSS (DES `app.css` ~L2140-2180 and others; `map-pin` 18 hits, `dispatch-panel` 14 hits).

Size: large. Roughly 320 lines of page, 177 of JS, 56 of config and geo, about 200 lines of backend (migration, two profile methods, view, form field, asset routes).

---------------------------------------------------------------------

## 8. Properties `/properties` and `/properties/:id`

Purpose: the Agency's Properties, and one Property's history: open Tickets first, then the facts, Tenants, Nominated Tradies, frequent issues and closed Tickets.

### DES (`DES:src/web/pages/properties.ts`, 212 lines)
- List (`GET /properties`, L19-36): subtitle "N Properties managed by the Agency.", "Add a Property" (primary, sm → `/setup#properties`). `list()` (L77-91) is a `table` with a right-aligned Max Repair Cost and Open Tickets. Headers: Property (link to `/properties/:id`), Property Owner, Max Repair Cost, Tenants (names, or "No Tenants" muted), Open Tickets, Property Manager. Empty: "No Properties yet. Add the first one to start taking reports." with the button.
- Profile (`GET /properties/:id`, L38-72): page action "Back to Properties" (ghost). 404 text "There is no such Property in your Agency.". Body:
  1. `openTickets` (L178-194): section "Open Tickets", stacked table (Issue `ticketCell` with unread, Urgency, Jobs with stage badges, Reported). Caption "most urgent first".
  2. `facts` (L103-126): `section` with `dl.property-facts`. Max Repair Cost as a large `num` figure first. Property Owner as a `contact` block (name, tel, mailto on separate lines, L94-100). Property Manager. Building Manager `contact` when set.
  3. `grid lg:grid-cols-2`: `tenants` (L135-150; table Tenant with "Since 1 Jan 2025", Mobile, Email) and `nominated` (L152-166; Tradie link and trade badges, or "No Nominated Tradie. Tenants arrange Urgent Repairs themselves.").
  4. `frequent` (L168-175): badges such as "Plumbing: 3 Tickets".
  5. `closedTickets` (L197-212): stacked table (Issue, Trades badges, "Closed 2 weeks ago").

### CUR (`CUR:src/web/pages/properties.ts`, 135 lines)
- Only `GET /properties` exists (L19-132). No profile route.
- Subtitle "Each Property has one Property Owner and one Property Manager." Table (L36-61): Address (plain text, no link), Property Manager, Property Owner (business name or name), Max Repair Cost (right), Tenants joined, Nominated Tradies joined or "None". **No Open Tickets column.**
- Below the table is the inline "Add a Property" form (L63-128) and an "Add many from a spreadsheet" disclosure (L123-126).

### Design-only vs needs data
- Design-only: profile markup, `property-facts`/`property-contact` CSS (5 and 1 hits in DES css, 0 in HEAD), list Open Tickets column and address links.
- Needs data: the Open Tickets count is available from `actions.dashboard({filter:'all'}).tickets` (open only), so the list column needs no new query. The profile's open Tickets come from `tickets.openTickets(agencyId, [id])` (exists at HEAD). **Closed Tickets need a query that HEAD lacks** (`tickets.list`, see section 2). Tenant `tenancyStart` is in the schema.
- Size: list small; profile medium (about 210 lines plus a route and `views.property`).

---------------------------------------------------------------------

## 9. Tradies `/tradies` and `/tradies/:id`

Purpose: the Agency's Tradies, best rating first, with both ratings side by side and a profile showing their work history.

### DES (`DES:src/web/pages/tradie.ts`, 208 lines)
Directory (`GET /tradies?trade=`, L22-39):
- Subtitle "Best myEST8 rating first. The two ratings are shown side by side, never combined." Action "Add a Tradie" (primary, sm → `/setup#tradies`).
- `tradeFilter` (L82-90): a GET form with `data-autosubmit` (the list narrows when the Trade changes), a select "Trade" with "All Trades", a Filter button (secondary, for no JavaScript), and "Show all Trades" when filtered.
- `directory()` (L93-113): `table` with caption "Tradies" or "<Trade> Tradies". Columns: Tradie (link, business name, with the person's name muted beneath), Trades (info badges), myEST8 rating (`4.0` "from 3"), Google rating (`4.8` "120 reviews", or "Not on Google" muted), Previous Quotes (count, right). Empty: "No Tradie does <trade>." or "No Tradies yet. Add the Tradies you already use."
- Sorting is by `views.tradies` (`DES:views.ts:302-321`): best myEST8 average, then name.

Profile (`GET /tradies/:id`, L41-72):
- Subtitle = the person's name. Action "Back to Tradies" (ghost).
- `header()` (L116-142): Trade badges; `grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]` of a `dl` (Name, Mobile, Email) and a `statGroup` of two `stat` tiles, "myEST8 rating" (hint: "From N ratings, including the starting rating", or the starting-rating line) and "Google rating" (value, or "Not on Google").
- `bookings()` (L193-207): stacked table, "Ticket" (`ticketCell` with address) | "When" (`timeRange`) | "Property Manager". Empty: "Nothing booked."
- `quotes()` (L172-190): stacked table "Previous Quotes, newest first": Ticket (`ticketCell`) | Trade | Price | Received | Outcome badge (Chosen = success, Not chosen = neutral, Not decided yet = info).
- `ratings()` (L145-163): section "Ratings" with two sub-tables side by side (`md:grid-cols-2`): "From Property Managers" and "From Tenants", each Score ("4 / 5") and Date, or "None yet.".

### CUR (`CUR:src/web/pages/tradie.ts`, 190 lines)
Directory (L21-74): plain `table` (Business, Trades, myEST8 rating `avg (count)`, Google rating text, Mobile). No trade filter, no Previous Quotes column, no sort by rating (`people('tradie')` order, L27) with a per-Tradie `actions.tradie()` call (N+1, L28). The Google place search form and "Add a Tradie" form, plus a spreadsheet import, are on the same page (L55-69), so it doubles as Setup.

Profile (L76-112): `header()` (L114-143) is close to DES. Then two columns: `ratings()` (L145-160, one table with a "From" column mixing Property Manager and Tenant) and `quotes()` (L162-177: Trade, Price, Received, with no Ticket link, property or outcome). Then `bookings()` (L179-190: When, Property, PM, with no Ticket link).

### Data
- `DES:quotes.ts` `previousQuotes` is the same at HEAD (`CUR:quotes.ts:65-73`): it returns `priceCents`, `at`, `jobId`. DES `views.tradie` (L378-408) adds `ticketId`, `propertyAddress`, `description` and `outcome` (`chosen` | `not_chosen` | `waiting`). CUR `views.ts:103-105` does not.
- DES bookings (`views.ts` `tradie`, ~L361-416) need `ticketId` and `description`. HEAD `scheduling.bookings` (`CUR:scheduling.ts:351-363`) returns only start, end, property address and PM.
- `modules.quotes.quoteCount` (DES `quotes.ts`) **does not exist at HEAD**. It drives the Previous Quotes count on the directory.

### Design-only vs needs data
- Design-only: trade filter form and autosubmit, sorted directory, Previous Quotes count, split PM and Tenant rating tables, `ticketCell`s, outcome badges, Back link.
- Needs data: `quoteCount`, `previousQuotes` with Ticket and outcome, bookings with Ticket and description, `tradies` directory view. All plain queries.
- Size: medium.

---------------------------------------------------------------------

## 10. Settings `/settings?tab=`

Purpose: where the Agency's settings are looked at, with the editing done in Setup.

### DES (`DES:src/web/pages/settings.ts`, 133 lines)
- Four `TABS` (L15-21): Agency, Channels, Team, Import, shown with `sideTabs` (ui.ts L735-745) in a `lg:grid-cols-[13rem_minmax(0,1fr)]` layout (L66-68). On phones the tabs become a row that scrolls sideways.
- Agency tab (`agencyTab`, L76-97): section "Agency" with `dl` (Name, Time zone, Property Managers count, "Urgent Repair limit: $1,000, set by NSW law") and a muted note "Quote reminders, approval delays and message wording are not editable yet." Then section "Properties and people": a list with Properties (link to `/properties`, "Add a Property"), Tradies (link, "Add a Tradie"), Tenants ("Add a Tenant" only), and Property Owners and Building Managers ("Add an Owner or Building Manager"). Each add goes to a `/setup#…` anchor.
- Channels tab (`channelsTab`, L99-111): section "Channels", "Manage channels" link. `table` Channel (SMS, WhatsApp, Email), Address, Last test message (time or "Not tested"). Empty: "No channels connected. Connect SMS, WhatsApp or email so Tenants can reach you." with "Connect a channel".
- Team tab (`teamTab`, L113-123): section "Team", "Add a colleague" → `/welcome/team`. `table` Name (with "(you)") and Email (mailto).
- Import tab (`importTab`, L125-133): intro text ("Add many at once from an Excel or CSV file. You review the rows before anything is added.") and a list of four kinds, each with an "Import" button to its `/setup#…` anchor.

### CUR (`CUR:src/web/pages/settings.ts`, 31 lines)
One section, "Your Agency", with two links: Setup ("for channels, Property Owners, Building Managers and Tenants") and "Step-by-step guide". No tabs, no Agency details, no channels, team or import content.

### Design-only vs needs data
- Design-only: the whole tabbed page. Every value it needs is already available: `actions.agency()`, `actions.propertyManagers()`, `actions.channels()` (with `testedAt`, `profiles.ts:58` at HEAD), `actions.people()`.
- `sideTabs`, `dl`, `table`, `section` exist at HEAD. `side-tab` CSS exists in HEAD css.
- Size: small to medium (about 130 lines).

---------------------------------------------------------------------

## 11. Import review `/setup/imports/:token` (under Setup)

Purpose: check a spreadsheet's columns and rows before anything is added.

### DES (`DES:src/web/pages/import.ts`, 398 lines) and CUR (`CUR:src/web/pages/import.ts`, 399 lines)
The two are nearly identical. The diff is 31 lines. Routes, the upload `bodyLimit`, `changesFrom`, and the review markup all match:
- `reviewPage` (DES L193-224; CUR L194-224): subtitle "From <file>" and "N added so far"; action "Back to Setup" link; `p.import-summary` (rows to review, ready, needs a fix, duplicates); `columnsSection` (DES L237-283); `rowsSection` (DES L297-350) with `import-table`, status and notes, `fixControl` (DES L381-397) for flagged cells, and the action row (Add N, Check changes, Discard upload, and the "Plus N ticked rows that need a fix" counter).
- Differences in CUR: `SETUP_HOME` (CUR L28-35) sends Tradies and Properties back to `/tradies` and `/properties` (DES sends everything to `/setup#…`). The back-link label and the active nav follow that (CUR L208). `shellInfo` is awaited.
- Data and routes are unchanged.

### Design-only vs needs data
- None. Only the destination of the back-links differs. This is a product choice, not a gap.

---------------------------------------------------------------------

## Shared pieces

### ui.ts (DES 1076 lines, CUR 991 lines)
Present in both: `page` (controls, subtitle, actions, shell), `card`, `section`, `sectionHeader`, `badge`, `urgencyBadge`, `statusBadge`, `emptyState`, `table`, `field`, `stat`, `statGroup`, `steps`, `chatBubble`, `tabs`, `sideTabs`, `timeline`, `photoGrid`, `dl`, `clip`, `docket`, `countStrip`, `queueRow` (with `decision`), `segmented`, `lane`, `formatMoney`, `formatWhen`, `formatTime`, `formatDay`, `formatAge`, `humanise`.

Design-only in DES `ui.ts`:
- `ticketCell` (L821-846): missing at HEAD.
- `table` `stack` option (L541): HEAD `table` has no `stack`.
- `countStrip` `decision` chip (L899): HEAD has no `decision`.
- `docket` `age` and `decision` (L849-897): HEAD `docket` has neither. HEAD does have `street` and `size: 'large'`.
- `dl` rendered as `.facts` rows (L789-809): HEAD `dl` is a grid with `divide-y`.

### Support modules absent at HEAD
- `src/web/request-checks.ts` (DES 81 lines): see section 4.
- `src/web/bookings.ts` (DES 92 lines): `bookingCard`, `visitNote`, `placeOf`, `bookingsByDay`, `shortDay`, `longDay`, `dayRange`. Also imported by the Dispatch page (section 7).
- `src/geo.ts` (DES 32 lines): see section 7.
- `src/web/map-config.ts` (DES 24 lines) and `src/web/static/dispatch-map.js` (DES 177 lines): see section 7.
- `src/zoned-time.ts`: DES adds `dayOf`, `addDays`, `mondayOf`, `weekdayOf`, `startOfDay`, `daysFrom`, `parseDay` (L73-107). HEAD has `wallClock`, `zonedInstant`, `formatVisit` only. These are pure helpers.

### views.ts (DES 445 lines, CUR 136 lines)
Present in CUR: `dashboard` (CUR L39-72), `navCounts` (L79-88), `tradie` (L91-108), `ticket` (L110-134), with `ticketSummary` and `issueDetails` helpers.
Absent in CUR:
- `stageOf` and `quotingDecision` (DES L30-42), and `board` (L103-150).
- `requests`, `request` (DES L176-184).
- `tickets` with counts (DES L204-225).
- `approvals` (DES L227-248), `propertyOverviews` (L250-265), `property` (L267-300).
- `tradies` directory (L302-321), `dispatch` (L323-360).
- `tradie` extras (`previousQuotes` with Ticket and outcome, bookings with Ticket) and `ticket.propertyId` (see sections 3 and 9).

### app.ts `asPropertyManager`
DES exposes `requests`, `request`, `tickets`, `approvals`, `propertyOverviews`, `property`, `tradieDirectory`, `dispatch`, `geocodeMissing`, `setTradieAddress` (`DES:app.ts` ~L27-38). CUR has none of these. CUR has `dashboard`, `navCounts`, `tradie`, `ticket`, `calendar`, `freeSlots`, `suggestTimes`, `acceptTime`, and the rest.

### Stylesheet
- `DES:src/web/static/app.css` is 3275 lines. `CUR` is 2404 lines.
- Present in both, usable as is: `lane`, `queue-*`, `count-*`, `segmented`, `side-tabs`, `stat-tile*`, `table-frame`, `import-*`, `section-*`, `facts` (DES only).
- Missing from CUR, which the design pages depend on: `dispatch-*`, `map-pin*`, `docket-foot`, `docket-status`, `schedule-*`, `booking-*`, `inbox-item*`, `request-*`, `ticket-head`, `ticket-stub`, `ticket-perf`, `ticket-next*`, `ticket-menu`, `ticket-cell*`, `quote-compare*`, `quote-column`, `quote-*`, `property-*`, `facts-*`, and the Leaflet container rules (DES L2140-2180). `table-frame.is-stacked` (16 hits in DES, 0 in HEAD) is the stacked-table rule.

---------------------------------------------------------------------

## Data and backend gaps (current tree)

Each item is marked where it is used.

1. `tickets.list(agencyId, propertyIds)`, all statuses (absent). Used by the Tickets list, Closed Tickets, Property profile.
2. Board facts per Ticket: `quotes.quotingOf`, `scheduling.visitsOfTickets`, `tickets.jobsOfTickets`, `tickets.issuesWithUnread` (absent). Used by the dashboard board. CUR does N+1 instead.
3. `quotes.waitingOnOwner` (absent). Used by Approvals.
4. `quotes.quoteCount` (absent). Used by the Tradie directory.
5. `previousQuotes` with `ticketId`, `propertyAddress`, `description`, `outcome` (CUR returns `priceCents`, `at`, `jobId` only). Used by Tradie profile.
6. `scheduling.bookings` with `ticketId` and `description` (CUR returns start, end, address, PM only). Used by Tradie profile.
7. `scheduling` `toView` with `trade`, `issue`, `suburb`, `visit`, `propertyId`, `propertyManagerId` (absent). Used by Schedule.
8. `views.ticket` `propertyId` (absent). Used by Ticket header link.
9. Tradie business address and `lat`/`lng` (absent from schema and `profiles`). Used by Dispatch.
10. `profiles.geocodeMissing`, `profiles.setTradieAddress` (absent). Used by Dispatch. `ports.places.geocode` exists.
11. Leaflet served from `/assets` (absent). Used by Dispatch.
12. `request-checks.ts` (absent). Used by dashboard and Requests.
13. `views.dispatch`, `views.property`, `views.propertyOverviews`, `views.tradies`, `views.approvals`, `views.requests` (absent as views; partly derivable from existing queries).

Items 1–3 and 9–10 are real missing queries or schema. The rest are mapping changes or pure modules.

---------------------------------------------------------------------

## Summary table

Size: S = under about 100 lines of change, M = 100–300, L = over 300 including backend. These are rough estimates for markup plus the listed data work.

| Page | Design-only (pure markup or CSS) | Needs backend or data not in the working tree | Rough size |
|---|---|---|---|
| Dashboard `/` | Desk grid, decisions/alerts/inbox markup, lanes, decision chips, 56px thumbs | Board facts (`board` and four queries), `request-checks.ts`, urgency sort decision | M |
| Tickets `/tickets` | Tabs, urgency strip, stacked table, `ticketCell` | `tickets.list` (all statuses), per-Ticket counts without N+1 | S–M |
| Ticket `/tickets/:id` | Docket header, Next step strip and text, urgency menu, comparison table, Quote ratings, photos folded into report | `propertyId` on `views.ticket` | M–L |
| Requests `/requests`, `/requests/:id` | Review two-column layout and CSS, disclosures, urgency sort, count strip, list titled by address | `request-checks.ts` port (pure) | S–M |
| Approvals `/approvals` | Owner and receipt tables, count strip, Reminder badges | `quotes.waitingOnOwner` (new query), 48-hour silent flag, `repairCost` (exists) | M |
| Schedule `/calendar` (DES) / `/dispatch` (CUR) | Week folding, Mine/All and hidden note, booking cards, reschedule links, day widths | `Booking` fields (`trade`, `issue`, `suburb`, `visit`, `propertyId`, `propertyManagerId`) | S–M |
| Dispatch `/dispatch` (DES only) | Page, panels, tables, legend, `dispatch-map.js`, `map-config`, `geo.ts`, CSS | Tradie address and `lat`/`lng` (migration and form), `geocodeMissing`, `setTradieAddress`, `views.dispatch`, Leaflet assets | L |
| Properties `/properties`, `/properties/:id` | List Open Tickets column and links, profile markup, `property-*` CSS | `views.property` composition; closed Tickets (`tickets.list`) | M |
| Tradies `/tradies`, `/tradies/:id` | Trade filter form with autosubmit, sort, Previous Quotes count, split ratings, ticket links, outcome badges | `quotes.quoteCount`, `previousQuotes` fields, `scheduling.bookings` fields, `views.tradies` | M |
| Settings `/settings` | Whole four-tab page | None (agency, PMs, channels with `testedAt`, people all exist) | S–M |
| Import review `/setup/imports/:token` | Back-link destinations (product choice) | None | S (or 0) |

Shared: `ticketCell`, `table` stack, `countStrip` decision, `docket` age and decision (ui.ts), `zoned-time` helpers, `bookings.ts`, `request-checks.ts`, and the CSS blocks listed above. Port these first, because most pages depend on them.

---------------------------------------------------------------------

## Notes on the issue files

`.scratch/web-app-improvements/issues/*.md` describe the code before the design and say what each page should do. The design commit implements several of their criteria:
- 03 (urgency sort): implemented on DES `/requests` (`requests.ts:85`), not on the DES dashboard.
- 01 (comparison table): implemented (`ticket.ts:789-847`, `quote-compare*`).
- 11 (header leads with next action): implemented (`ticket.ts:381-399`, `ticket-next`). Repair Cost only when above zero (`ticket.ts:354`).
- 15 (Dispatch): panels name Tickets by issue and show both ratings side by side (`dispatch.ts:149, 180-192`). Geocoding moved to a button (`dispatch.ts:72`). No Mine/All on the map (not implemented).
- 16 (decision rows): 56px thumbs on the dashboard (`dashboard.ts:293`). Flags wrap rather than collapsing (queueRow badges).
- 17 (property profile): implemented, with open Tickets first and the Max Repair Cost headline (`properties.ts:65-69`, `103-109`).
- 18 (Tradie profile): PM and Tenant ratings split, Ticket links and outcomes (`tradie.ts:145-190`). Needs the data gaps above.
- 21 (stacked tables): implemented (`ui.ts:541`, `table-frame.is-stacked`). HEAD `table` lacks it.

The design does not implement: 09 (Tradie rows on the Schedule with free time), 14 (dashboard repetition), 19 (Settings editable in place), 27 (Mine/All on every list page), and the Dispatch Mine/All filter (15).

Git facts: `ac2f5ea` is an ancestor of HEAD. HEAD removed `src/web/pages/dispatch.ts`, `src/web/bookings.ts`, `src/web/map-config.ts`, `src/web/static/dispatch-map.js`, `src/geo.ts`, `src/web/request-checks.ts`, and renamed `tickets.ts` to `ticket-list.ts`.
