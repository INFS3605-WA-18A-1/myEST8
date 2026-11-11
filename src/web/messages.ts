// The message log of one issue. A Reimbursement Request's page shows it as a collapsible
// side panel of chat bubbles, the latest few first in view, with the mark-read control when
// something is unread. The Ticket page lists it by person instead, one row per conversation,
// and each row opens that conversation over the page, as the dashboard's inbox does.

import { html } from 'hono/html';
import type { ChannelType } from '../ports.ts';
import { templates, type TemplateName } from '../templates.ts';
import { icon } from './icons.ts';
import { badge, chatBubble, emptyState, formatDay, formatTime, formatWhen, humanise, postButton, type Html } from './ui.ts';

/** One logged message, as `tickets.messages` returns it. */
export type LoggedMessageView = {
  direction: 'in' | 'out';
  channel: ChannelType;
  address: string;
  template: string | null;
  text: string;
  /** The composer wrote it (ADR 0011), not the template. */
  composed?: boolean;
  deliveryError: string | null;
  unread: boolean;
  at: string;
};

/** How many of the latest messages show before "Show all". */
const LATEST_MESSAGES = 6;
/** WhatsApp is paused as a channel, but messages that came by it still say so. */
const CHANNELS = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' } as const;
const nothing = html``;

/** A section whose heading opens and closes its body. */
export function collapsible(title: string, body: Html): Html {
  return html`<section class="section">
    <details open>
      <summary class="section-head cursor-pointer">
        <h2 class="section-title">${title}</h2>
      </summary>
      <div class="section-body mt-3">${body}</div>
    </details>
  </section>`;
}

/** Someone a message log can name: the address on the message is matched to their mobile or email. */
export type MessageContact = { name: string; role: string; mobile?: string | null; email?: string | null };

/** The Ticket's or claim's contact who owns an address (a mobile or an email), if one does. */
function contactFor(address: string, contacts: MessageContact[] | undefined): MessageContact | undefined {
  const digits = (value: string) => {
    const plain = value.replace(/\D/g, '');
    return plain.startsWith('0') ? `61${plain.slice(1)}` : plain;
  };
  const email = address.trim().toLowerCase();
  return contacts?.find((c) => (c.email && c.email.trim().toLowerCase() === email) || (c.mobile && digits(c.mobile) === digits(address)));
}

/** The issue's address as a person when one of the Ticket's or claim's contacts owns it, else the address itself. */
function contactOf(address: string, contacts: MessageContact[] | undefined): string {
  const found = contactFor(address, contacts);
  return found ? `${found.name} (${found.role})` : address;
}

/** One person's side of an issue's messages, oldest first. `contact` is unset for an address no contact owns. */
export type Conversation = { name: string; contact?: MessageContact; addresses: string[]; messages: LoggedMessageView[]; unread: number; latestAt: string };

