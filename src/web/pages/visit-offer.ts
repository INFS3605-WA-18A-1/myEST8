// The Tenant's no-login page at /v/:token, linked from the message that offers visit
// times (ADR 0002: the token is the only access). Opening a link, including one a
// mail scanner fetches, only shows the page. Booking a time, or saying none of them
// work, is the button's POST. Once one is saved, every link from the email shows it.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { ActionError, AVAILABILITY } from '../../shared.ts';
import { availabilityChoice } from '../../templates.ts';
import { text } from '../forms.ts';
import { alert, button, card, doneBox, field, publicPage, type Html } from '../ui.ts';
import { formatVisit, formatVisitDay } from '../../zoned-time.ts';

const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;

type Offer = NonNullable<Awaited<ReturnType<App['visitOffer']>>>;

/** GET /v/:token shows one time, or the form when none work. POST books it, or asks for other times. */
export function visitOfferPages(app: App) {
  const pages = new Hono();

  pages.get('/v/:token', async (c) => {
    const page = await app.visitOffer(c.req.param('token'), c.req.query('pick'));
    if (!page) return c.html(missingLink(), 404);
    return c.html(offerPage(c.req.param('token'), page, { home: c.req.query('home') === '1' }));
  });

  pages.post('/v/:token', async (c) => {
    const token = c.req.param('token');
    const form = await c.req.parseBody();
    const pick = text(form, 'pick');
    try {
      if (pick === 'another') await app.requestAnotherTime(token);
      else if (pick === 'none') await app.declineVisitTimes(token, { availability: text(form, 'availability'), note: text(form, 'note') });
      else await app.pickVisitTime(token, pick);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      if (error.code === 'not_found') return c.html(missingLink(), 404);
      const page = await app.visitOffer(token, pick === 'another' ? undefined : pick);
      if (!page) return c.html(missingLink(), 404);
      return c.html(offerPage(token, page, { error: error.message, home: text(form, 'home') === '1' }), STATUS[error.code]);
    }
    // What was saved is the page's state now, so every link from the email shows it.
    return c.redirect(`/v/${encodeURIComponent(token)}`, 303);
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
 * The offer as it stands. While its times are on offer, the link's own choice: Book that
 * time, or say when you're home. Once the Tenant has chosen, every link from the email
 * shows the choice in green, the offered times disabled, and "Need another time?" only
 * while the booked visit can still be asked to move.
 */
function offerPage(token: string, page: Offer, o: { error?: string; home?: boolean } = {}): Html {
  const none = page.pick === 'none';
  // The email's "say when you're home" link is a GET. It shows the form again after none already fit.
  const asking = (page.status === 'offered' && none) || (o.home && (page.status === 'offered' || page.status === 'none_fit'));
  const title =
    page.status === 'offered'
      ? page.bookable ? 'Book this visit' : asking ? (none ? 'None of these work' : 'When are you usually home?') : 'Visit time'
      : asking ? 'When are you usually home?'
      : page.status === 'none_fit' ? 'Other times'
      : 'Visit time';
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    width: 'narrow',
    brand: page.agencyName,
    title,
    footer: `Questions? Reply to any message from ${page.agencyName}.`,
    body: html`${o.error ? alert(o.error, 'error') : ''}
      ${page.bookable && page.start
        ? card({
            body: html`<p>${page.tradieBusinessName} can visit ${page.address}.${page.preferred ? " This is the Tradie's preferred time." : ''}</p>
              <form method="post" action="/v/${encodeURIComponent(token)}" class="tenant-form">
                <input type="hidden" name="pick" value="${page.pick}" />
                ${button(`Book ${formatVisitDay(page.start, page.timeZone)}`, { block: true })}
              </form>`,
          })
        : asking
          ? noneForm(token, page)
          : page.status === 'offered'
            ? html`<p>Open one of the times in the message we sent you.</p>`
            : answered(token, page)}`,
  });
}

/** An offer the Tenant answered, or one a later booking replaced: what was chosen, then the email's choices, disabled. */
function answered(token: string, page: Offer): Html {
  const times = offeredChoices(page);
  if (page.status === 'none_fit') {
    return html`${doneBox('Asked for other times')}
      ${card({ body: html`<p>We'll ask ${page.tradieBusinessName} for other times.</p>${times}` })}`;
  }
  if (page.status === 'superseded') return card({ body: html`<p>These times are no longer on offer.</p>${times}` });
  const visit = page.visit;
  // A visit moved since keeps the booking: the page names where it is now.
  const start = visit?.status === 'active' ? visit.start : page.pickedStart;
  const when = start ? formatVisit(start, page.timeZone) : '';
  if (visit?.status === 'cancelled') return card({ body: html`<p>This visit is cancelled.</p>${times}${anotherTime(token, false)}` });
  if (visit?.status === 'done') return card({ body: html`<p>This visit is done.</p>${times}${anotherTime(token, false)}` });
  const asked = visit?.rescheduleRequestedBy;
  return html`${asked === 'tenant' ? doneBox('Asked for another time') : doneBox(when ? `Booked: ${when}` : 'Booked')}
    ${card({
      body: html`${asked === 'tenant'
          ? html`<p>We'll ask ${page.tradieBusinessName} for other times. This visit stays booked for ${when} until you pick a new one.</p>`
          : asked
            ? html`<p>A new time has been asked for. This visit stays booked for ${when} until you pick a new one.</p>`
            : html`<p>${page.tradieBusinessName} will visit ${page.address} on ${when}.</p>`}
        ${times}${anotherTime(token, visit?.status === 'active' && !asked)}`,
    })}`;
}

/**
 * The times the email offered, and "None of these work", as buttons that no longer do
 * anything. A booking of one time has nothing else to show: the green block names it.
 * (A visit the Property Manager booked has a page like this too, with that one time.)
 */
function offeredChoices(page: Offer): Html | string {
  if (page.status === 'picked' && page.starts.length < 2) return '';
  return html`<div class="tenant-buttons" role="group" aria-label="The times offered">
    ${page.starts.map((start) => button(formatVisit(start, page.timeZone), { block: true, disabled: true, type: 'button' }))}
    ${button('None of these work', { block: true, variant: 'secondary', disabled: true, type: 'button' })}
  </div>`;
}

/** Asks for a new round. The visit stays booked until a new time is picked. Disabled once that no longer applies. */
function anotherTime(token: string, open: boolean): Html {
  if (!open) return html`<div class="tenant-buttons">${button('Need another time?', { block: true, variant: 'secondary', disabled: true, type: 'button' })}</div>`;
  return html`<form method="post" action="/v/${encodeURIComponent(token)}" class="tenant-form">
    <input type="hidden" name="pick" value="another" />
    ${button('Need another time?', { block: true, variant: 'secondary' })}
  </form>`;
}

/** The Tenant says when they are usually home, and may name a time that does work. */
function noneForm(token: string, page: Offer): Html {
  return card({
    body: html`<p>${page.tradieBusinessName} can visit ${page.address}, and none of the times work.</p>
      <form method="post" action="/v/${encodeURIComponent(token)}" class="tenant-form">
        <input type="hidden" name="pick" value="none" />
        ${page.status === 'none_fit' ? html`<input type="hidden" name="home" value="1" />` : ''}
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
