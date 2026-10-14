// The demo phone simulator under /demo. A signed-in Property Manager presenting the
// demo acts as any Tenant, Tradie, Property Owner or Building Manager of their own
// Agency: reads what myEST8 sent to their phone or inbox, replies on any of their
// channels to the Agency's own number or inbox, and moves the demo clock on so
// reminders and timeouts run.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { html, raw } from 'hono/html';
import type { ChannelType } from '../ports.ts';
import { ActionError, type Role } from '../shared.ts';
import type { WebEnv } from '../web/env.ts';
import { files, int, text, type FormValues } from '../web/forms.ts';
import { icon } from '../web/icons.ts';
import { shellInfo } from '../web/shell.ts';
import { ROLE_LABEL, alert, badge, button, chatBubble, emptyState, flashFrom, formatWhen, humanise, linkButton, page, section, segmented, withFlash, type Html } from '../web/ui.ts';
import type { DemoContact, DemoControls, DemoInboundMessage, DemoOutboundMessage } from './controls.ts';

const MB = 1024 * 1024;

/** The feed shows this many of the latest messages, and "Show older" adds this many more. */
const FEED_PAGE = 20;

const GROUPS: [Role, string][] = [
  ['tenant', 'Tenants'],
  ['tradie', 'Tradies'],
  ['owner', 'Property Owners'],
  ['building_manager', 'Building Managers'],
];

const CHANNEL_LABEL: Record<ChannelType, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };

/** One-tap replies for the demo script. */
const QUICK_REPLIES: Record<Role, string[]> = {
  tenant: ['The kitchen tap is dripping', 'Yes', 'No', '1', 'Any time', 'Gas smell in the kitchen', 'The lift is broken'],
  tradie: ['$180, Tue 9am', 'No thanks, too busy', 'Done', "Can't make Tuesday"],
  owner: ['YES', 'NO'],
  building_manager: ["Thanks, we're on it", 'Fixed'],
};

const CLOCK_STEPS = [1, 24, 48, 72];

/**
 * The phone: 380px wide on laptops, full width below, 28px radius, one allowed shadow.
 * On laptops it is as tall as the window allows under the top bar, up to 760px. On
 * phone it is sized to end inside the first frame, below the clock, the picker and
 * the page's top bar, so the composer and Send stay visible without scrolling. The
 * conversation is the main thing in it: the header and composer stay compact.
 */
const PHONE_FRAME =
  'flex min-h-[560px] h-[calc(100dvh_-_200px)] w-full min-w-0 flex-col overflow-hidden rounded-[28px] border border-control bg-surface shadow-[0_8px_24px_rgb(50_50_51/0.18)] lg:h-[min(760px,calc(100dvh_-_108px))] lg:w-[380px] lg:shrink-0';

/** A message on a contact's phone or in their inbox: from myEST8, or sent by them through the simulator. */
type ThreadMessage = {
  fromUs: boolean;
  at: string;
  channel: ChannelType;
  subject: string;
  text: string;
  attachments: string[];
  template: string | null;
};

