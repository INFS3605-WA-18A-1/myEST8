// The message log of one issue, as the Ticket page and a Reimbursement Request's page
// show it: a collapsible side panel of chat bubbles, the latest few first in view, with
// the mark-read control when something is unread. Also the collapsible panel itself.

import { html } from 'hono/html';
import type { ChannelType } from '../ports.ts';
import { templates, type TemplateName } from '../templates.ts';
import { icon } from './icons.ts';
import { badge, chatBubble, emptyState, formatWhen, humanise, postButton, type Html } from './ui.ts';

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

/** The issue's address as a person when one of the Ticket's or claim's contacts owns it, else the address itself. */
function contactOf(address: string, contacts: MessageContact[] | undefined): string {
  const digits = (value: string) => {
    const plain = value.replace(/\D/g, '');
    return plain.startsWith('0') ? `61${plain.slice(1)}` : plain;
  };
  const email = address.trim().toLowerCase();
  const found = contacts?.find((c) => (c.email && c.email.trim().toLowerCase() === email) || (c.mobile && digits(c.mobile) === digits(address)));
  return found ? `${found.name} (${found.role})` : address;
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
