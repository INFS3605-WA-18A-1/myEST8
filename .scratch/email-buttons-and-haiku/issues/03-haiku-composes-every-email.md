# Haiku composes every outbound email, with the template as the fallback

Status: ready-for-agent
Spec: ../spec.md

ADR 0011 decided that Claude Haiku composes what goes out ("Gap 3", not built). The `Composer` port (`src/ports.ts`, `ComposeInput` with `mustInclude`) and its Haiku adapter (`src/adapters/claude-composer.ts`) exist, and are used only for the Property Manager's follow-up (`src/tickets.ts`).

A local branch `haiku-composer` (commit `0ca11f8`) built this against an older `dev`. It is 282 commits behind and can't be merged. Read it for ideas (`git show 0ca11f8`): its `mustInclude` checks and fallback. Write against today's code.

## What to build

### 1. Compose in `notifications.deliver` (`src/notifications.ts`), email only
- For an email (`channelType === 'email'`) with `ports.composer` set, ask Haiku for the body. Pass:
  - the template name;
  - a plain-English purpose for each template;
  - the recipient's role;
  - the template's data as facts;
  - the template's text as the draft;
  - `untrustedFields` naming any facts that are another person's words: the Tenant's `description`, `message`, `issue` and `note`, and the like.
- **Never composed:** `onboarding.verification_code`, `onboarding.test_message`, and `tenant.follow_up` (the Property Manager's own words, already drafted). SMS and WhatsApp aren't composed either.
- **`mustInclude`:** derived in code from the template's text:
  - every `<Label>: <url>` button line, whole, so the renderer still makes the button;
  - every URL;
  - every dollar amount;
  - every visit time as the template formats it;
  - every phone number;
  - every "Reply …" instruction.
- **Checks:** the composed text is used only if it contains every `mustInclude` string verbatim, adds no URL, amount or phone number that isn't in the draft, and is under a sane length. Otherwise, or if Haiku throws or times out, send the template text and `console.error` one line with no message content.
- The subject stays the template's. The HTML is rendered from whichever text is sent, by the same `renderEmail`. Log the text actually sent (`logMessage`), and record whether it was composed (a boolean column is fine) so a Ticket's timeline can mark it as written by AI, as the follow-up does.

### 2. Completion emails carry the full story
`tenant.ticket_closed` and `owner.ticket_closed` (`tickets.closeTicket`) today say only the address. Give their data, from the data model:
- the issue's Summary;
- each done Job: Trade, the Tradie's business name, the date the visit was done, and the Firm Quote's scope of work (or the Estimate's description when the Job went ahead on an Estimate);
- for the Property Owner only: each Job's approved amount and the Ticket's Repair Cost;
- anything the Tradie recorded when marking the job done, if the data model stores it.

Rewrite the two templates' fixed text so the fallback reads well too. For example: "The plumbing repair at 12 King St is complete. Pete's Plumbing replaced the tap washer on Tue 27 Oct." The Owner's version adds the cost. With these facts, Haiku's version becomes a short summary of what was done, by whom and when.

Add the same facts (Tradie, scope of work, done date) to `tenant.fixed_properly`'s data. Change only its data and the opening sentence: issue 02 adds its rating buttons.

### 3. Wiring and tests
- `src/demo/runtime.ts` already builds the composer when `ANTHROPIC_API_KEY` is set. Use the same composer for outbound emails.
- **Tests must not churn.** `FakeComposer` (`test/support/fakes.ts`) answers `Composed: <draft>`, which follow-up tests rely on. For outbound emails, the harness must by default send exactly the template text, so the many existing assertions on sent text stay as they are. A test opts in to composing.
- `ADR 0011`: mark Gap 3 done, with what is and isn't composed. `docs/adr/0008`: note that email prose may now come from Haiku within these checks.

## Acceptance criteria
- [ ] Tests:
  - a composed email that keeps every `mustInclude` string is sent, and its HTML still has its buttons;
  - a draft missing a button line, URL, amount or time falls back to the template;
  - one that adds a URL or amount falls back;
  - a composer error falls back;
  - SMS and WhatsApp are never composed;
  - the excluded templates are never composed;
  - untrusted facts are passed as untrusted.
- [ ] Tests that `tenant.ticket_closed` and `owner.ticket_closed` carry the Job facts above, and that only the Owner's carries amounts.
- [ ] A test of `src/adapters/claude-composer.ts` is unchanged or extended, never weakened.
- [ ] `npm run check` passes.
