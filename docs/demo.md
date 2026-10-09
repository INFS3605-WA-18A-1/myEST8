# Running the demo

`npm run demo` starts the whole app on your machine with:

- **Dummy external APIs.** The classifier (Jev), the photo matcher, the quote reader and Google Places/Geocoding are answered by an in-process mock (`src/demo/mock-apis.ts`). Nothing leaves your machine unless you set the env vars below.
- **A simulated messenger.** No SMS, WhatsApp or email is really sent. Every outbound message is kept in memory and shown in the phone simulator.
- **A movable clock.** The demo clock runs in real time, and the simulator can move it forward to show reminders and deadlines without waiting.
- **Seed data.** The Agency "Harbour Realty" with its Property Managers, Properties, Owners, Tenants and Tradies.
- **Work already in flight.** Ten days of maintenance stories are played before the demo opens, so every screen has something on it. See [What's already in the demo](#whats-already-in-the-demo).

Everything lives in an in-memory database. **Stopping the demo throws all data away**; the next start is a fresh copy of the seed and stories.

## Start it

```sh
npm install
npm run demo                  # http://localhost:3000
PORT=4000 npm run demo        # another port
DEMO_DATA=empty npm run demo  # just the Agency, with nothing in flight
```

Start-up takes a few seconds while the stories play; the banner says what they left.

Open <http://localhost:3000>, sign in, and open the phone simulator at <http://localhost:3000/demo>. The background worker runs every 2 seconds, and straight away after every simulator action. Each message myEST8 sends is also printed to the terminal. Ctrl+C stops it.

## Sign in

| Property Manager | Email                   | Password   |
| ---------------- | ----------------------- | ---------- |
| Alice Archer     | `alice@harbour.example` | `demo1234` |
| Bob Baker        | `bob@harbour.example`   | `demo1234` |

Sessions follow the real clock, so moving the demo clock forward doesn't sign you out.

## What's in the seed

The Agency's channels: SMS and WhatsApp on `+61290000000`, email at `inbox@harbour.example`.

| Property                            | Property Manager | Property Owner           | Max Repair Cost | Tenants                                               | Notes                                              |
| ----------------------------------- | ---------------- | ------------------------ | --------------- | ----------------------------------------------------- | -------------------------------------------------- |
| 12 King St, Newtown NSW 2042        | Alice            | Olivia Owens             | $500            | Tom Tran `+61400000001`, Hana Ho `+61400000002`       | Nominated Tradies: Nina (plumbing), Sam (electrical) |
| 5/40 Ocean Ave, Bondi NSW 2026      | Bob              | Oscar Ortiz (mobile only) | $800            | Bella Bui `bella@example.com` (email only)            | Strata; Building Manager Barry Strata `barry@strata.example` |
| 7 Wilson St, Newtown NSW 2042       | Alice            | Olivia Owens             | $600            | Wei Zhang `+61400000003`                              |                                                    |
| 21 Glebe Point Rd, Glebe NSW 2037   | Bob              | Oscar Ortiz              | $400            | Priya Patel `+61400000004`, `priya@example.com`       |                                                    |
| 2/31 Australia St, Camperdown NSW 2050 | Alice         | Grace Green              | $500            | Liam Lee `+61400000005`                               | Strata unit, no Building Manager on file; Nominated Tradie: Sam |
| 9 Albion St, Annandale NSW 2038     | Alice            | Grace Green              | $700            | Maya Morris `+61400000006`, `maya@example.com`        | Nominated Tradies: Dana, Erin                      |
| 27 Llewellyn St, Marrickville NSW 2204 | Alice         | Henry Hill               | $400            | Noah Nair `+61400000007`, Kai Kelly `+61400000008`    | Nominated Tradies: Dana, Lucy                      |
| 17 Glenmore Rd, Paddington NSW 2021 | Bob              | Isla Irwin               | $600            | Ruby Russo `+61400000009` (moved in 17 Aug 2026; uses WhatsApp) | Nominated Tradie: Finn                  |
| 42 Coogee Bay Rd, Coogee NSW 2034   | Bob              | Isla Irwin               | $800            | Ethan Evans `+61400000010`, Sofia Silva `+61400000011` | Nominated Tradies: Finn, Erin                     |
| 3/15 Bronte Rd, Bondi Junction NSW 2022 | Bob          | Jack Jones (mobile only) | $500            | Omar Odeh `+61400000012`                              | Strata unit, no Building Manager on file           |

Property Owners: Olivia Owens `+61400000100` / `olivia@example.com`; Oscar Ortiz `+61400000101`; Grace Green `+61400000102` / `grace@example.com`; Henry Hill `+61400000103` / `henry@example.com`; Isla Irwin `+61400000104` / `isla@example.com`; Jack Jones `+61400000105`.

| Tradie       | Business               | Contact                       | Trades                       | Starting rating | Google        |
| ------------ | ---------------------- | ----------------------------- | ---------------------------- | --------------- | ------------- |
| Pete Park    | Pete's Plumbing        | `+61400000200`                | plumbing                     | 4               | 4.8 (120)     |
| Quinn Quick  | Quick Pipes            | `quotes@quickpipes.example`   | plumbing                     | 4               | 4.2 (40)      |
| Dana Drip    | Drip Doctors           | `+61400000202`                | plumbing                     | 5               | not on Google |
| Finn Flow    | Flow Bros Plumbing     | `+61400000203`                | plumbing                     | 3               | 4.9 (15)      |
| Nina Nguyen  | Nina's Plumbing        | `+61400000204`                | plumbing                     | 4               | 4.2 (33)      |
| Sam Spark    | Sparky Sam Electrical  | `+61400000205`                | electrical                   | 4               | 4.5 (60)      |
| Carl Cutter  | FixIt Carpentry        | `+61400000206`                | carpentry, general handyman  | 4               | 4.6 (48)      |
| Ally Appleby | Cool Appliance Repairs | `ally@coolappliances.example` | appliances                   | 4               | 4.3 (72)      |
| Lucy Lock    | Lucy's Locksmiths      | `+61400000208`                | locksmith                    | 5               | not on Google |
| Erin Ellis   | Ellis Electrical       | `+61400000209`                | electrical                   | 4               | 4.7 (89)      |
| Rhys Ridge   | Ridgeline Roofing      | `+61400000210`                | roofing                      | 4               | 4.4 (27)      |
| Tess Tiler   | Topside Roofing        | `+61400000211`                | roofing                      | 3               | not on Google |
| Arlo Ashby   | Appliance Rescue       | `jobs@appliancerescue.example` | appliances                  | 3               | 3.9 (210)     |
| Harry Hughes | Handy Harry's          | `+61400000213`                | general handyman, carpentry  | 4               | 4.8 (64)      |
| Bea Banks    | Bugs Away Pest Control | `+61400000214`                | pest control                 | 4               | 4.1 (132)     |
| Kev Keyes    | Keystone Locksmiths    | `+61400000215`                | locksmith                    | 3               | not on Google |
| Mo Mansour   | Pest Patrol            | `+61400000216`                | pest control                 | 4               | not on Google |

The starting ratings are before the stories: the closed Tickets below add Tenant and Property Manager ratings on top.

## What's already in the demo

`npm run demo` plays these stories before it opens (`src/demo/stories.ts`). They go through the app's real inputs: Tenants, Tradies and Owners message in through the phone simulator, photos and receipts go up through the upload links, Alice and Bob use their own actions, and the clock runs from ten days ago to now, so the 48-hour reminders, 72-hour prompts and owner alerts have really fired. The clock reads the real time when the demo opens. Everything is in each person's simulator thread and on each Ticket's timeline.

**Tom Tran and 12 King St are left with nothing open**, and Pete, Finn and Nina have no Quote Requests waiting, so the script below plays exactly as written.

Waiting as Maintenance Requests:

| Who, where                         | PM    | What                                    | Why it's interesting                                    |
| ---------------------------------- | ----- | --------------------------------------- | ------------------------------------------------------- |
| Wei Zhang, 7 Wilson St             | Alice | Bathroom basin draining slowly          | Two clean photos: taken just now, at the Property       |
| Noah Nair, 27 Llewellyn St         | Alice | Loose fence palings                     | Never sent photos: went ahead after 48 hours, "no photos" |
| Ruby Russo, 17 Glenmore Rd         | Bob   | Mouldy window frame (by WhatsApp)       | Both photos flagged: one predates her tenancy, one was taken in Penrith |
| Sofia Silva, 42 Coogee Bay Rd      | Bob   | Power point buzzing and warm            | Urgency flagged "check urgency"; a screenshot with no metadata |

Open Tickets:

| Who, where                         | PM    | What                                    | Where it's up to                                        |
| ---------------------------------- | ----- | --------------------------------------- | ------------------------------------------------------- |
| Maya Morris, 9 Albion St           | Alice | Oven not heating                        | Quotes in from Ally and Arlo, not yet confirmed         |
| Ethan Evans, 42 Coogee Bay Rd      | Bob   | Roof leaking (High)                     | One confirmed Quote (Rhys) after 72 hours: **invite more Tradies** alert; Tess was reminded; Ethan's "any update?" is unread |
| Priya Patel, 21 Glebe Point Rd     | Bob   | Hot water system leaking (High)         | Dana's $980 is over the $400 limit; Oscar was asked 3+ days ago, reminded at 24 hours: **owner no reply** alert |
| Liam Lee, 2/31 Australia St        | Alice | Light switch broken                     | Erin's Quote approved; waiting for a Work Order          |
| Wei Zhang, 7 Wilson St             | Alice | Toilet cistern running                  | Finn booked for the next weekday 9am, visit confirmed; Wei's note for the plumber is unread |
| Kai Kelly, 27 Llewellyn St         | Alice | Cupboard under the sink, pipe leaking (High) | **Two Jobs**: plumbing booked with Dana three weekdays out; carpentry has Carl's and Harry's confirmed Quotes to choose from |
| Omar Odeh, 3/15 Bronte Rd          | Bob   | Front door lock stiff                   | Lucy booked two weekdays out; Omar asked for another day (reschedule request, unread) |
| Bella Bui, 5/40 Ocean Ave          | Bob   | Dishwasher not draining (by email)      | Ally booked six weekdays out, visit confirmed               |
| Maya Morris, 9 Albion St           | Alice | Bathroom door handle came off           | Carl finished; Maya rated 4; **rating due** alert for Alice |

Closed, with both ratings (so Tradie profiles have ratings and previous Quotes, recommendations differ, and Properties have frequent issues): Hana's blocked shower (Pete) and hallway light (Sam) at King St, Wei's leaking kitchen tap at Wilson St (Nina, rated 3), Priya's blocked toilet at Glebe Point Rd (Finn), Bella's oven door at Ocean Ave (Ally).

Urgent Repairs: Noah's burst pipe at Llewellyn St, receipt uploaded and forwarded to Henry; Omar's hot water at Bronte Rd, waiting for a receipt.

The inbox: a text from an unknown number (Ruby's new flatmate), Priya asking about rent (not maintenance), Maya's "any update?" (two Tickets open, so a low-confidence best guess), and Liam's broken intercom (a Common Area with no Building Manager on file). Bella's foyer light went to Barry, the Building Manager, so it's in Barry's thread in the simulator, not the inbox.

The calendar has the visits done in the last few days and the ones booked over the next two weeks, for both Property Managers and four Tradies.

## A 10-minute demo script

Keep two browser tabs open: the Property Manager's dashboard (signed in as Alice) and the phone simulator at `/demo`. In the simulator you pick who you are, the channel, type the message and send it; the outbox shows what each person received.

The mock classifier and quote reader read messages by keywords, much as the real models would. If one misreads a quote, correct the price or time on the Ticket page when you confirm the Quote. That is the same review step a Property Manager does with real replies.

### 1. A Tenant reports a dripping tap (about 3 minutes)

1. **Simulator, as Tom Tran (SMS):** "The kitchen tap is dripping". Tom gets an acknowledgement and the first question.
2. **As Tom,** answer each question as it arrives: "Kitchen sink", "Since Monday", "No" (not getting worse), "1" (weekday mornings). Tom then gets a no-login link to upload photos.
3. **Open the upload link** from Tom's thread and upload one or two photos. The photo checks read each photo's metadata: a photo taken more than 14 days before the report, before the tenancy began, or more than 1 km from the Property is flagged for the Property Manager. A phone photo with location taken anywhere but Newtown will be flagged, which shows the check working. A photo with no metadata (a screenshot, say) isn't held against the Tenant.
4. **Dashboard, as Alice:** the Maintenance Request appears with the photos and any flags. Confirm it. Tom gets a link to his progress tracker. Open it: it shows where the Ticket is up to, never prices or Tradies.

### 2. Quotes, approval and the Work Order (about 4 minutes)

1. **On the Ticket's plumbing Job,** send Quote Requests to Pete's Plumbing, Flow Bros Plumbing and Nina's Plumbing.
2. **Time travel +48h** in the simulator. Nobody has replied yet, so all three Tradies get a reminder to quote.
3. **Simulator, as each Tradie,** reply to the Quote Request:
   - Pete Park (SMS): "$650, Tue 9am"
   - Finn Flow (SMS): "$380 Wednesday 10am"
   - Nina Nguyen (SMS): "No thanks, too busy"
4. **On the Ticket page,** the two Quotes are waiting to be checked. Confirm each one (fix any misread price or time). Then **choose Pete's**. $650 is over King St's $500 Max Repair Cost, so Olivia, the Property Owner, gets an approval request.
5. **Simulator, as Olivia Owens (SMS):** "YES". The Quote is approved; Finn is told he wasn't chosen.
6. **Send the Work Order** to Pete; the start is filled in from his Quote. Pete gets the Work Order, Tom gets the visit time, and Olivia is told it's booked.
7. **As Tom:** "Yes that works" to confirm the visit. It shows on the calendar.

### 3. Done, ratings and closing (about 1 minute)

1. **As Pete:** "All done, washer replaced". Tom is asked whether it was fixed properly.
2. **As Tom:** "5". On the Ticket, Alice rates Pete as well.
3. **Close the Ticket.** Tom and Olivia are told the repair is complete.

### 4. An Urgent Repair (about 1 minute)

1. **As Tom (SMS):** "There is a gas smell in the kitchen". This is Urgent, so it never becomes a Ticket: Tom is told to arrange the repair now, with King St's Nominated Tradies (Nina, Sam), and can claim up to $1,000 back. He gets a link for the receipt.
2. **Open the receipt link** and upload a photo or PDF of a receipt. It is forwarded to Olivia, and the Urgent Repair shows on Alice's dashboard.

### 5. A Common Area issue (about 1 minute)

1. **As Bella Bui (email):** "The lift is broken again". Ocean Ave is a strata building, so this goes to Barry Strata, the Building Manager, and Bella is told it's been passed on. No Ticket is created: Common Areas are the strata's to repair, not the Agency's.

`test/demo/e2e.test.ts` runs this script, with these exact messages, on every test run. `test/demo/stories.test.ts` checks the stories leave every dashboard section filled, Tom free, and step 1 working.

## Using real APIs

Each external API can be pointed at a real endpoint with env vars. Anything not set stays mocked; the start-up banner says which are real.

| Env vars                              | API                                                   |
| ------------------------------------- | ----------------------------------------------------- |
| `JEV_API_URL`, `JEV_API_KEY`          | The classifier (Jev)                                  |
| `VISION_API_URL`, `VISION_API_KEY`    | The photo matcher                                     |
| `QUOTES_API_URL`, `QUOTES_API_KEY`    | The quote reader                                      |
| `GOOGLE_MAPS_API_KEY`                 | Google Places (New) and the Geocoding API             |
| `PORT`                                | The port to listen on (default 3000)                  |
| `PUBLIC_URL`                          | The address used in upload and tracker links (default `http://localhost:$PORT`) |

```sh
JEV_API_URL=https://jev.example/api JEV_API_KEY=... npm run demo
```

The stories are skipped when the classifier or quote reader is real: they rely on the mock reading each message the same way every time. With a real Google key, the seeded Tradies are added as not on Google, because their demo listings only exist in the mock. Messages are always simulated: the demo never sends real SMS, WhatsApp or email.

To open upload and tracker links on a real phone, set `PUBLIC_URL` to an address the phone can reach, such as your machine's LAN address (`PUBLIC_URL=http://192.168.1.20:3000`) or a tunnel.