/** An issue's messages by person (a contact's mobile and email together), the latest conversation first. */
export function conversations(messages: LoggedMessageView[], contacts: MessageContact[] = []): Conversation[] {
  const byKey = new Map<string, Conversation>();
  for (const m of messages) {
    const contact = contactFor(m.address, contacts);
    const key = contact ? `${contact.role}:${contact.name}` : `address:${m.address.trim().toLowerCase()}`;
    const convo = byKey.get(key) ?? { name: contact?.name ?? m.address, ...(contact ? { contact } : {}), addresses: [], messages: [], unread: 0, latestAt: m.at };
    if (!convo.addresses.includes(m.address)) convo.addresses.push(m.address);
    convo.messages.push(m);
    if (m.unread) convo.unread++;
    if (m.at > convo.latestAt) convo.latestAt = m.at;
    byKey.set(key, convo);
  }
  return [...byKey.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

/** Two letters for an avatar ("Omar Odeh" is OO); a number with no name uses its last two digits. */
function initialsOf(name: string): string {
  const letters = name
    .replace(/[^A-Za-z ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return letters || name.replace(/\D/g, '').slice(-2) || '+';
}

/** Today's messages say their time, older ones their day. */
function shortWhen(iso: string, timeZone: string, now: Date): string {
  return formatDay(iso, timeZone) === formatDay(now.toISOString(), timeZone) ? formatTime(iso, timeZone) : formatDay(iso, timeZone);
}

/**
 * The messages as a list of conversations, one row per person: who, the last thing said
 * and when, and how many are unread. Each row opens its conversation (conversationDialog)
 * over the page; without JavaScript it jumps to it instead.
 */
export function conversationList(convos: Conversation[], o: { timeZone: string; now: Date; idPrefix: string }): Html {
  const unread = convos.reduce((n, c) => n + c.unread, 0);
  const titleId = `${o.idPrefix}-title`;
  return html`<section class="section convos" aria-labelledby="${titleId}">
    <div class="section-head">
      <h2 class="section-title" id="${titleId}">Messages</h2>
      ${unread ? html`<span class="convos-unread">${unread} unread</span>` : nothing}
    </div>
    <div class="section-body">
      ${convos.length
        ? html`<ul class="convo-list" role="list">
            ${convos.map((c, i) => {
              const last = c.messages.at(-1)!;
              return html`<li>
                <a class="convo-row${c.unread ? ' is-unread' : ''}" href="#${o.idPrefix}-${i}" data-dialog-open="${o.idPrefix}-${i}">
                  <span class="convo-avatar" aria-hidden="true">${initialsOf(c.name)}</span>
                  <span class="convo-main">
                    <span class="convo-who"><span class="convo-name">${c.name}</span>${c.contact ? html`<span class="convo-role">${c.contact.role}</span>` : nothing}</span>
                    <span class="convo-preview">${last.direction === 'out' ? html`<span class="convo-you">Sent:</span> ` : nothing}${last.text}</span>
                  </span>
                  <span class="convo-meta">
                    <time datetime="${c.latestAt}">${shortWhen(c.latestAt, o.timeZone, o.now)}</time>
                    ${c.unread ? html`<span class="convo-count"><span class="sr-only">Unread: </span>${c.unread}</span>` : nothing}
                  </span>
                </a>
              </li>`;
            })}
          </ul>`
        : emptyState('No messages yet.')}
    </div>
  </section>`;
}

/**
 * One conversation over the page, as the inbox shows a thread: the person and how to reach
 * them at the top, every message oldest to newest (each with its channel, its subject and
 * when), and Mark messages read under them while any is unread. A native dialog: Escape
 * closes it and the row that opened it gets the focus back (static/app.js).
 */
export function conversationDialog(c: Conversation, i: number, o: { timeZone: string; idPrefix: string; markRead: string; profileHref?: string }): Html {
  const id = `${o.idPrefix}-${i}`;
  const mobile = c.contact?.mobile;
  const email = c.contact?.email;
  return html`<dialog id="${id}" class="inbox-modal convo-dialog" aria-labelledby="${id}-name">
    <div class="inbox-modal-head convo-dialog-head">
      <span class="convo-avatar is-big" aria-hidden="true">${initialsOf(c.name)}</span>
      <div class="convo-dialog-who">
        <h2 class="inbox-thread-name" id="${id}-name">${o.profileHref ? html`<a href="${o.profileHref}">${c.name}</a>` : c.name}</h2>
        <p class="inbox-thread-sub">${c.contact ? `${c.contact.role} · ` : ''}${c.addresses.join(' · ')}</p>
      </div>
      <div class="convo-dialog-reach">
        ${mobile ? html`<a class="btn btn-sm btn-outline" href="sms:${mobile}">${icon('chat-circle', { size: 'size-4' })}Text</a>` : nothing}
        ${email ? html`<a class="btn btn-sm btn-outline" href="mailto:${email}">${icon('envelope-simple', { size: 'size-4' })}Email</a>` : nothing}
      </div>
      <a class="inbox-modal-close" href="#" data-dialog-close aria-label="Close">${icon('x', { size: 'size-5' })}</a>
    </div>
    <div class="inbox-thread convo-thread" data-convo-thread>
      <ol class="inbox-messages">
        ${c.messages.map((m) => conversationMessage(m, o.timeZone))}
      </ol>
    </div>
    ${c.unread ? html`<div class="convo-dialog-foot">${postButton(o.markRead, 'Mark messages read', { variant: 'secondary', size: 'sm' })}</div>` : nothing}
  </dialog>`;
}

const CHANNEL_ICON: Record<string, string> = { sms: 'chat-circle-text', email: 'envelope-simple', whatsapp: 'whatsapp-logo' };

/** One message in a conversation: its channel and subject, when, and whether it came in or went out; unread, failed and AI-written ones say so. */
function conversationMessage(m: LoggedMessageView, timeZone: string): Html {
  const inbound = m.direction === 'in';
  const flagged = m.composed || m.unread || m.deliveryError;
  return html`<li class="inbox-message ${inbound ? 'is-in' : 'is-out'}${m.unread ? ' is-unread' : ''}${m.deliveryError ? ' is-failed' : ''}">
    <div class="inbox-message-head">
      <span class="inbox-message-channel">${icon(CHANNEL_ICON[m.channel] ?? 'chat-circle-text', { size: 'size-3.5' })}${CHANNELS[m.channel]}</span>
      <span class="sr-only">${inbound ? 'Received' : 'Sent'}</span>
      ${m.template ? html`<span class="convo-subject">${templateSubject(m.template)}</span>` : nothing}
      <time class="inbox-message-time" datetime="${m.at}">${formatWhen(m.at, timeZone)}</time>
    </div>
    <p class="inbox-message-text">${shortLinks(m.text)}</p>
    ${flagged
      ? html`<p class="convo-flags">${m.composed ? writtenByAI : nothing}${m.unread ? badge('Unread', 'warning') : nothing}${m.deliveryError ? badge(m.deliveryError, 'error') : nothing}</p>`
      : nothing}
  </li>`;
}

/**
 * The message log, as a collapsible side panel, with the mark-read control (a POST
 * to `markRead`) when something is unread. The latest few show; the older ones open
 * above them, and start open when one of them is unread. `contacts` names the people
 * the messages went to or came from. `more` is a control that stays under the log.
 */
export function messageLog(messages: LoggedMessageView[], o: { timeZone: string; markRead: string; contacts?: MessageContact[]; more?: Html }): Html {
  const unread = messages.filter((m) => m.unread).length;
  const read = unread ? postButton(o.markRead, 'Mark messages read', { variant: 'secondary', size: 'sm' }) : nothing;
  const older = messages.slice(0, -LATEST_MESSAGES);
  const latest = messages.slice(-LATEST_MESSAGES);
  const log = messages.length
    ? html`${older.length
          ? html`<details class="ticket-older" ${older.some((m) => m.unread) ? 'open' : ''}>
              <summary class="cursor-pointer text-sm font-medium text-action">Show all ${messages.length} messages</summary>
              <div>${older.map((m) => messageBubble(m, o.timeZone, o.contacts))}</div>
            </details>`
          : nothing}
        <div>${latest.map((m) => messageBubble(m, o.timeZone, o.contacts))}</div>`
    : emptyState('No messages yet.');
  return collapsible(
    unread ? `Messages (${unread} unread)` : 'Messages',
    o.more ? html`${read}<div class="message-scroll">${log}</div>${o.more}` : html`${read} ${log}`,
  );
}

/** The AI mark on a message the composer wrote: the sparkle, then the words that carry its meaning. */
const writtenByAI = html`<span class="inline-flex items-center gap-1">${icon('sparkle', { size: 'size-3.5', weight: 'fill' })}Written by AI</span>`;

/** Inbound messages on the left, what myEST8 sent on the right; unread ones stand out, and one the AI wrote says so. */
function messageBubble(m: LoggedMessageView, timeZone: string, contacts?: MessageContact[]): Html {
  const subject = m.template ? html`: <span class="font-medium">${templateSubject(m.template)}</span>` : nothing;
  return chatBubble({
    side: m.direction === 'in' ? 'start' : 'end',
    header: html`${m.direction === 'in' ? 'From' : 'To'} ${contactOf(m.address, contacts)} by ${CHANNELS[m.channel]}${subject}`,
    text: shortLinks(m.text),
    footer: html`${formatWhen(m.at, timeZone)}${m.composed ? html` · ${writtenByAI}` : nothing}${m.unread ? html` ${badge('Unread', 'warning')}` : nothing}${m.deliveryError ? html` ${badge(m.deliveryError, 'error')}` : nothing}`,
    tone: m.deliveryError ? 'error' : m.unread ? 'warning' : undefined,
  });
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g;

/** A message's text with each link shortened to what it is ("progress link", "upload link"); the link itself is the full URL. */
function shortLinks(text: string): Html {
  const parts: (Html | string)[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    parts.push(text.slice(last, match.index));
    parts.push(html`<a class="link" href="${match[0]}" title="${match[0]}" rel="noopener noreferrer">${linkName(match[0])}</a>`);
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return html`${parts}`;
}

function linkName(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    if (pathname.startsWith('/t/')) return 'progress link';
    if (pathname.startsWith('/u/')) return 'upload link';
    if (pathname.startsWith('/q/')) return 'quote page link';
    return `${hostname} link`;
  } catch {
    return 'link';
  }
}

function templateSubject(name: string): string {
  return name in templates ? templates[name as TemplateName].subject : humanise(name);
}
