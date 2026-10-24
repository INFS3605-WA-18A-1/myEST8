// The Tenant's no-login page at /v/:token, linked from the message that offers visit
// times (ADR 0002: the token is the only access). Opening a link, including one a
// mail scanner fetches, only shows the page. Booking is the button's POST.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import { text } from '../forms.ts';
import { alert, button, card, publicPage, type Html } from '../ui.ts';
import { formatVisit, formatVisitDay } from '../../zoned-time.ts';

const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;

type Offer = NonNullable<Awaited<ReturnType<App['visitOffer']>>>;

/** GET /v/:token shows the time; POST /v/:token books it. */
export function visitOfferPages(app: App) {
  const pages = new Hono();

  pages.get('/v/:token', async (c) => {
    const page = await app.visitOffer(c.req.param('token'), c.req.query('pick'));
    if (!page) return c.html(missingLink(), 404);
    return c.html(confirmPage(c.req.param('token'), page, c.req.query('booked') === '1'));
  });

  pages.post('/v/:token', async (c) => {
    const token = c.req.param('token');
    const form = await c.req.parseBody();
    const pick = text(form, 'pick');
    try {
      await app.pickVisitTime(token, pick);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      if (error.code === 'not_found') return c.html(missingLink(), 404);
      const page = await app.visitOffer(token, pick);
      if (!page) return c.html(missingLink(), 404);
      return c.html(confirmPage(token, page, false, error.message), STATUS[error.code]);
    }
    return c.redirect(`/v/${encodeURIComponent(token)}?booked=1`, 303);
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

function confirmPage(token: string, page: Offer, booked: boolean, error?: string): Html {
  const when = page.pickedStart ?? page.start;
  const bookedFor = when ? `This visit is booked for ${formatVisit(when, page.timeZone)}.` : 'This visit is booked.';
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    width: 'narrow',
    brand: page.agencyName,
    title: page.bookable ? 'Book this visit' : 'Visit time',
    footer: `Questions? Reply to any message from ${page.agencyName}.`,
    body: html`${error ? alert(error, 'error') : ''}
      ${page.bookable && page.start
        ? card({
            body: html`<p>${page.tradieBusinessName} can visit ${page.address}.</p>
              <form method="post" action="/v/${encodeURIComponent(token)}" class="tenant-form">
                <input type="hidden" name="pick" value="${page.pick}" />
                ${button(`Book ${formatVisitDay(page.start, page.timeZone)}`, { block: true })}
              </form>`,
          })
        : booked || page.status === 'picked'
          ? html`<p>${bookedFor}</p>`
          : page.pick === 'none'
            ? html`<p>None of these times work. Reply to the message and say when you're usually home.</p>`
            : html`<p>Open one of the times in the message we sent you.</p>`}`,
  });
}
