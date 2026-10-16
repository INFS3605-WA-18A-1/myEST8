// Form parts shared by the Setup page (/setup) and the guided onboarding wizard
// (/welcome): channels and how to create them, contact details, Tradies and
// Google listings. Each renderer takes the values to show again and the errors
// to show next to each control, keyed by the posted field name.

import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { MAX_IMPORT_ROWS, type ImportKind } from '../../imports.ts';
import type { ChannelType } from '../../ports.ts';
import { MAX_SHEET_BYTES } from '../../spreadsheet.ts';
import { ActionError, TRADES, type Trade } from '../../shared.ts';
import { int, list, optional, text, type FormValues } from '../forms.ts';
import { icon } from '../icons.ts';
import { badge, button, emptyState, field, formatWhen, humanise, table, type Html } from '../ui.ts';

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
  { type: 'whatsapp', name: 'WhatsApp', addressLabel: 'Agency WhatsApp number', inputType: 'tel', placeholder: '+61 400 000 000' },
  { type: 'email', name: 'Email', addressLabel: 'Inbound email address', inputType: 'email', placeholder: 'agency@mail.example.test' },
];

/** The sentence that replaces a channel's form when this server can't deliver on it, naming what still works. */
export function unavailableNote(type: ChannelType, unavailable: readonly ChannelType[]): Html {
  const channel = CHANNELS.find((ch) => ch.type === type)!;
  const working = CHANNELS.filter((ch) => !unavailable.includes(ch.type)).map((ch) => (ch.type === 'email' ? 'email' : ch.name));
  const left = working.length ? ` Tenants can still reach you by ${working.join(' and ')}.` : '';
  const what = type === 'email' ? 'Email forwarding' : channel.name;
  return html`<p class="text-sm" data-unavailable="${type}">${what} isn't available on this server yet.${left}</p>`;
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

/** The chip for a channel this server can't deliver on. */
export const unavailableChip = (): Html => badge('Not available here', 'neutral');

/** How a channel should read: missing, waiting on a first email, verified by code or inbound mail, or connected without that. */
export function channelState(channel: AgencyChannel | undefined, o: { waiting?: boolean; verified?: boolean } = {}) {
  if (!channel) return 'missing' as const;
  if (o.waiting) return 'waiting' as const;
  if (o.verified || channel.testedAt) return 'verified' as const;
  return 'connected' as const;
}

/** A channel's state as a short chip. `testedAt` means the address was verified. */
export function channelChip(channel: AgencyChannel | undefined, o: { waiting?: boolean; verified?: boolean } = {}): Html {
  switch (channelState(channel, o)) {
    case 'missing':
      return badge('Not connected', 'warning');
    case 'waiting':
      return badge('Waiting for your first message', 'info');
    case 'verified':
      return badge('Verified', 'success');
    case 'connected':
      return badge('Connected', 'info');
  }
}

/** A channel's state in words, same meanings as `channelChip`. */
export function channelBadge(channel: AgencyChannel | undefined, o: { waiting?: boolean; verified?: boolean } = {}): Html {
  return channelChip(channel, o);
}

/** The address a connected channel uses. */
export function channelLine(channel: AgencyChannel, timeZone: string, o: { waiting?: boolean; smsInbound?: 'simulator' | 'none' } = {}): Html {
  if (o.waiting) return html`<p class="text-sm">Waiting for your first message at <strong class="break-all">${channel.address}</strong>.</p>`;
  // A typed SMS number on a real server proves the Agency holds it; it isn't where Tenants' texts arrive.
  if (channel.testedAt && channel.type === 'sms' && o.smsInbound === 'none') {
    return html`<p class="text-sm">Verified ${formatWhen(channel.testedAt, timeZone)}. <strong class="break-all">${channel.address}</strong> is confirmed as the Agency's number. Texts to it don't reach myEST8 yet.</p>`;
  }
  if (channel.testedAt) return html`<p class="text-sm">Verified ${formatWhen(channel.testedAt, timeZone)}. Tenants reach the Agency at <strong class="break-all">${channel.address}</strong>.</p>`;
  return html`<p class="text-sm">Connected to <strong class="break-all">${channel.address}</strong>.</p>`;
}

/** The number form and, once a code has been sent, the code form. A typed number is not saved until the code matches. */
export function phoneChannelForm(o: {
  channel: (typeof CHANNELS)[number];
  postTo: string;
  confirmTo: string;
  pending?: { address: string };
  suggestion?: string;
  current?: string;
  className: string;
}): Html {
  const value = o.pending?.address || o.current || o.suggestion || '';
  return html`<form method="post" action="${o.postTo}" class="${o.className}">
      <input type="hidden" name="type" value="${o.channel.type}" />
      ${field({
        label: o.channel.addressLabel,
        name: 'address',
        id: `${o.channel.type}-address`,
        type: o.channel.inputType,
        required: true,
        value,
        placeholder: o.channel.placeholder,
      })}
      ${button(o.current || o.pending ? 'Send a new code' : 'Send code', { size: 'sm', variant: o.current ? 'secondary' : 'primary' })}
    </form>
    ${o.pending
      ? html`<form method="post" action="${o.confirmTo}" class="${o.className}">
          <input type="hidden" name="type" value="${o.channel.type}" />
          <input type="hidden" name="address" value="${o.pending.address}" />
          ${field({
            label: '6-digit code',
            name: 'code',
            id: `${o.channel.type}-code`,
            required: true,
            autocomplete: 'one-time-code',
            placeholder: '123456',
            hint: `Sent to ${o.pending.address}. It expires in 10 minutes.`,
          })}
          ${button(`Verify ${o.channel.name}`, { size: 'sm' })}
        </form>`
      : ''}`;
}

/** The Agency's inbound address, with a button that copies it (app.js). The field can be copied by hand without JavaScript. */
export function inboundEmailField(address: string): Html {
  return html`<div class="flex flex-wrap items-end gap-3">
    <div class="min-w-56 flex-1">
      <label class="field-label" for="email-address">Inbound email address</label>
      <input id="email-address" class="input w-full" type="email" readonly value="${address}" />
    </div>
    <button type="button" class="btn btn-secondary btn-sm" data-copy-for="email-address">Copy</button>
  </div>`;
}

/** How to set the channel up, folded away. */
export function channelGuide(type: ChannelType, _origin: string, o: { open?: boolean } = {}): Html {
  const open = o.open ? 'open' : '';
  switch (type) {
    case 'sms':
      return html`<details class="text-sm" ${open}>
          <summary>How SMS verification works</summary>
          <ol class="mt-2 ml-5 list-decimal space-y-1">
            <li>Enter the mobile number the Agency uses for SMS.</li>
            <li>myEST8 texts a 6-digit code to that number. The code lasts 10 minutes.</li>
            <li>Enter the code here. The number is saved only after the code matches.</li>
          </ol>
        </details>`;
    case 'whatsapp':
      return html`<details class="text-sm" ${open}>
          <summary>How WhatsApp verification works</summary>
          <ol class="mt-2 ml-5 list-decimal space-y-1">
            <li>Enter the Agency's WhatsApp number.</li>
            <li>myEST8 sends a 6-digit code to it. Enter the code here. The number is saved only after the code matches.</li>
            <li>WhatsApp only delivers a free-form reply within 24 hours of the person's last message. Outside that window, use SMS or email.</li>
          </ol>
        </details>`;
    case 'email':
      return html`<details class="text-sm" ${open}>
          <summary>Forward mail to myEST8</summary>
          <p class="mt-2">myEST8 gives the Agency an address on its inbound domain. Forward the Agency inbox to that address. Resend receives the mail and turns it into Maintenance Requests.</p>
          <ol class="mt-2 ml-5 list-decimal space-y-1">
            <li>Copy the inbound address shown here.</li>
            <li>In the Agency's email, add a forwarding rule to that address.</li>
            <li>Send one message to the Agency inbox so it is forwarded on. This row stays on waiting for your first message until that mail arrives, then it shows Verified.</li>
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
  return table(['Business', 'Name', 'Trades', 'myEST8 rating', 'Google rating'], rows, { stack: true, caption: 'Tradies' });
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
