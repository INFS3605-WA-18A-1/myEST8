# Send SMS through textbee

Status: ready-for-agent
Spec: ../spec.md

## What to build

- `src/adapters/textbee.ts` with the textbee Messenger, as the spec's Sending section says.
- `messengersFromEnv` (`src/adapters/messenger.ts`) reads the four `TEXTBEE_*` variables (all or none) and `TEXTBEE_API_URL`. With textbee set, it's the SMS Messenger and takes over from Twilio, with a log line saying so.
- `src/demo/runtime.ts`: with textbee set, the Twilio number-per-Agency setup isn't built or offered, even when `TOKEN_ENCRYPTION_KEY` is set. Hosted mode no longer lists SMS as unavailable. Keep any "which number does textbee own" knowledge in one place, for issues 02 and 03 to use, for example a small `textbee` config object the runtime passes on.

## Acceptance criteria

- [ ] Adapter tests:
  - the request (URL, method, `x-api-key`, body) for one text
  - a text with an attachment carries its signed link
  - a refused number and a server error are classified like Twilio's
  - the key never appears in an error
- [ ] Runtime and hosted tests:
  - a partial `TEXTBEE_*` set refuses to start, naming what's missing
  - with all four set, SMS goes through textbee, not Twilio and not the simulator
  - with all four set plus `TOKEN_ENCRYPTION_KEY`, the Twilio number panel isn't offered
  - hosted with textbee doesn't list SMS as unavailable
- [ ] `npm run check` passes.
