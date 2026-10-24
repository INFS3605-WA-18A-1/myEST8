# Jev classifies, with Claude as the fallback

Status: ready-for-agent
Spec: ../spec.md

## What to build

- **Port the System One adapter.** Replace `src/adapters/jev.ts` with the System One version from `git show jev-classifier:src/adapters/jev.ts`:
  - `POST {baseUrl}/v1/systemone`, `authorization: Bearer`, model `jev-latest`
  - `choice` questions, with `safeNames` for ids like `answer:guided`
  - answers read with confidence
  - key redaction

  Keep it compatible with dev's `Classifier` port and its current callers. Dev has moved on (missing-details extraction, shared addresses, visit and approval answers), so check every question intake asks today.
- **Port the question instructions and criteria** from `jev-classifier`'s commit `4d1c50e`, "Write instructions and criteria for every classifier question". Each option says when it applies, and Jev's `choice` needs that. Write instructions and criteria for any question dev added since, so every question intake asks has them. Claude's adapter keeps working with the richer questions: it can use them in its tool schema descriptions, or ignore them.
- **Don't drop the Claude classifier.** That branch's last commit, `8daaad3`, removed it; don't port that. Instead:
  - **Choosing:** with `JEV_API_URL` set, the classifier is **Jev, with Claude as the fallback.** A small classifier wrapper tries Jev, and on a thrown error (outage, malformed answer, 4xx/5xx) logs it with `console.error`, key redacted, and asks Claude instead. With no `JEV_API_URL` but an Anthropic key, it's Claude as today. With neither, it's the mock as today.
  - **The startup log:** the hosted "[hosted] Real: … Mocked or off: …" line, and the demo's, names the classifier as "classifier (Jev, Claude fallback)" or similar, and lists the **Trade suggester** as real or mock.
  - **The setting check:** `JEV_API_URL` without `JEV_API_KEY` is reported as missing (the existing check, around `runtime.ts:91`).
- **The mock** (`src/demo/mock-classifier.ts`) and `src/demo/mock-apis.ts`'s `/jev/v1/classify` route: the demo's mock Jev must speak `/v1/systemone` now. Keep the demo stories working.
- **Docs:** ADR 0011's "not built yet" gaps 1 and 2 are marked done. `docs/channels-setup.md` §4 says Jev is used when `JEV_API_URL` is set, with Claude as the fallback.

## Acceptance criteria

- [ ] Adapter tests:
  - the System One request (model, state, choice questions with criteria, bearer key, a safe name for `answer:guided`)
  - answers mapped back to the original ids with confidence
  - an unknown option or a missing answer gives confidence 0
  - a malformed answer throws
  - the key never appears in an error
- [ ] Wrapper tests: Jev answers are used, and Jev throwing falls back to Claude's answers and logs.
- [ ] Runtime and hosted tests:
  - `JEV_API_URL` plus an Anthropic key gives the Jev-with-fallback classifier, named so in the startup log
  - the Trade suggester is listed as real with `JEV_API_URL`, and as mock without it
  - `JEV_API_URL` without `JEV_API_KEY` is reported missing
- [ ] Every existing intake scenario passes against the mock.
- [ ] `npm run check` passes.
