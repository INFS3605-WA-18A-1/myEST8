// The Tenant's no-login page at /v/confirm/:token, linked from a visit the Property
// Manager booked or moved. Opening the link, including one a mail scanner fetches,
// only shows the page. Confirming, or asking for another time, is the button's POST.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import { text } from '../forms.ts';
import { alert, button, card, publicPage, type Html } from '../ui.ts';
import { formatVisitDay } from '../../zoned-time.ts';

const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;

type Visit = NonNullable<Awaited<ReturnType<App['visitConfirmation']>>>;

/** GET /v/confirm/:token shows the visit. POST confirms it, or asks for another time. */
export function visitConfirmPages(app: App) {
  const pages = new Hono();

  pages.get('/v/confirm/:token', async (c) => {
    const page = await app.visitConfirmation(c.req.param('token'));
    if (!page) return c.html(missingLink(), 404);
    return c.html(confirmPage(c.req.param('token'), page, c.req.query('another') === '1', c.req.query('asked') === '1'));
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
      return c.html(confirmPage(token, page, action === 'another', false, error.message), STATUS[error.code]);
    }
    const next = action === 'another' ? `/v/confirm/${encodeURIComponent(token)}?asked=1` : `/v/confirm/${encodeURIComponent(token)}?confirmed=1`;
    return c.redirect(next, 303);
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

function confirmPage(token: string, page: Visit, another: boolean, asked: boolean, error?: string): Html {
  const when = formatVisitDay(page.start, page.timeZone);
  const open = page.status === 'active';
  const confirming = open && !page.visitConfirmed && !another;
  const title = !open ? 'Visit time' : another ? (asked ? 'Another time' : 'Need another time?') : confirming ? 'Confirm this visit' : 'Visit time';
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    width: 'narrow',
    brand: page.agencyName,
    title,
    footer: `Questions? Reply to any message from ${page.agencyName}.`,
    body: html`${error ? alert(error, 'error') : ''}
      ${card({
        body: html`${stateLine(page, when, another, asked)}
          ${confirming
            ? html`<form method="post" action="/v/confirm/${encodeURIComponent(token)}" class="tenant-form">
                <input type="hidden" name="action" value="confirm" />
                ${button(`Confirm ${when}`, { block: true })}
              </form>`
            : ''}
          ${another && open && !asked
            ? html`<form method="post" action="/v/confirm/${encodeURIComponent(token)}" class="tenant-form">
                <input type="hidden" name="action" value="another" />
                ${button('Need another time?', { block: true, variant: 'secondary' })}
              </form>`
            : ''}`,
      })}`,
  });
}

/** What the visit is now. A moved visit names the current time, not the one in an old message. */
function stateLine(page: Visit, when: string, another: boolean, asked: boolean): Html {
  if (page.status === 'cancelled') return html`<p>This visit is cancelled.</p>`;
  if (page.status === 'done') return html`<p>This visit is done. It was booked for ${when}.</p>`;
  if (asked) {
    return page.kind === 'inspection'
      ? html`<p>We've noted that you need another time. This visit stays booked for ${when} until it moves.</p>`
      : html`<p>We'll ask ${page.tradieBusinessName} for other times. This visit stays booked for ${when} until you pick a new one.</p>`;
  }
  if (another) return html`<p>${page.tradieBusinessName} is booked to visit ${page.address} on ${when}.</p>`;
  if (page.visitConfirmed) return html`<p>Confirmed. This visit is booked for ${when}.</p>`;
  return html`<p>${page.tradieBusinessName} will visit ${page.address}.</p>`;
}
