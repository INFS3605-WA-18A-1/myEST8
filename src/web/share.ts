// The Share control: a button that opens a small panel to pass a link on by
// copying it, or by email or SMS. Everything is server-rendered links:
// there are no server routes and no requests. It is a <details> disclosure, so
// without JavaScript the panel still opens with the plain links and a read-only
// field to copy the link by hand. app.js (the "share" block) adds the Copy link
// button, the phone's own share sheet (Web Share API) where there is one, and
// closing on Escape or a click elsewhere.

import type { Context } from 'hono';
import { html } from 'hono/html';
import { icon } from './icons.ts';
import type { Html } from './ui.ts';

export type ShareChannel = 'copy' | 'email' | 'sms' | 'native';

const ALL_CHANNELS: ShareChannel[] = ['copy', 'email', 'sms', 'native'];

/** The note on a Property Manager page's Share panel: its links only open for colleagues. */
export const COLLEAGUES_ONLY = 'Only Property Managers in your Agency can open this link.';

let counter = 0;

/**
 * A Share button and its panel. `title` heads the panel and is the email
 * subject; `text` is the message, sent with `url` after it. `label` replaces
 * "Share" on the button; `note` is a muted line under the title (who can open
 * the link, say). `channels` picks the options, all of them by default. `align`
 * says which edge of the button the panel lines up with on wider screens; on
 * phones it is a sheet along the bottom of the screen.
 */
export function shareButton(o: {
  title: string;
  text: string;
  url: string;
  label?: string;
  note?: string;
  channels?: ShareChannel[];
  align?: 'start' | 'end';
}): Html {
  const id = `share-${++counter}`;
  const channels = new Set(o.channels ?? ALL_CHANNELS);
  const message = `${o.text} ${o.url}`;
  const email = `mailto:?subject=${encodeURIComponent(o.title)}&body=${encodeURIComponent(`${o.text}\n\n${o.url}`)}`;
  const sms = `sms:?&body=${encodeURIComponent(message)}`;

  const option = (channel: ShareChannel, href: string, iconName: string, label: string) =>
    channels.has(channel)
      ? html`<li>
          <a class="share-option" data-share-channel="${channel}" href="${href}">
            ${icon(iconName)}<span>${label}</span>
          </a>
        </li>`
      : '';

  return html`<details class="share ${o.align === 'start' ? 'is-start' : ''}" data-share data-share-title="${o.title}" data-share-text="${o.text}">
    <summary class="btn btn-outline btn-sm share-toggle">${icon('share-network', { size: 'size-4' })}<span>${o.label ?? 'Share'}</span></summary>
    <div class="share-panel" role="group" aria-labelledby="${id}-title">
      <div class="share-head">
        <p class="share-title" id="${id}-title">${o.title}</p>
        <button type="button" class="btn btn-ghost btn-sm btn-square share-close" data-share-close hidden aria-label="Close">${icon('x', { size: 'size-4' })}</button>
      </div>
      ${o.note ? html`<p class="share-note">${o.note}</p>` : ''}
      <div class="share-link">
        <label class="share-label" for="${id}-url">Link</label>
        <div class="share-copy">
          <input id="${id}-url" class="share-url" type="text" readonly value="${o.url}" data-share-url aria-describedby="${id}-status" />
          ${channels.has('copy')
            ? html`<button type="button" class="btn btn-primary btn-sm share-copy-button" data-share-copy hidden>${icon('copy', { size: 'size-4' })}<span>Copy link</span></button>`
            : ''}
        </div>
        <p class="share-status" id="${id}-status" aria-live="polite" data-share-status></p>
      </div>
      <ul class="share-options" aria-label="Send the link">
        ${option('email', email, 'envelope', 'Email')}
        ${option('sms', sms, 'chat-text', 'SMS')}
        ${channels.has('native')
          ? html`<li data-share-native hidden>
              <button type="button" class="share-option">${icon('dots-three')}<span>More options…</span></button>
            </li>`
          : ''}
      </ul>
    </div>
  </details>`;
}

/**
 * The absolute link to share: `path` on the address the request came to, or,
 * without a path, the page being looked at (its query kept, any flash message
 * dropped). Honours a proxy's X-Forwarded-Proto and X-Forwarded-Host.
 */
export function shareUrl(c: Context, path?: string): string {
  const here = new URL(c.req.url);
  const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const origin = `${forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : here.protocol.replace(':', '')}://${forwardedHost || here.host}`;
  if (path !== undefined) return new URL(path, origin).toString();
  here.searchParams.delete('ok');
  here.searchParams.delete('error');
  return `${origin}${here.pathname}${here.search}`;
}
