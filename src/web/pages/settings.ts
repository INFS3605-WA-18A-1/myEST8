// Settings: the Agency, its channels, its team and importing from a spreadsheet, in
// side tabs. Everything that changes a setting happens here, under /settings: no
// control sends the Property Manager to Setup, the welcome guide or another page.
// Channels connect on the Channels tab. Records (Properties, Tradies, Tenants,
// Property Owners) are not settings; they live on Profiles.
//
//   GET  /settings[?tab=…]                  a tab: agency (the default), channels, team, import
//   GET  /settings/agency/edit              the Agency tab with its details as a form
//   POST /settings/agency                   save the Agency's name and time zone
//   POST /settings/team                     add a colleague; shows their temporary password once
//   GET  /settings/team/<id>/remove         who takes over their Properties, then remove
//   POST /settings/team/<id>/remove         remove the colleague
//   GET  /settings/import/<kind>            upload a spreadsheet of one kind
//   …    /settings/import…, /imports…, /templates…   the upload, review and templates (import.ts)

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { IMPORT_KINDS, type ImportKind } from '../../imports.ts';
import { ActionError, normalizeAddress } from '../../shared.ts';
import { NO_CONNECTORS, type ChannelConnectors } from '../connectors.ts';
import type { WebEnv } from '../env.ts';
import { text, type FormValues } from '../forms.ts';
import { icon } from '../icons.ts';
import { shellInfo } from '../shell.ts';
import {
  button,
  contactLink,
  dl,
  emptyState,
  field,
  flashFrom,
  formatWhen,
  linkButton,
  page,
  section,
  table,
  withFlash,
  type Flash,
  type Html,
} from '../ui.ts';
import { channelName, laterChannelList, WORKING_CHANNELS } from './channel-options.ts';
import { importPages, settingsImportPath } from './import.ts';
import {
  CHANNELS,
  channelChip,
  addColleague,
  colleagueAdded,
  type ColleagueAdded,
  colleagueForm,
  fieldGrid,
  IMPORT_NOUNS,
  importPanel,
  emailSetup,
  phoneChannelForm,
  templatePath,
  unavailableChip,
  unavailableNote,
  valueOf,
  valuesOf,
  type Errors,
  type Values,
} from './onboarding-forms.ts';
import { serverSmsPanel } from './server-sms.ts';
import { serverWhatsappPanel, whatsappChip } from './server-whatsapp.ts';
import { SETTINGS_TABS, settingsLayout, settingsTabHref, type SettingsTab } from './settings-shell.ts';
import { TIME_ZONES } from './signup.ts';
import { smsNumberPanel } from './sms-number.ts';

type AgencyChannel = Awaited<ReturnType<PropertyManagerActions['channels']>>[number];
type Agency = ReturnType<PropertyManagerActions['agency']>;
type Colleague = Awaited<ReturnType<PropertyManagerActions['propertyManagers']>>[number];

const CHANNEL_NAME = Object.fromEntries(WORKING_CHANNELS.map((ch) => [ch.key, ch.name])) as Record<AgencyChannel['type'], string>;

