# Jev classifies inbound messages, with Claude as the fallback, and checks for safety risks

## Why

The TypeSafe console shows no Jev usage from production, because production never calls Jev:

- **The classifier always uses Claude.** `src/demo/runtime.ts` picks `createClaudeClassifier` whenever `ANTHROPIC_API_KEY` is set, which it is. Jev only classifies when there's no Anthropic key.
- **The Trade suggester fell back to the keyword mock** because `JEV_API_URL` was unset. It is set now, and so is `JEV_API_KEY`. The startup log's "Real … / Mocked or off …" line never mentioned it.
- **`master`'s `src/adapters/jev.ts` speaks a contract guessed before TypeSafe published its API** (`/v1/classify`). The real `POST /v1/systemone` adapter, and instructions and criteria for every classifier question, are on the unpushed branch `jev-classifier` (commits `50a039d`, `4d1c50e`, `8daaad3`). That branch is 234 commits behind `dev`, so its work is **ported** onto this branch, not merged.

ADR 0011 already decided "Jev classifies inbound messages, Claude Haiku composes". This makes the code match it.

## Issues

1. `01-jev-classifies-with-claude-fallback.md`
2. `02-safety-check.md`, which comes after 01 on the same branch

## Ground rules

- Test-first, one vertical slice at a time, at the existing seams:
  - adapter tests with a stubbed fetch (`test/adapters/`)
  - intake scenarios through `test/support/harness.ts`
  - runtime and hosted tests (`test/demo/runtime.test.ts`, `test/hosted.test.ts`)
- Expected values come from worked examples. Never weaken an existing test.
- Before writing Jev code, read TypeSafe's live docs: <https://docs.typesafe.ai/api.md>, the choice and noul primitives (`/primitives/choice.md`, `/primitives/noul.md`) and `/confidence.md`. Follow them where the old branch differs.
- Only `src/adapters/jev.ts` knows TypeSafe's format. The API key never appears in an error.
- `npm run check` passes before an issue is marked resolved.
