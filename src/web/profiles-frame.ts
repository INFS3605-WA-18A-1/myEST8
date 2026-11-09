// The frame every Profiles page shares, so moving between the kinds of profile never
// changes the page around the list: the h1 "Profiles" with the chips for each kind beside
// it (the one shown filled), then one white card whose top band holds the search on the
// left and Mine / All and the Add button on the right. /profiles is the All chip; the
// lists are /properties, /tenants, /owners, /tradies and /building-managers.

import { html } from 'hono/html';
import { icon } from './icons.ts';
import { segmented, type Html } from './ui.ts';

export type ProfileTab = 'all' | 'properties' | 'tenants' | 'owners' | 'tradies' | 'building-managers';
export type ProfileFilter = 'mine' | 'all';
export type ProfileCounts = { properties: number; tenants: number; owners: number; tradies: number; buildingManagers: number };

const TABS: { tab: ProfileTab; label: string; path: string; count: keyof ProfileCounts | null }[] = [
  { tab: 'all', label: 'All', path: '/profiles', count: null },
  { tab: 'properties', label: 'Properties', path: '/properties', count: 'properties' },
  { tab: 'tenants', label: 'Tenants', path: '/tenants', count: 'tenants' },
  { tab: 'owners', label: 'Property Owners', path: '/owners', count: 'owners' },
  { tab: 'tradies', label: 'Tradies', path: '/tradies', count: 'tradies' },
  { tab: 'building-managers', label: 'Building Managers', path: '/building-managers', count: 'buildingManagers' },
];

/** A Profiles page's address with All kept (Mine is every page's default, so it adds nothing), plus any other query (a search, a Trade). */
export function profileHref(path: string, filter: ProfileFilter | null, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({ ...(filter === 'all' ? { filter } : {}), ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) }).toString();
  return query ? `${path}?${query}` : path;
}

/** The kinds of profile as chips beside the title: each opens its list, Mine or All carried along (Tradies are the Agency's either way, but carry it on). */
export function profileChips(active: ProfileTab, counts: ProfileCounts, filter: ProfileFilter): Html {
  return html`<nav class="profiles-chips" aria-label="Profile types">
    ${TABS.map(({ tab, label, path, count }) => {
      const on = tab === active;
      const n = count ? counts[count] : 0;
      return html`<a class="profiles-chip${on ? ' is-active' : ''}" href="${profileHref(path, filter)}" title="${label}" ${on ? html`aria-current="page"` : ''}><span class="profiles-chip-label">${label}</span>${n ? html` <span class="num">${n}</span>` : ''}</a>`;
    })}
  </nav>`;
}

/** Mine and All for a Profiles page, keeping its other query. */
export function mineAll(path: string, filter: ProfileFilter, extra: Record<string, string> = {}): Html {
  return segmented(
    [
      { label: 'Mine', href: profileHref(path, 'mine', extra), active: filter === 'mine' },
      { label: 'All', href: profileHref(path, 'all', extra), active: filter === 'all' },
    ],
    'Whose Properties',
  );
}

/**
 * The search over a list page: it narrows the rows as you type (static/app.js). It needs
 * JavaScript, so without it the box is hidden and every row shows.
 */
export function listFilter(label: string, placeholder: string): Html {
  return html`<div class="profiles-search js-only" role="search">
    <label class="profiles-search-field">
      <span class="sr-only">${label}</span>
      ${icon('magnifying-glass', { size: 'size-4' })}
      <input type="search" placeholder="${placeholder}" autocomplete="off" data-list-filter />
    </label>
  </div>`;
}

/** The Add button at the toolbar's right on a list page. */
export function addButton(label: string, href: string): Html {
  return html`<a class="btn btn-primary btn-sm" href="${href}">${icon('plus', { size: 'size-4' })}${label}</a>`;
}

/** The white card: its top band (the search, then Mine / All and Add at the right), then the page's own body. */
export function profilesCard(o: { search: Html; end: Html; body: Html; flush?: boolean }): Html {
  return html`<div class="profiles-card">
    <div class="profiles-toolbar">
      ${o.search}
      <div class="profiles-toolbar-end">${o.end}</div>
    </div>
    ${o.flush ? o.body : html`<div class="profiles-list" data-list-scope>${o.body}<p class="profiles-list-none" data-list-none hidden>No matches. Try fewer letters.</p></div>`}
  </div>`;
}