/** One line of a Settings list: what it is, a muted hint, and its actions at the end. */
function settingsRow(o: { label: string; hint?: string; actions: Html }): Html {
  return html`<li class="settings-row">
    <div class="settings-row-text">
      <span class="settings-row-label">${o.label}</span>
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
  { kind: 'properties', hint: 'Needs their Owners first.' },
  { kind: 'tenants', hint: 'Needs their Properties first.' },
  { kind: 'tradies', hint: 'Business, Trades and a starting rating.' },
];

const isKind = (value: string): value is ImportKind => (IMPORT_KINDS as readonly string[]).includes(value);

/** A Settings page: the side tabs with `tab` current, and `body` beside them. */
function settingsPage(c: Context<WebEnv>, tab: SettingsTab, body: Html, o: { flash?: Flash | null } = {}): Html {
  return page({
    title: 'Settings',
    pm: c.var.pm,
    active: 'settings',
    shell: shellInfo(c),
    flash: o.flash === undefined ? flashFrom(c.req.url) : o.flash,
    body: settingsLayout(tab, body),
  });
}

/** Settings under /settings. */
export function settingsPages(o: { connectors?: ChannelConnectors } = {}) {
  const connectors = o.connectors ?? NO_CONNECTORS;
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions } = c.var;
    const tab: SettingsTab = SETTINGS_TABS.find(([key]) => key === c.req.query('tab'))?.[0] ?? 'agency';
    const body: Html =
      tab === 'channels'
        ? await channelsTab(actions, actions.agency().timeZone, connectors)
        : tab === 'team'
          ? await teamTab(c, {})
          : tab === 'import'
            ? importTab()
            : agencyTab(actions.agency(), (await actions.propertyManagers()).length);
    return c.html(settingsPage(c, tab, body));
  });

  // The Agency's details

  pages.get('/agency/edit', (c) => c.html(settingsPage(c, 'agency', agencyForm(c.var.actions.agency(), {}))));
  pages.post('/agency', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    try {
      await c.var.actions.editAgency({ name: text(form, 'name'), timeZone: text(form, 'timeZone') });
      return c.redirect(withFlash('/settings', 'ok', 'Agency details saved.'), 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.html(settingsPage(c, 'agency', agencyForm(c.var.actions.agency(), { values: valuesOf(form), errors: { ...error.fields } }), { flash: null }), 400);
    }
  });

  // The team

  pages.post('/team', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const colleague = { name: text(form, 'name'), email: text(form, 'email') };
    try {
      const added = await addColleague(c, colleague);
      // The page shows a password: keep it out of every cache, and out of the address bar.
      c.header('Cache-Control', 'no-store');
      return c.html(settingsPage(c, 'team', await teamTab(c, { added }), { flash: null }));
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      const errors = Object.keys(error.fields).length ? { ...error.fields } : { email: error.message };
      return c.html(settingsPage(c, 'team', await teamTab(c, { values: valuesOf(form), errors }), { flash: null }), 400);
    }
  });

  pages.get('/team/:id/remove', async (c) => {
    const shown = await removePage(c, {});
    return shown ?? c.redirect(withFlash(settingsTabHref('team'), 'error', 'Property Manager not found'), 303);
  });
  pages.post('/team/:id/remove', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const handTo = Number(text(form, 'handTo')) || null;
    try {
      const { name, moved } = await c.var.actions.removePropertyManager(Number(c.req.param('id')), { handTo });
      const to = moved ? (await c.var.actions.propertyManagers()).find((m) => m.id === handTo)?.name : undefined;
      const message = to ? `${name} removed. ${moved === 1 ? 'Their Property is' : `Their ${moved} Properties are`} now ${to}'s.` : `${name} removed.`;
      return c.redirect(withFlash(settingsTabHref('team'), 'ok', message), 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      if (error.fields.handTo) {
        const shown = await removePage(c, { error: error.fields.handTo }, 400);
        if (shown) return shown;
      }
      return c.redirect(withFlash(settingsTabHref('team'), 'error', error.message), 303);
    }
  });

  // Importing from a spreadsheet: each kind's upload page, then import.ts's upload, review and templates.

  pages.get('/import/:kind', (c) => {
    const kind = c.req.param('kind');
    if (!isKind(kind)) return c.notFound();
    return c.html(settingsPage(c, 'import', importKindPanel(kind)));
  });
  pages.route('/', importPages({ home: 'settings' }));

  return pages;
}

// Agency

function timeZoneLabel(timeZone: string) {
  return TIME_ZONES.find((z) => z.value === timeZone)?.label ?? timeZone;
}

function agencyTab(agency: Agency, team: number): Html {
  return section({
    title: 'Agency',
    actions: linkButton('Edit details', '/settings/agency/edit', { size: 'sm' }),
    body: html`${dl([
        ['Name', agency.name],
        ['Time zone', timeZoneLabel(agency.timeZone)],
        ['Property Managers', html`<a class="link" href="${settingsTabHref('team')}">${String(team)}<span class="sr-only"> Property Managers, see Team</span></a>`],
        ['Urgent Repair limit', '$1,000, set by NSW law'],
      ])}
      <p class="text-sm text-muted">Quote reminders, approval delays and message wording are not editable yet.</p>`,
  });
}

/** The Agency tab with its details as a form, as posted when refused. */
function agencyForm(agency: Agency, o: { values?: Values; errors?: Errors }): Html {
  const zones = TIME_ZONES.some((z) => z.value === agency.timeZone) ? TIME_ZONES : [...TIME_ZONES, { value: agency.timeZone, label: agency.timeZone }];
  return section({
    title: 'Edit Agency details',
    body: html`<form method="post" action="/settings/agency" class="details-form">
      ${fieldGrid(html`
        ${field({ label: 'Agency name', name: 'name', id: 'agency-name', required: true, autocomplete: 'organization', value: o.values ? valueOf(o.values, 'name') : agency.name, error: o.errors?.name })}
        ${field({
          label: 'Time zone',
          name: 'timeZone',
          id: 'agency-time-zone',
          type: 'select',
          options: zones,
          value: o.values ? valueOf(o.values, 'timeZone') : agency.timeZone,
          hint: 'Visit times, reminders and the Schedule follow it.',
          error: o.errors?.timeZone,
        })}
      `)}
      <div class="details-actions">${button('Save')}${linkButton('Cancel', '/settings', { variant: 'ghost' })}</div>
    </form>`,
  });
}

