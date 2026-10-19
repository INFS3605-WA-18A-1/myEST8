// Settings: the Agency, its channels, its team and importing from a spreadsheet, in
// side tabs. Each tab shows what is set today and links straight to the Setup section
// whose form changes it. The rest of the Agency's settings (Quote and approval timings, messages) are
// not editable yet.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import type { ImportKind } from '../../imports.ts';
import { icon } from '../icons.ts';
import { dl, emptyState, flashFrom, formatWhen, linkButton, page, section, sideTabs, table, type Html } from '../ui.ts';
import { IMPORT_NOUNS, templatePath } from './onboarding-forms.ts';

type AgencyChannel = Awaited<ReturnType<PropertyManagerActions['channels']>>[number];

const TABS = [
  ['agency', 'Agency'],
  ['channels', 'Channels'],
  ['team', 'Team'],
  ['import', 'Import'],
] as const;
type Tab = (typeof TABS)[number][0];

const CHANNEL_NAME: Record<AgencyChannel['type'], string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };

/**
 * The Agency's Properties and the people around them: where each list is (if it has a
 * page) and the Setup section that adds to it.
 */
const SETUP_AREAS: { label: string; hint: string; list?: string; add: string; href: string }[] = [
  { label: 'Properties', hint: 'Each with its Property Owner and Max Repair Cost.', list: '/properties', add: 'Add a Property', href: '/setup#properties' },
  { label: 'Tradies', hint: 'Who you send Quote Requests and Work Orders to.', list: '/tradies', add: 'Add a Tradie', href: '/setup#tradies' },
  { label: 'Tenants', hint: 'Each with their Property, contact details and Tickets.', list: '/tenants', add: 'Add a Tenant', href: '/setup#tenants' },
  { label: 'Property Owners and Building Managers', hint: 'Listed on each Property’s page.', add: 'Add an Owner or Building Manager', href: '/setup#people' },
];

/** One line of a Settings list: what it is (linked when it has a page), a muted hint, and its actions at the end. */
function settingsRow(o: { label: string; href?: string; hint?: string; actions: Html }): Html {
  return html`<li class="settings-row">
    <div class="settings-row-text">
      ${o.href ? html`<a class="settings-row-label link" href="${o.href}">${o.label}</a>` : html`<span class="settings-row-label">${o.label}</span>`}
      ${o.hint ? html`<span class="settings-row-hint">${o.hint}</span>` : ''}
    </div>
    <div class="settings-row-actions">${o.actions}</div>
  </li>`;
}

/**
 * Each kind of spreadsheet, in the order they must happen (a Property needs its Property
 * Owner, a Tenant their Property; Tradies stand alone), with what each row holds.
 */
const IMPORTS: { kind: ImportKind; hint: string }[] = [
  { kind: 'owners', hint: 'Name, mobile and email.' },
  { kind: 'building-managers', hint: 'For strata Properties.' },
  { kind: 'properties', hint: 'Needs their Property Owners first.' },
  { kind: 'tenants', hint: 'Needs their Properties first.' },
  { kind: 'tradies', hint: 'Business, Trades and a starting rating.' },
];

/** Settings under /settings. */
export function settingsPages() {
  const pages = new Hono<WebEnv>();
  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const tab: Tab = TABS.find(([key]) => key === c.req.query('tab'))?.[0] ?? 'agency';
    const { timeZone } = actions.agency();
    const body: Html =
      tab === 'channels'
        ? channelsTab(await actions.channels(), timeZone)
        : tab === 'team'
          ? teamTab(await actions.propertyManagers(), pm.id)
          : tab === 'import'
            ? importTab()
            : agencyTab(actions.agency(), (await actions.propertyManagers()).length);
    return c.html(
      page({
        title: 'Settings',
        pm,
        active: 'settings',
        shell: shellInfo(c),
        flash: flashFrom(c.req.url),
        body: html`<div class="settings-layout">
          ${sideTabs(TABS.map(([key, label]) => ({ label, href: key === 'agency' ? '/settings' : `/settings?tab=${key}`, active: key === tab })), 'Settings')}
          <div class="settings-panel">${body}</div>
        </div>`,
      }),
    );
  });
  return pages;
}

function agencyTab(agency: { name: string; timeZone: string }, team: number): Html {
  return html`${section({
    title: 'Agency',
    body: html`${dl([
        ['Name', agency.name],
        ['Time zone', agency.timeZone],
        ['Property Managers', String(team)],
        ['Urgent Repair limit', '$1,000, set by NSW law'],
      ])}
      <p class="text-sm text-muted">Quote reminders, approval delays and message wording are not editable yet.</p>`,
  })}${section({
    title: 'Properties and people',
    body: html`<ul class="settings-list" role="list">
      ${SETUP_AREAS.map((area) => settingsRow({ label: area.label, href: area.list, hint: area.hint, actions: linkButton(area.add, area.href, { size: 'sm' }) }))}
    </ul>`,
  })}`;
}

function channelsTab(channels: AgencyChannel[], timeZone: string): Html {
  return section({
    title: 'Channels',
    actions: linkButton('Manage channels', '/setup#channels', { size: 'sm' }),
    body: channels.length
      ? table(
          ['Channel', 'Address', 'Last test message'],
          channels.map((ch) => [
            html`<span class="font-medium">${CHANNEL_NAME[ch.type]}</span>`,
            html`<span class="break-all">${ch.address}</span>`,
            html`${ch.testedAt ? formatWhen(ch.testedAt, timeZone) : html`<span class="text-muted">Not tested</span>`}`,
          ]),
          { caption: 'Channels', stack: 'labelled' },
        )
      : emptyState('No channels connected. Connect SMS or email so Tenants can reach you.', linkButton('Connect a channel', '/setup#channels', { variant: 'primary', size: 'sm' })),
  });
}

function teamTab(team: Awaited<ReturnType<PropertyManagerActions['propertyManagers']>>, meId: number): Html {
  return section({
    title: 'Team',
    actions: linkButton('Add a colleague', '/welcome/team', { size: 'sm' }),
    body: table(
      ['Name', 'Email'],
      team.map((m) => [html`<span class="font-medium">${m.name}</span>${m.id === meId ? html` <span class="text-muted">(you)</span>` : ''}`, html`<a class="link break-all" href="mailto:${m.email}">${m.email}</a>`]),
      { caption: 'Property Managers in the Agency', stack: 'labelled' },
    ),
  });
}

function importTab(): Html {
  return section({
    title: 'Import',
    body: html`<p class="settings-intro">Add many at once from an Excel or CSV file. You review the rows before anything is added. Fill in the template so the columns match.</p>
      <ul class="settings-list" role="list">
        ${IMPORTS.map(({ kind, hint }) =>
          settingsRow({
            label: IMPORT_NOUNS[kind].many,
            hint,
            actions: html`<a class="link import-template" href="${templatePath(kind)}" download>${icon('download-simple', { size: 'size-4' })}<span>Template<span class="sr-only"> for ${IMPORT_NOUNS[kind].many}</span></span></a>
              ${linkButton(`Import ${IMPORT_NOUNS[kind].many}`, `/setup#import-${kind}`, { size: 'sm' })}`,
          }),
        )}
      </ul>`,
  });
}
