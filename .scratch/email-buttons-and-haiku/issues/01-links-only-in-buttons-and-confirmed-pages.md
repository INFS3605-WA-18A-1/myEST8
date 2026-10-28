# Links only in buttons, and a green confirmed state on every action page

Status: ready-for-agent
Spec: ../spec.md

## What to build

### 1. No raw web address in any email's HTML (`src/email-layout.ts`)
- `button()` prints the URL as text under each button. Remove that line. The button's `href` is the only place the address appears.
- `inline()` turns a URL inside a sentence into underlined address text. A URL must never show as text. Every URL in a template becomes a button:
  - A line ending `<sentence>: <url>` or `<sentence> here: <url>`, as `tenant.upload_link`, `tenant.confirmed` and `tenant.urgent_repair_reminder` do, renders the sentence as a paragraph and the URL as a button. The button is labelled by the existing `buttonLabel` rules.
  - A URL in the middle of a sentence: change the template so the URL sits on its own `<Label>: <url>` line instead.
- Go through every template in `src/templates.ts` that carries a link. Each must end up with every URL in a button whose label says what it does. "Open link" must never be a label: add a `BUTTON_LABELS` rule, or give the template a `<Label>: <url>` line.
- Plain-text email bodies, SMS and WhatsApp keep their URLs as text (they have no buttons). Only the HTML changes.

### 2. A green confirmed state on every existing action page
Pages a button opens:
- `/v/:token` (`visit-offer.ts`): book a visit time, none of these work, another time.
- `/v/confirm/:token` (`visit-confirm.ts`): confirm a visit, another time.
- `/q/:token/decline`, `/q/:token/done`, `/q/:token/another`, `/q/:token/inspection-done`, `/q/:token/inspection-another` (`quote-form.ts`).

Once the choice is saved, the page shows it in a green confirmed block. Reuse `.tenant-done` (`role="status"`, `src/web/static/tenant.css`; `doneBox` in `src/web/tenant-pages.ts`), and make it one shared helper in `src/web/ui.ts` that every page uses. Examples:
- "✓ Confirmed: Mon 16 Nov, 9:00 am"
- "✓ Booked: Mon 16 Nov, 9:00 am"
- "✓ Marked done on Tue 27 Oct"

The choices that no longer apply show disabled, not removed. For example, the other offered times appear as disabled buttons, and "Need another time?" stays enabled only where asking is still allowed. Any button from that email opened later shows the same confirmed state. For example, opening `pick=2` after `pick=1` was booked shows "Booked: <time of pick 1>", with the `pick=2` time disabled.

## Acceptance criteria
- [ ] `test/email-layout.test.ts`: no rendered email contains an `http` URL as text. Each URL in the text is an `<a>` inside a button cell. A sentence ending `here: <url>` renders as paragraph then button.
- [ ] A test that renders every template in `templates` with sample data and asserts: no visible URL text in the HTML, and no "Open link" label.
- [ ] Web tests: each page above shows the green confirmed block after its POST, and again on a later GET of any of the email's links. Already-chosen options render `disabled`. GETs still change nothing.
- [ ] The existing e2e specs that read these pages still pass. Update their expectations where the visible wording changed.
- [ ] `docs/design-system.md` (Emails): links only in buttons; the confirmed state.
- [ ] `npm run check` passes.
