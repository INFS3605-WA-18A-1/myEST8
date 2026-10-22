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

### What the renderer is given

Every template is one plain string, so the renderer works from these shapes (read from `src/templates.ts`):

- One paragraph ending in a link after a colon: `...straight from your phone: https://…` (`tenant.upload_link`, `tenant.confirmed`, `tenant.urgent_repair_reminder`, `tradie.firm_quote_*`).
- A link in the middle, followed by more sentences: `tradie.quote_request` (`...(your fixed price): https://… Or reply with a ballpark price...`).
- Numbered questions on their own lines, from issue 01: `1. Is it getting worse? (yes or no)`.
- Free text from a person (`tenant.follow_up`, `description`, `message`) that can hold `<`, `&`, quotes and a link inside a sentence.
- One line, no link (`tenant.acknowledgement`, `onboarding.verification_code`).

### Tokens (from `docs/design-system.md`, copied as hex because email can't use CSS variables)

| Role | Token | Hex | Used for | Contrast |
|---|---|---|---|---|
| Page | Sand `--page` | `#F4EFE6` | Behind the card and the footer | Slate on it 5.4:1 |
| Card | `--surface` | `#FFFFFF` | The message | |
| Text | Night `--ink` | `#13212E` | Body, the header band | 16.4:1 on white; white on Night 16.4:1 |
| Secondary | Slate `--muted` | `#55636F` | Footer, the URL under a button | 6.2:1 on white, 5.4:1 on Sand |
| Action | Harbour `--action` | `#1F5C8B` | The button, links | white on it 7.1:1; as text 7.1:1 on white |
| Edge | Line `--line` | `#D8DEE4` | Card border | decorative |
| Decision | Wattle `--hivis` | `#FFC233` | A 4px left edge on what needs the Tenant: the numbered questions and the button | Never text, never a button fill |

Radius 8px on the card, 6px on the button (the design system's section and button radii). Spacing steps 8, 16, 24, 32.

### Type

System stack only: `-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Bricolage Grotesque and Public Sans won't load in most clients, so the voice comes from weight and size instead: the Agency's name 20px 700 on Night; body 16px / 1.5 regular Night; the button 16px 600; the URL under it and the footer 13px. Sentence case everywhere, no all-caps, no letter-spacing.

### Wireframe

```
 Sand ──────────────────────────────────────────────────────────────────
 │           ┌──────────────────────────────────────────┐  600px max,   │
 │           │ Harbour Realty                           │  fluid below  │
 │           │ (Night band, white 20px bold)            │               │
 │           ├──────────────────────────────────────────┤               │
 │           │ white card, 32px top, 24px sides         │               │
 │           │                                          │               │
 │           │ Hi Kevin, this is Harbour Realty. Thanks │  paragraphs   │
 │           │ for letting us know about an issue ...   │               │
 │           │                                          │               │
 │           │ ▌1. Is it getting worse? (yes or no)     │  Wattle 4px   │
 │           │ ▌2. When are you usually home: ...       │  left edge    │
 │           │                                          │               │
 │           │ ▌[ Upload photos ]                       │  Harbour      │
 │           │ ▌https://myest8.test/upload/abc…         │  button, URL  │
 │           │                                          │  in Slate     │
 │           └──────────────────────────────────────────┘               │
 │           Reply to this email to answer or ask a question.           │  Slate 13px
 │           Sent through myEST8                                        │  on Sand
 └─────────────────────────────────────────────────────────────────────
```

### Alignment

Everything is left-aligned on one inset: the Agency's name, paragraphs, list, button, URL and footer. An action block's Wattle edge sits in the card's 24px inset, with its content 16px in from the edge, so action text lines up with the paragraphs above and below it rather than stepping in. No centred text and no centred button. The column is `max-width: 600px; width: 100%`, so at 375px the card is the screen less 16px of Sand each side, with the same inset. Nothing is two columns, so nothing needs a media query.

### What makes it this product's email

- **The Agency heads it, myEST8 is the footer.** The Tenant hears from Harbour Realty, as in the app's tenant pages ("the bar names the Agency"). myEST8 is the quiet "Sent through myEST8" line.
- **Night, Sand and Harbour.** The Night band is the rail and sign-in panel; Sand is the page behind every section; the white card is a section with its 1px Line border.
- **Wattle means "this needs you".** Same meaning as the Wattle edge on a dashboard row in "Needs your attention": an email that asks the Tenant to do something (answer the numbered questions, open the link) marks that block with a 4px Wattle left edge. An acknowledgement asks for nothing, so it has none. A generic transactional email puts its brand colour on a hero bar or a rounded pill whatever it says.
- **Harbour means act.** The only Harbour fill is the button, and its label is a verb that says what happens ("Upload photos", "Give your quote"), never "Click here" or an arrow.
- **Plain, not decorated.** No hero image, no logo image, no social row, no all-caps. The email reads like the text it came from, set well.

### Checked against the design system

- Colours are only the documented tokens. Wattle is never text or a button; it is an edge on white. Every text pair is one measured above (all AA, most AAA).
- Radii 8 and 6, spacing from the scale, sentence case, no middle dots or arrows on labels.
- Touch target: the button is 44px tall (12px padding, 20px line).
- It differs from the app in three allowed ways: hex values instead of variables (email can't resolve `var()`), the system stack instead of the two brand fonts, and a Night band with the Agency's name where the app has the logo (no images, per the spec). The "Emails" section of the design system records this, and a test keeps the hex values equal to the tokens in `app.css`.
- Dark mode: every cell sets its own background and text colour and the page declares `color-scheme: light`, so a client that darkens doesn't leave white text on a transparent background.

### Rules the renderer follows

- A **URL becomes a button** when it is alone in its paragraph, ends it, or follows a colon or the end of a sentence. A URL in the middle of a sentence stays an inline link.
- The **label** comes from the sentence the link finishes: receipt gives "Upload receipt", quote or Estimate gives "Give your quote", photos gives "Upload photos", progress gives "Follow progress", otherwise "Open link". The URL is always shown as text under the button too.
- Text after a link in the same paragraph ("Or reply with...") is its own paragraph under the button.
- A single line break inside a paragraph is a `<br>`.
