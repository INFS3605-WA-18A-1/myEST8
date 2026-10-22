# Branded HTML emails

Status: ready-for-agent
Spec: ../spec.md (section 2)

## What to build

Section 2 of the spec: `src/email-layout.ts` (`renderEmail`), the optional `html` on `OutboundMessage`, `notifications` setting it for email only, and the Resend and SendGrid mailers sending `html` with `text`.

Write the `## Design plan` below before building, render the three sample emails to PNG, look at them, and fix what's off.

Don't touch `src/intake.ts` or the guided questions: issue 01 does those, in another worktree.

## Acceptance criteria

- [ ] Renderer tests (`test/email-layout.test.ts`), each against a worked example:
  - the Agency's name in the header
  - paragraphs from blank lines
  - `1.`/`2.` lines as an ordered list
  - a URL as a button and also as visible text
  - `<script>` and `&` in the text escaped
  - the preheader is the first sentence
  - `lang="en-AU"`
- [ ] Mailer tests:
  - Resend's and SendGrid's request bodies carry `html` and `text`
  - a message without `html` sends as before
- [ ] Notification test: an email send has `html` from the renderer, and an SMS send has none.
- [ ] `docs/design-system.md` gets a short "Emails" section with the layout and tokens.
- [ ] `npm run check` passes.

## Design plan

(Written by the implementer before building.)
