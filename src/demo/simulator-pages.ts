// The demo phone simulator under /demo. A signed-in Property Manager presenting the
// demo acts as any Tenant, Tradie, Property Owner or Building Manager: reads what
// myEST8 sent to their phone or inbox, replies on any of their channels, and moves
// the demo clock on so reminders and timeouts run.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { html } from 'hono/html';
import type { ChannelType } from '../ports.ts';
import { ActionError, type Role } from '../shared.ts';
import type { WebEnv } from '../web/env.ts';
import { files, int, text, type FormValues } from '../web/forms.ts';
import { badge, button, card, chatBubble, emptyState, flashFrom, formatWhen, humanise, page, postButton, withFlash, type Html } from '../web/ui.ts';
import type { DemoContact, DemoControls, DemoInboundMessage, DemoOutboundMessage } from './controls.ts';

const MB = 1024 * 1024;

const GROUPS: [Role, string][] = [
  ['tenant', 'Tenants'],
  ['tradie', 'Tradies'],
  ['owner', 'Property Owners'],
  ['building_manager', 'Building Managers'],
];

const ROLE_LABEL: Record<Role, string> = {
  tenant: 'Tenant',
  tradie: 'Tradie',
  owner: 'Property Owner',
  building_manager: 'Building Manager',
};

const CHANNEL_LABEL: Record<ChannelType, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };

/** One-tap replies for the demo script. */
const QUICK_REPLIES: Record<Role, string[]> = {
  tenant: ['The kitchen tap is dripping', 'Yes', 'No', '1', 'Any time', 'Gas smell in the kitchen', 'The lift is broken'],
  tradie: ['$180, Tue 9am', 'No thanks, too busy', 'Done', "Can't make Tuesday"],
  owner: ['YES', 'NO'],
  building_manager: ["Thanks, we're on it", 'Fixed'],
};

