# Receive SMS from textbee

Status: resolved
Blocked by: 01
Spec: ../spec.md

## What to build

`POST /webhooks/textbee`, as the spec's Receiving section says: signature check on the raw body first, `MESSAGE_RECEIVED` only, the inbound message mapping, and the 200/401/404 rules. The parsing and signature check live in `src/adapters/textbee.ts`, beside the Messenger. Only that file knows textbee's format.

## Acceptance criteria

HTTP tests in a new `test/textbee-webhook.test.ts`, following `test/sms-webhook.test.ts`. Each one signs the body with the HMAC hex worked out once and pasted in as a literal.
- [x] A signed `MESSAGE_RECEIVED` from a Tenant's mobile to the connected number reaches that Agency's intake as an SMS from that mobile, and the Tenant gets intake's reply through textbee.
- [x] A wrong signature, a missing signature, and a body changed after signing are each 401 and store nothing.
- [x] Another event (`MESSAGE_SENT`) is 200 and stores nothing.
- [x] No Agency connected yet: 200, nothing stored.
- [x] The same `smsId` posted twice is stored once.
- [x] A text from `TEXTBEE_NUMBER` itself is 200 and stores nothing.
- [x] With textbee unset, the route is 404.
- [x] `npm run check` passes.
