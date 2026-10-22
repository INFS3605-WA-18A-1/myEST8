# Ask only what's missing, and branded emails

Two changes to what a Tenant experiences after reporting a repair.

## 1. Ask only what's missing (issue 01)

**Today.** When a Tenant reports a new issue, intake (`startIssue`, `askGuidedQuestion`, `handleAnswer` and `finishGuidedQuestions` in `src/intake.ts`) sends the four guided questions **one message at a time**, in a fixed order: `location`, `started`, `worsening`, `availability` (`GUIDED_QUESTIONS` in `src/templates.ts`). It never notices that the Tenant's first message often already answers some of them ("Last night the kitchen sink broke…" answers where and when). Over email that's four round trips.

**Now.**
1. When a new issue starts, an **extractor** (Claude Haiku) reads the Tenant's message and returns any of the four details it states:
   - `location` and `started`: short text in the Tenant's words
   - `worsening`: `yes` or `no`
   - `availability`: one of `AVAILABILITY` in `src/shared.ts`

   It leaves out anything not clearly stated. What it finds is saved on the issue (`updateIssue`), and `availability` is also saved with `profiles.setAvailability`, as `handleAnswer` does today.
2. If nothing is missing, intake goes straight on (`finishGuidedQuestions`).
3. If some are missing, intake sends **one** message, template `tenant.missing_details`, subject "A few quick questions". It lists only the missing questions, numbered, in the usual order, with their reply hints. For example: "Thanks, Kevin. To get this sorted we just need: 1. Is it getting worse? (yes or no) 2. When are you usually home: weekday mornings, weekday afternoons, Saturdays or any time?" It then waits for a reply to those questions.
4. **The reply.** The usual classifier gate decides whether a message is an answer (as `answer:guided` does now). If it is, the extractor reads it for the still-missing questions, saves what it finds and works out what's left.
   - Nothing left: go on.
   - Something left and the reply added at least one answer: ask again for only what's left.
   - The reply added nothing: go on without the rest, so the Tenant is never asked the same thing a third time. The Property Manager sees the blanks.
5. **When the extractor fails** (throws, or no `ANTHROPIC_API_KEY` outside the demo), it's treated as finding nothing: all four questions in one message. Intake never stops because of it.
6. **Requests already waiting.** Some issues in production are already waiting on a single guided question (`kind: 'guided'` awaiting rows, for example issue #1 waiting on `location`). A reply to one of those is handled by the new logic: extract, save, ask once for whatever is still missing. They don't fall back into the old one-at-a-time chain.
7. Everything after (photos, the 48-hour no-photos task, Summary, Urgent Repairs) is unchanged.

**The extractor** is a new port, `DetailExtractor`:

```
extract({ text, wanted: GuidedQuestion[], issue: { description } }) →
  Partial<{ location: string; started: string; worsening: 'yes' | 'no'; availability: Availability }>
```

- `src/adapters/claude-extractor.ts` uses Claude Haiku (`claude-haiku-5-5`, the model `claude-composer.ts` uses) through the Messages API, asking for JSON only.
- The Tenant's text goes in as **data, never instructions** (follow `claude-composer.ts`'s `untrusted` handling and its system prompt).
- It validates every value: unknown keys dropped, enums checked, strings trimmed, at most 120 characters, empty strings dropped. Only `wanted` keys come back.
- Errors never contain the API key, and there's a short timeout.
- Wiring follows the Composer: real with `ANTHROPIC_API_KEY`, a small keyword mock in the demo and tests, and `null` (treated as "found nothing") hosted without a key.
- This amends ADR 0011, which gave Jev the classifying. Write `docs/adr/0014-haiku-extracts-guided-answers.md`, a short ADR. Haiku extracts because the answers are free text in the Tenant's words, and production has an Anthropic key and no Jev.

## 2. Branded HTML emails (issue 02)

**Today.** Every email is plain text (`text` only, `src/adapters/resend-mailer.ts`; `src/adapters/sendgrid-mailer.ts` the same).

**Now.** Every email myEST8 sends gets an HTML body with a plain-text alternative, the same text as today.
- **One renderer,** `src/email-layout.ts`: `renderEmail({ agencyName, subject, text }) → html`. It builds the email from the template's plain text, so all templates are covered at once with no per-template HTML:
  - paragraphs from blank-line breaks
  - lines starting `1.`, `2.` … as an ordered list
  - a URL on its own, or ending a sentence, as a button labelled by what it does where the template's wording makes that clear ("Upload photos", "Give your quote"), otherwise "Open link", with the URL also shown as text under it
  - everything else HTML-escaped
- `OutboundMessage` (`src/ports.ts`) gets an optional `html`. `notifications.send` (and the verification-code send) sets it for the email channel only. The Resend and SendGrid mailers send `html` with `text`.

**Design.** It follows the product's identity in `docs/design-system.md` (Harbour `#1F5C8B` for actions, Wattle `#FFC233` as the one accent, Sand `#F4EFE6` behind, Slate `#55636F` for secondary text), within what email clients support.
- Table layout, 600 px wide and fluid below that, inline styles only, no external CSS or web fonts. Use a system sans-serif stack: the brand fonts won't load in most clients.
- No images needed. The Agency's name, set as text, heads the email: the Tenant hears from their Agency, and myEST8 is the quiet "sent through myEST8" in the footer.
- A short hidden preheader (the first sentence) for inbox previews.
- `lang="en-AU"`, `role="presentation"` on layout tables, 16 px body text, enough contrast, and buttons as real links.
- It looks right in light mode and doesn't break in dark mode (no white text on transparent backgrounds).
- The footer says how to reply: "Reply to this email to answer" for emails that expect an answer, "Questions? Reply to this email" otherwise. Keep it simple: one footer line works for both.

Before building, write the design plan into issue 02 under `## Design plan`: tokens, an ASCII wireframe, what makes it this product's rather than a generic transactional email. Check it against the design system. Then render three real emails to PNG with Playwright (`.screenshots/email/`, not committed): the acknowledgement, the missing-details questions, and the photo upload link. Look at them and fix what's off.

## Test seams (agreed, the repo's existing ones)

- **Intake scenarios** through the test harness (`test/support/harness.ts`: `h.receive`, `h.answer`), as the existing intake tests do: what the Tenant is sent and what's saved on the issue.
- **Adapter tests** (`test/adapters/`, stubbed fetch): the extractor's request and how its answer is read and validated, and the mailers' request bodies.
- **The renderer** as a unit, from template text to HTML: escaping, lists, buttons, the Agency name.

Test-first, one vertical slice at a time, with expected values from worked examples. Existing intake tests that walk the one-at-a-time flow are updated to the new flow, keeping what each one checks. Update `test/support/harness.ts` helpers so scenarios stay readable. Never weaken an assertion to make a test pass.

## Non-goals

- Changing the photo request, the Summary or Urgent Repair handling.
- Making SMS or WhatsApp texts HTML: they stay plain, and `tenant.missing_details` works as a text too.
- Per-Agency logos or colours.
- Composing emails with Haiku (only the follow-up from #33 is composed).
