# Setting up real channels: keys and accounts

myEST8 reaches Tenants, Tradies and Property Owners through channels they already use ([ADR 0004](adr/0004-gmail-and-whatsapp-cloud-api.md)):

| Channel | How | What you set up |
| ------- | --- | --------------- |
| Email | Gmail, connected by each Agency signing in to Google | A Google Cloud OAuth client (section 1) |
| WhatsApp | Meta's WhatsApp Cloud API | A Meta app, a token and a webhook (section 2) |
| SMS | A Twilio number bought for each Agency ([ADR 0005](adr/0005-twilio-sms-number-per-agency.md)), or simulated | A paid Twilio account and an Australian regulatory bundle (section 3). Without them, nothing: SMS is simulated |

With none of this set, every channel is simulated: a new Agency is connected to the phone simulator when it signs up, and nothing is sent to a real phone or inbox. Set up only what you want to be real.

All the values go in one file outside the repo, `~/.config/myest8/live.env` (`chmod 600`), which the systemd service loads. [`deploy/live.env.example`](../deploy/live.env.example) is the template. The repo's `.env` is not used by the service.

## 0. A stable public address (first)

Google's redirect address and Meta's webhook address must be exact, fixed HTTPS URLs. A quick tunnel gets a new URL every time it restarts, which breaks both. You need a hostname such as `myest8.yourdomain.com` on a domain in your Cloudflare account.

