# Screenshot review and work plan (14 Oct 2026)

105 Playwright screenshots of the demo, at laptop (1366×768) and phone (390×844) sizes:
- signed out: landing, sign in, sign in error, sign up
- every PM page and its filters, found by crawling the rail
- six Tenant upload and tracker links, plus bad links
- the phone simulator: send as a Tenant, then see the Request
- the collapsed rail and the phone drawer

Script: `.screenshots/crawl.ts`. Output: `.screenshots/audit/` (git-ignored).

## What the screenshots show

### Where a PM decides

| Page | Problem | Seen in |
|---|---|---|
| Request review | Label/value rows put the value about 360 px from its label, so the eye has to cross the screen. | 019, 020 |
| Request review | **Decide** is the last card, below Photos and Checks. Its three controls (Confirm, Reason+Reject, Urgency+Change Urgency) sit side by side as equals. | 019, 020 |
| Request review | Checks says "Nothing to check." directly above a "Photos match the description" flag. | 020 |
| Ticket header | The largest number on the page is **$0.00** Repair Cost while quoting. | 018 |
| Ticket header | An Urgency `<select>`+Save form takes the header's prime spot. | 018 |
| Ticket header | Nothing says what the PM should do next. | 018 |
| Ticket quotes | Quotes are uneven cards, each holding its own edit form ("Needs checking", Price, Proposed time, Confirm Quote). They can't be compared at a glance. | 018 |
| Ticket messages | Messages are one long column of about 30 bubbles, with full `http://localhost…` tracker and upload URLs. | 017, 018 |
| Ticket timeline | The timeline repeats each Quote Request and Quote line by line. | 017, 018 |
| Dashboard | The board says "2 of 2 Quotes in" for #12. Neither Quote is confirmed, so the PM actually has 2 Quotes to check. | 006, 018 |
| Dashboard (phone) | "Needs your decision" starts about 1,500 px down, below all five stage lanes. On a phone, the decision is the job. | 059 |
| Dashboard | Below the fold, Inbox (with full "Best guess" tables) and "All open Tickets" repeat what is above. The page is 3,300 px on a laptop and 5,200 px on a phone. | 006, 059 |
| Dashboard | Decision rows still cut the street ("27 Llewell… M.") because Confirm and Review share the row. | 006 |

### Finding and scheduling

| Page | Problem | Seen in |
|---|---|---|
| Schedule | There are seven equal columns even when five are empty. | 011 |
| Schedule | Cards cut off the Tradie and the street ("Sparky Sam Ele…", "12 King St, Newt…"). | 011 |
| Schedule | Cards never say what the visit is for. | 011 |
| Schedule | There is no Mine/All filter. | 011 |
| Dispatch | The Tradie schedule is 17 rows of "–" with three bookings in them. | 007 |
| Dispatch | The Properties table names Tickets "Ticket 6", not by the issue. | 007 |
| Tickets list | The Ticket number is the first column and the issue sits in the middle, against the docket rule (issue, then address, then status). | 009 |
| Tickets list | "1 unread" stacks under the number. | 009 |
| Requests list | The address is bold and the description quiet, which reverses the dashboard docket. | 008 |

### Profiles and settings

| Page | Problem | Seen in |
|---|---|---|
| Property | Open Tickets is the last card. | 034 |
| Property | Max Repair Cost is just a table row. | 034 |
| Property | There is no history of closed Tickets. | 034 |
| Property | The Owner's contacts run together on one line. | 034 |
| Tradie | There is no back link. | 022 |
| Tradie | Previous Quotes don't say which Property or Ticket they were for. | 022 |
| Tradie | Upcoming bookings don't link to the Ticket. | 022 |
| Settings | Agency is read-only, with a note sending the PM to the long Setup page. | 014, 033 |

### Outsiders: Tenants (and Tradies and Owners through messages)

| Page | Problem | Seen in |
|---|---|---|
| Upload | `/u/<any text>` shows the upload form, so a bad or expired link looks like it works. | 046, 099 |
| Upload | The page never names the Agency or the Property. | 093 |
| Upload | Choosing files gives no "3 photos selected" feedback. | 093 |
| Tracker | It doesn't name the Agency or the address. | 094 |
| Tracker | "Now: Booked" repeats the current step. | 094 |
| Tracker | "Approved" reads as an owner approval. | 094 |
| Tracker | "Done" then "Closed" is redundant. | 094 |
| Tracker | The visit doesn't name the Tradie. | 094 |
| Phone simulator | The thread shows about 3 lines. The composer (channel, file input, 7 quick-reply buttons, textarea) fills the phone frame, so you can't read the conversation you are simulating. | 050, 092 |

