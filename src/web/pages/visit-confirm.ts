// The Tenant's no-login page at /v/confirm/:token, linked from a visit the Property
// Manager booked or moved. Opening the link, including one a mail scanner fetches,
// only shows the page. Confirming, or asking for another time, is the button's POST.
// Once one is saved, both links from the email show it.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import { text } from '../forms.ts';
import { alert, button, card, doneBox, publicPage, type Html } from '../ui.ts';
import { formatVisit, formatVisitDay } from '../../zoned-time.ts';

const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;

type Visit = NonNullable<Awaited<ReturnType<App['visitConfirmation']>>>;

/** GET /v/confirm/:token shows the visit. POST confirms it, or asks for another time. */
export function visitConfirmPages(app: App) {
  const pages = new Hono();

  pages.get('/v/confirm/:token', async (c) => {
    const page = await app.visitConfirmation(c.req.param('token'));
    if (!page) return c.html(missingLink(), 404);
    return c.html(confirmPage(c.req.param('token'), page, c.req.query('another') === '1'));
  });

  pages.post('/v/confirm/:token', async (c) => {
    const token = c.req.param('token');
    const action = text(await c.req.parseBody(), 'action');
    try {
      if (action === 'another') await app.askToMoveVisit(token);
      else await app.confirmBookedVisit(token);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      if (error.code === 'not_found') return c.html(missingLink(), 404);
      const page = await app.visitConfirmation(token);
      if (!page) return c.html(missingLink(), 404);
      return c.html(confirmPage(token, page, action === 'another', error.message), STATUS[error.code]);
    }
    // What was saved is the page's state now, so both links from the email show it.
    return c.redirect(`/v/confirm/${encodeURIComponent(token)}${action === 'another' ? '?another=1' : ''}`, 303);
  });

  return pages;
}

function missingLink(): Html {
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    title: "This link isn't right",
    body: html`<p>Check you opened the whole link from the message we sent you.</p>
      <p>If it still doesn't work, reply to that message and ask for a new link.</p>`,
  });
}

/**
 * Before the Tenant answers, the link's own button: Confirm, or Need another time?.
 * Once they have (or the visit is done or cancelled), both links show the answer in
 * green and both buttons, disabled where they no longer apply.
 */
function confirmPage(token: string, page: Visit, another: boolean, error?: string): Html {
  const when = formatVisitDay(page.start, page.timeZone);
  const open = page.status === 'active';
  const asked = open && page.rescheduleRequestedBy === 'tenant';
  const confirmed = open && page.visitConfirmed;
  const settled = !open || asked || confirmed;
  const canConfirm = open && !page.visitConfirmed && !asked;
  const canAsk = open && !page.rescheduleRequestedBy;
  const title = !open ? 'Visit time' : asked ? 'Another time' : confirmed ? 'Visit confirmed' : another ? 'Need another time?' : 'Confirm this visit';
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    width: 'narrow',
    brand: page.agencyName,
    title,
    footer: `Questions? Reply to any message from ${page.agencyName}.`,
    body: html`${error ? alert(error, 'error') : ''}
      ${asked ? doneBox('Asked for another time') : confirmed ? doneBox(`Confirmed: ${formatVisit(page.start, page.timeZone)}`) : ''}
      ${card({
        body: html`${stateLine(page, when, another)}
          ${settled || !another ? actionButton(token, 'confirm', `Confirm ${when}`, canConfirm) : ''}
          ${settled || another ? actionButton(token, 'another', 'Need another time?', canAsk) : ''}`,
      })}`,
  });
}

/** One of the email's two choices: a form that posts it, or the same button disabled once it no longer applies. */
function actionButton(token: string, action: 'confirm' | 'another', label: string, enabled: boolean): Html {
  const variant = action === 'another' ? 'secondary' : 'primary';
  if (!enabled) return html`<div class="tenant-buttons">${button(label, { block: true, variant, disabled: true, type: 'button' })}</div>`;
  return html`<form method="post" action="/v/confirm/${encodeURIComponent(token)}" class="tenant-form">
    <input type="hidden" name="action" value="${action}" />
    ${button(label, { block: true, variant })}
  </form>`;
}

/** What the visit is now. A moved visit names the current time, not the one in an old message. */
function stateLine(page: Visit, when: string, another: boolean): Html {
  if (page.status === 'cancelled') return html`<p>This visit is cancelled.</p>`;
  if (page.status === 'done') return html`<p>This visit is done. It was booked for ${when}.</p>`;
  if (page.rescheduleRequestedBy === 'tenant') {
    return page.kind === 'inspection'
      ? html`<p>We've noted that you need another time. This visit stays booked for ${when} until it moves.</p>`
      : html`<p>We'll ask ${page.tradieBusinessName} for other times. This visit stays booked for ${when} until you pick a new one.</p>`;
  }
  if (page.visitConfirmed) return html`<p>${page.tradieBusinessName} will visit ${page.address} on ${when}.</p>`;
  if (another) return html`<p>${page.tradieBusinessName} is booked to visit ${page.address} on ${when}.</p>`;
  return html`<p>${page.tradieBusinessName} will visit ${page.address}.</p>`;
}
