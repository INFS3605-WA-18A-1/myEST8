# Each Agency gets its own Twilio SMS number

Amends the SMS part of [ADR 0004](0004-gmail-and-whatsapp-cloud-api.md). Built, and now switched off: superseded by [ADR 0013](0013-textbee-sms-twilio-cannot-be-used.md), because Twilio rejected the Australian regulatory bundle and a trial account cannot send custom text.

An Agency's SMS channel is a number that Twilio sends and receives for. There are two ways to get one, each with its own button and a short explanation, in the welcome wizard's Channels step, on the Setup page and in Settings. It is the same component in all three.

1. **Create a new number.** One click. myEST8 buys an Australian mobile number on the server's Twilio account (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`), using the regulatory bundle and address the operator set up once (`TWILIO_BUNDLE_SID`, `TWILIO_ADDRESS_SID`). It points the number's incoming texts at `${PUBLIC_URL}/webhooks/twilio` and connects it as the Agency's SMS channel. There is no code to verify, because myEST8 owns the number. The platform pays the monthly fee. The number is named `myEST8 Agency <id>` on Twilio, so asking again finds the number already bought instead of buying another.
2. **Register a Twilio number.** For an Agency that already has a Twilio account and number. The Agency pastes its Account SID and Auth Token. myEST8 checks them against Twilio, refuses a trial account, and lists the numbers that can send and receive SMS. If there are none it says so and links to Twilio to buy one. The Agency picks one, and myEST8 points that number's incoming texts at the same webhook and connects it. The Auth Token is stored encrypted (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`, the key Gmail's tokens used). While the Agency is still choosing, the pair sits in the same encrypted row, so the token is never carried through the browser.

Either path replaces whatever SMS number the Agency had before. An Agency can't connect an ordinary mobile, because something has to send and receive that number's texts.

## Sending and receiving

- **Outbound** goes from the Agency's own number, through the Twilio account that owns it: the server's account for a created number, the Agency's own for a registered one. An Agency with no number still uses the shared `TWILIO_SMS_FROM` number if one is set. The `DEMO_SEND_TO` gate and the refusal rules still apply.
- **Inbound** `POST /webhooks/twilio` finds the Agency by the `To` number and checks `X-Twilio-Signature` with the token of the account that owns that number. A bad or missing signature and an unknown `To` both get 403, with the same body, so a caller can't tell which. This is a deliberate change: an unknown `To` used to be accepted and dropped.
- Twilio credentials are only sent to media URLs under Twilio's own API, using the account named in the URL. An Agency can sign its own webhooks, so a media URL in one is untrusted.

## Disconnecting

- A **created** number is released back to Twilio, which stops its monthly fee and can't be undone. A confirmation page says so first.
- A **registered** number is only unlinked. myEST8 clears the number's webhook if it still points at myEST8, and deletes the stored credentials. The number stays on the Agency's Twilio account.

## What the server needs

`TOKEN_ENCRYPTION_KEY` turns the feature on, because a registered Agency's Auth Token must be encrypted. Without it the SMS channel stays an address the Agency types, with a code sent to verify it, exactly as before.

"Create a new number" also needs the server's Twilio account, `TWILIO_BUNDLE_SID` and `TWILIO_ADDRESS_SID`. Without the last two, the button is shown disabled with a one-line reason for the operator. "Register a Twilio number" still works. `npx tsx scripts/twilio-setup.ts` checks the account and prints the two values.

`TWILIO_API_BASE_URL` points the Twilio calls at a local fake. `scripts/fake-twilio.ts` is one, for `npm run demo`.

## Facts checked on 2026-10-21

- A Twilio trial account can send only Twilio's own template messages, not custom text, so the platform's account has to be upgraded. A registered Agency's account does too, which is why a trial is refused.
- An Australian mobile number costs about US$8.25 a month, plus a charge per message. It needs an approved regulatory bundle and an address on the account. The operator creates both once, by hand, in the Twilio Console.

Prices and rules are Twilio's and change. Check them before relying on these figures.

## Limits

- The lock that stops two clicks buying two numbers works within one server process. Two serverless instances answering at the same moment could each buy one. The `myEST8 Agency <id>` name makes the next request find the number, and the extra can be released in the Twilio Console.
- Australian numbers can't receive pictures, so SMS has no attachments here.
- A number inside a Twilio Messaging Service may ignore its own webhook. The Agency must remove it from the service.
- None of this has been run against live Twilio. It was checked against a local fake that follows Twilio's documented API.
