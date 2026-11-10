// The Agency's Tradies: the directory at /tradies, adding one at /tradies/new, and a
// Tradie's profile at /tradies/:id: one soft card with the business, who to call and the
// myEST8 rating up top (and a step to the Tradie before and after), then tabs for previous
// Quotes (each with its Ticket and whether it was chosen, over a read of their work and both
// ratings), upcoming bookings and every rating given, Property Managers' and Tenants' apart.
// Beside the tabs, the contact details and Trades edit in place (the pen: inlineEdit; without
// JavaScript ?edit=details opens it, posting to /tradies/:id/details) and the service area is
// a map that opens the Tradie on the Dispatch map, with the business address under it. A Tradie
// is removed from the Agency from their profile: they leave the lists and pickers, but the
// profile still opens, with their past Quotes and ratings, and without the pen, Remove or the
// address form.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, TRADES, type Trade } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { formAction, list, text } from '../forms.ts';
import { icon } from '../icons.ts';
import { shellInfo } from '../shell.ts';
import { addButton, listFilter, profileChips, profileHref, profilesCard, type ProfileFilter } from '../profiles-frame.ts';
import { alert, badge, button, contactLink, editSwap, emptyState, inlineEdit, field, flashFrom, formatMoney, formatWhen, humanise, linkButton, othersUsing, page, postButton, profileRead, ratingChip, rowLink, section, sharedAddressNote, table, ticketCell, type Html } from '../ui.ts';
import { timeRange } from './calendar.ts';
import { addTradieSection, contactControls, contactFrom, importPanel, listingChoice, saveDetails, tradesControl, tradieFields, valueOf, type DetailsEdit, type Errors, type Values } from './onboarding-forms.ts';

type TradieView = Awaited<ReturnType<PropertyManagerActions['tradie']>>;
type DirectoryEntry = Awaited<ReturnType<PropertyManagerActions['tradieDirectory']>>[number];

/** A Tradie's profile under /tradies/:id. */
export function tradiePages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const trade = TRADES.find((t) => t === c.req.query('trade')) ?? null;
    const flash = flashFrom(c.req.url);
    // Tradies are the Agency's either way; Mine or All is only carried on to the chips and Trades.
    const filter: ProfileFilter = c.req.query('filter') === 'all' ? 'all' : 'mine';
    const [everyone, overview] = await Promise.all([actions.tradieDirectory(), actions.profilesOverview({ filter })]);
    const tradies = trade ? everyone.filter((t) => t.trades.includes(trade)) : everyone;
    return c.html(
      page({
        title: 'Tradies',
        heading: 'Profiles',
        pm,
        active: 'profiles',
        flash,
        shell: shellInfo(c),
        controls: profileChips('tradies', overview.counts, filter),
        body: profilesCard({
          search: listFilter('Filter Tradies', 'Business, name or Trade'),
          end: addButton('Add a Tradie', '/tradies/new'),
          body: html`${tradeFilter(everyone, trade, filter)}${directory(tradies, trade)}`,
        }),
      }),
    );
  });

  pages.get('/new', (c) => addTradiePage(c));

  pages.post('/:id{[0-9]+}/details', (c) => {
    const id = Number(c.req.param('id'));
    return saveDetails(c, {
      profile: `/tradies/${id}`,
      save: (form) => c.var.actions.editTradie(id, { ...contactFrom(form), businessName: text(form, 'businessName'), trades: list(form, 'trades') as Trade[] }),
      show: (refused) => profilePage(c, id, refused),
    });
  });

  // Refused, the reason shows on the Tradie's profile.
  pages.post('/:id{[0-9]+}/remove', (c) => {
    const id = Number(c.req.param('id'));
    return formAction(c, `/tradies/${id}`, async () => {
      const name = await c.var.actions.removeTradie(id);
      return { ok: `${name} removed`, redirect: '/tradies' };
    });
  });

  pages.get('/:id{[0-9]+}', (c) => profilePage(c, Number(c.req.param('id'))));

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

export type AddTradieRefusal = { message: string; values: Values; errors: Errors };

