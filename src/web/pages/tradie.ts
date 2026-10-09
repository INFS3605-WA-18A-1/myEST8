// A Tradie's profile: contact details, Trades, the myEST8 rating next to the Google
// rating, every rating given, previous Quotes and upcoming bookings.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { badge, emptyState, flashFrom, formatMoney, formatWhen, humanise, linkButton, page, sectionHeader, stat, statGroup, table, type Html } from '../ui.ts';
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
        page({
          title: 'Tradie not found',
          pm,
          shell: shellInfo(c),
          body: html`<p>There's no such Tradie in your Agency.</p>${linkButton('Back to setup', '/setup#tradies')}`,
        }),
        404,
      );
    }
    const { timeZone } = actions.agency();
    return c.html(
      page({
        title: tradie.businessName ?? tradie.name,
        pm,
        shell: shellInfo(c),
        flash: flashFrom(c.req.url),
        subtitle: tradie.businessName ? tradie.name : undefined,
        body: html`${header(tradie)}
          <div class="grid gap-6 lg:grid-cols-2">${ratings(tradie, timeZone)}${quotes(tradie, timeZone)}</div>
          ${bookings(tradie, timeZone)}`,
      }),
    );
  });

  return pages;
}

/** The Trades, the contact details, and the two ratings side by side (two columns from 1024 px). */
function header(t: TradieView): Html {
  const { average, count } = t.myEst8Rating;
  return html`<section class="section" aria-label="Tradie details">
    <div class="flex flex-wrap items-center gap-2">${t.trades.map((trade) => badge(humanise(trade), 'info'))}</div>
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-6 gap-y-2 text-sm">
        <dt class="text-muted">Name</dt>
        <dd class="min-w-0 break-words">${t.name}</dd>
        <dt class="text-muted">Mobile</dt>
        <dd class="min-w-0 break-words">${t.mobile ? html`<a class="link" href="tel:${t.mobile}">${t.mobile}</a>` : '—'}</dd>
        <dt class="text-muted">Email</dt>
        <dd class="min-w-0 break-all">${t.email ? html`<a class="link" href="mailto:${t.email}">${t.email}</a>` : '—'}</dd>
      </dl>
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
    </div>
  </section>`;
}

function ratings(t: TradieView, timeZone: string): Html {
  return html`<section class="section min-w-0" aria-label="Ratings">
    ${sectionHeader('Ratings')}
    ${t.ratings.length
      ? table(
          ['From', 'Score', 'Date'],
          t.ratings.map((r) => [
            html`${r.source === 'property_manager' ? 'Property Manager' : 'Tenant'}`,
            html`<span class="num">${r.score} / 5</span>`,
            html`${formatWhen(r.at, timeZone)}`,
          ]),
          { caption: 'Ratings' },
        )
      : emptyState('No ratings yet beyond the starting rating.')}
  </section>`;
}

function quotes(t: TradieView, timeZone: string): Html {
  return html`<section class="section min-w-0" aria-label="Previous Quotes">
    ${sectionHeader('Previous Quotes')}
    ${t.previousQuotes.length
      ? table(
          ['Trade', 'Price', 'Received'],
          t.previousQuotes.map((q) => [
            html`${humanise(q.trade)}`,
            html`<span class="num">${formatMoney(q.priceCents)}</span>`,
            html`${formatWhen(q.at, timeZone)}`,
          ]),
          { caption: 'Previous Quotes' },
        )
      : emptyState('No Quotes yet.')}
  </section>`;
}

function bookings(t: TradieView, timeZone: string): Html {
  return html`<section class="section" aria-label="Upcoming bookings">
    ${sectionHeader('Upcoming bookings')}
    ${t.bookings.length
      ? table(
          ['When', 'Property', 'Property Manager'],
          t.bookings.map((b) => [html`<span class="num">${timeRange(b.start, b.end, timeZone)}</span>`, html`${b.propertyAddress}`, html`${b.propertyManager}`]),
          { caption: 'Upcoming bookings' },
        )
      : emptyState('Nothing booked.')}
  </section>`;
}