// Channels

async function channelsTab(actions: PropertyManagerActions, timeZone: string, connectors: ChannelConnectors): Promise<Html> {
  const channels = await actions.channels();
  const sms = await actions.smsNumber();
  const channelsSection = section({
    title: 'Channels',
    body: channels.length
      ? table(
          ['Channel', 'Address', 'Last test message'],
          channels.map((ch) => {
            // A number myEST8 set up (Twilio, or the server's own SMS phone or WhatsApp number) was proved when it was connected, so it has no test message.
            const viaTwilio = ch.type === 'sms' && sms?.number?.phoneNumber === ch.address;
            const server = ch.type === 'sms' ? connectors.smsPhone : ch.type === 'whatsapp' ? connectors.whatsappNumber : null;
            const viaServer = server !== null && normalizeAddress(server) === normalizeAddress(ch.address);
            return [
              html`<span class="font-medium">${CHANNEL_NAME[ch.type]}</span>`,
              html`<span class="break-all">${ch.address}</span>${viaTwilio ? html` <span class="text-muted">${sms.number!.kind === 'created' ? 'Created by myEST8' : 'Your Twilio number'}</span>` : ''}`,
              html`${viaTwilio || viaServer ? html`<span class="text-muted">Not needed</span>` : ch.testedAt ? formatWhen(ch.testedAt, timeZone) : html`<span class="text-muted">Not tested</span>`}`,
            ];
          }),
          { caption: 'Channels', stack: 'labelled' },
        )
      : emptyState('No channels connected yet. Connect one below so Tenants can reach you.'),
  });
  // Each channel connects in its own section here: nothing links out to Setup.
  const panels = await Promise.all(
    WORKING_CHANNELS.map(async ({ key }) => {
      const current = channels.find((ch) => ch.type === key);
      if (key === 'whatsapp') {
        return section({
          id: 'whatsapp',
          title: channelName('whatsapp'),
          actions: whatsappChip(connectors.whatsappNumber, current),
          body: serverWhatsappPanel({ from: 'settings', number: connectors.whatsappNumber, current: current?.address }),
        });
      }
      if (connectors.unavailable.includes(key)) {
        return section({ id: key, title: channelName(key), actions: unavailableChip(), body: unavailableNote(key, connectors.unavailable) });
      }
      if (key === 'email') {
        const email = await actions.ensureInboundEmail();
        return section({
          id: 'email',
          title: channelName('email'),
          actions: channelChip(current, { waiting: email.state === 'waiting', verified: email.state === 'verified' }),
          body: emailSetup(email),
        });
      }
      // SMS: the server's phone, else the Twilio panel, else a typed number proved with a code.
      const body = connectors.smsPhone
        ? serverSmsPanel({ from: 'settings', number: connectors.smsPhone, current: current?.address })
        : sms
          ? await smsNumberPanel(actions, { from: 'settings', current: current?.address })
          : phoneChannelForm({
              channel: CHANNELS.find((ch) => ch.type === 'sms')!,
              postTo: '/setup/channels?from=settings',
              confirmTo: '/setup/channels/confirm?from=settings',
              pending: (await actions.pendingChannelVerifications()).find((row) => row.channelType === 'sms'),
              current: current?.address,
              className: 'grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]',
            });
      return section({ id: 'sms', title: channelName('sms'), actions: connectors.smsPhone || sms ? undefined : channelChip(current), body });
    }),
  );
  // Quieter than the working channels: a muted heading and one line, not another section card.
  const later = html`<div id="later-channels" class="channel-later-group">
    <h2 class="channel-later-title">More channels</h2>
    ${laterChannelList()}
  </div>`;
  return html`${channelsSection}${panels}${later}`;
}

// Team

