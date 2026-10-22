# SMS through textbee

The decision and its reasons are in [ADR 0013](../../docs/adr/0013-textbee-sms-twilio-cannot-be-used.md). Twilio can't be used, so real SMS goes through an Android phone running textbee. This spec is how it's built.

## Configuration

- `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`, `TEXTBEE_NUMBER` (E.164, for example `+61412345678`) and `TEXTBEE_WEBHOOK_SECRET`: all four or none. A partial set refuses to start, as a half Twilio or Meta pair does today (`messengersFromEnv`, `src/adapters/messenger.ts`).
- `TEXTBEE_API_URL` (optional) overrides `https://api.textbee.dev`, for a fake in tests.
- With textbee set, it is **the** SMS provider. It takes SMS over from Twilio the way Meta takes WhatsApp over (log a line saying so), and the Twilio number-per-Agency panel isn't offered.
- Without it, everything is as today: the simulator in the demo, and SMS listed as unavailable when hosted with no provider.

## Sending

- `src/adapters/textbee.ts`: a Messenger that sends one SMS through `POST {base}/api/v1/gateway/send-sms` with `x-api-key`. Read textbee's API reference (https://textbee.dev/docs/api-reference) for whether the device id goes in the path or the body, and for the response shape. Follow what it says; it overrules this spec.
- Errors are classified the way the Twilio messenger does (`UndeliverableError` and `ProviderRefusedError` in `src/ports.ts`), so a refused number becomes a form message and an outage surfaces.
- The API key never appears in an error.
- Attachments: SMS can't carry them, so a message with attachments sends the text plus each attachment's signed link (`fileLinks`), as the Twilio messenger's links work today.

## Receiving

- `POST /webhooks/textbee` in `src/http.ts`. Read the raw body and check `X-Signature` (lowercase-hex HMAC-SHA256 of the raw bytes with `TEXTBEE_WEBHOOK_SECRET`, compared in constant time) before parsing.
  - A bad or missing signature is **401** and stores nothing.
  - With textbee unset, the route is a 404.
- Only `webhookEvent: "MESSAGE_RECEIVED"` is handled. Other events are acknowledged with 200 and ignored.
- A received text becomes the common inbound message:
  - `providerMessageId`: `smsId`
  - `channelType: 'sms'`
  - `from`: `sender`
  - `agencyChannel`: `TEXTBEE_NUMBER` (textbee doesn't say which number was texted)
  - `text`: `message`
  - `receivedAt`: `receivedAt`
  - no attachments
- **When no Agency has connected the number yet,** reply 200 and log it. Don't reply 4xx: textbee would stop the delivery and eventually pause the webhook.
- **The same `smsId` twice** is stored once (`receive` is already idempotent by provider message id).
- **A text from `TEXTBEE_NUMBER` itself** (the phone texting itself) is ignored with 200.

## Connecting the number to an Agency

- With textbee set, the SMS part of the Channels screens (the welcome wizard's Channels step, Setup and Settings, where `smsNumberPanel`/the code form sit today) offers one thing: **Connect SMS**. It says "Tenants text +61 412 345 678. This is the server's SMS phone." Pressing it connects `TEXTBEE_NUMBER` as the Agency's SMS channel with no code (`profiles.connectChannel(..., { verified: true })`, as Create a new number does). Once connected it shows the number with **Disconnect**.
- If another Agency already has the number, Connect SMS is refused: "This server's SMS number is connected to another Agency."
- The type-a-number-and-code form and the Twilio panel are not shown while textbee is set.

## Test seams (agreed, the repo's existing ones)

- **Adapter tests** (`test/adapters/`, stubbed fetch): the request sent to textbee, and how its answers and errors are read.
- **HTTP tests** (`test/`, like `test/sms-webhook.test.ts` for Twilio): the webhook signed and posted as textbee would, and what's stored or sent.
- **Page tests** (`test/web/`): the Channels screens' Connect SMS and Disconnect.
- **Runtime tests** (`test/demo/runtime.test.ts`, `test/hosted.test.ts`): which provider is chosen from the environment.

Test-first, one vertical slice at a time. Expected values come from worked examples, never recomputed the way the code does it. For the signature, compute the HMAC of a fixed body and secret once by hand and paste the hex in as a literal.

## Non-goals

- A number per Agency, or more than one phone.
- MMS or photos by text.
- Delivery receipts (`MESSAGE_DELIVERED` / `MESSAGE_FAILED`).
- Polling textbee for missed texts.
- Removing the Twilio code.