1. Put the hostname in `deploy/cloudflared.yml` (copy it from the example in that file) and in `live.env` as `PUBLIC_URL=https://myest8.yourdomain.com`.
2. `cloudflared tunnel route dns mytunnel myest8.yourdomain.com` creates the DNS record for the tunnel.
3. Run the named tunnel instead of the quick one: see [hosting.md](hosting.md#a-fixed-address).

Without a domain, use the quick tunnel for the simulated demo only.

## 1. Gmail (email, one connection per Agency)

In the [Google Cloud console](https://console.cloud.google.com):

1. Create a project called "myEST8" and enable the **Gmail API** (APIs and services, Library).
2. **OAuth consent screen** (Google Auth Platform):
   - User type **External**. Fill in the app name, support email and developer contact.
   - Audience: **Testing**. Add every Gmail address that will connect as a **Test user** (up to 100).
3. **Data access**: add the scopes `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`. myEST8 never asks for `gmail.modify`, so it cannot change or delete mail.
4. **Credentials, Create credentials, OAuth client ID, Web application.** Authorized redirect URIs:
   - `https://myest8.yourdomain.com/oauth/google/callback`
   - `http://localhost:4001/oauth/google/callback` for `PORT=4001 npm run dev`
5. Put these in `live.env`:

   ```sh
   GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
   CHANNEL_SECRET_KEY=...     # openssl rand -base64 32
   ```

   `CHANNEL_SECRET_KEY` encrypts the stored Gmail refresh tokens (AES-256-GCM). Keep a copy: if it is lost, every Agency has to connect Gmail again. All three must be set, or none.

What to expect:

- Google shows "Google hasn't verified this app". Choose Advanced, then continue.
- In Testing mode a refresh token lapses after about 7 days (third-party sources; Google's own page doesn't state it). The Agency then sees "Gmail needs reconnecting" and clicks Reconnect Gmail. Mail that arrived meanwhile is still read.
- `gmail.readonly` is a Restricted scope. Publishing the app, which removes the 7-day limit, needs Google's verification and a security assessment, which takes weeks.
- Each Agency signs in once under Settings, Channels, Connect Gmail. myEST8 polls the inbox every minute and replies from that address.

## 2. WhatsApp (Meta Cloud API, one number for the server)

At [developers.facebook.com](https://developers.facebook.com):

1. Register as a developer. Create an app with the **WhatsApp** use case and a business portfolio.
2. **WhatsApp, API Setup**: connect a WhatsApp Business account. Note the **Phone number ID** of the test number and its display number. Add the phone numbers allowed to receive messages (the test number reportedly allows 5; check the panel).
3. **A permanent token.** Business Settings, Users, System users: create a system user, give it your app (Manage app) and the WhatsApp account (Manage WhatsApp Business accounts), then generate a token with `business_management`, `whatsapp_business_messaging` and `whatsapp_business_management`. The temporary token on the API Setup page expires within hours, so don't use it.
4. **App secret**: App settings, Basic, App secret.
5. **Webhook**: WhatsApp, Configuration. Callback URL `https://myest8.yourdomain.com/webhooks/whatsapp`, and a verify token you make up. Subscribe to the **messages** field. Meta calls the URL once to check it, so myEST8 must already be running there.
6. Put these in `live.env` (all five, or none):

   ```sh
   WHATSAPP_TOKEN=EAAG...
   WHATSAPP_APP_SECRET=...
   WHATSAPP_VERIFY_TOKEN=any-random-string-you-chose
   WHATSAPP_PHONE_NUMBER_ID=106540352242922
   WHATSAPP_DISPLAY_NUMBER=+15551234567
   ```

Limits:

- Tenants must message first. myEST8 can reply freely for 24 hours after their last message; after that WhatsApp allows only approved templates, so myEST8 uses SMS or email instead.
- One WhatsApp number belongs to one Agency. The first Agency to press Connect WhatsApp gets it. A number for every Agency (Embedded Signup) is not built.
- A Meta app in Development mode may not receive some webhooks.

## 3. SMS (Twilio, a number for each Agency)

The Agency clicks **Get an SMS number** under Channels. myEST8 buys an Australian mobile on your Twilio account, sends its incoming texts to `https://myest8.yourdomain.com/webhooks/twilio`, and connects it. Nothing else is set up per Agency.

1. Upgrade the Twilio account from trial and add funds. A trial account can't hold an Australian number, and can only text verified numbers.
2. Phone Numbers, Regulatory Compliance, **Bundles**: create a bundle for Australia, Mobile, Business, and wait for Twilio to approve it (it can take a few days). Note its `BU...` id and the `AD...` id of the address in it.
3. Put these in `live.env`:

   ```sh
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_BUNDLE_SID=BU...      # turns SMS numbers on
   TWILIO_ADDRESS_SID=AD...     # the address in the bundle
   FILE_LINK_SECRET=...         # openssl rand -base64 32; Twilio fetches attachments by signed link
   ```

   Leave `TWILIO_SMS_FROM` empty: it would send every Agency's SMS from one number.

Each number costs a monthly fee plus each message. Asking again never buys a second number for the same Agency (the number is named `myEST8 Agency <id>` on Twilio). A number you release in the Twilio console stops working for that Agency.

## 4. Optional

- `GOOGLE_MAPS_API_KEY`: real address lookup for the Dispatch map. Enable the Geocoding API and the Places API (New) on the key and restrict the key to those two. Without it a mock places the pins.
- `JEV_API_URL`, `JEV_API_KEY`, `VISION_API_*`, `QUOTES_API_*`: your own classifier, photo matcher and quote reader. Leave them empty and the mocks run.

## Checking it works

1. Restart: `systemctl --user restart myest8`, then `journalctl --user -u myest8 -n 20`. A half-set group (for example only `GOOGLE_OAUTH_CLIENT_ID`) refuses to start and names what is missing.
2. Sign up a new Agency. Email shows **Connect Gmail**, WhatsApp **Connect WhatsApp**, and SMS **Get an SMS number** (or, without Twilio, it is connected and simulated).
3. Connect Gmail with a Test user account, then email that address from another account. A Maintenance Request appears within about a minute.
4. Reply from myEST8: the message arrives from the Agency's own address.
5. WhatsApp: **Send a test message** to a phone on the test number's allowed list (WhatsApp, API Setup). It arrives as WhatsApp's "Hello World" sample template, because WhatsApp drops free-form messages to anyone who hasn't messaged the number in the last 24 hours. Meta accepts every send before delivering it, so a refusal shows only in the log: `journalctl --user -u myest8 | grep "WhatsApp could not deliver"` (the webhook must be subscribed to **messages**, which also carries delivery statuses).
6. Message the test number from an allowed phone. The message reaches the Agency, and the reply arrives within 24 hours.
7. Email: **Send a test email to** fills in your own address. Change it to any inbox you can check. Signing in to Google does not count as a test.
