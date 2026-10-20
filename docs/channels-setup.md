# Setting up real channels: keys and accounts

myEST8 reaches Tenants, Tradies and Property Owners through channels they already use. Email goes through Resend ([ADR 0006](adr/0006-resend-email-and-claude-haiku.md)). WhatsApp goes through Meta's WhatsApp Cloud API ([ADR 0004](adr/0004-gmail-and-whatsapp-cloud-api.md)). SMS is simulated, or one shared Twilio number. A Twilio number bought for each Agency ([ADR 0005](adr/0005-twilio-sms-number-per-agency.md)) is not built.

| Channel | How | What you set up |
| ------- | --- | --------------- |
| Email | Resend, on a subdomain such as `mail.kevinhe.pro` | The domain's MX, SPF and DKIM, and a webhook (section 1) |
| WhatsApp | Meta's WhatsApp Cloud API | A Meta app, a token and a webhook (section 2) |
| SMS | Simulated, or one shared Twilio number | A Twilio account only if SMS should be real (section 3) |

Gmail OAuth is still in the code and is dormant (section 5). With none of the groups below set, every channel is simulated: nothing is sent to a real phone or inbox.

All the values go in one file outside the repo, `~/.config/myest8/live.env` (`chmod 600`), which the systemd service loads. [`deploy/live.env.example`](../deploy/live.env.example) is the template. The repo's `.env` is not used by the service. The names below are the ones the process reads. It does not read `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `CHANNEL_SECRET_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_DISPLAY_NUMBER`, `TWILIO_BUNDLE_SID` or `TWILIO_ADDRESS_SID`.

## 0. A stable public address (first)

Resend's webhook address and Meta's webhook address must be exact, fixed HTTPS URLs. A quick tunnel gets a new URL every time it restarts, which breaks both. You need a hostname such as `myest8.yourdomain.com` on a domain in your Cloudflare account.