/** The Add a Tradie page. A refused save is this same page, with what was typed and why. */
export async function addTradiePage(c: Context<WebEnv>, refused?: AddTradieRefusal) {
  const { actions, pm } = c.var;
  const flash = flashFrom(c.req.url);
  const form = flash?.kind === 'error' ? c.req.query('form') : undefined;
  const errorFor = (key: string): Html => (form === key && flash ? alert(flash.message, 'error') : html``);
  const choice = listingChoice((name) => c.req.query(name));
  return c.html(
    page({
      title: 'Add a Tradie',
      pm,
      active: 'profiles',
      shell: shellInfo(c),
      flash,
      actions: linkButton('Back to Tradies', '/tradies', { variant: 'ghost', size: 'sm' }),
      body: section({
        title: 'Add a Tradie',
        body: html`
          ${refused ? alert(refused.message, 'error') : ''}
          ${await addTradieSection({
            actions,
            choice,
            path: '/tradies/new',
            anchor: '',
            postTo: '/setup/tradies',
            submit: button('Add Tradie', { variant: 'primary' }),
            values: refused?.values,
            errors: refused?.errors,
          })}
          <details class="import-details mt-4 border-t border-line pt-3" id="import-tradies" ${form === 'import-tradies' ? 'open' : ''}>
            <summary class="cursor-pointer font-semibold text-action">${icon('file-xls', { size: 'size-4' })}<span>Add many from a spreadsheet</span></summary>
            <div class="mt-3">${importPanel('tradies', { error: errorFor('import-tradies') })}</div>
          </details>
        `,
      }),
    }),
    refused ? 400 : 200,
  );
}

/** A Tradie's profile; `refused` is a save of their details that was refused, shown with the form open. */
async function profilePage(c: Context<WebEnv>, id: number, refused?: DetailsEdit) {
  const { actions, pm } = c.var;
  let tradie: TradieView;
  try {
    tradie = await actions.tradie(id);
  } catch (error) {
    if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
    return c.html(
      page({
        title: 'Tradie not found',
        pm,
        active: 'profiles',
        shell: shellInfo(c),
        body: emptyState("There's no such Tradie in your Agency.", linkButton('Back to Tradies', '/tradies')),
      }),
      404,
    );
  }
  const { timeZone } = actions.agency();
  const flash = flashFrom(c.req.url);
  const removed = !!tradie.removedAt;
  // A removed Tradie can't be edited: no form, even if one is asked for or a save is refused.
  const editing = !removed && (!!refused || c.req.query('edit') === 'details');
  const people = await actions.people();
  const directory = removed ? [] : await actions.tradieDirectory();
  const at = directory.findIndex((entry) => entry.tradieId === id);
  const neighbours = { before: at > 0 ? directory[at - 1]! : null, after: at >= 0 && at < directory.length - 1 ? directory[at + 1]! : null };
  const notice = removed
    ? html`${alert(`Removed from the Agency on ${longDate(tradie.removedAt!, timeZone)}.`, 'info')}${refused ? alert(refused.message, 'error') : ''}`
    : '';
  const name = tradie.businessName ?? tradie.name;
  return c.html(
    page({
      title: name,
      pm,
      active: 'profiles',
      shell: shellInfo(c),
      flash,
      crumbs: [{ label: 'Profiles', href: '/profiles' }, { label: 'Tradies', href: '/tradies' }, { label: name }],
      body: html`${notice}
        <div class="tradie-card">
          ${hero(tradie, removed, neighbours)}
          <div class="tradie-board">
            <div class="tradie-main">${tabs(tradie, timeZone)}</div>
            <aside class="tradie-side" aria-label="About ${name}">
              ${details(tradie, editing, refused, people)}
              ${removed ? '' : serviceArea(tradie, flash, c.req.query('form'))}
            </aside>
          </div>
        </div>`,
    }),
    refused ? 400 : 200,
  );
}

/** "PP" for Proximity Plumbing. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : name.slice(0, 2)).toUpperCase();
}

/**
 * The top of the card: a way back, the business with whether they're on the list, who to ask
 * for and their myEST8 rating, then Remove, a Call button for the contact (when there is a
 * mobile) and a step to the Tradie before and after in the directory's order.
 */