async function teamTab(c: Context<WebEnv>, o: { added?: ColleagueAdded; values?: Values; errors?: Errors }): Promise<Html> {
  const { actions, pm } = c.var;
  const team = await actions.propertyManagers();
  const properties = await actions.properties();
  const managed = (m: Colleague) => properties.filter((p) => p.propertyManagerId === m.id).length;
  return html`${o.added ? colleagueAdded(o.added, { origin: new URL(c.req.url).origin, agencyName: actions.agency().name }) : ''}
    ${section({
      title: 'Team',
      body: table(
        ['Name', 'Email', 'Properties', ''],
        team.map((m) => [
          html`<span class="font-medium">${m.name}</span>${m.id === pm.id ? html` <span class="text-muted">(you)</span>` : ''}`,
          contactLink('email', m.email),
          html`<span class="num">${String(managed(m))}</span>`,
          m.id === pm.id
            ? html``
            : html`<a class="btn btn-ghost btn-sm settings-remove" href="/settings/team/${m.id}/remove">Remove<span class="sr-only"> ${m.name}</span></a>`,
        ]),
        { caption: 'Property Managers in the Agency', stack: 'labelled' },
      ),
    })}
    ${section({
      id: 'add-colleague',
      title: 'Add a colleague',
      body: html`<p class="settings-intro">They get their own sign-in and see their own Properties first. Tenants, Tradies and Owners never need an account.</p>
        ${colleagueForm({ action: '/settings/team', values: o.values, errors: o.errors, invites: !!c.var.invite })}`,
    })}`;
}

/** Removing a colleague: what happens, and who takes over their Properties. Null when they aren't a colleague who can be removed. */
async function removePage(c: Context<WebEnv>, o: { error?: string }, status: 200 | 400 = 200) {
  const { actions, pm } = c.var;
  const id = Number(c.req.param('id'));
  const team = await actions.propertyManagers();
  const colleague = team.find((m) => m.id === id);
  if (!colleague || colleague.id === pm.id) return null;
  const managed = (await actions.properties()).filter((p) => p.propertyManagerId === id).length;
  const others = team.filter((m) => m.id !== id);
  const body = section({
    title: `Remove ${colleague.name}`,
    body: html`<form method="post" action="/settings/team/${id}/remove" class="settings-remove-form">
      <p>${colleague.name} will no longer be able to sign in to myEST8. Any spreadsheet they uploaded and haven't added yet is discarded. Their past work on Tickets stays.</p>
      ${managed
        ? html`<p>They look after ${managed === 1 ? 'one Property' : `${managed} Properties`}. Choose who takes ${managed === 1 ? 'it' : 'them'} over.</p>
            <div class="settings-field">
              ${field({
                label: 'Hand their Properties to',
                name: 'handTo',
                id: 'hand-to',
                type: 'select',
                required: true,
                options: others.map((m) => ({ value: String(m.id), label: m.id === pm.id ? `${m.name} (you)` : m.name })),
                value: String(pm.id),
                error: o.error,
              })}
            </div>`
        : ''}
      <div class="details-actions">${button(`Remove ${colleague.name}`, { variant: 'danger' })}${linkButton('Cancel', settingsTabHref('team'), { variant: 'ghost' })}</div>
    </form>`,
  });
  return c.html(settingsPage(c, 'team', body, { flash: null }), status);
}

// Import

function importTab(): Html {
  return section({
    title: 'Import',
    body: html`<p class="settings-intro">Add many at once from an Excel or CSV file. You review the rows before anything is added. Fill in the template so the columns match.</p>
      <ul class="settings-list" role="list">
        ${IMPORTS.map(({ kind, hint }) =>
          settingsRow({
            label: IMPORT_NOUNS[kind].many,
            hint,
            actions: html`<a class="link import-template" href="${templatePath(kind, 'settings')}" download>${icon('download-simple', { size: 'size-4' })}<span>Template<span class="sr-only"> for ${IMPORT_NOUNS[kind].many}</span></span></a>
              ${linkButton(`Import ${IMPORT_NOUNS[kind].many}`, settingsImportPath(kind), { size: 'sm' })}`,
          }),
        )}
      </ul>`,
  });
}

/** One kind's upload, in the Import tab. */
function importKindPanel(kind: ImportKind): Html {
  const { many } = IMPORT_NOUNS[kind];
  const hint = IMPORTS.find((i) => i.kind === kind)?.hint;
  return section({
    title: `Import ${many}`,
    actions: linkButton('Back to Import', settingsTabHref('import'), { variant: 'ghost', size: 'sm' }),
    body: html`${hint ? html`<p class="settings-intro">${hint}</p>` : ''}${importPanel(kind, { from: 'settings' })}`,
  });
}