const CLOCK_STEPS = [1, 24, 48, 72];

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

  pages.get('/', (c) => {
    const timeZone = agencyTimeZone(c);
    const contacts = demo.contacts();
    const outbox = demo.outbox();
    const inbound = demo.inbound();
    const selected = contacts.find((p) => String(p.personId) === c.req.query('contact')) ?? null;
    const received = (p: DemoContact) => outbox.filter((m) => [m.to, ...m.cc].some((a) => owns(p, a))).length;
    const thread = selected ? threadOf(selected, outbox, inbound) : [];

    const body = html`<div class="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_20rem]">
      <aside class="hidden lg:block" aria-label="People">${contactList(contacts, selected, received)}</aside>
      <section class="min-w-0 space-y-4">
        ${contactPicker(contacts, selected)}
        ${selected
          ? phone(selected, thread, timeZone)
          : card({ body: contacts.length ? html`<p>Pick someone to act as. You'll see what myEST8 sent them, and can reply as them.</p>` : emptyState('No people to act as yet. Add Tenants, Tradies, Property Owners or Building Managers in Setup.') })}
      </section>
      <aside class="min-w-0 space-y-4">${clockPanel(demo.now(), timeZone, selected)} ${sentFeed(outbox, contacts, timeZone)}</aside>
    </div>`;

    return c.html(page({ title: 'Phone simulator', pm: c.get('pm'), active: 'simulator', flash: flashFrom(c.req.url), body }));
  });

  pages.post('/send', bodyLimit({ maxSize: 40 * MB }), async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const contact = demo.contacts().find((p) => String(p.personId) === text(form, 'contact'));
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
      await demo.sendAs(address, channel, message, attachments);
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
    .filter((m) => [m.to, ...m.cc].some((a) => owns(contact, a)))
    .map((m, i) => ({ order: [1, i], message: { fromUs: true, at: m.at, channel: m.channel, subject: m.subject, text: m.text, attachments: m.attachments, template: m.template } }));
  return [...theirs, ...ours]
    .sort((a, b) => Date.parse(a.message.at) - Date.parse(b.message.at) || a.order[0]! - b.order[0]! || a.order[1]! - b.order[1]!)
    .map((m) => m.message);
}

function channelBadge(channel: ChannelType): Html {
  return badge(CHANNEL_LABEL[channel] ?? channel, channel === 'email' ? 'info' : channel === 'whatsapp' ? 'success' : 'neutral');
}

/** "tenant.upload_link" -> "Tenant · Upload link" */
function templateLabel(template: string) {
  return template.split('.').map(humanise).join(' · ');
}

function contactList(contacts: DemoContact[], selected: DemoContact | null, received: (p: DemoContact) => number): Html {
  if (!contacts.length) return emptyState('No people yet.');
  return html`<nav class="space-y-4">
    ${GROUPS.map(([role, label]) => {
      const people = contacts.filter((p) => p.role === role);
      if (!people.length) return '';
      return html`<div>
        <h2 class="mb-1 text-sm font-semibold uppercase opacity-70">${label}</h2>
        <ul class="menu w-full p-0">
          ${people.map((p) => {
            const count = received(p);
            return html`<li>
              <a href="${threadPath(p.personId)}" class="${p === selected ? 'menu-active' : ''}" ${p === selected ? html`aria-current="page"` : ''}>
                <span class="flex-1">${p.name}<br /><span class="text-xs opacity-70">${[p.mobile, p.email].filter(Boolean).join(' · ')}</span></span>
                ${count ? html`<span class="badge badge-sm" title="Messages from myEST8">${count}</span>` : ''}
              </a>
            </li>`;
          })}
        </ul>
      </div>`;
    })}
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

function phone(contact: DemoContact, thread: ThreadMessage[], timeZone: string): Html {
  const channels = channelsOf(contact);
  const lastChannel = thread.at(-1)?.channel;
  const defaultChannel = lastChannel && channels.includes(lastChannel) ? lastChannel : channels[0];
  return card({
    title: `${contact.name}'s ${channels.length === 1 && channels[0] === 'email' ? 'inbox' : 'phone'}`,
    actions: badge(ROLE_LABEL[contact.role]),
    body: html`
      <p class="text-sm opacity-70">${[contact.mobile, contact.email].filter(Boolean).join(' · ')}</p>
      <div class="my-4 space-y-2">
        ${thread.length
          ? thread.map((m) =>
              chatBubble({
                side: m.fromUs ? 'start' : 'end',
                header: `${m.fromUs ? 'myEST8' : contact.name} · ${CHANNEL_LABEL[m.channel]} · ${formatWhen(m.at, timeZone)}`,
                text: m.subject ? `Subject: ${m.subject}\n\n${m.text}` : m.text,
                footer: footer(m),
              }),
            )
          : emptyState(`Nothing yet. Send a message as ${contact.name} to start.`)}
      </div>
      ${channels.length ? composer(contact, channels, defaultChannel!) : emptyState(`${contact.name} has no mobile or email to send from.`)}
    `,
  });
}

function footer(m: ThreadMessage): string | undefined {
  const notes = [...(m.attachments.length ? [`Attached: ${m.attachments.join(', ')}`] : []), ...(m.template ? [templateLabel(m.template)] : [])];
  return notes.length ? notes.join(' · ') : undefined;
}

function composer(contact: DemoContact, channels: ChannelType[], defaultChannel: ChannelType): Html {
  return html`<form method="post" action="/demo/send" enctype="multipart/form-data" class="space-y-3">
    <input type="hidden" name="contact" value="${contact.personId}" />
    <div>
      <label for="field-channel">Send by</label>
      <select id="field-channel" name="channel" class="select select-bordered">
        ${channels.map((ch) => html`<option value="${ch}" ${ch === defaultChannel ? 'selected' : ''}>${CHANNEL_LABEL[ch]}</option>`)}
      </select>
    </div>
    <div>
      <p class="text-sm">Quick replies</p>
      <div class="flex flex-wrap gap-2">
        ${QUICK_REPLIES[contact.role].map((reply) => button(reply, { variant: 'secondary', size: 'sm', name: 'quick', value: reply }))}
      </div>
    </div>
    <div>
      <label for="field-text">Message</label>
      <textarea id="field-text" name="text" rows="3" class="textarea textarea-bordered w-full" placeholder="Type as ${contact.name}"></textarea>
    </div>
    <div>
      <label for="field-attachments">Attachments</label>
      <input id="field-attachments" name="attachments" type="file" multiple class="file-input file-input-bordered w-full" />
      <p class="text-sm opacity-70">A photo, receipt or PDF Quote, sent as an attachment.</p>
    </div>
    ${button(`Send as ${contact.name}`)}
  </form>`;
}

function clockPanel(now: Date, timeZone: string, selected: DemoContact | null): Html {
  return card({
    title: 'Demo clock',
    body: html`
      <p class="text-xl font-semibold"><time datetime="${now.toISOString()}">${formatWhen(now.toISOString(), timeZone)}</time></p>
      <p class="text-sm opacity-70">Agency time (${timeZone})</p>
      <div class="mt-2 flex flex-wrap gap-2">
        ${CLOCK_STEPS.map((hours) =>
          postButton('/demo/advance', `+${hours} hour${hours === 1 ? '' : 's'}`, {
            variant: 'secondary',
            size: 'sm',
            fields: { hours, ...(selected ? { contact: selected.personId } : {}) },
          }),
        )}
      </div>
      <p class="mt-2 text-sm opacity-70">Moving the clock runs every reminder and timeout that falls due.</p>
    `,
  });
}

function sentFeed(outbox: DemoOutboundMessage[], contacts: DemoContact[], timeZone: string): Html {
  return card({
    title: 'What myEST8 sent',
    body: outbox.length
      ? html`<ol class="space-y-2">
          ${outbox.toReversed().map((m) => {
            const to = contacts.find((p) => owns(p, m.to));
            return html`<li class="text-sm">
              <div class="flex flex-wrap items-center gap-2">
                ${to ? html`<a class="link" href="${threadPath(to.personId)}">${to.name}</a>` : html`<span>${m.to}</span>`}
                ${channelBadge(m.channel)}
                <time class="opacity-70" datetime="${m.at}">${formatWhen(m.at, timeZone)}</time>
              </div>
              <div>${templateLabel(m.template)}${m.subject ? html`: ${m.subject}` : ''}</div>
            </li>`;
          })}
        </ol>`
      : emptyState('Nothing sent yet.'),
  });
}