function hero(t: TradieView, removed: boolean, near: { before: DirectoryEntry | null; after: DirectoryEntry | null }): Html {
  const name = t.businessName ?? t.name;
  const first = t.name.split(/\s+/)[0]!;
  const step = (entry: DirectoryEntry | null, label: string, glyph: 'caret-left' | 'caret-right') =>
    entry
      ? html`<a class="tradie-step" href="/tradies/${entry.tradieId}" aria-label="${label}: ${entry.businessName ?? entry.name}" title="${label}: ${entry.businessName ?? entry.name}">${icon(glyph, { size: 'size-4' })}</a>`
      : html`<span class="tradie-step is-off" aria-hidden="true">${icon(glyph, { size: 'size-4' })}</span>`;
  return html`<header class="tradie-hero">
    <a class="tradie-back" href="/tradies" aria-label="Back to Tradies" title="Back to Tradies">${icon('caret-left', { size: 'size-4' })}</a>
    <span class="tradie-hero-avatar" aria-hidden="true">${initials(name)}</span>
    <div class="tradie-hero-text">
      <h1 class="tradie-name">${name}</h1>
      <p class="tradie-hero-meta">
        ${removed ? badge('Removed', 'neutral') : html`<span class="tradie-onlist">${icon('check', { size: 'size-3.5', weight: 'bold' })}On your list</span>`}
        ${t.businessName ? html`<span class="tradie-hero-dot" aria-hidden="true">·</span><span>Contact <strong>${t.name}</strong></span>` : ''}
        <span class="tradie-hero-dot" aria-hidden="true">·</span><span class="tradie-hero-rating">${icon('star', { size: 'size-3.5', weight: 'fill' })}<strong class="num">${t.myEst8Rating.average.toFixed(1)}</strong> myEST8 rating</span>
      </p>
    </div>
    <div class="tradie-hero-actions">
      ${removed ? '' : removeButton(t)}
      ${t.mobile ? html`<a class="btn btn-primary btn-sm" href="tel:${t.mobile.replace(/\s+/g, '')}">${icon('phone', { size: 'size-4' })}Call ${first}</a>` : ''}
      ${removed ? '' : html`<span class="tradie-steps">${step(near.before, 'Previous Tradie', 'caret-left')}${step(near.after, 'Next Tradie', 'caret-right')}</span>`}
    </div>
  </header>`;
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

/** A small map-like picture for the service area: soft ground, water and roads, with the Tradie's pin. */
function areaPicture(): Html {
  return html`<svg class="tradie-map-art" viewBox="0 0 264 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="264" height="110" fill="#ecefe9" />
    <path d="M196 0h68v110h-86c8-30 6-52-6-72-6-12-4-26 8-38z" fill="#c9d9e4" />
    <path d="M0 62C60 54 96 70 150 56S230 44 264 50" fill="none" stroke="#fff" stroke-width="7" />
    <path d="M70 0c6 34 4 62 14 110" fill="none" stroke="#fff" stroke-width="5" />
    <path d="M0 24c50 6 90-2 140 8" fill="none" stroke="#fff" stroke-width="3" />
    <path d="M120 110c2-30 14-50 40-70" fill="none" stroke="#fff" stroke-width="3" />
  </svg>`;
}

/**
 * Where the Tradie works from. The picture opens them on the Dispatch map (their pin, picked);
 * a Tradie the map can't place says so and asks for an address, which the form under it saves.
 */
function serviceArea(t: TradieView, flash: ReturnType<typeof flashFrom>, form: string | undefined): Html {
  const refused = flash?.kind === 'error' && form === 'address' ? alert(flash.message, 'error') : '';
  const art = html`${areaPicture()}<span class="tradie-map-pin" aria-hidden="true">${icon('wrench', { size: 'size-4', weight: 'fill' })}</span>`;
  return html`<section class="tradie-side-card" id="business-address" aria-label="Service area">
    <div class="tradie-side-head"><h2 class="tradie-side-title">Service area</h2></div>
    ${t.located
      ? html`<a class="tradie-map" href="/dispatch#panel-tradie-${t.tradieId}" aria-label="Open ${t.businessName ?? t.name} on the Dispatch map">${art}<span class="tradie-map-note">On the Dispatch map</span></a>
          <p class="tradie-map-link"><a class="link" href="/dispatch#panel-tradie-${t.tradieId}">View on map</a></p>`
      : html`<div class="tradie-map is-off">${art}<span class="tradie-map-note is-warn">Not on the map yet</span></div>
          <p class="tradie-map-link"><a class="link" href="#tradie-address">${t.businessAddress ? 'Check the address' : 'Add a service area'}</a></p>`}
    <form method="post" action="/tradies/${t.tradieId}/address" class="tradie-address">
      ${refused}
      ${field({
        label: 'Business address',
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
    </form>
  </section>`;
}

/**
 * The Trades as links, each with how many Tradies do it, so filtering is one click and
 * works without JavaScript. A Trade nobody does isn't offered, unless it's the one asked for.
 * Each keeps All, when it is on, for the chips above.
 */
function tradeFilter(everyone: DirectoryEntry[], selected: Trade | null, filter: ProfileFilter): Html {
  const counts = TRADES.map((t) => ({ trade: t, count: everyone.filter((x) => x.trades.includes(t)).length })).filter((c) => c.count || c.trade === selected);
  const item = (label: string, href: string, count: number, active: boolean) =>
    html`<li><a href="${href}" class="trade-filter-item"${active ? html` aria-current="page"` : ''}>${label} <span class="trade-filter-count num">${count}</span></a></li>`;
  return html`<nav class="trade-filter" aria-label="Filter by Trade">
    <ul>
      ${item('All Trades', profileHref('/tradies', filter), everyone.length, selected === null)}
      ${counts.map((c) => item(humanise(c.trade), profileHref('/tradies', filter, { trade: c.trade }), c.count, c.trade === selected))}
    </ul>
  </nav>`;
}

/** Every Tradie with both ratings next to each other and the number of Quotes they have given. */
function directory(tradies: DirectoryEntry[], trade: Trade | null): Html {
  if (!tradies.length) {
    return emptyState(trade ? `No Tradie does ${humanise(trade).toLowerCase()}.` : 'No Tradies yet. Add the Tradies you already use.', linkButton('Add a Tradie', '/tradies/new', { variant: 'primary', size: 'sm' }));
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

/** Five stars, filled to the rating rounded to the nearest whole star. */
function stars(average: number): Html {
  const full = Math.round(average);
  return html`<span class="tradie-stars" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => icon('star', { size: 'size-4', weight: n <= full ? 'fill' : 'regular' }))}</span>`;
}

/**
 * The ratings in one glance: the myEST8 rating (the starting rating and every rating since)
 * with a bar for each source beside it. The Property Managers', the Tenants' and Google's
 * are shown on their own, never combined.
 */
function ratingSummary(t: TradieView): Html {
  const { average, count } = t.myEst8Rating;
  const bySource = (label: string, source: TradieView['ratings'][number]['source']) => {
    const scores = t.ratings.filter((r) => r.source === source).map((r) => r.score);
    if (!scores.length) return { label, score: null as number | null, note: 'No ratings yet', tone: '' };
    return { label, score: scores.reduce((a, b) => a + b, 0) / scores.length, note: `${scores.length} ${scores.length === 1 ? 'rating' : 'ratings'}`, tone: '' };
  };
  const google = t.googleRating
    ? { label: 'Google rating', score: t.googleRating.rating, note: `${t.googleRating.reviewCount ?? 0} reviews`, tone: ' is-google' }
    : { label: 'Google rating', score: null as number | null, note: 'Not on Google', tone: ' is-google' };
  const rows = [bySource('From Property Managers', 'property_manager'), bySource('From Tenants', 'tenant'), google];
  return html`<section class="tradie-rating" aria-label="Ratings">
    <div class="tradie-rating-main">
      <p class="tradie-rating-label">myEST8 rating</p>
      <p class="tradie-rating-score"><strong class="num">${average.toFixed(1)}</strong>${stars(average)}</p>
      <p class="tradie-rating-hint">${count === 1 ? 'The starting rating; no Jobs rated yet' : `From ${count} ratings, incl. the starting rating`}</p>
    </div>
    <ul class="tradie-bars" role="list">
      ${rows.map(
        (row) => html`<li class="tradie-bar-row${row.tone}">
          <span class="tradie-bar-label">${row.label}</span>
          <span class="tradie-bar-value">${row.score === null ? '' : html`<strong class="num">${row.score.toFixed(1)}</strong> <span aria-hidden="true">·</span> `}${row.note}</span>
          ${row.score === null ? html`<span class="tradie-bar is-empty" aria-hidden="true"></span>` : html`<progress class="tradie-bar" max="5" value="${row.score}" aria-hidden="true"></progress>`}
        </li>`,
      )}
    </ul>
  </section>`;
}

/**
 * The side card: who to ask for and the numbers behind the Quotes, then the contact details and
 * the Trades, all editing in place (the pen turns the values into inputs and adds the business
 * name). The ratings and the Google listing aren't edited here; the business address has its
 * own form in the Service area card.
 */
function details(t: TradieView, editing: boolean, refused: DetailsEdit | undefined, people: Parameters<typeof othersUsing>[0]): Html {
  const values = refused?.values ?? { businessName: t.businessName ?? '', name: t.name, mobile: t.mobile ?? '', email: t.email ?? '', trades: t.trades };
  const errors = refused?.errors;
  const controls = contactControls('tradie', { values, errors });
  const reach = (kind: 'mobile' | 'email', value: string | null) => (value ? html`${contactLink(kind, value)}${sharedAddressNote('Also', othersUsing(people, value, t.tradieId))}` : html`<span class="text-muted">—</span>`);
  const row = (label: string, read: Html | string, edit?: { for: string; control: Html }) =>
    html`<div class="tradie-fact"><dt>${edit ? html`<label for="${edit.for}">${label}</label>` : label}</dt><dd>${editSwap(read, edit?.control)}</dd></div>`;
  return inlineEdit({
    id: 'details',
    label: 'Tradie details',
    action: `/tradies/${t.tradieId}/details`,
    edit: { label: 'Edit details', href: `/tradies/${t.tradieId}?edit=details#details` },
    cancel: `/tradies/${t.tradieId}#details`,
    save: 'Save details',
    editing,
    canEdit: !t.removedAt,
    className: 'tradie-side-card',
    refusal: refused && !Object.keys(refused.errors).length ? refused.message : undefined,
    view: (tools) => html`
      <div class="tradie-side-head"><h2 class="tradie-side-title">Tradie details</h2>${tools}</div>
      <dl class="tradie-facts">
        ${row('Contact', t.name, controls.name)}
        <div class="tradie-fact inline-edit-only"><dt><label for="tradie-business">Business name</label></dt><dd><div class="inline-edit-control">${field({ label: 'Business name', name: 'businessName', id: 'tradie-business', required: true, bare: true, value: valueOf(values, 'businessName'), error: errors?.businessName })}</div></dd></div>
        ${row('Quotes given', html`<span class="num">${t.previousQuotes.length}</span>`)}
        ${row('Visits booked', html`<span class="num">${t.bookings.length}</span>`)}
      </dl>
      <div class="tradie-side-block">
        <h3 class="tradie-side-sub">Contact information</h3>
        <dl class="tradie-facts is-stacked">
          ${row('Mobile', reach('mobile', t.mobile), controls.mobile)}
          ${row('Email', reach('email', t.email), controls.email)}
        </dl>
      </div>
      <div class="tradie-side-block">
        <h3 class="tradie-side-sub">Trades</h3>
        ${editSwap(html`<span class="tradie-trades">${t.trades.map((trade) => badge(humanise(trade), 'info'))}</span>`, tradesControl({ values, errors }))}
      </div>`,
  });
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
  return html`<div class="grid gap-4 md:grid-cols-2">${group('From Property Managers', 'property_manager')}${group('From Tenants', 'tenant')}</div>`;
}

const OUTCOME: Record<TradieView['previousQuotes'][number]['outcome'], { badge: Html; label: string }> = {
  chosen: { badge: html`<span class="badge badge-soft badge-success">${icon('check', { size: 'size-3', weight: 'bold' })}Chosen</span>`, label: 'Chosen' },
  not_chosen: { badge: badge('Not chosen', 'neutral'), label: 'Not chosen' },
  waiting: { badge: html`<span class="badge badge-soft badge-info"><span class="tradie-dot" aria-hidden="true"></span>Not decided yet</span>`, label: 'Not decided yet' },
};

/** Search, Trade and Outcome over the Quotes below. They narrow the list in the page, so they need app.js and show only with it. */
function quoteFilters(t: TradieView): Html {
  const trades = [...new Set(t.previousQuotes.map((q) => q.trade))];
  return html`<div class="tradie-filters js-only" role="search" aria-label="Filter the Quotes">
    <label class="tradie-search">${icon('magnifying-glass', { size: 'size-4' })}<span class="sr-only">Search the Quotes</span><input type="search" class="input" placeholder="Search quotes" data-quote-search autocomplete="off" /></label>
    ${trades.length > 1
      ? html`<label class="tradie-select"><span class="sr-only">Trade</span><select class="select" data-quote-trade><option value="">Trade</option>${trades.map((trade) => html`<option value="${trade}">${humanise(trade)}</option>`)}</select></label>`
      : ''}
    <label class="tradie-select"><span class="sr-only">Outcome</span><select class="select" data-quote-outcome><option value="">Outcome</option>${Object.entries(OUTCOME).map(([key, o]) => html`<option value="${key}">${o.label}</option>`)}</select></label>
  </div>`;
}

/** The Quotes a Property Manager confirmed, newest first: the Ticket, its words, whether it was chosen, the price and the way to the Ticket. */
function quotes(t: TradieView, timeZone: string): Html {
  const newestFirst = [...t.previousQuotes].sort((a, b) => b.at.localeCompare(a.at));
  if (!newestFirst.length) return emptyState('No Quotes yet.');
  return html`${quoteFilters(t)}
    <div class="tradie-quotes" data-quotes>
      ${newestFirst.map(
        (q) => html`<article class="tradie-quote" data-quote data-trade="${q.trade}" data-outcome="${q.outcome}" data-text="${`#${q.ticketId} ${q.description} ${q.propertyAddress} ${humanise(q.trade)}`.toLowerCase()}">
          <div class="tradie-quote-top">
            <h3 class="tradie-quote-title"><a href="/tickets/${q.ticketId}">Ticket #${q.ticketId}</a><span class="tradie-quote-trade">${humanise(q.trade)}</span></h3>
            ${OUTCOME[q.outcome].badge}
          </div>
          <p class="tradie-quote-property"><span>Property:</span> <a class="link" href="/properties/${q.propertyId}">${q.propertyAddress}</a></p>
          <p class="tradie-quote-text">${q.description}</p>
          <div class="tradie-quote-foot">
            <span class="tradie-quote-when">Received ${formatWhen(q.at, timeZone)}</span>
            <strong class="tradie-quote-price num">${formatMoney(q.priceCents)}</strong>
            <a class="btn btn-secondary btn-sm" href="/tickets/${q.ticketId}">Open Ticket</a>
          </div>
        </article>`,
      )}
      <p class="tradie-quotes-none" data-quotes-none hidden>No Quotes match.</p>
    </div>`;
}

/** Visits to come, each with the Ticket it is for. */
function bookings(t: TradieView, timeZone: string): Html {
  return t.bookings.length
    ? table(
        ['Ticket', 'When', 'Property Manager'],
        t.bookings.map((b) => [
          ticketCell({ ticketId: b.ticketId, issue: b.description, address: b.propertyAddress }),
          html`<span class="num whitespace-nowrap">${timeRange(b.start, b.end, timeZone)}</span>`,
          html`<span class="text-muted">${b.propertyManager}</span>`,
        ]),
        { caption: 'Upcoming bookings', stack: true },
      )
    : emptyState('Nothing booked.');
}

/**
 * The tabs: Previous Quotes (with the read of their work and the ratings at a glance above the
 * list), Jobs (the bookings to come) and Ratings (every one given). Without JavaScript the
 * three panes are listed one under another, each under its heading.
 */
function tabs(t: TradieView, timeZone: string): Html {
  const tab = (id: string, label: string, count: number | null, selected = false) =>
    html`<button type="button" role="tab" id="tab-${id}" class="tradie-tab" aria-controls="${id}" aria-selected="${selected ? 'true' : 'false'}">${label}${count === null ? '' : html` <span class="tradie-tab-count num">${count}</span>`}</button>`;
  const ratingsGiven = t.ratings.length;
  return html`<section class="tradie-tabs" data-tabs aria-label="${t.businessName ?? t.name}'s work">
    <div class="tradie-tablist js-only" role="tablist" aria-label="Views">
      ${tab('tradie-quotes', 'Previous Quotes', t.previousQuotes.length, true)}${tab('tradie-jobs', 'Jobs', t.bookings.length)}${tab('tradie-ratings', 'Ratings', ratingsGiven)}
    </div>
    <div class="tradie-pane" role="tabpanel" id="tradie-quotes" aria-labelledby="tab-tradie-quotes">
      <h2 class="tradie-pane-title">Previous Quotes</h2>
      <div class="tradie-insight"><p class="tradie-insight-tag">${icon('sparkle', { size: 'size-3.5', weight: 'fill' })}myEST8 insight</p>${profileRead(t.read)}</div>
      ${ratingSummary(t)}
      ${quotes(t, timeZone)}
    </div>
    <div class="tradie-pane" role="tabpanel" id="tradie-jobs" aria-labelledby="tab-tradie-jobs">
      <h2 class="tradie-pane-title">Upcoming bookings</h2>
      ${bookings(t, timeZone)}
    </div>
    <div class="tradie-pane" role="tabpanel" id="tradie-ratings" aria-labelledby="tab-tradie-ratings">
      <h2 class="tradie-pane-title">Ratings</h2>
      ${ratings(t, timeZone)}
    </div>
  </section>`;
}
