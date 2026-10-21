# Classifier adapter for Jev

Status: ready-for-agent

## Goal

A real `Classifier` (`src/ports.ts`) backed by Jev (TypeSafe AI): one call per inbound message that answers typed questions with confidence scores.

## What exists

- `Classifier.classify({ text, state, questions })` returns one `{ answer, confidence }` per question id; every answer must be one of the question's options.
- `src/intake.ts` builds the questions per sender role (message class, related item, Urgency, Trade, update type, the answer it is waiting for; reply type for Tradies and Property Owners) and applies the 0.7 threshold (`src/shared.ts` `DEFAULT_SETTINGS`).
- Tests use `FakeClassifier`.

## Acceptance criteria

- [x] Adapter maps `text` + `state` to Jev's JSON state and each question to a typed question with fixed answers.
- [x] An answer outside the options, or a missing answer, is returned with confidence 0 so intake sends the message to the inbox.
- [x] Jev errors and rate limits are thrown so the worker retries.
- [x] Nothing outside the adapter depends on Jev's API shape.

## Needs a human

- Jev early-access credentials and usage limits (in limited early access since 15 September 2026). Decide the fallback model if access or limits change during the build; the port makes the swap local to the adapter.

## Testing

- Adapter tests against recorded Jev responses with a stubbed `fetch`. Manual demo checklist for the live service.

## Comments

**2026-10-21:** Reopened. The adapter was built against a contract guessed before TypeSafe published its API (`POST /v1/classify`, an `options` list, a list of answers). The real API is `POST https://api.typesafe.ai/v1/systemone`. It takes `model` (e.g. `jev-latest`) and a `questions` map. Each `choice` question has a `criteria` map, and answers come back keyed by question name with `choice`, `confidence` and `probabilities` (https://docs.typesafe.ai/api.md). [ADR 0011](../../../docs/adr/0011-jev-classifies-haiku-composes.md) also makes Jev *the* classifier: Claude Haiku stops classifying and composes outbound messages instead. New acceptance:

- [ ] `jev.ts` speaks `/v1/systemone` with a `model`, and maps each `ClassifierQuestion` to a `choice` question (criteria from its options).
- [ ] An unanswered question, or an answer outside the options, still comes back with confidence 0.
- [ ] The demo's mock Jev (`src/demo/mock-apis.ts`) speaks the same contract.
- [ ] `src/demo/runtime.ts` uses Jev as the classifier whenever `JEV_API_URL` is set, regardless of `ANTHROPIC_API_KEY`.