1. Put the hostname in `deploy/cloudflared.yml` (copy it from the example in that file) and in `live.env` as `PUBLIC_URL=https://myest8.yourdomain.com`.
2. `cloudflared tunnel route dns mytunnel myest8.yourdomain.com` creates the DNS record for the tunnel.
3. Run the named tunnel instead of the quick one: see [hosting.md](hosting.md#a-fixed-address).

Without a domain, use the quick tunnel for the simulated demo only. The live service runs `src/main.ts`, which refuses to start unless `PUBLIC_URL` is `https://...` and, while any API is mocked, unless `ALLOW_MOCKS=1`. See [hosting.md](hosting.md#which-program-the-service-runs).

## 1. Resend (email)

Inbound mail uses a subdomain so the root domain's existing MX is left alone. `mail.kevinhe.pro` is the example; another subdomain of a domain you control is the same setup. An Agency forwards or CCs its mail to an address on that subdomain.

In the [Resend dashboard](https://resend.com/domains):

1. Add the subdomain and turn on sending and receiving.
2. Publish the records Resend shows for that subdomain. Do not copy values from this page; they are generated per domain.
   - **SPF** and **DKIM** so Resend can send as the subdomain.
   - **MX** for receiving. It has to be the lowest priority (the smallest preference number) on that subdomain, or mail goes somewhere else. Resend drops mail forwarded straight at the SMTP host in the MX record unless this MX is verified.
3. Wait until Resend shows the domain and receiving as verified.
4. Create a webhook. Endpoint `https://myest8.yourdomain.com/webhooks/resend` (your `PUBLIC_URL`, plus `/webhooks/resend`). Event **`email.received`**. The event carries metadata only; myEST8 then fetches the body. Copy the signing secret into `RESEND_WEBHOOK_SECRET`.
5. Put these in `live.env` (all three, or none). The values here are placeholders:

   ```sh
   RESEND_API_KEY=re_xxx
   RESEND_WEBHOOK_SECRET=whsec_xxx
   RESEND_INBOUND_DOMAIN=mail.kevinhe.pro
   ```

`RESEND_INBOUND_DOMAIN` is the subdomain from step 1, with no `@` and no scheme.

## 2. WhatsApp (Meta Cloud API, one number for the server)

At [developers.facebook.com](https://developers.facebook.com):

1. Register as a developer. Create an app with the **WhatsApp** use case and a business portfolio.
2. **WhatsApp, API Setup**: connect a WhatsApp Business account. Note the **Phone number ID** of the test number and its display number. Add the phone numbers allowed to receive messages (the test number reportedly allows 5; check the panel).
3. **A permanent token.** Business Settings, Users, System users: create a system user, give it your app (Manage app) and the WhatsApp account (Manage WhatsApp Business accounts), then generate a token with `business_management`, `whatsapp_business_messaging` and `whatsapp_business_management`. The temporary token on the API Setup page expires within hours, so don't use it.
4. **App secret**: App settings, Basic, App secret.
5. **Webhook**: WhatsApp, Configuration. Callback URL `https://myest8.yourdomain.com/webhooks/whatsapp`, and a verify token you make up. Subscribe to the **messages** field. Meta calls the URL once to check it, so myEST8 must already be running there.
6. Put these in `live.env`:

   ```sh
   META_WHATSAPP_ACCESS_TOKEN=
   META_WHATSAPP_PHONE_NUMBER_ID=
   META_APP_SECRET=
   META_WEBHOOK_VERIFY_TOKEN=
   META_WHATSAPP_NUMBER=+15550000000
   ```

   `META_WHATSAPP_PHONE_NUMBER_ID` and `META_WHATSAPP_ACCESS_TOKEN` are both set, or neither: a half pair refuses to start. `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` are both set or the webhook route is off (a half pair does not throw; the route is absent). `META_WHATSAPP_NUMBER` is the E.164 number shown on the channels page.

Limits:

- Tenants must message first. myEST8 can reply freely for 24 hours after their last message; after that WhatsApp allows only approved templates, so myEST8 uses SMS or email instead.
- One WhatsApp number belongs to one Agency. The first Agency to press Connect WhatsApp gets it. A number for every Agency (Embedded Signup) is not built.
- A Meta app in Development mode may not receive some webhooks.

## 3. SMS (simulated, or one shared Twilio number)

A button that buys an Australian mobile per Agency is not built. `TWILIO_BUNDLE_SID` and `TWILIO_ADDRESS_SID` are not read. Leave them unset.

Without Twilio, SMS stays on the phone simulator.

With a paid Twilio account, one number you already own can send and receive for the server:

1. Upgrade the Twilio account from trial if you need to text numbers you have not verified.
2. On that number, set "A message comes in" to `https://myest8.yourdomain.com/webhooks/twilio`, HTTP POST.
3. Put these in `live.env`:

   ```sh
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=
   TWILIO_SMS_FROM=+61400000000
   FILE_LINK_SECRET=
   ```

   `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are both set, or neither. Both also require `FILE_LINK_SECRET` (32 random bytes or more, `openssl rand -base64 32`) and an https `PUBLIC_URL`: Twilio fetches attachments by a signed link. `TWILIO_SMS_FROM` is required with them: every SMS is sent from that E.164 number, and the app refuses to start without it (an SMS never goes out from an Agency's own mobile number).

`TWILIO_WHATSAPP_FROM` is optional (without it Twilio sends no WhatsApp) and unused while the Meta pair in section 2 is set: Meta takes the WhatsApp channel.

## 4. AI: Jev classifies, Claude Haiku composes ([ADR 0011](adr/0011-jev-classifies-haiku-composes.md))

```sh
JEV_API_URL=https://api.typesafe.ai
JEV_API_KEY=xxx
ANTHROPIC_API_KEY=sk-ant-xxx
```

The keys are placeholders. Jev (TypeSafe) classifies every inbound message: its kind, Urgency, Trade, and reply type. Claude Haiku composes the messages myEST8 sends, such as the email when a Property Manager forwards a Ticket to the Property Owner, and writes each request's Summary. Either one left empty runs its mock.

**Not built yet:** today classification uses Claude Haiku whenever `ANTHROPIC_API_KEY` is set, and Jev only without it. `src/adapters/jev.ts` still speaks a guessed pre-release contract rather than TypeSafe's `/v1/systemone`. Outbound messages are fixed templates. ADR 0011 lists the gaps.

`VISION_API_*`, `QUOTES_API_*` and `GOOGLE_MAPS_API_KEY` are the same as before: leave them empty and the mocks run. For the maps key, enable the Geocoding API and the Places API (New) and restrict the key to those two.

`src/main.ts` exits if any of these is still a mock, unless `ALLOW_MOCKS=1`.

## 5. Gmail (dormant)

Gmail is not the email path. The code remains: if `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set, the process also requires `TOKEN_ENCRYPTION_KEY` (base64 of 32 bytes, `openssl rand -base64 32`) and polls the connected mailbox. Set neither client value and Gmail stays off. A half pair refuses to start. Losing `TOKEN_ENCRYPTION_KEY` means every connected Agency has to sign in to Google again.

Redirect URI, if you ever turn it on: `https://myest8.yourdomain.com/oauth/google/callback`.

## Checking it works

1. Restart: `systemctl --user restart myest8`, then `journalctl --user -u myest8 -n 20`. A half-set group (for example only `GOOGLE_CLIENT_ID`, or only `META_WHATSAPP_ACCESS_TOKEN`) refuses to start and names what is missing. Mocked APIs do the same unless `ALLOW_MOCKS=1`.
2. Sign up a new Agency. Leave `GOOGLE_CLIENT_ID` unset so email stays off the dormant Gmail button. WhatsApp is paused: the setup pages offer SMS and email only, and the WhatsApp backend below stays dormant. SMS is an address you type. There is no **Get an SMS number** action. With the Twilio pair set, outbound SMS always uses `TWILIO_SMS_FROM`.
3. Send mail to an address on `RESEND_INBOUND_DOMAIN`, or forward a message there. Resend posts `email.received` to `/webhooks/resend`; the event has no body, and myEST8 fetches it.
4. WhatsApp (paused; only if it is turned back on): **Send a test message** to a phone on the test number's allowed list (WhatsApp, API Setup). The text is `This is a test message from <Agency name> on myEST8. This channel is working.` Meta delivers that free-form text only within 24 hours of that phone's last message to the test number. A later failure is a warning in the log, `WhatsApp message to … failed`, so the webhook has to be subscribed to **messages** (delivery statuses come on that field too): `journalctl --user -u myest8 | grep "WhatsApp message to"`.
5. WhatsApp (paused): message the test number from an allowed phone. The message reaches the Agency, and a reply inside 24 hours is free-form text.
