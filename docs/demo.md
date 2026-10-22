# Running the demo

`npm run demo` starts the whole app on your machine with:

- **Dummy external APIs.** The classifier (Jev), the photo matcher, the quote reader, Google Places and Nominatim's geocoding are answered by an in-process mock (`src/demo/mock-apis.ts`). Nothing leaves your machine unless you set the env vars below.
- **A simulated messenger.** No SMS or email is really sent (unless you set up Twilio and SendGrid: see [Sending real messages](#sending-real-messages)). Every outbound message is kept in the demo's database and shown in the phone simulator.
- **A movable clock.** The demo clock runs in real time, and the simulator can move it forward to show reminders and deadlines without waiting.
- **Seed data.** The Agency "Harbour Realty" with its Property Managers, Properties, Owners, Tenants and Tradies.
- **Work already in flight.** Ten days of maintenance stories are played before the demo opens, so every screen has something on it. See [What's already in the demo](#whats-already-in-the-demo).

The data lives in Postgres: a local one in Docker that `npm run demo` starts for you (see [The database](#the-database)). `npm run demo` keeps everything in a fresh throwaway schema. **Stopping it throws all data away**; the next start is a fresh copy of the seed and stories. To keep your data between restarts, use `npm run dev` or set `DATABASE_SCHEMA` (see [Keep your data](#keep-your-data)).

## Start it

```sh
npm install
npm run demo                  # http://localhost:3000 (starts Postgres in Docker first, if it isn't running)
PORT=4000 npm run demo        # another port
DEMO_DATA=empty npm run demo  # just the Agency, with nothing in flight
```

Start-up takes a few seconds while the stories play; the banner says what they left.

### Keep your data

```sh
npm run dev                             # data in the schema "dev", restarts when you edit the code
npm run dev:reset                       # empty the local database (same as npm run db:reset) to start afresh
DATABASE_SCHEMA=mine npm run demo       # any schema name you like
```

With `DATABASE_SCHEMA` set, the demo keeps its data in that Postgres schema (created and migrated on first use) instead of a throwaway one:

- **First start, empty schema:** seeds Harbour Realty and plays the stories (unless `DEMO_DATA=empty`), as `npm run demo` does.
- **Every start after:** carries on from what is in the schema. Nothing is seeded again and **the stories are never replayed**: they are played against a clock set ten days back, which can't be done on top of later data. The banner says so. `npm run db:reset` gets them again.
- **Kept across restarts:** everything in the app (Agencies, people, Tickets, sessions, so you stay signed in), the phone simulator's history, and how far the demo clock has been moved forward.
- **Refused:** a schema with data the demo didn't finish seeding (a start-up stopped part-way). Run `npm run db:reset`, or set `DATABASE_SCHEMA` to another name.

Tests never touch this database: they make their own throwaway databases (see [testing.md](testing.md)).

### The database

The demo runs on Postgres, as production does on Supabase. Locally that's a `postgres:17` container in Docker:

```sh
npm run db:start     # start it (created the first time, on port 54340; data kept in the myest8-pgdata volume)
npm run db:stop      # stop it; the data stays
npm run db:migrate   # apply supabase/migrations to the dev schema (the demo does this itself on start)
npm run db:reset     # empty the local database: npm run dev's data and anything a killed demo left behind
```

The connection string is `SUPABASE_DB_URL`, defaulting to the local one, `postgres://postgres:postgres@127.0.0.1:54340/myest8`. Point it at any other Postgres on your machine (for example `npx supabase start`, port 54322) to use that instead. The demo applies the migrations itself, so it only runs on a Postgres on this machine; it refuses a hosted one.

Open <http://localhost:3000>, sign in, and open the phone simulator at <http://localhost:3000/demo>. The background worker runs every 2 seconds, and straight away after every simulator action. Each message myEST8 sends is also printed to the terminal. Ctrl+C stops it.

## Sign in

| Property Manager | Email                   | Password   |
| ---------------- | ----------------------- | ---------- |
| Alice Archer     | `alice@harbour.example` | `demo1234` |
| Bob Baker        | `bob@harbour.example`   | `demo1234` |

Sessions follow the real clock, so moving the demo clock forward doesn't sign you out.

## What's in the seed

The Agency's channels: SMS on `+61290000000`, email at `inbox@harbour.example`.

| Property                            | Property Manager | Property Owner           | Max Repair Cost | Tenants                                               | Notes                                              |
| ----------------------------------- | ---------------- | ------------------------ | --------------- | ----------------------------------------------------- | -------------------------------------------------- |
| 12 King St, Newtown NSW 2042        | Alice            | Olivia Owens             | $500            | Tom Tran `+61400000001`, Hana Ho `+61400000002`       | Nominated Tradies: Nina (plumbing), Sam (electrical) |
| 5/40 Ocean Ave, Bondi NSW 2026      | Bob              | Oscar Ortiz (mobile only) | $800            | Bella Bui `bella@example.com` (email only)            | Strata; Building Manager Barry Strata `barry@strata.example` |
| 7 Wilson St, Newtown NSW 2042       | Alice            | Olivia Owens             | $600            | Wei Zhang `+61400000003`                              |                                                    |
| 21 Glebe Point Rd, Glebe NSW 2037   | Bob              | Oscar Ortiz              | $400            | Priya Patel `+61400000004`, `priya@example.com`       |                                                    |
| 2/31 Australia St, Camperdown NSW 2050 | Alice         | Grace Green              | $500            | Liam Lee `+61400000005`                               | Strata unit, no Building Manager on file; Nominated Tradie: Sam |
| 9 Albion St, Annandale NSW 2038     | Alice            | Grace Green              | $700            | Maya Morris `+61400000006`, `maya@example.com`        | Nominated Tradies: Dana, Erin                      |
| 27 Llewellyn St, Marrickville NSW 2204 | Alice         | Henry Hill               | $400            | Noah Nair `+61400000007`, Kai Kelly `+61400000008`    | Nominated Tradies: Dana, Lucy                      |
| 17 Glenmore Rd, Paddington NSW 2021 | Bob              | Isla Irwin               | $600            | Ruby Russo `+61400000009` (moved in 17 Aug 2026) | Nominated Tradie: Finn                  |
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
| Ruby Russo, 17 Glenmore Rd         | Bob   | Mouldy window frame (by SMS)       | Both photos flagged: one predates her tenancy, one was taken in Penrith |
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

Urgent Repairs, each with its Reimbursement Request: Noah's burst pipe at Llewellyn St, receipt uploaded with $380 claimed and forwarded by Alice to Henry; Omar's hot water at Bronte Rd, waiting for a receipt.

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

1. **As Pete:** "All done, washer replaced". The visit hasn't started yet, so nothing changes: Pete is told when it is booked for, and the message waits unread on the Ticket. A visit is never done before it starts.
2. **Time travel** past Pete's visit (+24h or +72h in the simulator, until the clock is past its start), then **as Pete** send "All done, washer replaced" again. Tom is asked whether it was fixed properly.
3. **As Tom:** "5". On the Ticket, Alice rates Pete as well.
4. **Close the Ticket.** Tom and Olivia are told the repair is complete.

### 4. An Urgent Repair (about 1 minute)

1. **As Tom (SMS):** "There is a gas smell in the kitchen". This is Urgent, so it never becomes a Ticket: Tom is told to arrange the repair now, with King St's Nominated Tradies (Nina, Sam), and can claim up to $1,000 back. He gets a link for the receipt.
2. **Open the receipt link** and upload a photo or PDF of a receipt, with the amount if you like. The Reimbursement Request waits for Alice: it is counted beside Approvals and listed there as Awaiting your review.
3. **As Alice**, open it from Approvals (or the dashboard's Urgent Repairs), check the receipt and the amount, and **Forward to Property Owner**: Olivia gets the receipt by email with Alice copied in. Once Olivia has paid Tom back, **Mark reimbursed** and Tom is told.

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
| `GOOGLE_MAPS_API_KEY`                 | Google Places (New) only                              |
| `NOMINATIM_URL`                       | Geocoding, which places addresses on the Dispatch map. Needs no key. Hosted mode and `npm start` default to `https://nominatim.openstreetmap.org` |
| `PHOTON_URL`                          | Address suggestions as a Property's address is typed. Needs no key. Hosted mode and `npm start` default to `https://photon.komoot.io` |
| `TWILIO_*`, `SENDGRID_*`, `FILE_LINK_SECRET`, `DEMO_SEND_TO` | Real SMS and email. See [Sending real messages](#sending-real-messages) |
| `PORT`                                | The port to listen on (default 3000)                  |
| `PUBLIC_URL`                          | The address used in upload and tracker links (default `http://localhost:$PORT`) |
| `SUPABASE_DB_URL`                     | The Postgres to use (default: the local one from `npm run db:start`). See [The database](#the-database) |
| `DATABASE_SCHEMA`                     | A Postgres schema to keep data in across restarts (default: a throwaway one). See [Keep your data](#keep-your-data) |
| `DEMO_DATA`                           | `empty` starts with just the Agency, no stories       |

```sh
JEV_API_URL=https://jev.example/api JEV_API_KEY=... npm run demo
```

[`.env.example`](../.env.example) lists every variable with a one-line note. Copy it to `.env` (git-ignored) and export it in your shell; the demo doesn't load it by itself.

The stories are skipped when the classifier or quote reader is real: they rely on the mock reading each message the same way every time. With a real Google key, the seeded Tradies are added as not on Google, because their demo listings only exist in the mock. Linked Tradies' Google ratings are refreshed weekly by the worker.

To open upload and tracker links on a real phone, set `PUBLIC_URL` to an address the phone can reach, such as your machine's LAN address (`PUBLIC_URL=http://192.168.1.20:3000`) or a tunnel.

## Sending real messages

With Twilio and/or SendGrid configured, the demo really sends on those channels (`src/adapters/messenger.ts`), and still shows every message in the phone simulator. **It only really messages the addresses in `DEMO_SEND_TO`** (comma-separated phone numbers and emails, or `*` for anyone): the seeded people's numbers are made up and could belong to real people. Everyone else is simulated only.

| Env vars | What for |
| -------- | -------- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | SMS through Twilio's Messages API. The token also checks signatures on `/webhooks/twilio` |
| `TWILIO_SMS_FROM` | Optional senders used instead of the Agency's connected numbers (the seeded `+61290000000` isn't a Twilio number) |
| `FILE_LINK_SECRET`, `PUBLIC_URL` | Required with Twilio: photos and PDFs go as `MediaUrl` links to `PUBLIC_URL/media/:id`, signed with this secret and valid for an hour. `PUBLIC_URL` must be an https address Twilio can reach (a tunnel works) |
| `SENDGRID_API_KEY` | Email through SendGrid v3 Mail Send, with reply-to the Agency's inbox address and cc and attachments |
| `SENDGRID_FROM` | Optional sender on a SendGrid-verified domain, used instead of the Agency's inbox address |
| `SENDGRID_INBOUND_PUBLIC_KEY` | Checks signatures on `/webhooks/sendgrid` (Inbound Parse) |

```sh
PUBLIC_URL=https://my-tunnel.example FILE_LINK_SECRET=$(openssl rand -base64 48) \
TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_SMS_FROM=+61480000000 \
DEMO_SEND_TO=+61412345678 npm run demo
```

For replies to come back in, point the Twilio number's "A message comes in" webhook at `PUBLIC_URL/webhooks/twilio` (HTTP POST), and SendGrid Inbound Parse at `PUBLIC_URL/webhooks/sendgrid` with signing on. In Setup, connect the Agency's SMS and WhatsApp channels to the Twilio number (and email to the Inbound Parse address), so inbound messages reach the right Agency. A recipient the provider refuses for good (Twilio 21211, 21614 or 21610; a SendGrid 400 on the address) fails its task once with an "Undeliverable" error in the log instead of being retried.

### Checking the live services by hand

`npm run smoke:live -- --to +61412345678` sends one SMS to that number, makes one Jev classify call and one Nominatim geocode, and prints each result. It refuses to run without `--to` and every key it needs (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` or `--from`, `JEV_API_URL`, `JEV_API_KEY`). The geocode needs no key. Automated tests never call a real provider.

Manual checklist with real providers:

1. `npm run smoke:live -- --to <your mobile>`: the SMS arrives, Jev answers each question with an option and a confidence, the geocode is near 12 King St, Newtown.
2. Demo with Twilio set and `DEMO_SEND_TO=<your mobile>`, and a Tenant added in Setup with your mobile: text the Agency's Twilio number from your phone, get the acknowledgement by SMS, reply, and see the reply land.
3. Add a Property Owner with your mobile and no email, and a Tenant at their Property: report an Urgent Repair as the Tenant, upload a receipt photo and forward it from its Reimbursement Request. The Owner's SMS arrives as an MMS with the receipt; its `/media/...` link stops working after an hour. (Quote Requests only attach photos on email.)
4. With SendGrid set, a Tradie on email gets the Quote Request with the photos attached; replying lands in the Ticket through Inbound Parse.

## Running it for real on a home server

`npm start` runs myEST8 without the demo Agency, for people who sign up (`src/main.ts`, ADR 0004). Email goes through each Agency's own Gmail, and SMS stays on the phone simulator.

1. **Database.** `npm run db:start` (Docker) on the server. Data is kept in the schema `myest8`. Alternatively, set `SUPABASE_DB_URL` to a Postgres connection string.
2. **Public address.** Create a Cloudflare named tunnel to a hostname you own, pointing at `http://localhost:$PORT`. A quick tunnel's random URL changes on every start and breaks the webhooks and the OAuth redirect. Set `PUBLIC_URL` to `https://<that hostname>`.
3. **Gmail.**
   - In Google Cloud, enable the Gmail API.
   - Create an OAuth client (Web application) with the redirect URI `https://<hostname>/oauth/google/callback`.
   - Keep the consent screen in Testing, and add each Gmail account that will connect as a test user.
   - Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY`.
4. **WhatsApp (paused).** Not offered in the app for now; skip this step.
   - In Meta for Developers, create an app with WhatsApp.
   - On API Setup, note the test number and its Phone number ID, and add your phone as a recipient.
   - Set the four `META_*` values.
   - Add the webhook `https://<hostname>/webhooks/whatsapp` with your verify token, and subscribe to `messages`.
5. **Classifier.** Set `JEV_API_URL` and `JEV_API_KEY`. Anything else left on a mock needs `ALLOW_MOCKS=1`.
6. **Start.** Export the variables, run `npm start`, then sign up at the public address. On the channels step, connect Gmail, then send a test message.

Keep secrets out of the repo: load them from a git-ignored `.env`, or the server's service manager (for example a systemd `EnvironmentFile`). `npm start` runs TypeScript through `tsx`, so install with dev dependencies (`npm ci`).
