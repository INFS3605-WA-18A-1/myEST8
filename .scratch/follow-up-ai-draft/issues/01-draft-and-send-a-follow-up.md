# Draft and send a follow-up (actions and wiring)

Status: ready-for-agent
Spec: ../spec.md

## What to build

- **Wire the Composer** into `Ports` (`src/context.ts`) as `composer: Composer | null`.
  - `src/demo/runtime.ts` builds `createClaudeComposer` when `ANTHROPIC_API_KEY` is set. Otherwise it uses a small mock composer for the demo and the tests, in the same way the summariser has `mockSummariser`.
  - The mock must make it obvious the text is a draft from notes, for example "Hi <name>,\n\n<notes>\n\n<agency>".
  - The test harness gets a fake composer that tests can make return text or throw.
- **The template** `tenant.follow_up` in `src/templates.ts`: subject "About your maintenance request", body exactly the text given.
- **Two Property Manager actions** in `src/app.ts`, implemented in the module that owns Maintenance Requests or notifications. Read the code to decide which; don't put logic in `app.ts`.
  - `draftFollowUp(issueId, notes)` returns `{ text, byAI: boolean }`. It refuses blank notes, notes over 1000 characters, and an issue that isn't this Agency's or isn't a Maintenance Request still in intake (`IN_INTAKE` in `src/tickets.ts`), using the usual `ActionError`/`invalid` with a field name. It falls back to the notes with `byAI: false` when the composer is null or throws, and never throws because of the composer.
  - `sendFollowUp(issueId, text)` refuses blank text, text over 4000 characters, and the same issues. It sends `tenant.follow_up` to the Tenant through `modules.notifications.send(..., { issueId })`, so the usual channel choice, logging and delivery handling apply. It returns the Tenant's name.

## Acceptance criteria

- [ ] Tests (follow the style of the existing module and `test/` tests):
  - the draft comes from the composer with the facts, untrusted fields and draft from the spec (asserted on the fake)
  - the composer missing or throwing gives the notes back with `byAI: false`
  - blank, too-long and wrong-Agency inputs are refused, and so is an issue that isn't in intake
  - sending reaches the Tenant on their channel with the template's subject, and is logged against the issue
- [ ] `npm run check` passes.
