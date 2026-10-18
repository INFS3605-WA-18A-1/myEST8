# Light rail, page header in content, count sentence, docket, Needs you

Status: ready-for-agent
Owner: ui-agent
Spec: ../spec.md, Part 1 "Layout"

## Acceptance criteria

- [x] The rail is Gumleaf with Ironbark text and a 4px Wattle bar on the current item; collapse and drawer still work.
- [x] `page()` renders no separate top bar; the page header row (h1, date, Mine/All, user menu) sits in the content column.
- [x] `countSentence()` replaces `countStrip()`; `needsYou()` wraps the decision queue with the full-height Wattle bar.
- [x] Docket reads number, issue, address, stage; large variant at 40px.
- [x] Sections, tables and badges follow the spec sizes; `npm run typecheck` passes.
