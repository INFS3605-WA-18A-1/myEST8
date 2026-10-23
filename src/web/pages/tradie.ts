// The Agency's Tradies: the directory at /tradies, and a Tradie's profile at
// /tradies/:id with contact details, Trades, the myEST8 rating next to the Google
// rating, upcoming bookings, previous Quotes (each with its Ticket and whether it was
// chosen) and every rating given, Property Managers' and Tenants' apart. A Tradie is
// removed from the Agency from their profile: they leave the lists and pickers, but the
// profile still opens, with their past Quotes and ratings.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, TRADES, type Trade } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { formAction, text } from '../forms.ts';
import { icon } from '../icons.ts';
import { shellInfo } from '../shell.ts';
import { alert, badge, button, contactLink, emptyState, field, flashFrom, formatMoney, formatWhen, humanise, linkButton, page, postButton, ratingChip, rowLink, section, sectionHeader, stat, statGroup, table, ticketCell, type Html } from '../ui.ts';
import { timeRange } from './calendar.ts';
import { addTradieSection, importPanel, listingChoice } from './onboarding-forms.ts';

type TradieView = Awaited<ReturnType<PropertyManagerActions['tradie']>>;
type DirectoryEntry = Awaited<ReturnType<PropertyManagerActions['tradieDirectory']>>[number];

/** A Tradie's profile under /tradies/:id. */
export function tradiePages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const trade = TRADES.find((t) => t === c.req.query('trade')) ?? null;
    const flash = flashFrom(c.req.url);
    const refused = flash?.kind === 'error' ? c.req.query('form') : undefined;
    const errorFor = (key: string): Html => (refused === key && flash ? alert(flash.message, 'error') : html``);
    const choice = listingChoice((name) => c.req.query(name));
    const everyone = await actions.tradieDirectory();
    const tradies = trade ? everyone.filter((t) => t.trades.includes(trade)) : everyone;
    return c.html(
      page({
        title: 'Tradies',
        pm,
        active: 'tradies',
        flash,
        shell: shellInfo(c),
        subtitle: 'Best myEST8 rating first. The two ratings are shown side by side, never combined.',
        actions: linkButton('Add a Tradie', '#add-tradie', { variant: 'primary', size: 'sm' }),
        body: html`${tradeFilter(everyone, trade)}${directory(tradies, trade)}
          ${section({
            id: 'add-tradie',
            title: 'Add a Tradie',
            body: html`
              ${await addTradieSection({
                actions,
                choice,
                path: '/tradies',
                anchor: '#add-tradie',
                postTo: '/setup/tradies',
                submit: button('Add Tradie', { variant: 'primary' }),
                refusal: errorFor('tradie'),
              })}
              <details class="import-details mt-4 border-t border-line pt-3" id="import-tradies" ${refused === 'import-tradies' ? 'open' : ''}>
                <summary class="cursor-pointer font-semibold text-action">${icon('file-xls', { size: 'size-4' })}<span>Add many from a spreadsheet</span></summary>
                <div class="mt-3">${importPanel('tradies', { error: errorFor('import-tradies') })}</div>
              </details>
            `,
          })}`,
      }),
    );
  });

  // Refused, the reason shows on the Tradie's profile.
  pages.post('/:id{[0-9]+}/remove', (c) => {
    const id = Number(c.req.param('id'));
    return formAction(c, `/tradies/${id}`, async () => {
      const name = await c.var.actions.removeTradie(id);
      return { ok: `${name} removed`, redirect: '/tradies' };
    });
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
          shell: shellInfo(c),
          body: emptyState("There's no such Tradie in your Agency.", linkButton('Back to Tradies', '/tradies')),
        }),
        404,
      );
    }
    const { timeZone } = actions.agency();
    const flash = flashFrom(c.req.url);
    return c.html(
      page({
        title: tradie.businessName ?? tradie.name,
        pm,
        active: 'tradies',
        shell: shellInfo(c),
        flash,
        subtitle: tradie.businessName ? tradie.name : undefined,
        actions: html`${tradie.removedAt ? '' : removeButton(tradie)}${linkButton('Back to Tradies', '/tradies', { variant: 'ghost', size: 'sm' })}`,
        body: html`${tradie.removedAt ? alert(`Removed from the Agency on ${longDate(tradie.removedAt, timeZone)}.`, 'info') : ''}
          ${header(tradie)} ${quotes(tradie, timeZone)} ${bookings(tradie, timeZone)} ${ratings(tradie, timeZone)}
          ${tradie.removedAt ? '' : addressForm(tradie, flash, c.req.query('form'))}`,
      }),
    );
  });

  // Sets where the Tradie works from; the map places them when the address is found.
  pages.post('/:id{[0-9]+}/address', (c) => {
    const id = Number(c.req.param('id'));
    return formAction(c, `/tradies/${id}`, async (form) => {
      const address = text(form, 'businessAddress');
      await c.var.actions.setTradieAddress(id, address);
      return { ok: address ? 'Business address saved' : 'Business address removed' };
    });
  });

  return pages;
}

