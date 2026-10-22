# Running a product demo

How to show myEST8 live: a Tenant reports a repair from their own phone, and the Property Manager takes it from there. The demo runs on production (<https://myest8.vercel.app>, see [Master is the testing environment](../AGENTS.md)), so the email and texts are real.

If anything real is down on the day, run the local demo instead (`npm run demo`, see [docs/demo.md](demo.md)). It has the same app with a phone simulator and sample data, and needs no setup.

## Who does what

| Role | Needs | Does |
|---|---|---|
| **Presenter** (the Property Manager) | A laptop signed in to myEST8 as the Agency's Property Manager | Walks through the app: the dashboard, the request, the follow-up, Dispatch, the schedule |
| **Tenant** | Any phone with email, and with SMS if you're showing texts | Reports the repair and answers myEST8's questions |
| **Android phone owner** | The Android phone running textbee (below) | Keeps the phone on and online. Doesn't touch it during the demo |

One person can be both Tenant and Android phone owner, but **not on the same phone**. The Tenant texts *to* the Android phone.

## The day before

1. **Production is up to date.** The latest release PR is merged into `master`, and its `deploy-prod` and `smoke` jobs are green in GitHub Actions.
2. **The Agency is set up** in the app:
   - a Property Owner
   - a Property, with an address that shows a pin on Dispatch (if it has none, press **Look up missing addresses**)
   - the **Tenant** on that Property, with the email address and mobile number they'll use in the demo
   - two or three Tradies added from their Google listings
3. **Email works.** From the Tenant's email, send a short test to the Agency's inbound address (Settings → Channels shows it, for example `kevin-estate@mail.kevinhe.pro`). It should appear under Tickets within a minute or two. Delete or reject it afterwards.
4. **SMS works** (only if you're showing texts). The Android phone is set up (below), and the Agency shows the phone's number as connected under Settings → Channels. From the Tenant's phone, text the Android phone's number: myEST8 should reply within a minute, and the text should appear under Tickets.
5. **Each test leaves something behind.** Either reject the test requests, or start the demo from a different issue, so the demo request is new.

## The demo (about 10 minutes)

1. **The Tenant reports a repair** (2 min). By email or by text, for example: "The kitchen tap at 227/9 Rose Valley Way has been dripping since Monday." Don't attach a photo the first time.
2. **myEST8 asks the questions** (2 min). The Tenant gets an acknowledgement, then the guided questions one at a time (where, since when, …). They answer each. After the last one, myEST8 asks for photos with an upload link. The Tenant opens the link and adds a photo, or replies to the email with one attached.
3. **The Property Manager reviews it** (2 min). On the dashboard, the request is under *Needs your attention*. Open it to show:
   - the AI Summary (marked ✦✦)
   - the photo and its checks
   - the Urgency and Trade the AI chose
4. **Follow up with AI** (1 min). In **Follow up with <name>**, type a rough note ("ask if it's still dripping and whether they can turn the tap off underneath"), press **Draft with AI**, show the draft marked ✦✦, edit a word, and **Send**. The Tenant shows it arriving.
5. **Confirm and dispatch** (2 min). Press **Confirm**. Open **Dispatch** to show the Property's pin and the nearby Tradies with their myEST8 and Google ratings, then ask for Quotes.
6. **The week** (1 min). Open **Schedule**: the Teams-style week, today's red time line, and **Free today**. Back on the dashboard, pick a day in **Next 7 days**.

## If something goes wrong

| Problem | What to do |
|---|---|
| Nothing arrives after an email | Wait a minute: background jobs run straight after each email and every 5 minutes. Still nothing? Carry on by text, or switch to the local demo. |
| Nothing arrives after a text | The Android phone is probably offline or asleep (see below). Carry on by email. |
| A reply is slow | Say so and move to the Property Manager's side. The reply will turn up. |
| The site is down | Run `npm run demo` on the laptop and use the phone simulator. |

## For the Android phone owner

Your phone is the Agency's SMS number for the demo. Texts to your number go to myEST8, and myEST8's replies go out from your number, through an app called textbee ([ADR 0013](adr/0013-textbee-sms-twilio-cannot-be-used.md) says why).

### What you need

- **An Android phone** (textbee doesn't run on iPhone) with a SIM that can send and receive texts, and some credit or an SMS plan.
- **Ideally a spare phone or spare SIM.** textbee forwards **every** text the phone receives to myEST8, including personal ones. Those land in the Agency's inbox, where the Property Manager can see them. If you use your own phone, turn receiving off after the demo (the last section).
- Mobile data or wifi for the whole demo.

### Set it up (once, about 15 minutes)

1. Get the textbee sign-in from whoever runs the team's textbee account.
2. On the phone, install the textbee app from textbee.dev (its dashboard links to the app download).
3. Open the app, sign in, and **allow every permission it asks for**, especially sending and receiving SMS.
4. In the app, turn on **receiving SMS**, so incoming texts are forwarded.
5. Stop Android putting textbee to sleep: **Settings → Apps → textbee → Battery → Unrestricted** (the names vary by phone; look for "battery optimisation" or "background usage").
6. Tell the team your number in full international form, for example `+61412345678`, and the **device id** the app or dashboard shows. They put these in the server's settings (`TEXTBEE_NUMBER`, `TEXTBEE_DEVICE_ID`; [docs/channels-setup.md](channels-setup.md) section 3).
7. When the team says it's connected, ask someone to text your number. myEST8 should text back within a minute.

### On the day

- **Charge the phone fully,** or keep it plugged in.
- Keep it **on mobile data or wifi,** with the textbee app open or at least not force-closed. Don't turn on airplane mode or battery saver.
- **Don't use the phone for texting during the demo.** Every text it receives goes to myEST8, and every reply myEST8 sends comes from it. You'll see these texts appear in its Messages app; that's expected. Don't reply to them yourself.
- **Watch the limit.** textbee's free plan allows 50 texts a day and 300 a month. One demo uses about 10 to 15. Don't run lots of rehearsals the same day.

### After the demo

- In the textbee app, turn **receiving SMS off** (or sign out), so your own texts stop going to myEST8.
- Tell the team, so they can press **Disconnect** under Settings → Channels. Texts to your number then stop being linked to the Agency.
