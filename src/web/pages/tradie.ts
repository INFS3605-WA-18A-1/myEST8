// A Tradie's profile: contact details, Trades, the myEST8 rating next to the Google
// rating, every rating given, previous Quotes and upcoming bookings.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import {
  badge,
  dl,
  emptyState,
  flashFrom,
  formatMoney,
  formatWhen,
  humanise,
  linkButton,
  page,
  sectionHeader,
  stat,
  statGroup,
  table,
  type Html,
} from '../ui.ts';
import { timeRange } from './calendar.ts';

type TradieView = ReturnType<PropertyManagerActions['tradie']>;

/** A Tradie's profile under /tradies/:id. */
export function tradiePages() {
  const pages = new Hono<WebEnv>();

  pages.get('/:id{[0-9]+}', (c) => {
    const { actions, pm } = c.var;
    let tradie: TradieView;
    try {
      tradie = actions.tradie(Number(c.req.param('id')));
    } catch (error) {
      if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
      return c.html(
        page({ title: 'Tradie not found', pm, body: html`<p>There's no such Tradie in your Agency.</p>${linkButton('Back to setup', '/setup#tradies')}` }),
        404,
      );
    }
    const { timeZone } = actions.agency();
    return c.html(
      page({
        title: tradie.businessName ?? tradie.name,
        pm,
        flash: flashFrom(c.req.url),
        body: html`${profile(tradie)} ${ratings(tradie, timeZone)} ${quotes(tradie, timeZone)} ${bookings(tradie, timeZone)}`,
      }),
    );
  });

  return pages;
}

function profile(t: TradieView): Html {
  const { average, count } = t.myEst8Rating;
  return html`
    ${statGroup([
      stat({
        label: 'myEST8 rating',
        value: average.toFixed(1),
        hint: count === 1 ? 'The starting rating; no Jobs rated yet' : `From ${count} ratings, including the starting rating`,
      }),
      t.googleRating
        ? stat({
            label: 'Google rating',
            value: t.googleRating.rating === null ? '—' : t.googleRating.rating.toFixed(1),
            hint: `${t.googleRating.reviewCount ?? 0} reviews`,
          })
        : stat({ label: 'Google rating', value: 'Not on Google' }),
    ])}
    <section class="mt-6" aria-label="Contact">
      ${sectionHeader('Contact')}
      ${dl([
        ['Name', t.name],
        ['Mobile', t.mobile ? html`<a class="link" href="tel:${t.mobile}">${t.mobile}</a>` : '—'],
        ['Email', t.email ? html`<a class="link" href="mailto:${t.email}">${t.email}</a>` : '—'],
        ['Trades', html`${t.trades.map((trade) => html`${badge(humanise(trade), 'info')} `)}`],
      ])}
    </section>
  `;
}

function ratings(t: TradieView, timeZone: string): Html {
  return html`<section class="mt-8" aria-label="Ratings">
    ${sectionHeader('Ratings')}
    ${t.ratings.length
      ? table(
          ['From', 'Score', 'Date'],
          t.ratings.map((r) => [
            html`${r.source === 'property_manager' ? 'Property Manager' : 'Tenant'}`,
            html`${r.score} / 5`,
            html`${formatWhen(r.at, timeZone)}`,
          ]),
          { caption: 'Ratings' },
        )
      : emptyState('No ratings yet beyond the starting rating.')}
  </section>`;
}

function quotes(t: TradieView, timeZone: string): Html {
  return html`<section class="mt-8" aria-label="Previous Quotes">
    ${sectionHeader('Previous Quotes')}
    ${t.previousQuotes.length
      ? table(
          ['Trade', 'Price', 'Received'],
          t.previousQuotes.map((q) => [html`${humanise(q.trade)}`, html`${formatMoney(q.priceCents)}`, html`${formatWhen(q.at, timeZone)}`]),
          { caption: 'Previous Quotes' },
        )
      : emptyState('No Quotes yet.')}
  </section>`;
}

function bookings(t: TradieView, timeZone: string): Html {
  return html`<section class="mt-8" aria-label="Upcoming bookings">
    ${sectionHeader('Upcoming bookings')}
    ${t.bookings.length
      ? table(
          ['When', 'Property', 'Property Manager'],
          t.bookings.map((b) => [
            timeRange(b.start, b.end, timeZone),
            html`${b.propertyAddress}`,
            html`${b.propertyManager}`,
          ]),
          { caption: 'Upcoming bookings' },
        )
      : emptyState('Nothing booked.')}
  </section>`;
}