function removeButton(t: TradieView): Html {
  return postButton(`/tradies/${t.tradieId}/remove`, 'Remove Tradie', {
    variant: 'danger',
    size: 'sm',
    confirm: `${t.businessName ?? t.name} won't be offered for new Jobs. Their past Quotes and ratings stay on the Tickets they belong to.`,
  });
}

/** "8 October 2026", in the Agency's time zone. */
function longDate(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(at));
}

/** Where the Tradie works from, which puts them on the Dispatch map. */
function addressForm(t: TradieView, flash: ReturnType<typeof flashFrom>, form: string | undefined): Html {
  const refused = flash?.kind === 'error' && form === 'address' ? alert(flash.message, 'error') : '';
  return section({
    id: 'business-address',
    title: 'Business address',
    body: html`<form method="post" action="/tradies/${t.tradieId}/address" class="grid max-w-xl gap-3">
      ${refused}
      ${field({
        label: 'Address',
        name: 'businessAddress',
        id: 'tradie-address',
        value: t.businessAddress ?? '',
        placeholder: '5 Depot Rd, Marrickville NSW 2204',
        hint: t.businessAddress
          ? t.located
            ? 'On the Dispatch map.'
            : 'Not found yet, so this Tradie is not on the Dispatch map. Check the address.'
          : 'Where they work from. It puts them on the Dispatch map and in the nearest Tradies for a Property.',
      })}
      <div>${button('Save address', { variant: 'secondary', size: 'sm' })}</div>
    </form>`,
  });
}

/**
 * The Trades as links, each with how many Tradies do it, so filtering is one click and
 * works without JavaScript. A Trade nobody does isn't offered, unless it's the one asked for.
 */
function tradeFilter(everyone: DirectoryEntry[], selected: Trade | null): Html {
  const counts = TRADES.map((t) => ({ trade: t, count: everyone.filter((x) => x.trades.includes(t)).length })).filter((c) => c.count || c.trade === selected);
  const item = (label: string, href: string, count: number, active: boolean) =>
    html`<li><a href="${href}" class="trade-filter-item"${active ? html` aria-current="page"` : ''}>${label} <span class="trade-filter-count num">${count}</span></a></li>`;
  return html`<nav class="trade-filter" aria-label="Filter by Trade">
    <ul>
      ${item('All Trades', '/tradies', everyone.length, selected === null)}
      ${counts.map((c) => item(humanise(c.trade), `/tradies?trade=${c.trade}`, c.count, c.trade === selected))}
    </ul>
  </nav>`;
}

/** Every Tradie with both ratings next to each other and the number of Quotes they have given. */
function directory(tradies: DirectoryEntry[], trade: Trade | null): Html {
  if (!tradies.length) {
    return emptyState(trade ? `No Tradie does ${humanise(trade).toLowerCase()}.` : 'No Tradies yet. Add the Tradies you already use.', linkButton('Add a Tradie', '#add-tradie', { variant: 'primary', size: 'sm' }));
  }
  return table(
    ['Tradie', 'Trades', 'myEST8 rating', 'Google rating', 'Previous Quotes'],
    tradies.map((t) => {
      const { average, count } = t.myEst8Rating;
      return [
        html`${rowLink(t.businessName ?? t.name, `/tradies/${t.tradieId}`)}${t.businessName ? html`<br /><span class="text-xs text-muted">${t.name}</span>` : ''}`,
        html`<span class="flex flex-wrap gap-1">${t.trades.map((x) => badge(humanise(x), 'info'))}</span>`,
        ratingChip({ source: 'myEST8', rating: average, count, named: false }),
        ratingChip({ source: 'Google', rating: t.googleRating?.rating ?? null, count: t.googleRating?.reviewCount ?? 0, onGoogle: !!t.googleRating, named: false }),
        html`${t.quotes}`,
      ];
    }),
    { stack: 'labelled', caption: trade ? `${humanise(trade)} Tradies` : 'Tradies', align: ['left', 'left', 'left', 'left', 'right'] },
  );
}

/**
 * What a Property Manager weighs up first: the Trades and how to reach them, then the
 * ratings. The myEST8 rating (the starting rating and every rating since) comes with
 * the Property Managers' and the Tenants' averages on their own, and Google's rating
 * beside them, never combined.
 */
