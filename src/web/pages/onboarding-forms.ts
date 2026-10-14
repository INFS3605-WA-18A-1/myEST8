// Form parts shared by the Setup page (/setup) and the guided onboarding wizard
// (/welcome): channels and how to create them, contact details, Tradies and
// Google listings. Each renderer takes the values to show again and the errors
// to show next to each control, keyed by the posted field name.

import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { MAX_IMPORT_ROWS, type ImportKind } from '../../imports.ts';
import { isSimulatedNumber } from '../../onboarding.ts';
import type { ChannelType } from '../../ports.ts';
import { MAX_SHEET_BYTES } from '../../spreadsheet.ts';
import { ActionError, TRADES, type Trade } from '../../shared.ts';
import { int, list, optional, text, type FormValues } from '../forms.ts';
import type { GmailStatus } from '../../gmail-credentials.ts';
import type { ChannelModes } from '../env.ts';
import { icon } from '../icons.ts';
import { alert, badge, button, emptyState, field, formatWhen, humanise, linkButton, table, type Html } from '../ui.ts';

type Person = Awaited<ReturnType<PropertyManagerActions['people']>>[number];
type Listing = Awaited<ReturnType<PropertyManagerActions['findGoogleListings']>>[number];
type AgencyChannel = Awaited<ReturnType<PropertyManagerActions['channels']>>[number];

/** Posted values to show again in a refused form, by field name. Files are never shown again. */
export type Values = Record<string, string | string[]>;
/** Messages to show next to controls, by field name. */
export type Errors = Record<string, string>;

/** The radio value for a Tradie who has no Google listing. */
export const NOT_ON_GOOGLE = 'none';

/** The Agency's three channels, as the forms describe them. */
export const CHANNELS: { type: ChannelType; name: string; addressLabel: string; inputType: 'tel' | 'email'; placeholder: string }[] = [
  { type: 'sms', name: 'SMS', addressLabel: 'Agency SMS number', inputType: 'tel', placeholder: '+61 2 9000 0000' },
  { type: 'whatsapp', name: 'WhatsApp', addressLabel: 'WhatsApp sandbox number', inputType: 'tel', placeholder: '+1 415 523 8886' },
  { type: 'email', name: 'Email', addressLabel: 'Address the Agency inbox forwards to', inputType: 'email', placeholder: 'maintenance@parse.youragency.com.au' },
];

/**
 * One channel's row when channels connect as `modes` says (docs/adr/0004, 0005): Gmail by signing in to
 * Google, WhatsApp and an SMS number by one button each, anything else simulated. No provider setup is
 * shown: the Agency never sets up Twilio, Meta or a webhook.
 */
export function modeChannelBody(o: {
  channel: (typeof CHANNELS)[number];
  current: AgencyChannel | undefined;
  modes: ChannelModes;
  gmail: GmailStatus | 'unavailable';
  /** Where to come back to after Google, and where the WhatsApp and SMS buttons post. */
  returnTo: string;
  whatsappAction: string;
  smsAction: string;
  testAction: string;
  /** The signed-in Property Manager's email: where a test email goes unless they change it. */
  pmEmail: string;
  timeZone: string;
}): Html {
  const { channel, current } = o;
  const line = current ? channelLine(current, o.timeZone) : html``;
  if (channel.type === 'email' && o.modes.gmail) {
    const to = `/oauth/google/start?return=${o.returnTo}`;
    if (current && o.gmail === 'connected') {
      return html`${line}<p class="mt-1 text-sm">New mail to ${current.address} reaches myEST8 within a minute, and myEST8 replies from that address. It never changes or deletes mail.</p>
        ${testForm(o, 'email', { value: o.pmEmail, hint: `Sent from ${current.address}. Use any inbox you can check.` })}
        <div class="mt-2">${linkButton('Reconnect Gmail', to, { variant: 'secondary', size: 'sm' })}</div>`;
    }
    if (o.gmail === 'needs_reconnect') {
      return html`${alert('Gmail needs reconnecting: Google no longer accepts the saved sign-in. Mail is not being read or sent until you connect again.', 'warning')}
        <div class="mt-2">${linkButton('Reconnect Gmail', to, { variant: 'primary', size: 'sm' })}</div>`;
    }
    return html`<p class="text-sm">Sign in with the Google account that receives the Agency’s maintenance email. myEST8 reads new mail there and replies from the same address. It never changes or deletes mail.</p>
      <div class="mt-2">${linkButton('Connect Gmail', to, { variant: 'primary', size: 'sm' })}</div>`;
  }
  if (channel.type === 'whatsapp' && o.modes.whatsappNumber) {
    if (!current) {
      return html`<p class="text-sm">Tenants message ${o.modes.whatsappNumber} on WhatsApp. Connect it to this Agency, then send a test message.</p>
        <form method="post" action="${o.whatsappAction}" class="mt-2">${button('Connect WhatsApp', { size: 'sm' })}</form>`;
    }
    return html`${line}${testForm(o, 'whatsapp', { hint: 'The phone gets WhatsApp’s “Hello World” sample message. While WhatsApp runs on Meta’s test number, only phones on its allowed list receive anything.' })}`;
  }
  if (channel.type === 'sms' && o.modes.smsNumbers) {
    if (!current || isSimulatedNumber(current.address)) {
      return html`<p class="text-sm">Tenants text the Agency on an Australian mobile number of its own. myEST8 gets the number and sets it up: there is nothing to type.</p>
        <form method="post" action="${o.smsAction}" class="mt-2">${button('Get an SMS number', { size: 'sm' })}</form>`;
    }
    return html`${line}${testForm(o, 'sms', {})}`;
  }
  return html`<p class="text-sm">Simulated: messages show in the phone simulator, and nothing is sent to a real phone or inbox.</p>${current
      ? html`<p class="text-sm"><strong class="break-all">${current.address}</strong> is a made-up ${channel.type === 'email' ? 'address' : 'number'} for the simulator, not a real one.</p>`
      : ''}`;
}

