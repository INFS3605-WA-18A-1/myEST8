# SMS through textbee, because Twilio can't be used

Supersedes the SMS part of [ADR 0005](0005-twilio-sms-number-per-agency.md). Planned.

## Why Twilio can't be used

myEST8 needs to send custom texts to Australian mobiles and receive the replies. Twilio can't do that for this project:

- **A trial account can't send custom text.** Twilio's trial docs (updated 2026-09-23) allow only predefined template messages, to at most 5 verified numbers, in the sign-up country. myEST8's texts are all custom.
- **An upgraded account needs an Australian regulatory bundle,** and Twilio rejected ours (2026-10-22). An Australian mobile number on Twilio needs an approved bundle (identity and an Australian address) before it can be bought, so without one there is no number at all. It is a manual review that takes days, with no guarantee for a student project.
- **Other routes are no easier.** A US number needs A2P 10DLC brand and campaign registration. Australian SMS providers (ClickSend, Mobile Message and the like) also have to verify identity under ACMA's rules, so they could refuse in the same way.

The Twilio code from #23 (ADR 0005: a number per Agency, Create or Register) stays in the repo and is **switched off**: with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TOKEN_ENCRYPTION_KEY` unset, none of it runs and the Channels pages don't offer it. If a bundle is approved later, setting those variables turns it back on. Then textbee must be unset, because only one SMS provider runs at a time.

## Decision

SMS goes through **textbee** (https://textbee.dev): an Android phone with a SIM runs the textbee app, and myEST8 sends and receives through it.

- **Sending:** `POST https://api.textbee.dev/api/v1/gateway/send-sms`, header `x-api-key`, body `{ "recipients": [...], "message": "..." }`.
- **Receiving:** textbee posts a `MESSAGE_RECEIVED` webhook to `${PUBLIC_URL}/webhooks/textbee`. The body has `smsId`, `sender`, `message`, `deviceId`, `receivedAt` and `idempotencyKey`. It is signed in `X-Signature` with the lowercase-hex HMAC-SHA256 of the raw body, keyed by the webhook's signing secret. textbee retries a 5xx up to 10 times, stops on a 4xx, and pauses a webhook whose deliveries keep failing.
- **One number for the server.** The phone's number belongs to one Agency, the one that presses **Connect SMS** on its Channels page. There is no verification code, because the server's own phone is the number. A second Agency is told the number is taken.

Configuration: `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`, `TEXTBEE_NUMBER` (the phone's number, E.164) and `TEXTBEE_WEBHOOK_SECRET`, all four or none. `TEXTBEE_API_URL` points at a fake for tests.

## Consequences

- No paperwork, no number fees: texts cost what the phone's plan charges.
- textbee's free tier allows 1 device, 50 texts a day and 300 a month. That's enough for a demo, not for real use.
- The phone must stay on and online. Texts sent while it's off wait on textbee, and texts received are forwarded when it's back.
- SMS is text only: photos come by email or the upload link, which already work.
- One Agency per phone. A number per Agency would need a phone per Agency, or Twilio after all.
