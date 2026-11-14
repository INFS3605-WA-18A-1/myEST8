// The card every profile is drawn in (a Tradie, a Tenant, an Owner, a Building Manager, a
// Property), so opening one kind of profile reads like opening any other: a way back, an
// avatar with the name and a line of what matters most, the actions and a step to the
// profile before and after in its list's order; then tabs of their history on the left
// (counts on each tab) and the details that edit in place on the right.

import { html } from 'hono/html';
import { icon } from './icons.ts';
import { editSwap, type Html } from './ui.ts';

/** A profile next to this one in its list, for the steps beside the actions. */
export type Neighbour = { href: string; name: string };

/** "PP" for Proximity Plumbing; the first two letters of a one-word name. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : name.slice(0, 2)).toUpperCase();
}

/** The previous and next profile in `list`'s order around the one whose key is `key`, or none when it isn't listed (a removed one). */
export function neighboursIn<T>(list: T[], keyOf: (item: T) => number, key: number, link: (item: T) => Neighbour): { before: Neighbour | null; after: Neighbour | null } | null {
  const at = list.findIndex((item) => keyOf(item) === key);
  if (at < 0) return null;
  return { before: at > 0 ? link(list[at - 1]!) : null, after: at < list.length - 1 ? link(list[at + 1]!) : null };
}

/**
 * The top of the card. `avatar` is initials or an icon; `meta` is the line under the name,
 * its items set apart by dots; `steps` (with `noun`, "Tenant") steps through the list.
 */
export function profileHero(o: {
  back: { href: string; label: string };
  avatar: Html | string;
  name: string;
  meta: (Html | string)[];
  actions?: Html;
  steps?: { before: Neighbour | null; after: Neighbour | null } | null;
  noun: string;
}): Html {
  const step = (n: Neighbour | null, label: string, glyph: 'caret-left' | 'caret-right') =>
    n
      ? html`<a class="tradie-step" href="${n.href}" aria-label="${label}: ${n.name}" title="${label}: ${n.name}">${icon(glyph, { size: 'size-4' })}</a>`
      : html`<span class="tradie-step is-off" aria-hidden="true">${icon(glyph, { size: 'size-4' })}</span>`;
  const meta = o.meta.filter((m) => m !== '');
  return html`<header class="tradie-hero">
    <a class="tradie-back" href="${o.back.href}" aria-label="${o.back.label}" title="${o.back.label}">${icon('caret-left', { size: 'size-4' })}</a>
    <span class="tradie-hero-avatar" aria-hidden="true">${o.avatar}</span>
    <div class="tradie-hero-text">
      <h1 class="tradie-name">${o.name}</h1>
      ${meta.length ? html`<p class="tradie-hero-meta">${meta.map((m, i) => html`${i ? html`<span class="tradie-hero-dot" aria-hidden="true">·</span>` : ''}${m}`)}</p>` : ''}
    </div>
    <div class="tradie-hero-actions">
      ${o.actions ?? ''}
      ${o.steps ? html`<span class="tradie-steps">${step(o.steps.before, `Previous ${o.noun}`, 'caret-left')}${step(o.steps.after, `Next ${o.noun}`, 'caret-right')}</span>` : ''}
    </div>
  </header>`;
}

/** "Call Pete" for a person with a mobile; nothing without one. */
export function callButton(name: string, mobile: string | null): Html {
  if (!mobile) return html``;
  return html`<a class="btn btn-primary btn-sm" href="tel:${mobile.replace(/\s+/g, '')}">${icon('phone', { size: 'size-4' })}Call ${name.split(/\s+/)[0]}</a>`;
}

/** The card: the hero over the tabs, with the side column (`aria-label` "About …") beside them from 64rem. */
export function profileCard(o: { hero: Html; main: Html; side: Html; about: string }): Html {
  return html`<div class="tradie-card">
    ${o.hero}
    <div class="tradie-board">
      <div class="tradie-main">${o.main}</div>
      <aside class="tradie-side" aria-label="About ${o.about}">${o.side}</aside>
    </div>
  </div>`;
}

/** One tab of a profile: its label and count, the heading it has without JavaScript, and what it shows. */
export type ProfileTab = { id: string; label: string; count: number | null; title?: string; body: Html };

/**
 * The tabs, the first selected. Without JavaScript the panes are listed one under another,
 * each under its heading (static/app.js picks the selected one).
 */
export function profileTabs(label: string, tabs: ProfileTab[]): Html {
  return html`<section class="tradie-tabs" data-tabs aria-label="${label}">
    <div class="tradie-tablist js-only" role="tablist" aria-label="Views">
      ${tabs.map(
        (t, i) =>
          html`<button type="button" role="tab" id="tab-${t.id}" class="tradie-tab" aria-controls="${t.id}" aria-selected="${i === 0 ? 'true' : 'false'}">${t.label}${t.count === null ? '' : html` <span class="tradie-tab-count num">${t.count}</span>`}</button>`,
      )}
    </div>
    <div class="tab-panes">
      ${tabs.map(
        (t) => html`<div class="tradie-pane" role="tabpanel" id="${t.id}" aria-labelledby="tab-${t.id}">
          <h2 class="tradie-pane-title">${t.title ?? t.label}</h2>
          ${t.body}
        </div>`,
      )}
    </div>
  </section>`;
}

/** The read of a profile's record (profileRead), in the band the tabs open with. */
export function insight(read: Html): Html {
  return html`<div class="tradie-insight"><p class="tradie-insight-tag">${icon('sparkle', { size: 'size-3.5', weight: 'fill' })}myEST8 insight</p>${read}</div>`;
}

/** One label and value in a side card; `edit` is the control that takes the value's place while editing. */
export function sideFact(label: string, read: Html | string, edit?: { for: string; control: Html }): Html {
  return html`<div class="tradie-fact"><dt>${edit ? html`<label for="${edit.for}">${label}</label>` : label}</dt><dd>${editSwap(read, edit?.control)}</dd></div>`;
}

/** A row that shows only while editing (a name that is otherwise the card's title). */
export function editOnlyFact(label: string, edit: { for: string; control: Html }): Html {
  return html`<div class="tradie-fact inline-edit-only"><dt><label for="${edit.for}">${label}</label></dt><dd><div class="inline-edit-control">${edit.control}</div></dd></div>`;
}

/** A side card's heading, with the pen (or the tick and cross) beside it. */
export function sideHead(title: string, tools: Html = html``): Html {
  return html`<div class="tradie-side-head"><h2 class="tradie-side-title">${title}</h2>${tools}</div>`;
}
