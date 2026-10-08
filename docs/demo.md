# Running the demo

`npm run demo` starts the whole app on your machine with:

- **Dummy external APIs.** The classifier (Jev), the photo matcher, the quote reader and Google Places/Geocoding are answered by an in-process mock (`src/demo/mock-apis.ts`). Nothing leaves your machine unless you set the env vars below.
- **A simulated messenger.** No SMS, WhatsApp or email is really sent. Every outbound message is kept in memory and shown in the phone simulator.
- **A movable clock.** The demo clock runs in real time, and the simulator can move it forward to show reminders and deadlines without waiting.
- **Seed data.** The Agency "Harbour Realty" with its Property Managers, Properties, Owners, Tenants and Tradies.

Everything lives in an in-memory database. **Stopping the demo throws all data away**; the next start is a fresh copy of the seed.

## Start it

```sh
npm install
npm run demo            # http://localhost:3000
PORT=4000 npm run demo  # another port
```

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

Property Owners: Olivia Owens `+61400000100` / `olivia@example.com`; Oscar Ortiz `+61400000101`.

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

`test/demo/e2e.test.ts` runs this script, with these exact messages, on every test run.

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

With a real Google key, the seeded Tradies are added as not on Google, because their demo listings only exist in the mock. Messages are always simulated: the demo never sends real SMS, WhatsApp or email.

To open upload and tracker links on a real phone, set `PUBLIC_URL` to an address the phone can reach, such as your machine's LAN address (`PUBLIC_URL=http://192.168.1.20:3000`) or a tunnel.