## Architecture (improve-codebase-architecture)

These are the candidates from an architecture walk of `src/web` and the core. They use the codebase-design vocabulary.

1. **Dashboard board read model (Strong).**
   - `boardOf` builds a full Ticket view, including `recommend()`, for every open Ticket, then throws most of it away.
   - The stage, quoting and "Ready to choose" rules live in the page. The page hard-codes 2 instead of using `MIN_QUOTES`.
   - Fix: a deep `views.dashboard` that does the work in batched queries.
   - Goes to Task 3.
2. **One Maintenance Request query, plus one flags concept (Strong).**
   - `/requests/:id` loads the whole dashboard to show one request.
   - The flag list is built three times and the copies disagree: requests.ts misses flagged photos.
   - Goes to Task 1, with `src/web/request-checks.ts`.
3. **Bookings and calendar days (Strong).**
   - Bookings lack their Trade, so calendar.ts loads Tickets one by one (N+1).
   - The day arithmetic is copied in calendar.ts, dispatch.ts and dashboard.ts.
   - Dispatch geocodes on every GET.
   - Goes to Task 4.
4. **Property onboarding as one core command (Strong).**
   - welcome.ts does four separate writes with its own validation, so it isn't atomic.
   - imports.ts duplicates the duplicate check.
   - `ROLE_LABEL` is copied four times.
   - Goes to Task 7.
5. **Ticket actions return their outcome (Worth exploring).** Today `onPost` re-reads the full Ticket view to word the flash message. Not this round.
6. **Split ui.ts by concept (Worth exploring).** Into shell, domain vocabulary, and rows/tables. Not this round: it would conflict with every parallel task.
7. **Channel forms are written twice, in welcome and setup (Speculative).** Not this round.

Bugs found:
- `/u/:token` doesn't validate the token. Task 5.
- "Nothing to check." shows above a flag. Task 1.
- The dashboard shows "Approved" where the Job is "Ready to book". Task 3.
- Reject from the review page lands on `/`. Tasks 1 and 3.
- Dispatch geocodes on each load. Task 4.
- Adding a Property during onboarding isn't atomic. Task 7.

## Tasks

Agents run in parallel on the same working tree. Each owns its files. `src/web/static/app.css` and `src/web/ui.ts` are shared: add page-scoped blocks only, and re-read before each edit.

1. **Request review and Requests list.** Owns `src/web/pages/requests.ts` and `test/web/requests*.test.ts`.
2. **Ticket page.** Owns `src/web/pages/ticket.ts` and `test/web/ticket*.test.ts`.
3. **Dashboard and the board read model.** Owns:
   - `src/web/pages/dashboard.ts`
   - `src/views.ts` (the board query)
   - `test/web/dashboard.test.ts`
   - core tests for the new view
4. **Schedule and Dispatch.** Owns:
   - `src/web/pages/calendar.ts`
   - `src/web/pages/dispatch.ts`
   - one new shared module for the week's bookings
   - their tests
5. **Tenant pages and the phone simulator.** Owns:
   - `src/web/tenant-pages.ts`
   - `src/demo/simulator-pages.ts`
   - `tracker()` in `src/tickets.ts`
   - `test/web/tenant*.test.ts`, `test/web/simulator.test.ts`
6. **Lists, profiles and shared components.** Owns:
   - `src/web/ui.ts` (`facts`)
   - `src/web/pages/tickets.ts`, `properties.ts`, `tradie.ts`, `settings.ts`
   - `test/web/ui.test.ts` and those pages' tests

7. **Property onboarding command.** Owns:
   - `welcome.ts`, `setup.ts`, `onboarding-forms.ts`
   - `src/onboarding.ts`, imports
   - their tests

Out of this round: landing copy, sign-up and onboarding (issues 22, 25), and the Channel guide (issue 10).

## Result (14 Oct 2026)

All seven tasks landed.
- `npm run check` is green:
  - typecheck
  - 628 unit tests
  - 9 Playwright end-to-end tests
- After screenshots are in `.screenshots/after/`, from the same crawl. Each agent's own shots are in `.screenshots/<task>/`.
- New core seams:
  - `views.dashboard` board facts and `views.request`
  - `tickets.uploadLink`
  - `onboarding.addPropertyWithPeople` (atomic)
  - bookings carry Trade, issue and status
  - day helpers live in `zoned-time.ts`
- New shared web modules:
  - `request-checks.ts`
  - `bookings.ts`
- Still open:
  - Candidates 5–7 above.
  - The Urgent Repairs table squeezes on phones.
  - Dispatch's tables scroll inside their frame on phones.
  - The landing page, sign-up and the Channel guide.