/** Gets the Agency its SMS number. A Twilio failure (no bundle, no balance) is shown, not hidden. */
export async function getSmsNumber(actions: PropertyManagerActions): Promise<string> {
  try {
    return await actions.getSmsNumber();
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError('invalid', `myEST8 couldn't get an SMS number: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Sending a test message on a connected channel, to an address the Property Manager types. */
function testForm(o: { current: AgencyChannel | undefined; testAction: string }, type: ChannelType, f: { value?: string; hint?: string }): Html {
  const email = type === 'email';
  return html`<form method="post" action="${o.testAction}" class="mt-3 grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
    <input type="hidden" name="type" value="${type}" />
    ${field({
      label: email ? 'Send a test email to' : 'Send a test message to',
      name: 'to',
      id: `${type}-to`,
      type: email ? 'email' : 'tel',
      required: true,
      value: f.value ?? '',
      placeholder: email ? 'you@youragency.com.au' : 'Your mobile, like 0412 345 678',
      hint: f.hint,
    })}
    ${button('Send a test message', { variant: o.current?.testedAt ? 'secondary' : 'primary', size: 'sm' })}
  </form>`;
}

/** The posted form's text values, to show again after a refusal. Passwords are left out. */
export function valuesOf(form: FormValues): Values {
  const values: Values = {};
  for (const [name, value] of Object.entries(form)) {
    if (/password/i.test(name)) continue;
    const strings = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
    values[name] = Array.isArray(value) ? strings : (strings[0] ?? '');
  }
  return values;
}

/** One value from `values`, as a string. */
export function valueOf(values: Values | undefined, name: string): string {
  const value = values?.[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/** The channel a form names in its "type" field, or a refusal. */
export function channelOf(form: FormValues) {
  const type = text(form, 'type');
  const channel = CHANNELS.find((ch) => ch.type === type);
  if (!channel) throw new ActionError('invalid', 'Choose SMS, WhatsApp or email');
  return channel;
}

/** A chosen option's id; refuses an empty choice with "Choose <label>". */
export function chosenId(form: FormValues, name: string, label: string) {
  const value = text(form, name);
  if (!value) throw new ActionError('invalid', `Choose ${label}`, { [name]: `Choose ${label}` });
  return Number(value);
}

/** A channel's state as a short chip: not connected, connected, or tested. */
export function channelChip(channel: AgencyChannel | undefined): Html {
  if (!channel) return badge('Not connected', 'warning');
  return channel.testedAt ? badge('Tested', 'success') : badge('Connected', 'info');
}

/** A channel's state in words: not connected, connected, or connected and tested. */
export function channelBadge(channel: AgencyChannel | undefined): Html {
  if (!channel) return badge('Not connected', 'warning');
  return channel.testedAt ? badge('Connected and tested', 'success') : badge('Connected, not tested yet', 'info');
}

/** The address a connected channel uses, and when its test message was sent. */
export function channelLine(channel: AgencyChannel, timeZone: string): Html {
  return html`<p class="text-sm">Connected to <strong class="break-all">${channel.address}</strong>${channel.testedAt
      ? html`. Test message sent ${formatWhen(channel.testedAt, timeZone)}`
      : ''}.</p>`;
}

/** How to create the channel, folded away. `origin` is this site, for the webhook addresses. */
export function channelGuide(type: ChannelType, origin: string, o: { open?: boolean } = {}): Html {
  const open = o.open ? 'open' : '';
  switch (type) {
    case 'sms':
      return html`<details class="text-sm" ${open}>
          <summary>No Twilio number yet?</summary>
          <ol class="mt-2 ml-5 list-decimal space-y-1">
            <li>In the Twilio Console, buy an Australian number that can send and receive SMS.</li>
            <li>In the number's Messaging settings, set "A message comes in" to <code class="break-all">${origin}/webhooks/twilio</code>, HTTP POST.</li>
            <li>Connect the number here, then send a test message.</li>
          </ol>
        </details>`;
    case 'whatsapp':
      return html`<details class="text-sm" ${open}>
          <summary>Set up the WhatsApp sandbox</summary>
          <p class="mt-2">For now myEST8 uses the Twilio WhatsApp sandbox. A sender of your own, approved by Meta, comes later.</p>
          <ol class="mt-2 ml-5 list-decimal space-y-1">
            <li>In the Twilio Console, open Messaging, then Try it out, then Send a WhatsApp message.</li>
            <li>Set "When a message comes in" to <code class="break-all">${origin}/webhooks/twilio</code>, HTTP POST.</li>
            <li>Each Tenant joins the sandbox once by sending it the join code from their phone.</li>
            <li>Connect the sandbox number here, then send a test message.</li>
          </ol>
        </details>`;
    case 'email':
      return html`<details class="text-sm" ${open}>
          <summary>Set up SendGrid Inbound Parse</summary>
          <p class="mt-2">Email reaches myEST8 through SendGrid Inbound Parse. Replies go out from the same address.</p>
          <ol class="mt-2 ml-5 list-decimal space-y-1">
            <li>In SendGrid, authenticate your domain so email can be sent from it.</li>
            <li>Add an MX record for a receiving subdomain, such as parse.youragency.com.au, pointing to mx.sendgrid.net.</li>
            <li>In Settings, Inbound Parse, add that subdomain with the URL <code class="break-all">${origin}/webhooks/sendgrid</code>.</li>
            <li>Forward the Agency inbox to an address on that subdomain, then connect that address here.</li>
          </ol>
        </details>`;
  }
}

/** Fields in two columns from 768px up, one column on phones. */
export function fieldGrid(fields: Html): Html {
  return html`<div class="grid gap-x-4 gap-y-3 md:grid-cols-2">${fields}</div>`;
}

/**
 * Name, mobile and email. Control ids start with `id` ("owner-name"). With
 * `scope`, the posted names do too ("ownerName"), so several people fit in one
 * form. `optional` drops the required mark, for a person the form can do without.
 */
export function contactFields(
  id: string,
  o: { scope?: string; values?: Values; errors?: Errors; nameLabel?: string; hint?: string; optional?: boolean } = {},
): Html {
  const name = (f: 'name' | 'mobile' | 'email') => scoped(o.scope, f);
  return html`
    ${field({ label: o.nameLabel ?? 'Name', name: name('name'), id: `${id}-name`, required: !o.optional, autocomplete: 'off', value: valueOf(o.values, name('name')), error: o.errors?.[name('name')] })}
    ${field({ label: 'Mobile', name: name('mobile'), id: `${id}-mobile`, type: 'tel', placeholder: '0412 345 678', autocomplete: 'off', value: valueOf(o.values, name('mobile')), error: o.errors?.[name('mobile')] })}
    ${field({
      label: 'Email',
      name: name('email'),
      id: `${id}-email`,
      type: 'email',
      hint: o.hint ?? 'A mobile number, an email address, or both.',
      autocomplete: 'off',
      value: valueOf(o.values, name('email')),
      error: o.errors?.[name('email')],
    })}
  `;
}

/** The contact posted by `contactFields` with the same `scope`. */
export function contactFrom(form: FormValues, scope?: string) {
  return { name: text(form, scoped(scope, 'name')), mobile: optional(form, scoped(scope, 'mobile')), email: optional(form, scoped(scope, 'email')) };
}

/** "owner" + "name" -> "ownerName"; no scope -> "name". */
export function scoped(scope: string | undefined, name: string) {
  return scope ? `${scope}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;
}

/** Checkboxes (in `columns` from 768px) or radio buttons in a labelled group. `checked` ticks the given values. */
export function choiceGroup(o: {
  legend: string;
  name: string;
  type: 'checkbox' | 'radio';
  options: { value: string; label: string }[];
  columns?: 2 | 4;
  required?: boolean;
  hint?: string;
  checked?: string[];
  error?: string;
}): Html {
  const control = o.type === 'checkbox' ? 'checkbox checkbox-primary checkbox-sm' : 'radio radio-primary radio-sm';
  const layout = o.type === 'checkbox' ? (o.columns === 4 ? 'grid gap-x-4 md:grid-cols-4' : 'grid gap-x-4 md:grid-cols-2') : 'flex flex-col';
  return html`<fieldset class="min-w-0" ${o.error ? html`aria-invalid="true"` : ''}>
    <legend class="field-label mb-1">${o.legend}</legend>
    <div class="${layout}">
      ${o.options.map(
        (opt) => html`<label class="flex cursor-pointer items-start gap-2 py-1 text-sm">
          <input
            type="${o.type}"
            class="${control} mt-0.5"
            name="${o.name}"
            value="${opt.value}"
            ${o.required ? 'required' : ''}
            ${o.checked?.includes(opt.value) ? 'checked' : ''}
          />
          <span>${opt.label}</span>
        </label>`,
      )}
    </div>
    ${o.error ? html`<p class="field-error">${o.error}</p>` : ''}
    ${o.hint ? html`<p class="field-hint">${o.hint}</p>` : ''}
  </fieldset>`;
}

/** The Google listing search that comes before the Tradie form. Submits `google` to `action` by GET. */
export function googleSearchForm(action: string, query: string, problem: string | null, found: number): Html {
  return html`<form method="get" action="${action}" class="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
      ${field({ label: 'First, find their Google listing', name: 'google', id: 'google-search', value: query, placeholder: 'Business name and suburb' })}
      ${button('Search Google', { variant: 'secondary', size: 'sm' })}
    </form>
    ${problem ? html`<p class="mt-2 text-sm text-high">${problem}</p>` : ''}
    ${query && !problem && !found ? html`<p class="mt-2 text-sm">No Google listings found for "${query}".</p>` : ''}`;
}

/** Google listings for `query`, or the problem to show when the search failed. */
export async function searchListings(actions: PropertyManagerActions, query: string): Promise<{ listings: Listing[]; problem: string | null }> {
  if (!query) return { listings: [], problem: null };
  try {
    return { listings: await actions.findGoogleListings(query), problem: null };
  } catch {
    return { listings: [], problem: "Google search isn't working right now. Try again, or mark the Tradie as not on Google." };
  }
}

/** The fields of the Tradie form: business, contact, Trades, starting rating and Google listing. */
export function tradieFields(o: { listings: Listing[]; values?: Values; errors?: Errors }): Html {
  const { values, errors } = o;
  const trades = values?.trades;
  return fieldGrid(html`
    ${field({ label: 'Business name', name: 'businessName', id: 'tradie-business', required: true, value: valueOf(values, 'businessName'), error: errors?.businessName })}
    ${contactFields('tradie', { values, errors, nameLabel: 'Contact name' })}
    <div class="md:col-span-2">
      ${choiceGroup({
        legend: 'Trades',
        name: 'trades',
        type: 'checkbox',
        options: TRADES.map((trade) => ({ value: trade, label: humanise(trade) })),
        columns: 4,
        checked: Array.isArray(trades) ? trades : trades ? [trades] : [],
        error: errors?.trades,
      })}
    </div>
    ${field({
      label: 'Starting rating',
      name: 'startingRating',
      id: 'tradie-rating',
      type: 'select',
      required: true,
      placeholder: 'Choose 1 to 5',
      value: valueOf(values, 'startingRating'),
      options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} / 5` })),
      hint: 'How good they have been for the Agency so far. Ratings after each Job build on it.',
      error: errors?.startingRating,
    })}
    <div class="md:col-span-2">
      ${choiceGroup({
        legend: 'Google listing',
        name: 'placeId',
        type: 'radio',
        required: true,
        options: [...o.listings.map((l) => ({ value: l.placeId, label: `${l.name}, ${l.address}` })), { value: NOT_ON_GOOGLE, label: 'Not on Google' }],
        checked: [valueOf(values, 'placeId')],
        hint: o.listings.length ? undefined : 'Search above to link their listing, so their Google rating shows next to ours.',
        error: errors?.placeId,
      })}
    </div>
  `);
}

/** Adds the Tradie posted by `tradieFields`. Refusals name the posted field at fault. */
export async function addTradieFrom(actions: PropertyManagerActions, form: FormValues): Promise<string> {
  const businessName = text(form, 'businessName');
  if (!businessName) throw new ActionError('invalid', 'Enter the business name', { businessName: 'Enter the business name' });
  if (!text(form, 'startingRating')) throw new ActionError('invalid', 'Choose a starting rating', { startingRating: 'Choose a starting rating' });
  const tradie = {
    ...contactFrom(form),
    businessName,
    trades: list(form, 'trades') as Trade[],
    startingRating: int(form, 'startingRating', 'the starting rating'),
  };
  const listing = text(form, 'placeId');
  try {
    // An empty listing is left for addTradie to refuse with its own message.
    await actions.addTradie(listing === NOT_ON_GOOGLE ? { ...tradie, notOnGoogle: true } : { ...tradie, googlePlaceId: listing });
  } catch (error) {
    // addTradie names its input ("googlePlaceId"); the form posts it as "placeId".
    if (error instanceof ActionError && error.fields.googlePlaceId) throw new ActionError(error.code, error.message, { placeId: error.message });
    throw error;
  }
  return businessName;
}

/** The Agency's Tradies with their Trades and both ratings. */
export async function tradiesTable(actions: PropertyManagerActions, tradies: Person[], empty = 'No Tradies yet.'): Promise<Html> {
  if (!tradies.length) return emptyState(empty);
  const ratings = await Promise.all(tradies.map(async (t) => (await actions.tradie(t.id)).myEst8Rating));
  const rows = tradies.map((t, i) => {
    const { average, count } = ratings[i]!;
    return [
      html`<a class="link font-medium" href="/tradies/${t.id}">${t.businessName ?? t.name}</a>`,
      html`${t.name}`,
      html`${t.trades.map((trade) => html`${badge(humanise(trade), 'info')} `)}`,
      html`${average.toFixed(1)} <span class="text-sm text-muted">(${count})</span>`,
      html`${t.googlePlaceId ? `${t.googleRating?.toFixed(1) ?? '—'} (${t.googleReviewCount ?? 0} reviews)` : 'Not on Google'}`,
    ];
  });
  return table(['Business', 'Name', 'Trades', 'myEST8 rating', 'Google rating'], rows, { caption: 'Tradies' });
}

// Importing from a spreadsheet

/** Each kind of import as the pages name it: one and many. */
export const IMPORT_NOUNS: Record<ImportKind, { one: string; many: string }> = {
  owners: { one: 'Property Owner', many: 'Property Owners' },
  'building-managers': { one: 'Building Manager', many: 'Building Managers' },
  tradies: { one: 'Tradie', many: 'Tradies' },
  properties: { one: 'Property', many: 'Properties' },
  tenants: { one: 'Tenant', many: 'Tenants' },
};

/** Where the guide came from, so the review goes back there. */
export type ImportFrom = 'setup' | 'welcome';

/** The template's address: a CSV with our headings and an example row. */
export const templatePath = (kind: ImportKind) => `/setup/templates/${kind}.csv`;

/**
 * Adding many records at once: download the template, then upload a filled-in
 * .xlsx or .csv to review. `error` is the upload's own refusal, shown inside it.
 */
export function importPanel(kind: ImportKind, o: { from?: ImportFrom; error?: Html; compact?: boolean } = {}): Html {
  const { many } = IMPORT_NOUNS[kind];
  const from = o.from ?? 'setup';
  return html`<div class="import-panel" data-import-panel>
    ${o.compact
      ? ''
      : html`<p class="text-sm">
          Upload your own list as an Excel (.xlsx) or CSV file. Your column names can be anything: myEST8 matches them, and AI fills in what's
          missing. You check every row before anything is added.
        </p>`}
    ${o.error ?? ''}
    <form method="post" action="/setup/import/${kind}${from === 'welcome' ? '?from=welcome' : ''}" enctype="multipart/form-data" class="import-upload">
      ${field({
        label: `Spreadsheet of ${many}`,
        name: 'file',
        id: `import-${kind}-${from}-file`,
        type: 'file',
        required: true,
        accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv',
        hint: `.xlsx or .csv, up to ${MAX_IMPORT_ROWS} rows and ${MAX_SHEET_BYTES / 1024 / 1024} MB.`,
      })}
      <div class="import-upload-actions">
        ${button('Upload and review', { size: 'sm', variant: o.compact ? 'secondary' : 'primary' })}
        <a class="link import-template" href="${templatePath(kind)}" download>${icon('download-simple', { size: 'size-4' })}<span>Download template</span></a>
      </div>
    </form>
  </div>`;
}
