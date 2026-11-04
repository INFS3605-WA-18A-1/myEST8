// Every channel the Channels pages show, in one list: the welcome wizard's Channels
// step, Setup and Settings all read it, so the three can't drift. SMS, WhatsApp and
// email work today. Messenger, Telegram, WeChat and LINE are placeholders (ADR 0019):
// shown disabled with "Coming later", with no form and nothing behind them.

import { html } from 'hono/html';
import { icon } from '../icons.ts';
import { badge, type Html } from '../ui.ts';

export type ChannelOption =
  | { key: 'sms' | 'whatsapp' | 'email'; name: string; icon: string; later: false }
  | { key: 'messenger' | 'telegram' | 'wechat' | 'line'; name: string; icon: string; later: true };

/** The channels, in the order the pages show them: the working three, then the later four. */
export const CHANNEL_OPTIONS: readonly ChannelOption[] = [
  { key: 'sms', name: 'SMS', icon: 'chat-text', later: false },
  { key: 'whatsapp', name: 'WhatsApp', icon: 'whatsapp-logo', later: false },
  { key: 'email', name: 'Email', icon: 'envelope-simple', later: false },
  { key: 'messenger', name: 'Messenger', icon: 'messenger-logo', later: true },
  { key: 'telegram', name: 'Telegram', icon: 'telegram-logo', later: true },
  { key: 'wechat', name: 'WeChat', icon: 'wechat-logo', later: true },
  // Phosphor has no LINE logo, so a plain chat bubble stands in.
  { key: 'line', name: 'LINE', icon: 'chat-circle-dots', later: true },
];

/** The channels that work today, in page order. */
export const WORKING_CHANNELS = CHANNEL_OPTIONS.filter((ch): ch is Extract<ChannelOption, { later: false }> => !ch.later);

/** The placeholders, in page order. */
export const LATER_CHANNELS = CHANNEL_OPTIONS.filter((ch): ch is Extract<ChannelOption, { later: true }> => ch.later);

/** A working channel's name with its icon, for a row or card heading. */
export function channelName(key: ChannelOption['key']): Html {
  const channel = CHANNEL_OPTIONS.find((ch) => ch.key === key)!;
  return html`<span class="channel-name">${icon(channel.icon, { size: 'size-5' })}<span>${channel.name}</span></span>`;
}

/**
 * The later channels as quiet tiles. Each is a disabled button, so it can't be focused or
 * pressed and isn't a link anywhere; "Coming later" says why in words, not only in grey.
 */
export function laterChannelList(): Html {
  return html`<ul class="channel-later-list" role="list" data-later-channels>
    ${LATER_CHANNELS.map(
      (ch) => html`<li>
        <button type="button" class="channel-later" disabled aria-disabled="true" data-channel-later="${ch.key}">
          ${icon(ch.icon, { size: 'size-5' })}
          <span class="channel-later-name"><span class="sr-only">Connect </span>${ch.name}</span>
          ${badge('Coming later', 'neutral', { wrap: true })}
        </button>
      </li>`,
    )}
  </ul>`;
}

/** The one line above the tiles. */
export const LATER_CHANNELS_NOTE = "These can't be connected yet.";