function header(t: TradieView): Html {
  const { average, count } = t.myEst8Rating;
  const bySource = (label: string, source: TradieView['ratings'][number]['source']) => {
    const scores = t.ratings.filter((r) => r.source === source).map((r) => r.score);
    return scores.length
      ? stat({ label, value: (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1), hint: `${scores.length} ${scores.length === 1 ? 'rating' : 'ratings'}` })
      : stat({ label, value: 'No ratings yet' });
  };
  return html`<section class="section tradie-head" aria-label="Tradie details">
    <div class="tradie-contact">
      <div class="flex flex-wrap items-center gap-2">${t.trades.map((trade) => badge(humanise(trade), 'info'))}</div>
      <dl>
        <div><dt>Mobile</dt><dd>${t.mobile ? html`${contactLink('mobile', t.mobile)}` : '—'}</dd></div>
        <div><dt>Email</dt><dd>${t.email ? html`${contactLink('email', t.email)}` : '—'}</dd></div>
      </dl>
    </div>
    <div class="tradie-ratings">
      ${statGroup([
        stat({
          label: 'myEST8 rating',
          value: average.toFixed(1),
          hint: count === 1 ? 'The starting rating; no Jobs rated yet' : `From ${count} ratings, including the starting rating`,
        }),
        bySource('From Property Managers', 'property_manager'),
        bySource('From Tenants', 'tenant'),
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

/** Every rating given, the Property Managers' and the Tenants' in groups of their own. */
function ratings(t: TradieView, timeZone: string): Html {
  const group = (title: string, source: TradieView['ratings'][number]['source']) => {
    const given = t.ratings.filter((r) => r.source === source);
    return html`<div class="grid min-w-0 content-start gap-2">
      <h3 class="text-sm font-semibold [font-family:var(--font-head)]">${title}</h3>
      ${given.length
        ? table(
            ['Score', 'Date'],
            given.map((r) => [html`<span class="num">${r.score} / 5</span>`, html`${formatWhen(r.at, timeZone)}`]),
            { caption: title },
          )
        : html`<p class="text-sm text-muted">None yet.</p>`}
    </div>`;
  };
  return html`<section class="section" aria-label="Ratings">
    ${sectionHeader('Ratings')}
    <div class="grid gap-4 md:grid-cols-2">${group('From Property Managers', 'property_manager')}${group('From Tenants', 'tenant')}</div>
  </section>`;
}

const OUTCOME: Record<TradieView['previousQuotes'][number]['outcome'], Html> = {
  chosen: badge('Chosen', 'success'),
  not_chosen: badge('Not chosen', 'neutral'),
  waiting: badge('Not decided yet', 'info'),
};

/** The Quotes a Property Manager confirmed, newest first, each with the Ticket it was for and whether it was chosen. */
function quotes(t: TradieView, timeZone: string): Html {
  const newestFirst = [...t.previousQuotes].sort((a, b) => b.at.localeCompare(a.at));
  return html`<section class="section" aria-label="Previous Quotes">
    ${sectionHeader('Previous Quotes')}
    ${newestFirst.length
      ? table(
          ['Ticket', 'Trade', 'Price', 'Received', 'Outcome'],
          newestFirst.map((q) => [
            ticketCell({ ticketId: q.ticketId, issue: q.description, address: q.propertyAddress }),
            html`${humanise(q.trade)}`,
            html`${formatMoney(q.priceCents)}`,
            html`<span class="text-muted whitespace-nowrap">${formatWhen(q.at, timeZone)}</span>`,
            OUTCOME[q.outcome],
          ]),
          { caption: 'Previous Quotes, newest first', align: ['left', 'left', 'right', 'left', 'left'], stack: true },
        )
      : emptyState('No Quotes yet.')}
  </section>`;
}

/** Visits to come, each with the Ticket it is for. */
function bookings(t: TradieView, timeZone: string): Html {
  return html`<section class="section" aria-label="Upcoming bookings">
    ${sectionHeader('Upcoming bookings')}
    ${t.bookings.length
      ? table(
          ['Ticket', 'When', 'Property Manager'],
          t.bookings.map((b) => [
            ticketCell({ ticketId: b.ticketId, issue: b.description, address: b.propertyAddress }),
            html`<span class="num whitespace-nowrap">${timeRange(b.start, b.end, timeZone)}</span>`,
            html`<span class="text-muted">${b.propertyManager}</span>`,
          ]),
          { caption: 'Upcoming bookings', stack: true },
        )
      : emptyState('Nothing booked.')}
  </section>`;
}
