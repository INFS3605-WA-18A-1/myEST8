// Settings: the Agency, its channels, its team and importing from a spreadsheet, in
// side tabs. Each tab shows what is set today and links straight to the Setup section
// whose form changes it. The rest of the Agency's settings (Quote and approval timings, messages) are
// not editable yet.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { dl, emptyState, flashFrom, formatWhen, linkButton, page, section, sideTabs, table, type Html } from '../ui.ts';

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
const SETUP_AREAS: { label: string; list?: string; add: string; href: string }[] = [
  { label: 'Properties', list: '/properties', add: 'Add a Property', href: '/setup#properties' },
  { label: 'Tradies', list: '/tradies', add: 'Add a Tradie', href: '/setup#tradies' },
  { label: 'Tenants', add: 'Add a Tenant', href: '/setup#tenants' },
  { label: 'Property Owners and Building Managers', add: 'Add an Owner or Building Manager', href: '/setup#people' },
];

/** Where each kind of spreadsheet is imported: the Setup area that holds its upload form. */
const IMPORTS = [
  ['Property Owners and Building Managers', '/setup#people'],
  ['Tradies', '/setup#tradies'],
  ['Properties', '/setup#properties'],
  ['Tenants', '/setup#tenants'],
] as const;

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
        body: html`<div class="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          ${sideTabs(TABS.map(([key, label]) => ({ label, href: key === 'agency' ? '/settings' : `/settings?tab=${key}`, active: key === tab })), 'Settings')}
          <div class="grid min-w-0 gap-4">${body}</div>
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
    body: html`<ul class="grid gap-2" role="list">
      ${SETUP_AREAS.map(
        (area) =>
          html`<li class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
            ${area.list ? html`<a class="link" href="${area.list}">${area.label}</a>` : html`<span>${area.label}</span>`}${linkButton(area.add, area.href, { size: 'sm' })}
          </li>`,
      )}
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
          channels.map((ch) => [html`${CHANNEL_NAME[ch.type]}`, html`${ch.address}`, html`${ch.testedAt ? formatWhen(ch.testedAt, timeZone) : 'Not tested'}`]),
          { caption: 'Channels' },
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
      team.map((m) => [html`${m.name}${m.id === meId ? html` <span class="text-muted">(you)</span>` : ''}`, html`<a class="link break-all" href="mailto:${m.email}">${m.email}</a>`]),
      { caption: 'Property Managers in the Agency' },
    ),
  });
}

function importTab(): Html {
  return section({
    title: 'Import',
    body: html`<p class="mb-3 text-sm text-muted">Add many at once from an Excel or CSV file. You review the rows before anything is added.</p>
      <ul class="grid gap-2" role="list">
        ${IMPORTS.map(([label, href]) => html`<li class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0"><span>${label}</span>${linkButton('Import', href, { size: 'sm' })}</li>`)}
      </ul>`,
  });
}