/** The phone simulator under /demo. Mounted behind requirePropertyManager. */
export function simulatorPages(demo: DemoControls) {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const timeZone = agencyTimeZone(c);
    const me = c.get('pm').id;
    const contacts = await demo.contacts(me);
    const connected = (await c.get('actions').channels()).map((ch) => ch.type);
    const missing = (Object.keys(CHANNEL_LABEL) as ChannelType[]).filter((ch) => !connected.includes(ch));
    const selected = contacts.find((p) => String(p.personId) === c.req.query('contact')) ?? null;
    const query = (c.req.query('q') ?? '').trim();

    return c.html(
      page({
        title: 'Phone simulator',
        pm: c.get('pm'),
        active: 'simulator',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
        controls: clockControls(demo.now(), timeZone, selected),
        body: simulatorBody({
          contacts,
          outbox: await demo.outbox(me),
          inbound: await demo.inbound(me),
          selected,
          query,
          showAll: c.req.query('all') === '1',
          limit: feedLimit(c.req.query('feed')),
          missing,
          timeZone,
        }),
      }),
    );
  });

  pages.post('/send', bodyLimit({ maxSize: 40 * MB }), async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const me = c.get('pm').id;
    const contact = (await demo.contacts(me)).find((p) => String(p.personId) === text(form, 'contact'));
    return refusable(c, contact ? threadPath(contact.personId) : '/demo', async () => {
      if (!contact) throw new ActionError('not_found', 'Pick someone to act as');
      const asked = text(form, 'channel');
      const channel = channelsOf(contact).find((ch) => ch === asked);
      if (!channel) {
        const label = Object.hasOwn(CHANNEL_LABEL, asked) ? CHANNEL_LABEL[asked as ChannelType] : 'that channel';
        throw new ActionError('invalid', `${contact.name} can't send by ${label}`);
      }
      const address = channel === 'email' ? contact.email! : contact.mobile!;
      const message = text(form, 'quick') || text(form, 'text');
      const attachments = await Promise.all(
        files(form, 'attachments').map(async (f) => ({
          filename: f.name,
          contentType: f.type || 'application/octet-stream',
          content: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      if (!message && !attachments.length) throw new ActionError('invalid', 'Type a message or attach a file');
      await demo.sendAs(me, address, channel, message, attachments);
      return `Sent as ${contact.name} by ${CHANNEL_LABEL[channel]}`;
    });
  });

  pages.post('/advance', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const contactId = Number(text(form, 'contact'));
    return refusable(c, Number.isInteger(contactId) && contactId > 0 ? threadPath(contactId) : '/demo', async () => {
      const hours = int(form, 'hours', 'hours');
      if (hours < 1 || hours > 14 * 24) throw new ActionError('invalid', 'Move the clock between 1 hour and 2 weeks');
      await demo.advance(hours);
      return `Clock moved to ${formatWhen(demo.now().toISOString(), agencyTimeZone(c))}; reminders and timeouts ran`;
    });
  });

  return pages;
}

/**
 * The simulator's three columns: the contact list, the phone and the feed. On
 * phone the channel notice comes after them, so the phone and its composer are
 * in the first frame.
 */
function simulatorBody(o: {
  contacts: DemoContact[];
  outbox: DemoOutboundMessage[];
  inbound: DemoInboundMessage[];
  selected: DemoContact | null;
  query: string;
  showAll: boolean;
  limit: number;
  missing: ChannelType[];
  timeZone: string;
}): Html {
  const { contacts, selected, query, timeZone } = o;
  const listed = query ? contacts.filter((p) => matchesQuery(p, query)) : contacts;
  const sent = sentCounts(contacts, o.outbox);
  const thread = selected ? threadOf(selected, o.outbox, o.inbound) : [];

  // The feed: newest first, for the selected contact unless "All contacts" is on.
  const scoped = selected && !o.showAll ? o.outbox.filter((m) => addressed(selected, m)) : o.outbox;
  const newest = scoped.toReversed();
  const feed = { total: newest.length, items: newest.slice(0, o.limit), limit: o.limit, selected, showAll: o.showAll, query };

  return html`<div class="flex flex-col gap-4">
    <div class="grid gap-4 lg:grid-cols-[240px_380px_minmax(0,1fr)] lg:items-start">
      <aside class="hidden lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh_-_96px)] lg:overflow-y-auto">${contactList(contacts, listed, selected, sent, query)}</aside>
      <div class="flex min-w-0 flex-col gap-3">
        ${contactPicker(contacts, selected)}
        ${selected ? phone(selected, thread, timeZone) : pickPrompt(contacts)}
      </div>
      <div class="flex min-w-0 flex-col gap-4">${sentFeed(feed, contacts, timeZone)}</div>
    </div>
    ${o.missing.length ? html`<div class="order-last lg:order-first">${unconnectedNotice(o.missing)}</div>` : ''}
  </div>`;
}

/** Runs `action`; redirects to `back` with its message, or with the reason it was refused. */
async function refusable(c: Context<WebEnv>, back: string, action: () => Promise<string>) {
  try {
    return c.redirect(withFlash(back, 'ok', await action()), 303);
  } catch (error) {
    if (error instanceof ActionError) return c.redirect(withFlash(back, 'error', error.message), 303);
    throw error;
  }
}

function agencyTimeZone(c: Context<WebEnv>) {
  return c.get('actions').agency().timeZone;
}

function threadPath(personId: number) {
  return `/demo?contact=${personId}`;
}

/** A /demo link keeping only the parameters that are set. */
function demoUrl(o: { contact?: number; q?: string; all?: boolean; feed?: number }) {
  const search = new URLSearchParams();
  if (o.contact !== undefined) search.set('contact', String(o.contact));
  if (o.q) search.set('q', o.q);
  if (o.all) search.set('all', '1');
  if (o.feed) search.set('feed', String(o.feed));
  const query = search.toString();
  return query ? `/demo?${query}` : '/demo';
}

/** How many feed rows to show: the default page, or a larger count from "Show older". */
function feedLimit(raw: string | undefined) {
  const n = Number(raw);
  return Number.isInteger(n) && n > FEED_PAGE ? n : FEED_PAGE;
}

/** An address as written in messages, comparable with a contact's mobile or email. */
function normalise(address: string) {
  const bracketed = /<([^>]+)>/.exec(address);
  const plain = (bracketed ? bracketed[1]! : address).trim().toLowerCase().replace(/^whatsapp:/, '');
  return plain.includes('@') ? plain : plain.replace(/[\s()-]/g, '');
}

function owns(contact: DemoContact, address: string) {
  const a = normalise(address);
  return (contact.mobile !== null && normalise(contact.mobile) === a) || (contact.email !== null && normalise(contact.email) === a);
}

/** Whether myEST8's message went to the contact, directly or on copy. */
function addressed(contact: DemoContact, m: DemoOutboundMessage) {
  return [m.to, ...m.cc].some((a) => owns(contact, a));
}

/** Messages myEST8 sent to each contact, counted once in a pass over the outbox. */
function sentCounts(contacts: DemoContact[], outbox: DemoOutboundMessage[]) {
  const counts = new Map<number, number>();
  for (const m of outbox) {
    for (const p of contacts) {
      if (addressed(p, m)) counts.set(p.personId, (counts.get(p.personId) ?? 0) + 1);
    }
  }
  return counts;
}

/** The contact list's filter: a name, mobile or email containing the text, ignoring case. */
function matchesQuery(contact: DemoContact, query: string) {
  const q = query.toLowerCase();
  return [contact.name, contact.mobile ?? '', contact.email ?? ''].some((v) => v.toLowerCase().includes(q));
}

function channelsOf(contact: DemoContact): ChannelType[] {
  return [...(contact.mobile ? (['sms', 'whatsapp'] as const) : []), ...(contact.email ? (['email'] as const) : [])];
}

/** Everything myEST8 sent the contact and everything they sent in, oldest first. */
function threadOf(contact: DemoContact, outbox: DemoOutboundMessage[], inbound: DemoInboundMessage[]): ThreadMessage[] {
  // On the same instant, the contact's message comes first: myEST8 replies to it.
  const theirs = inbound
    .filter((m) => owns(contact, m.from))
    .map((m, i) => ({ order: [0, i], message: { fromUs: false, at: m.at, channel: m.channel, subject: '', text: m.text, attachments: m.attachments, template: null } }));
  const ours = outbox
    .filter((m) => addressed(contact, m))
    .map((m, i) => ({ order: [1, i], message: { fromUs: true, at: m.at, channel: m.channel, subject: m.subject, text: m.text, attachments: m.attachments, template: m.template } }));
  return [...theirs, ...ours]
    .sort((a, b) => Date.parse(a.message.at) - Date.parse(b.message.at) || a.order[0]! - b.order[0]! || a.order[1]! - b.order[1]!)
    .map((m) => m.message);
}

/** People can only message the Agency on the channels it has connected. */
function unconnectedNotice(missing: ChannelType[]): Html {
  const names = missing.map((ch) => CHANNEL_LABEL[ch]);
  const list = names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return alert(
    html`<p>Connect ${list} in Setup first. Until then, nobody can message the Agency that way from here.</p>
      <p class="mt-2">${linkButton('Connect channels', '/welcome/channels', { size: 'sm' })}</p>`,
    'info',
    { title: `${list} not connected yet` },
  );
}

function channelBadge(channel: ChannelType): Html {
  return badge(CHANNEL_LABEL[channel] ?? channel, channel === 'email' ? 'info' : channel === 'whatsapp' ? 'success' : 'neutral');
}

/** "tenant.upload_link" -> Tenant, then Upload link, as two elements with a gap between them. */
function templateLabel(template: string): Html {
  return html`<span class="inline-flex flex-wrap items-center gap-x-2">${template.split('.').map((part) => html`<span>${humanise(part)}</span>`)}</span>`;
}

/** The contact list: a filter, then each role's people with a count. Selected is filled with --action. */
function contactList(contacts: DemoContact[], listed: DemoContact[], selected: DemoContact | null, sent: Map<number, number>, query: string): Html {
  if (!contacts.length) return emptyState('No people yet.');
  return html`<nav aria-label="People" class="flex flex-col gap-4">
    <form method="get" action="/demo" role="search" class="flex flex-col gap-2">
      ${selected ? html`<input type="hidden" name="contact" value="${selected.personId}" />` : ''}
      <label for="contact-filter" class="field-label">Find someone</label>
      <div class="flex gap-2">
        <input id="contact-filter" type="search" name="q" value="${query}" placeholder="Name, phone or email" class="input input-bordered min-w-0 flex-1" />
        ${button('Filter', { variant: 'secondary' })}
      </div>
    </form>
    ${listed.length
      ? GROUPS.map(([role, label]) => {
          const people = listed.filter((p) => p.role === role);
          if (!people.length) return '';
          return html`<div class="flex flex-col gap-1">
            <h2 class="section-title flex items-center gap-2">${label} <span class="count-chip">${people.length}</span></h2>
            <ul class="flex flex-col gap-1">
              ${people.map((p) => {
                const isSelected = p === selected;
                const count = sent.get(p.personId) ?? 0;
                return html`<li>
                  <a href="${demoUrl({ contact: p.personId, q: query })}" class="flex items-center gap-2 rounded-md px-3 py-2 ${isSelected ? 'bg-action text-[var(--surface)]' : 'text-ink hover:bg-page'}" ${isSelected ? html`aria-current="page"` : ''}>
                    <span class="min-w-0 flex-1">
                      <span class="block font-semibold">${p.name}</span>
                      ${[p.mobile, p.email].filter((d): d is string => Boolean(d)).map((detail) => html`<span class="block truncate text-sm ${isSelected ? '' : 'text-muted'}">${detail}</span>`)}
                    </span>
                    ${count ? html`<span class="shrink-0 text-sm ${isSelected ? '' : 'text-muted'}">${count} sent</span>` : ''}
                  </a>
                </li>`;
              })}
            </ul>
          </div>`;
        })
      : emptyState(`No one matches “${query}”.`)}
  </nav>`;
}

/** At phone width the contact list collapses into a picker. */
function contactPicker(contacts: DemoContact[], selected: DemoContact | null): Html {
  if (!contacts.length) return html``;
  return html`<form method="get" action="/demo" class="flex gap-2 lg:hidden">
    <label for="contact-picker" class="sr-only">Act as</label>
    <select id="contact-picker" name="contact" class="select select-bordered min-w-0 flex-1" onchange="this.form.submit()">
      <option value="" ${selected ? '' : 'selected'}>Act as…</option>
      ${GROUPS.map(([role, label]) => {
        const people = contacts.filter((p) => p.role === role);
        return people.length
          ? html`<optgroup label="${label}">${people.map((p) => html`<option value="${p.personId}" ${p === selected ? 'selected' : ''}>${p.name}</option>`)}</optgroup>`
          : '';
      })}
    </select>
    ${button('Open', { variant: 'secondary' })}
  </form>`;
}

/** Shown in the middle column until someone is picked. */
function pickPrompt(contacts: DemoContact[]): Html {
  return section({
    title: 'Act as someone',
    body: contacts.length
      ? html`<p>Pick someone to act as. You'll see what myEST8 sent them, and can reply as them.</p>`
      : emptyState('No people to act as yet. Add Tenants, Tradies, Property Owners or Building Managers in Setup.'),
  });
}

/** The phone: a header, the thread scrolling inside it with the newest at the bottom, and the composer pinned below. */
function phone(contact: DemoContact, thread: ThreadMessage[], timeZone: string): Html {
  const channels = channelsOf(contact);
  const lastChannel = thread.at(-1)?.channel;
  const defaultChannel = lastChannel && channels.includes(lastChannel) ? lastChannel : channels[0];
  const label = `${contact.name}'s ${channels.length === 1 && channels[0] === 'email' ? 'inbox' : 'phone'}`;
  return html`<section class="${PHONE_FRAME}" aria-label="${label}">
    <header class="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
      <h2 class="section-title min-w-0 flex-1 truncate">${contact.name}</h2>
      ${badge(ROLE_LABEL[contact.role])}
      ${channels.map((ch) => channelBadge(ch))}
    </header>
    <div class="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-surface px-3 py-3" role="region" tabindex="0" aria-label="${`Messages with ${contact.name}`}">
      <div class="flex flex-col gap-3">
        ${thread.length
          ? thread.map((m) =>
              chatBubble({
                side: m.fromUs ? 'start' : 'end',
                header: html`<span class="font-semibold">${m.fromUs ? 'myEST8' : contact.name}</span>
                  <span>${CHANNEL_LABEL[m.channel]}</span>
                  <time class="text-muted" datetime="${m.at}">${formatWhen(m.at, timeZone)}</time>`,
                text: m.subject ? `Subject: ${m.subject}\n\n${m.text}` : m.text,
                footer: footer(m),
              }),
            )
          : emptyState(`Nothing yet. Send a message as ${contact.name} to start.`)}
      </div>
    </div>
    ${channels.length ? composer(contact, channels, defaultChannel!) : html`<div class="shrink-0 border-t border-line px-4 py-3">${emptyState(`${contact.name} has no mobile or email to send from.`)}</div>`}
  </section>`;
}

function footer(m: ThreadMessage): Html | undefined {
  const notes: Html[] = [
    ...(m.attachments.length ? [html`<span>Attached: ${m.attachments.join(', ')}</span>`] : []),
    ...(m.template ? [templateLabel(m.template)] : []),
  ];
  return notes.length ? html`<span class="flex flex-wrap gap-x-3 gap-y-1">${notes}</span>` : undefined;
}

/**
 * The composer pinned to the foot of the phone, kept compact so the thread has the
 * room: the quick replies in one row that scrolls sideways, the message, then the
 * channel, Attach and Send on one line. A few lines of script name what was attached.
 */
function composer(contact: DemoContact, channels: ChannelType[], defaultChannel: ChannelType): Html {
  return html`<form method="post" action="/demo/send" enctype="multipart/form-data" class="flex shrink-0 flex-col gap-2 border-t border-line bg-surface px-3 pt-2 pb-3">
    <input type="hidden" name="contact" value="${contact.personId}" />
    <div class="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1" role="group" aria-label="Quick replies">
      ${QUICK_REPLIES[contact.role].map((reply) => html`<button type="submit" name="quick" value="${reply}" class="btn btn-outline btn-sm shrink-0 font-normal">${reply}</button>`)}
    </div>
    <label for="field-text" class="sr-only">Message</label>
    <textarea id="field-text" name="text" rows="2" class="textarea textarea-bordered min-h-0 w-full resize-none" placeholder="Type as ${contact.name}"></textarea>
    <div class="flex items-center gap-2">
      <label for="field-channel" class="sr-only">Send by</label>
      <select id="field-channel" name="channel" class="select select-bordered select-sm w-auto shrink-0">
        ${channels.map((ch) => html`<option value="${ch}" ${ch === defaultChannel ? 'selected' : ''}>${CHANNEL_LABEL[ch]}</option>`)}
      </select>
      <label class="btn btn-ghost btn-sm min-w-0 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-action">
        ${icon('paperclip', { size: 'size-4' })}<span id="attach-label" class="truncate">Attach</span>
        <input id="field-attachments" name="attachments" type="file" multiple class="sr-only" />
      </label>
      <button type="submit" class="btn btn-primary btn-sm ml-auto shrink-0">Send<span class="sr-only"> as ${contact.name}</span></button>
    </div>
    ${ATTACH_SCRIPT}
  </form>`;
}

/** Shows how many files are attached ("2 files"), with their names on hover, in place of "Attach". */
const ATTACH_SCRIPT = raw(`<script>
(() => {
  const input = document.getElementById('field-attachments');
  const label = document.getElementById('attach-label');
  if (!input || !label) return;
  input.addEventListener('change', () => {
    const chosen = Array.from(input.files || []);
    label.textContent = chosen.length ? chosen.length + (chosen.length === 1 ? ' file' : ' files') : 'Attach';
    label.title = chosen.map((f) => f.name).join(', ');
  });
})();
</script>`);

/** The demo clock, in the top bar: the Agency's time and steps forward that POST /demo/advance. */
function clockControls(now: Date, timeZone: string, selected: DemoContact | null): Html {
  return html`<div class="flex items-center gap-2 text-sm">
    <span class="hidden text-muted sm:inline">Demo clock</span>
    <time class="num hidden font-semibold text-ink sm:inline" datetime="${now.toISOString()}">${formatWhen(now.toISOString(), timeZone)}</time>
    <span class="hidden text-xs text-muted md:inline">${timeZone}</span>
    ${CLOCK_STEPS.map((hours) => {
      const unit = hours === 1 ? 'hour' : 'hours';
      return html`<form method="post" action="/demo/advance" class="inline-flex">
        <input type="hidden" name="hours" value="${hours}" />
        ${selected ? html`<input type="hidden" name="contact" value="${selected.personId}" />` : ''}
        <button type="submit" class="btn btn-outline btn-xs sm:btn-sm" aria-label="${`Move the clock +${hours} ${unit}`}">+${hours}h</button>
      </form>`;
    })}
  </div>`;
}

/** What myEST8 sent: the latest rows, for the selected contact unless "All contacts" is on, with "Show older" for more. */
function sentFeed(
  o: { total: number; items: DemoOutboundMessage[]; limit: number; selected: DemoContact | null; showAll: boolean; query: string },
  contacts: DemoContact[],
  timeZone: string,
): Html {
  const scope = o.selected && !o.showAll ? `Nothing sent to ${o.selected.name} yet.` : 'Nothing sent yet.';
  const toggle = o.selected
    ? segmented([
        { label: 'All contacts', href: demoUrl({ contact: o.selected.personId, q: o.query, all: true }), active: o.showAll },
        { label: o.selected.name, href: demoUrl({ contact: o.selected.personId, q: o.query }), active: !o.showAll },
      ])
    : undefined;
  const contactId = o.selected?.personId;
  return section({
    title: 'What myEST8 sent',
    actions: toggle,
    body: html`${o.items.length
        ? html`<p class="text-sm text-muted">Showing the latest ${o.items.length} of ${o.total}</p>
            <ol class="flex flex-col gap-3">${o.items.map((m) => feedItem(m, contacts, timeZone))}</ol>`
        : emptyState(scope)}
      ${o.total > o.items.length
        ? html`<p><a class="link" href="${demoUrl({ contact: contactId, q: o.query, all: o.showAll, feed: o.limit + FEED_PAGE })}">Show older</a></p>`
        : ''}`,
  });
}

function feedItem(m: DemoOutboundMessage, contacts: DemoContact[], timeZone: string): Html {
  const to = contacts.find((p) => owns(p, m.to));
  return html`<li data-feed-item class="flex flex-col gap-1 border-b border-line pb-3 text-sm last:border-b-0 last:pb-0">
    <div class="flex flex-wrap items-center gap-2">
      ${to ? html`<a class="link font-semibold" href="${threadPath(to.personId)}">${to.name}</a>` : html`<span class="font-semibold">${m.to}</span>`}
      ${channelBadge(m.channel)}
      <time class="text-muted" datetime="${m.at}">${formatWhen(m.at, timeZone)}</time>
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      ${templateLabel(m.template)}
      ${m.subject ? html`<span class="text-muted">${m.subject}</span>` : ''}
    </div>
  </li>`;
}
