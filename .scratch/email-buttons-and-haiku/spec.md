# Buttons on every email, and Haiku writes them

## Why

The Property Manager reviewed the emails each stakeholder gets.

- Some emails still ask for a typed reply: the Tenant's 1–5 rating, and the Property Owner's YES/NO approval. Every email that collects an answer should collect it with buttons.
- After a choice is made, its page should show the choice as confirmed, in green, with the other choices disabled.
- Raw web addresses show in emails: under every button, and inline in sentences. Links belong only inside buttons.
- The update emails read as stiff fixed text. Outbound emails should be written by Claude Haiku from the facts. The completion emails to the Tenant and Property Owner should say what was done, by whom, when and anything else known.

## Decisions (from the Property Manager, 2026-10-28)

1. **Page-based confirmed state first.** A sent email can't change in most mail clients. Each button opens a no-login page. Once the choice is saved, that page shows it in green and disables the other choices, and every button from that email shows the same state afterwards. Outlook Actionable Message cards, which can change inside Outlook, come after (issue 04).
2. **New button flows:** Tenant star rating, Property Owner approve/decline, and Property Owner "Mark as paid" for a Reimbursement Request. The Tenant's guided questions stay reply-by-text.
3. **Haiku composes every outbound email** except the verification code and the channel test. If the draft is missing any link, amount, time or button line, or Haiku fails, the template's text goes out unchanged. SMS and WhatsApp stay as templates.

## Rules every issue keeps

- **No GET changes anything.** Mail scanners open links. A button opens a page, and the page's POST saves the choice (ADR 0002, `src/web/pages/visit-confirm.ts`).
- **Replying by text still works** for everything that has a button now.
- **A button is a template line `<Label>: <url>`.** `src/email-layout.ts` draws it as a button. Plain-text email, SMS and WhatsApp keep the line as it is.
- The domain words in `CONTEXT.md` (Tenant, Property Owner, Work Order, Reimbursement Request, Firm Quote…) are used as written there.
- `npm run check` passes. Tailwind changes mean `npm run css` and a committed `src/web/static/tw.css`.

## Issues

1. `01-links-only-in-buttons-and-confirmed-pages.md`: no raw URLs in email HTML; a shared green confirmed state on every existing action page.
2. `02-rating-approval-and-paid-buttons.md`: the three new button flows. Blocked by 01.
3. `03-haiku-composes-every-email.md`: Haiku writes outbound emails with a template fallback, and completion emails carry an AI summary.
4. `04-outlook-actionable-cards.md`: Outlook cards whose buttons change in place. Blocked by 02, and by registering a sender with Microsoft.
