// The Tenant's no-login page at /v/:token, linked from the message that offers visit
// times (ADR 0002: the token is the only access). Opening a link, including one a
// mail scanner fetches, only shows the page. Booking a time, or saying none of them
// work, is the button's POST.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { ActionError, AVAILABILITY } from '../../shared.ts';
import { availabilityChoice } from '../../templates.ts';
import { text } from '../forms.ts';
import { alert, button, card, field, publicPage, type Html } from '../ui.ts';
import { formatVisit, formatVisitDay } from '../../zoned-time.ts';

const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;

type Offer = NonNullable<Awaited<ReturnType<App['visitOffer']>>>;

/** GET /v/:token shows one time, or the form when none work. POST books it, or asks for other times. */
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
      if (pick === 'none') await app.declineVisitTimes(token, { availability: text(form, 'availability'), note: text(form, 'note') });
      else await app.pickVisitTime(token, pick);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      if (error.code === 'not_found') return c.html(missingLink(), 404);
      const page = await app.visitOffer(token, pick);
      if (!page) return c.html(missingLink(), 404);
      return c.html(confirmPage(token, page, false, error.message), STATUS[error.code]);
    }
    const next = pick === 'none' ? `/v/${encodeURIComponent(token)}?pick=none` : `/v/${encodeURIComponent(token)}?booked=1`;
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

function confirmPage(token: string, page: Offer, booked: boolean, error?: string): Html {
  const when = page.pickedStart ?? page.start;
  const bookedFor = when ? `This visit is booked for ${formatVisit(when, page.timeZone)}.` : 'This visit is booked.';
  const none = page.pick === 'none';
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    width: 'narrow',
    brand: page.agencyName,
    title: none ? (page.status === 'offered' ? 'None of these work' : 'Other times') : page.bookable ? 'Book this visit' : 'Visit time',
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
        : none
          ? page.status === 'offered'
            ? noneForm(token, page)
            : html`<p>Thanks. We'll ask ${page.tradieBusinessName} for other times.</p>`
          : booked || page.status === 'picked'
            ? html`<p>${bookedFor}</p>`
            : html`<p>Open one of the times in the message we sent you.</p>`}`,
  });
}

/** The Tenant says when they are usually home, and may name a time that does work. */
function noneForm(token: string, page: Offer): Html {
  return card({
    body: html`<p>${page.tradieBusinessName} can visit ${page.address}, and none of the times work.</p>
      <form method="post" action="/v/${encodeURIComponent(token)}" class="tenant-form">
        <input type="hidden" name="pick" value="none" />
        <fieldset class="tenant-choices">
          <legend>When are you usually home?</legend>
          ${AVAILABILITY.map(
            (value) => html`<label>
              <input type="radio" name="availability" value="${value}" ${page.availability === value ? 'checked' : ''} required />
              <span>${availabilityChoice(value)}</span>
            </label>`,
          )}
        </fieldset>
        ${field({
          label: 'A time that works',
          name: 'note',
          type: 'textarea',
          rows: 3,
          hint: 'Optional. For example, Sunday 10 am works.',
        })}
        ${button('Ask for other times', { block: true })}
      </form>`,
  });
}
