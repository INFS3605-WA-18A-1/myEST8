// Form parts shared by the Setup page (/setup) and the guided onboarding wizard
// (/welcome): channels and how to create them, contact details, Tradies and
// Google listings. Each renderer takes the values to show again and the errors
// to show next to each control, keyed by the posted field name.

import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import type { ChannelType } from '../../ports.ts';
import { ActionError, TRADES, type Trade } from '../../shared.ts';
import { int, list, optional, text, type FormValues } from '../forms.ts';
import { badge, button, emptyState, field, formatWhen, humanise, table, type Html } from '../ui.ts';

type Person = ReturnType<PropertyManagerActions['people']>[number];
type Listing = Awaited<ReturnType<PropertyManagerActions['findGoogleListings']>>[number];
type AgencyChannel = ReturnType<PropertyManagerActions['channels']>[number];

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

/** Whether a channel is connected and tested, in words with a badge. */
export function channelStatus(channel: AgencyChannel | undefined, timeZone: string): Html {
  if (!channel) return badge('Not connected', 'warning');
  return html`${channel.testedAt ? badge('Connected and tested', 'success') : badge('Connected, not tested yet', 'info')}
    <span class="block text-sm">Connected to <strong class="break-all">${channel.address}</strong>${channel.testedAt
        ? html`; test message sent ${formatWhen(channel.testedAt, timeZone)}`
        : ''}.</span>`;
}

/** How to create the channel if the Agency doesn't have it yet. `origin` is this site, for the webhook addresses. */
export function channelGuide(type: ChannelType, origin: string, o: { open?: boolean } = {}): Html {
  const twilioWebhook = html`<code class="break-all">${origin}/webhooks/twilio</code>`;
  const open = o.open ? 'open' : '';
  switch (type) {
    case 'sms':
      return html`<p>The Twilio phone number Tenants text.</p>
        <details class="mt-2" ${open}>
          <summary>No Twilio number yet?</summary>
          <ol class="list-decimal ml-5 text-sm">
            <li>Sign up at twilio.com and open the Console.</li>
            <li>Buy an Australian number that can send and receive SMS.</li>
            <li>In the number's Messaging settings, set "A message comes in" to Webhook ${twilioWebhook}, HTTP POST.</li>
            <li>Connect the number here and send yourself a test message.</li>
          </ol>
        </details>`;
    case 'whatsapp':
      return html`<p>For now myEST8 uses the Twilio WhatsApp sandbox. A WhatsApp sender of your own, approved by Meta, comes later.</p>
        <details class="mt-2" ${open}>
          <summary>Set up the sandbox</summary>
          <ol class="list-decimal ml-5 text-sm">
            <li>In the Twilio Console, open Messaging, then Try it out, then Send a WhatsApp message.</li>
            <li>In the sandbox settings, set "When a message comes in" to ${twilioWebhook}, HTTP POST.</li>
            <li>Join the sandbox from your phone by sending the join code shown there. Each Tenant does the same once.</li>
            <li>Connect the sandbox number here and send yourself a test message.</li>
          </ol>
        </details>`;
    case 'email':
      return html`<p>Email reaches myEST8 through SendGrid Inbound Parse. myEST8 also sends from this address, so replies come straight back.</p>
        <details class="mt-2" ${open}>
          <summary>Set up SendGrid Inbound Parse</summary>
          <ol class="list-decimal ml-5 text-sm">
            <li>In SendGrid, authenticate your domain so email can be sent from it.</li>
            <li>Add an MX record for a receiving subdomain (for example parse.youragency.com.au) pointing to mx.sendgrid.net.</li>
            <li>In Settings, Inbound Parse, add that subdomain with the URL <code class="break-all">${origin}/webhooks/sendgrid</code>.</li>
            <li>Forward the Agency inbox to an address on that subdomain, and connect that address here.</li>
          </ol>
        </details>`;
  }
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

/** Checkboxes or radio buttons in a labelled group. `checked` ticks the given values. */
export function choiceGroup(o: {
  legend: string;
  name: string;
  type: 'checkbox' | 'radio';
  options: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  checked?: string[];
  error?: string;
}): Html {
  return html`<fieldset class="fieldset my-2" ${o.error ? html`aria-invalid="true"` : ''}>
    <legend class="fieldset-legend">${o.legend}</legend>
    ${o.options.map(
      (opt) => html`<label class="label gap-2 cursor-pointer">
        <input
          type="${o.type}"
          class="${o.type} ${o.type}-primary ${o.type}-sm"
          name="${o.name}"
          value="${opt.value}"
          ${o.required ? 'required' : ''}
          ${o.checked?.includes(opt.value) ? 'checked' : ''}
        />
        <span>${opt.label}</span>
      </label>`,
    )}
    ${o.error ? html`<p class="label text-sm font-medium text-error">${o.error}</p>` : ''}
    ${o.hint ? html`<p class="label text-sm">${o.hint}</p>` : ''}
  </fieldset>`;
}

/** The Google listing search that comes before the Tradie form. Submits `google` to `action` by GET. */
export function googleSearchForm(action: string, query: string, problem: string | null, found: number): Html {
  return html`<form method="get" action="${action}">
      ${field({ label: 'First, find their Google listing', name: 'google', id: 'google-search', value: query, placeholder: 'Business name and suburb' })}
      ${button('Search Google', { variant: 'secondary', size: 'sm' })}
    </form>
    ${problem ? html`<p class="text-warning mt-2">${problem}</p>` : ''}
    ${query && !problem && !found ? html`<p class="mt-2">No Google listings found for "${query}".</p>` : ''}`;
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
  return html`
    ${field({ label: 'Business name', name: 'businessName', id: 'tradie-business', required: true, value: valueOf(values, 'businessName'), error: errors?.businessName })}
    ${contactFields('tradie', { values, errors, nameLabel: 'Contact name' })}
    ${choiceGroup({
      legend: 'Trades',
      name: 'trades',
      type: 'checkbox',
      options: TRADES.map((trade) => ({ value: trade, label: humanise(trade) })),
      checked: Array.isArray(trades) ? trades : trades ? [trades] : [],
      error: errors?.trades,
    })}
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
  `;
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
export function tradiesTable(actions: PropertyManagerActions, tradies: Person[], empty = 'No Tradies yet.'): Html {
  if (!tradies.length) return emptyState(empty);
  const rows = tradies.map((t) => {
    const { average, count } = actions.tradie(t.id).myEst8Rating;
    return [
      html`<a class="link font-medium" href="/tradies/${t.id}">${t.businessName ?? t.name}</a>`,
      html`${t.name}`,
      html`${t.trades.map((trade) => html`${badge(humanise(trade), 'info')} `)}`,
      html`${average.toFixed(1)} <span class="text-sm opacity-70">(${count})</span>`,
      html`${t.googlePlaceId ? `${t.googleRating?.toFixed(1) ?? '—'} (${t.googleReviewCount ?? 0} reviews)` : 'Not on Google'}`,
    ];
  });
  return table(['Business', 'Name', 'Trades', 'myEST8 rating', 'Google rating'], rows, { caption: 'Tradies' });
}
