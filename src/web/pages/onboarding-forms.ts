// Form parts shared by the Setup page (/setup) and the guided onboarding wizard
// (/welcome): channels and how to create them, contact details, Tradies and
// Google listings. Each renderer takes the values to show again and the errors
// to show next to each control, keyed by the posted field name.

import type { Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { MAX_IMPORT_ROWS, type ImportKind } from '../../imports.ts';
import type { ChannelType } from '../../ports.ts';
import { MAX_SHEET_BYTES } from '../../spreadsheet.ts';
import { ActionError, TRADES, type Trade } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { int, list, optional, text, type FormValues } from '../forms.ts';
import { icon } from '../icons.ts';
import { alert, badge, button, contactLink, dl, emptyState, field, formatWhen, humanise, ratingChip, rowLink, table, withFlash, type Html, type Option } from '../ui.ts';

type Person = Awaited<ReturnType<PropertyManagerActions['people']>>[number];
type Listing = Awaited<ReturnType<PropertyManagerActions['findGoogleListings']>>[number];
type ListingDetails = Awaited<ReturnType<PropertyManagerActions['googleListing']>>;
type AgencyChannel = Awaited<ReturnType<PropertyManagerActions['channels']>>[number];

/** Posted values to show again in a refused form, by field name. Files are never shown again. */
export type Values = Record<string, string | string[]>;
/** Messages to show next to controls, by field name. */
export type Errors = Record<string, string>;

/** The `placeId` posted for a Tradie who has no Google listing. */
const NOT_ON_GOOGLE = 'none';

/**
 * The Agency's channels, as the forms describe them: SMS and email. WhatsApp is not offered
 * on these pages (the backend keeps it dormant), so a posted type of "whatsapp" is refused.
 */
export const CHANNELS: { type: 'sms' | 'email'; name: string; addressLabel: string; inputType: 'tel' | 'email'; placeholder: string }[] = [
  { type: 'sms', name: 'SMS', addressLabel: 'Agency SMS number', inputType: 'tel', placeholder: '+61 2 9000 0000' },
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

/** What a refused edit of a profile's details shows again: what was posted, the reason under each field, and the reason itself for when it names no field. */
export type DetailsEdit = { values: Values; errors: Errors; message: string };

/**
 * Saves a profile's edited details (`save` is given the posted form). Saved, it goes back to the profile
 * with "Details saved." Refused, `show` renders the profile again with the form open, as it was posted
 * and with the reason; it is also what shows a record that isn't the Agency's, as a 404.
 */
export async function saveDetails(c: Context<WebEnv>, o: { profile: string; save: (form: FormValues) => Promise<unknown>; show: (refused: DetailsEdit) => Promise<Response> }) {
  const form = (await c.req.parseBody({ all: true })) as FormValues;
  try {
    await o.save(form);
    return c.redirect(withFlash(o.profile, 'ok', 'Details saved.'), 303);
  } catch (error) {
    if (!(error instanceof ActionError)) throw error;
    return o.show({ values: valuesOf(form), errors: { ...error.fields }, message: error.message });
  }
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

/** A pin posted with a Property, when both lat and lng are numbers. Missing or not a number is left for geocoding. */
export function postedLocation(form: FormValues): { lat: number; lng: number } | undefined {
  const latText = text(form, 'lat');
  const lngText = text(form, 'lng');
  if (!latText || !lngText) return undefined;
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

/** The channel a form names in its "type" field, or a refusal. */
export function channelOf(form: FormValues) {
  const type = text(form, 'type');
  const channel = CHANNELS.find((ch) => ch.type === type);
  if (!channel) throw new ActionError('invalid', 'Choose SMS or email');
  return channel;
}

/** A chosen option's id; refuses an empty choice with "Choose <label>". */
export function chosenId(form: FormValues, name: string, label: string) {
  const value = text(form, name);
  if (!value) throw new ActionError('invalid', `Choose ${label}`, { [name]: `Choose ${label}` });
  return Number(value);
}

/** The chip for a channel this server can't deliver on. */
export const unavailableChip = (): Html => badge('Not available here', 'neutral', { wrap: true });

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
      return badge('Not connected', 'warning', { wrap: true });
    case 'waiting':
      return badge('Waiting for your first message', 'info', { wrap: true });
    case 'verified':
      return badge('Verified', 'success', { wrap: true });
    case 'connected':
      return badge('Connected', 'info', { wrap: true });
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
  return html`<form method="post" action="${o.postTo}" class="control-row ${o.className}">
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
      ${button(o.current || o.pending ? 'Send a new code' : 'Send code', { variant: o.current ? 'secondary' : 'primary' })}
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
          ${button(`Verify ${o.channel.name}`)}
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
    <button type="button" class="btn btn-outline" data-copy-for="email-address">Copy</button>
  </div>`;
}

/** How to set the channel up, folded away. */
export function channelGuide(type: 'sms' | 'email', _origin: string, o: { open?: boolean } = {}): Html {
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
 * A Property's Address and Suburb. `data-address-suggest` lets app.js offer addresses
 * as the Address is typed and fill Suburb plus the hidden lat and lng. Without
 * JavaScript those stay empty and the address is geocoded on save.
 */
export function propertyPlaceFields(o: { values?: Values; errors?: Errors } = {}): Html {
  return html`
    ${field({
      label: 'Address',
      name: 'address',
      id: 'property-address',
      required: true,
      placeholder: '12 King St, Newtown NSW 2042',
      suggest: true,
      value: valueOf(o.values, 'address'),
      error: o.errors?.address,
    })}
    ${field({ label: 'Suburb', name: 'suburb', id: 'property-suburb', required: true, value: valueOf(o.values, 'suburb'), error: o.errors?.suburb })}
    <input type="hidden" name="lat" value="${valueOf(o.values, 'lat')}" />
    <input type="hidden" name="lng" value="${valueOf(o.values, 'lng')}" />
  `;
}

/**
 * Everything about a Property but its address: Property Owner, Property Manager, Max Repair Cost, Building
 * Manager and the Nominated Tradies picker, as the Properties page adds a Property and its profile edits one.
 * `values` and `errors` are a refused form's, by posted field name; `manager` is who the Property Manager
 * select starts on when `values` don't say.
 */
export function propertyFields(o: {
  owners: Person[];
  buildingManagers: Person[];
  propertyManagers: { id: number; name: string }[];
  tradies: Person[];
  manager?: number;
  values?: Values;
  errors?: Errors;
}): Html {
  const { values, errors } = o;
  return html`
    ${fieldGrid(html`
      ${propertyPlaceFields({ values, errors })}
      ${field({
        label: 'Property Owner',
        name: 'ownerId',
        id: 'property-owner',
        type: 'select',
        required: true,
        placeholder: 'Choose the Property Owner',
        value: valueOf(values, 'ownerId'),
        options: o.owners.map((p) => ({ value: String(p.id), label: p.name })),
        error: errors?.ownerId,
      })}
      ${field({
        label: 'Property Manager',
        name: 'propertyManagerId',
        id: 'property-manager',
        type: 'select',
        required: true,
        value: valueOf(values, 'propertyManagerId') || String(o.manager ?? ''),
        options: o.propertyManagers.map((m) => ({ value: String(m.id), label: m.name })),
        error: errors?.propertyManagerId,
      })}
      ${field({
        label: 'Max Repair Cost ($)',
        name: 'maxRepairCost',
        id: 'property-max',
        type: 'number',
        step: '0.01',
        min: 0,
        required: true,
        placeholder: '500',
        value: valueOf(values, 'maxRepairCost'),
        hint: "The most a Ticket's Repair Cost can reach before the Property Owner must approve.",
        error: errors?.maxRepairCost,
      })}
      ${field({
        label: 'Building Manager (strata only)',
        name: 'buildingManagerId',
        id: 'property-building-manager',
        type: 'select',
        value: valueOf(values, 'buildingManagerId'),
        options: [{ value: '', label: 'None' }, ...o.buildingManagers.map((b) => ({ value: String(b.id), label: b.name }))],
        error: errors?.buildingManagerId,
      })}
    `)}
    <div class="mt-3">
      ${o.tradies.length
        ? tradiePicker({ id: 'property', tradies: o.tradies, chosen: list(values ?? {}, 'nominatedTradieIds'), error: errors?.nominatedTradieIds })
        : html`<p class="text-sm text-muted">Add Tradies on the Tradies page to nominate them for Urgent Repairs.</p>`}
    </div>
  `;
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

/**
 * The Add form for a Property Owner or Building Manager: name, mobile and email, posting to `action`.
 * Setup and the two profile lists share it, so they can't drift.
 */
export function addPersonForm(o: { id: string; action: string; submit: string; values?: Values; errors?: Errors }): Html {
  return html`<form method="post" action="${o.action}">
    ${fieldGrid(contactFields(o.id, { values: o.values, errors: o.errors }))}
    <div class="mt-3">${button(o.submit, { size: 'sm' })}</div>
  </form>`;
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
/** Properties for a searchable select: the address, found by its street, suburb or postcode too. */
export function propertyOptions(properties: { id: number; address: string; suburb: string }[]): Option[] {
  return properties.map((p) => ({ value: String(p.id), label: p.address, keywords: p.suburb }));
}

/** Tradies for a searchable select: the business and its Trades, found by the Tradie's own name too. */
export function tradieOptions(tradies: { id: number; name: string; businessName: string | null; trades: Trade[] }[]): Option[] {
  return tradies.map((t) => ({ value: String(t.id), label: `${t.businessName ?? t.name} (${t.trades.map(humanise).join(', ')})`, keywords: t.name }));
}

/**
 * The Nominated Tradies: a searchable Tradie select per Tradie chosen, each with a
 * Remove button, and "Add Tradie" for another (app.js). With nothing chosen it starts
 * with one empty select, so it works without JavaScript too; empty ones post nothing
 * (`nominatedFrom`).
 */
export function tradiePicker(o: { id: string; tradies: Parameters<typeof tradieOptions>[0]; chosen?: string[]; legend?: string; hint?: string; error?: string }): Html {
  const options = tradieOptions(o.tradies);
  const chosen = o.chosen?.length ? o.chosen : [''];
  const row = (value: string, id: string) => html`<li class="picker-row" data-picker-row>
    <label class="sr-only" for="${id}">Nominated Tradie</label>
    <select id="${id}" name="nominatedTradieIds" class="select w-full" data-combobox>
      <option value="">Search Tradies by name or Trade</option>
      ${options.map((opt) => html`<option value="${opt.value}" ${value === opt.value ? 'selected' : ''} data-keywords="${opt.keywords ?? ''}">${opt.label}</option>`)}
    </select>
    <button type="button" class="btn btn-ghost btn-sm picker-remove" data-picker-remove>${icon('x', { size: 'size-4' })}<span>Remove</span></button>
  </li>`;
  return html`<fieldset class="picker min-w-0" data-picker ${o.error ? html`aria-invalid="true"` : ''}>
    <legend class="field-label mb-1">${o.legend ?? 'Nominated Tradies'}</legend>
    <ul class="picker-rows" data-picker-rows>${chosen.map((value, i) => row(value, `${o.id}-tradie-${i}`))}</ul>
    <template data-picker-template>${row('', `${o.id}-tradie`)}</template>
    <button type="button" class="btn btn-secondary btn-sm picker-add" data-picker-add hidden>${icon('plus', { size: 'size-4' })}<span>Add Tradie</span></button>
    ${o.error ? html`<p class="field-error">${o.error}</p>` : ''}
    <p class="field-hint">${o.hint ?? 'Who the Tenant can call for an Urgent Repair.'}</p>
  </fieldset>`;
}

/** The Tradies a `tradiePicker` posted, each once, leaving out rows left empty. */
export function nominatedFrom(form: FormValues): number[] {
  return [...new Set(list(form, 'nominatedTradieIds').filter(Boolean).map(Number))];
}

function choiceGroup(o: {
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

const GOOGLE_DOWN = "Google search isn't working right now. Try again, or mark the Tradie as not on Google.";

/**
 * Which Google listing the Tradie form is for, as the page's address says: what was
 * searched for, the listing picked from the results, or "not on Google" (`manual`).
 */
export type ListingChoice = { query: string; place: string; manual: boolean };

/** The choice a page was asked for, from its `google`, `place` and `manual` parameters. */
export function listingChoice(param: (name: string) => string | undefined): ListingChoice {
  const manual = param('manual') === '1';
  return { query: param('google')?.trim() ?? '', place: manual ? '' : (param('place')?.trim() ?? ''), manual };
}

/** The choice as query parameters, so a link or a refused form comes back to it. */
export function listingParams(choice: ListingChoice): string {
  return [choice.query && `google=${encodeURIComponent(choice.query)}`, choice.place && `place=${encodeURIComponent(choice.place)}`, choice.manual && 'manual=1'].filter(Boolean).join('&');
}

/** `url` with `params` added to its query. */
function withParams(url: string, params: string) {
  return params ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url;
}

/** Google listings for `query`, or the problem to show when the search failed. */
async function searchListings(actions: PropertyManagerActions, query: string): Promise<{ listings: Listing[]; problem: string | null }> {
  if (!query) return { listings: [], problem: null };
  try {
    return { listings: await actions.findGoogleListings(query), problem: null };
  } catch {
    return { listings: [], problem: GOOGLE_DOWN };
  }
}

/** The picked listing's details with Jev's Trades, or the problem to show when Google failed. */
async function loadListing(actions: PropertyManagerActions, placeId: string): Promise<{ listing: ListingDetails | null; problem: string | null }> {
  if (!placeId) return { listing: null, problem: null };
  try {
    return { listing: await actions.googleListing(placeId), problem: null };
  } catch {
    return { listing: null, problem: GOOGLE_DOWN };
  }
}

/** The listing's phone when it is an Australian mobile (04… or +614…). A landline isn't put in Mobile: myEST8 texts that number. */
function australianMobile(phone: string | null): string | null {
  const number = phone?.trim() ?? '';
  return /^(?:0|\+61)4\d{8}$/.test(number.replace(/[\s()-]/g, '')) ? number : null;
}

/** What a listing fills the Tradie form in with. The contact, email and rating are the Property Manager's to give. */
function listingValues(listing: ListingDetails): Values {
  return { businessName: listing.name, mobile: australianMobile(listing.phone) ?? '', trades: listing.suggestedTrades };
}

/** What Google and Jev say about the picked listing, above the form it fills in. */
function listingCard(listing: ListingDetails): Html {
  const mobile = australianMobile(listing.phone);
  const site = listing.website && /^https?:\/\//i.test(listing.website) ? html`<a class="link" href="${listing.website}" rel="noopener noreferrer">${listing.website}</a>` : null;
  const trades = listing.tradesSuggested
    ? listing.suggestedTrades.length
      ? html`<span class="flex flex-wrap gap-1">${listing.suggestedTrades.map((trade) => badge(humanise(trade), 'info'))}</span>`
      : 'None'
    : "Jev couldn't suggest any right now";
  const facts: [string, Html | string][] = [];
  if (listing.phone) {
    facts.push(['Phone', html`${contactLink('mobile', listing.phone)}${mobile ? '' : html`<span class="block text-muted">Not put in Mobile, because myEST8 texts that number.</span>`}`]);
  }
  if (site) facts.push(['Website', site]);
  facts.push(['Google rating', ratingChip({ source: 'Google', rating: listing.rating, count: listing.reviewCount, named: false })]);
  facts.push(['Trades Jev suggests', trades]);
  return html`<div class="listing-card">
    <h3 class="listing-card-name">${listing.name}</h3>
    <p class="listing-card-address">${listing.address}</p>
    ${dl(facts)}
  </div>`;
}

/**
 * Adding a Tradie from their Google listing, the one component of the welcome wizard,
 * Setup and the Tradies page: the search, its results as links, a card for the listing
 * picked, then the form filled in from it. `path` and `anchor` are where the page is;
 * `postTo` is where the form posts, to which the choice is added so that a refusal
 * comes back to it. `values` and `errors` are a refused form's, shown again over the
 * listing's own; `refusal` is why it was refused. Nothing is stored until the form is posted.
 */
export async function addTradieSection(o: {
  actions: PropertyManagerActions;
  choice: ListingChoice;
  path: string;
  anchor: string;
  postTo: string;
  submit: Html;
  values?: Values;
  errors?: Errors;
  refusal?: Html;
}): Promise<Html> {
  const { actions, values, errors } = o;
  // A form that was refused is still for the listing it was posted with.
  const posted = valueOf(values, 'placeId');
  const choice =
    o.choice.place || o.choice.manual || !posted ? o.choice : posted === NOT_ON_GOOGLE ? { ...o.choice, manual: true } : { ...o.choice, place: posted };
  const [search, picked] = await Promise.all([searchListings(actions, choice.query), loadListing(actions, choice.place)]);
  const problem = search.problem ?? picked.problem;
  const { listing } = picked;
  const href = (to: Partial<ListingChoice>) => `${o.path}?${listingParams({ query: choice.query, place: '', manual: false, ...to })}${o.anchor}`;
  const placeId = choice.manual ? NOT_ON_GOOGLE : listing ? choice.place : '';
  const tradesHint = !listing ? undefined : listing.suggestedTrades.length ? 'Suggested from their Google listing. Check them.' : 'Choose their Trades.';
  return html`
    <form method="get" action="${o.path}${o.anchor}" class="control-row grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
      ${field({ label: 'First, find their Google listing', name: 'google', id: 'google-search', value: choice.query, placeholder: 'Business name and suburb' })}
      ${button('Search Google', { variant: 'secondary' })}
    </form>
    ${problem ? html`<p class="mt-2 text-sm text-high">${problem}</p>` : ''}
    ${choice.query && !problem && !search.listings.length ? html`<p class="mt-2 text-sm">No Google listings found for "${choice.query}".</p>` : ''}
    ${search.listings.length
      ? html`<ul class="listing-results" role="list" aria-label="Google listings">
          ${search.listings.map((l) => {
            const current = l.placeId === choice.place;
            return html`<li><a class="listing-result" href="${href({ place: l.placeId })}" ${current ? html`aria-current="true"` : ''}>
              <span class="listing-result-name">${l.name}</span>
              <span class="listing-result-address">${l.address}</span>
              ${current ? html`<span class="listing-result-chosen">${icon('check-circle', { size: 'size-4' })}Chosen</span>` : ''}
            </a></li>`;
          })}
        </ul>`
      : ''}
    <p class="mt-3 text-sm"><a class="link" href="${href({ manual: true })}">Not on Google? Enter their details yourself</a></p>
    ${listing ? listingCard(listing) : ''}
    ${placeId
      ? html`<form method="post" action="${withParams(o.postTo, listingParams(choice))}" class="mt-4 space-y-3">
          ${o.refusal ?? ''}
          ${errors?.placeId ? alert(errors.placeId, 'error') : ''}
          <input type="hidden" name="placeId" value="${placeId}" />
          ${tradieFields({ values: values ?? (listing ? listingValues(listing) : undefined), errors, tradesHint })}
          <div>${o.submit}</div>
        </form>`
      : (o.refusal ?? '')}
  `;
}

/** The fields of the Tradie form: business, contact, Trades and starting rating (left out when editing a Tradie, whose rating is built from the Jobs they do). */
export function tradieFields(o: { values?: Values; errors?: Errors; tradesHint?: string; startingRating?: boolean }): Html {
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
        hint: o.tradesHint,
        error: errors?.trades,
      })}
    </div>
    ${o.startingRating === false
      ? ''
      : field({
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
  // The directory has every Tradie's rating; a Tradie's whole profile isn't needed for it.
  const ratings = new Map((await actions.tradieDirectory()).map((t) => [t.tradieId, t.myEst8Rating]));
  const rows = tradies.map((t) => {
    const { average, count } = ratings.get(t.id)!;
    return [
      rowLink(t.businessName ?? t.name, `/tradies/${t.id}`),
      html`${t.name}`,
      html`${t.trades.map((trade) => html`${badge(humanise(trade), 'info')} `)}`,
      ratingChip({ source: 'myEST8', rating: average, count, named: false }),
      ratingChip({ source: 'Google', rating: t.googleRating, count: t.googleReviewCount ?? 0, onGoogle: !!t.googlePlaceId, named: false }),
    ];
  });
  return table(['Business', 'Name', 'Trades', 'myEST8 rating', 'Google rating'], rows, { stack: 'labelled', caption: 'Tradies' });
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
