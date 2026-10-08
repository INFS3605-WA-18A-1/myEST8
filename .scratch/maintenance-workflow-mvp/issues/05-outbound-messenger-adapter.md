# Outbound Messenger adapter: Twilio and SendGrid

Status: ready-for-human

## Goal

A real `Messenger` (`src/ports.ts`) that sends SMS and WhatsApp through Twilio Programmable Messaging and email through SendGrid (ADR-0003).

## What exists

- `Messenger.send(OutboundMessage)`: channel type, Agency `from` address, `to`, `cc`, subject, rendered text, template name and data, attachments as bytes.
- `src/notifications.ts` chooses the channel (last channel within 24 hours, otherwise SMS, or email when there's no mobile), so WhatsApp is only used inside its reply window.
- Tests use `FakeMessenger` (`test/support/fakes.ts`).

## Acceptance criteria

- [ ] SMS and WhatsApp via the Twilio Messages API (`whatsapp:` prefix for WhatsApp). Attachments go as `MediaUrl`, which needs a signed, expiring no-login URL serving the stored file (`src/files.ts`).
- [ ] Email via SendGrid with `reply-to` set to the Agency's Inbound Parse address, so replies come back in; `cc` and attachments supported.
- [ ] Provider errors are thrown so the worker retries (`src/worker.ts`); a permanently invalid recipient is logged clearly.
- [ ] Credentials come from configuration, never from code.

## Needs a human

- Twilio account, SMS number and WhatsApp sandbox; SendGrid account, verified sender domain and Inbound Parse host.

## Testing

- Small adapter tests that check the request built for each channel against a stubbed `fetch`. Real providers are never called in automated tests; add the steps to the manual demo checklist.
