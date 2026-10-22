# Ask only what's missing

Status: ready-for-agent
Spec: ../spec.md (section 1)

## What to build

Section 1 of the spec: the `DetailExtractor` port and its Claude Haiku adapter and mock, the new intake flow (extract on arrival, one `tenant.missing_details` message listing only the missing questions, extract from the reply, stop after a reply that adds nothing), handling of issues already waiting on one guided question, and ADR 0014.

Don't touch the email renderer, the mailers or `OutboundMessage`: issue 02 does those, in another worktree.

## Acceptance criteria

- [ ] Intake scenario tests:
  - a first message that states where and when ("Last night the kitchen sink broke…"), with a fake extractor returning those two: the issue has `location` and `started`, and the Tenant gets one `tenant.missing_details` message asking only about worsening and availability
  - a first message that answers all four goes straight on (no questions; photo request or checking as today)
  - the reply "yes, getting worse, I'm home any time" fills `worsening` and `availability`, and intake goes on
  - a reply that answers one of two missing asks again for only the other
  - a reply that answers nothing: intake goes on without asking a third time
  - the extractor throwing asks all four in one message
  - an issue already waiting on `kind: 'guided'` (`location`) takes the reply through the new logic and asks once for what's still missing
- [ ] Adapter tests (`test/adapters/claude-extractor.test.ts`):
  - the request (model, the Tenant's text as untrusted data, JSON-only instruction)
  - reading a valid answer
  - unknown keys, bad enums, empty and over-long strings, and keys not `wanted` all dropped
  - malformed JSON throws
  - the key never in an error
- [ ] ADR 0014 written, and ADR 0011 notes it's amended.
- [ ] `npm run check` passes.
