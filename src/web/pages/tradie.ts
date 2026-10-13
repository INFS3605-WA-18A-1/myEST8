// A Tradie's profile: contact details, Trades, the myEST8 rating next to the Google
// rating, every rating given, previous Quotes and upcoming bookings.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { alert, badge, button, emptyState, flashFrom, formatMoney, formatWhen, humanise, linkButton, page, section, sectionHeader, stat, statGroup, table, type Html } from '../ui.ts';
import { icon } from '../icons.ts';
import { timeRange } from './calendar.ts';
import { googleSearchForm, importPanel, searchListings, tradieFields } from './onboarding-forms.ts';

type TradieView = Awaited<ReturnType<PropertyManagerActions['tradie']>>;

/** The Tradies list under /tradies and a Tradie's profile under /tradies/:id. */
export function tradiePages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const refused = flash?.kind === 'error' ? c.req.query('form') : undefined;
    const errorFor = (key: string): Html => (refused === key && flash ? alert(flash.message, 'error') : html``);
    const googleQuery = c.req.query('google')?.trim() ?? '';
    const tradies = await actions.people('tradie');
    const ratings = await Promise.all(tradies.map(async (t) => (await actions.tradie(t.id)).myEst8Rating));
    const rows = tradies.map((t, i) => {
      const { average, count } = ratings[i]!;
      return [
        html`<a class="link font-medium" href="/tradies/${t.id}">${t.businessName ?? t.name}</a>`,
        html`${t.trades.map(humanise).join(', ') || '—'}`,
        html`${average.toFixed(1)} <span class="text-muted">(${count})</span>`,
        html`${t.googlePlaceId ? `${t.googleRating?.toFixed(1) ?? '—'} (${t.googleReviewCount ?? 0} reviews)` : 'Not on Google'}`,
        html`${t.mobile ?? '—'}`,
      ];
    });
    const { listings, problem } = await searchListings(actions, googleQuery);
    const formAction = `/setup/tradies${googleQuery ? `?google=${encodeURIComponent(googleQuery)}` : ''}`;

    return c.html(
      page({
        title: 'Tradies',
        pm,
        active: 'tradies',
        flash,
        shell: await shellInfo(c),
        subtitle: 'The Tradies your Agency uses, shared by every Property Manager.',
        body: html`
          ${section({
            title: 'Tradies',
            body: tradies.length ? table(['Business', 'Trades', 'myEST8 rating', 'Google rating', 'Mobile'], rows, { caption: 'Tradies' }) : emptyState('Tradies appear here once you add them. Add the first one below.'),
          })}
          ${section({
            id: 'add-tradie',
            title: 'Add a Tradie',
            body: html`
              ${googleSearchForm('/tradies#add-tradie', googleQuery, problem, listings.length)}
              <form method="post" action="${formAction}" class="mt-4">
                ${errorFor('tradie')}
                ${tradieFields({ listings })}
                <div class="mt-3">${button('Add Tradie', { variant: 'primary' })}</div>
              </form>
              <details class="import-details mt-4 border-t border-line pt-3" id="import-tradies" ${refused === 'import-tradies' ? 'open' : ''}>
                <summary class="cursor-pointer font-semibold text-action">${icon('file-xls', { size: 'size-4' })}<span>Add many from a spreadsheet</span></summary>
                <div class="mt-3">${importPanel('tradies', { error: errorFor('import-tradies') })}</div>
              </details>
            `,
          })}
        `,
      }),
    );
  });

  pages.get('/:id{[0-9]+}', async (c) => {
    const { actions, pm } = c.var;
    let tradie: TradieView;
    try {
      tradie = await actions.tradie(Number(c.req.param('id')));
    } catch (error) {
      if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
      return c.html(
        page({
          title: 'Tradie not found',
          pm,
          active: 'tradies',
          shell: await shellInfo(c),
          body: html`<p>There's no such Tradie in your Agency.</p>${linkButton('Back to Tradies', '/tradies')}`,
        }),
        404,
      );
    }
    const { timeZone } = actions.agency();
    return c.html(
      page({
        title: tradie.businessName ?? tradie.name,
        pm,
        active: 'tradies',
        shell: await shellInfo(c),
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
