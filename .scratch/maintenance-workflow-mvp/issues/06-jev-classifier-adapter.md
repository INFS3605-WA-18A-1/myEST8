# Classifier adapter for Jev

Status: ready-for-human

## Goal

A real `Classifier` (`src/ports.ts`) backed by Jev (TypeSafe AI): one call per inbound message that answers typed questions with confidence scores.

## What exists

- `Classifier.classify({ text, state, questions })` returns one `{ answer, confidence }` per question id; every answer must be one of the question's options.
- `src/intake.ts` builds the questions per sender role (message class, related item, Urgency, Trade, update type, the answer it is waiting for; reply type for Tradies and Property Owners) and applies the 0.7 threshold (`src/shared.ts` `DEFAULT_SETTINGS`).
- Tests use `FakeClassifier`.

## Acceptance criteria

- [ ] Adapter maps `text` + `state` to Jev's JSON state and each question to a typed question with fixed answers.
- [ ] An answer outside the options, or a missing answer, is returned with confidence 0 so intake sends the message to the inbox.
- [ ] Jev errors and rate limits are thrown so the worker retries.
- [ ] Nothing outside the adapter depends on Jev's API shape.

## Needs a human

- Jev early-access credentials and usage limits (in limited early access since 15 September 2026). Decide the fallback model if access or limits change during the build; the port makes the swap local to the adapter.

## Testing

- Adapter tests against recorded Jev responses with a stubbed `fetch`. Manual demo checklist for the live service.
