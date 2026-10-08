// The design system: page layouts and components as HTML. Interpolated values are
// escaped by `html`; use `raw` only for markup this module builds itself.
//
// Built on daisyUI 5 components (https://daisyui.com, MIT) styled by the
// "myest8" theme in static/app.css, with Tailwind utilities generated in the
// browser by Tailwind's browser build. Some layouts are adapted from HyperUI
// (https://hyperui.dev, MIT); each component says where it came from.

import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;
export type Flash = { kind: 'ok' | 'error'; message: string };
export type NavKey = 'dashboard' | 'calendar' | 'setup' | 'simulator';
export type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'date'
  | 'datetime-local'
  | 'time'
  | 'url'
  | 'password'
  | 'textarea'
  | 'select'
  | 'file'
  | 'checkbox';

const THEME = 'myest8';

/**
 * Lets Tailwind generate utilities for daisyUI's colours (ring-primary,
 * divide-base-300, text-base-content/75...) without redefining them.
 */
const TAILWIND_THEME = html`<style type="text/tailwindcss">
  @theme inline reference {
    --color-base-100: var(--color-base-100);
    --color-base-200: var(--color-base-200);
    --color-base-300: var(--color-base-300);
    --color-base-content: var(--color-base-content);
    --color-primary: var(--color-primary);
    --color-primary-content: var(--color-primary-content);
    --color-secondary: var(--color-secondary);
    --color-secondary-content: var(--color-secondary-content);
    --color-accent: var(--color-accent);
    --color-accent-content: var(--color-accent-content);
    --color-neutral: var(--color-neutral);
    --color-neutral-content: var(--color-neutral-content);
    --color-info: var(--color-info);
    --color-info-content: var(--color-info-content);
    --color-success: var(--color-success);
    --color-success-content: var(--color-success-content);
    --color-warning: var(--color-warning);
    --color-warning-content: var(--color-warning-content);
    --color-error: var(--color-error);
    --color-error-content: var(--color-error-content);
  }
</style>`;

function head(title: string): Html {
  return html`<meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · myEST8</title>
    <link rel="stylesheet" href="/assets/daisyui.css" />
    <link rel="stylesheet" href="/assets/app.css" />
    <script src="/assets/tailwind.js"></script>
    ${TAILWIND_THEME}
    <script src="/assets/app.js" defer></script>`;
}

const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/' },
  { key: 'calendar', label: 'Calendar', href: '/calendar' },
  { key: 'setup', label: 'Setup', href: '/setup' },
  { key: 'simulator', label: 'Simulator', href: '/demo' },
];

function navLinks(active: NavKey | undefined): Html[] {
  return NAV.map(
    (item) =>
      html`<li>
        <a href="${item.href}" ${item.key === active ? html`class="menu-active font-semibold" aria-current="page"` : ''}>${item.label}</a>
      </li>`,
  );
}

/**
 * The top bar (daisyUI navbar + menu, https://daisyui.com/components/navbar/).
 * On wide screens the links sit in a row; on phones they fold into a
 * <details> dropdown, which opens and closes without JavaScript.
 */
function navbar(pm: { name: string } | null | undefined, active: NavKey | undefined): Html {
  const signOut = postButton('/logout', 'Sign out', { variant: 'ghost', size: 'sm' });
  return html`<header class="border-b border-base-300 bg-base-100">
    <nav class="app-container navbar min-h-16 gap-2" aria-label="Main">
      <a href="/" class="mr-2 text-xl font-bold tracking-tight text-primary">myEST8</a>
      ${pm
        ? html`<ul class="app-nav-wide menu menu-horizontal gap-1 p-0">
              ${navLinks(active)}
            </ul>
            <div class="app-nav-wide ml-auto items-center gap-3">
              <span class="text-sm text-base-content/80">${pm.name}</span>
              ${signOut}
            </div>
            <details class="app-nav-narrow dropdown dropdown-end ml-auto">
              <summary class="btn btn-ghost btn-square" aria-label="Menu">${ICON.menu}</summary>
              <div class="dropdown-content z-20 mt-2 w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
                <ul class="menu w-full p-0">
                  ${navLinks(active)}
                </ul>
                <div class="mt-2 flex items-center justify-between gap-2 border-t border-base-300 px-3 pt-2">
                  <span class="truncate text-sm text-base-content/80">${pm.name}</span>
                  ${signOut}
                </div>
              </div>
            </details>`
        : ''}
    </nav>
  </header>`;
}

function heading(title: string, subtitle?: Html | string, actions?: Html): Html {
  return html`<div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
    <div class="min-w-0">
      <h1 class="text-2xl font-bold tracking-tight break-words sm:text-3xl">${title}</h1>
      ${subtitle ? html`<p class="mt-1 text-sm text-base-content/75">${subtitle}</p>` : ''}
    </div>
    ${actions ? html`<div class="flex flex-wrap items-center gap-2">${actions}</div>` : ''}
  </div>`;
}

/**
 * A signed-in Property Manager's page: navbar, flash, the title as the page's
 * only <h1>, then `body`. Top-level elements in `body` are spaced apart.
 */
export function page(o: {
  title: string;
  pm?: { name: string } | null;
  active?: NavKey;
  flash?: Flash | null;
  body: Html;
  /** A line under the title. */
  subtitle?: Html | string;
  /** Buttons beside the title. */
  actions?: Html;
}): Html {
  return html`<!doctype html>
    <html lang="en-AU" data-theme="${THEME}">
      <head>
        ${head(o.title)}
      </head>
      <body class="min-h-screen bg-base-200 text-base-content antialiased">
        <a href="#main" class="skip-link">Skip to content</a>
        ${navbar(o.pm, o.active)}
        <main id="main" class="app-container space-y-6 py-6">
          ${o.flash ? flashMessage(o.flash) : ''} ${heading(o.title, o.subtitle, o.actions)}
          <div class="space-y-6">${o.body}</div>
        </main>
      </body>
    </html>`;
}

/** A page for people who don't sign in: Tenants using an upload or tracker link. Phone first. */
export function publicPage(o: { title: string; flash?: Flash | null; body: Html; subtitle?: Html | string }): Html {
  return html`<!doctype html>
    <html lang="en-AU" data-theme="${THEME}">
      <head>
        ${head(o.title)}
      </head>
      <body class="min-h-screen bg-base-200 text-base-content antialiased">
        <a href="#main" class="skip-link">Skip to content</a>
        <header class="border-b border-base-300 bg-base-100">
          <div class="app-container app-container-narrow flex min-h-14 items-center gap-2">
            <span class="text-primary">${ICON.home}</span>
            <span class="text-lg font-bold tracking-tight text-primary">myEST8</span>
          </div>
        </header>
        <main id="main" class="app-container app-container-narrow space-y-5 py-6">
          ${o.flash ? flashMessage(o.flash) : ''} ${heading(o.title, o.subtitle)}
          <div class="space-y-5">${o.body}</div>
        </main>
        <footer class="app-container app-container-narrow pb-8 text-center text-xs text-base-content/75">
          Questions? Reply to the message your Property Manager sent you.
        </footer>
      </body>
    </html>`;
}

/** The flash message carried in a redirect's query string (?ok= or ?error=). */
export function flashFrom(url: string): Flash | null {
  const params = new URL(url).searchParams;
  const ok = params.get('ok');
  const error = params.get('error');
  return error ? { kind: 'error', message: error } : ok ? { kind: 'ok', message: ok } : null;
}

/** A redirect target that shows `message` on the next page. */
export function withFlash(path: string, kind: Flash['kind'], message: string) {
  return `${path}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(message)}`;
}

/** The message after an action. app.js adds a close button and fades "ok" ones. */
export function flashMessage(flash: Flash): Html {
  const error = flash.kind === 'error';
  return html`<div role="${error ? 'alert' : 'status'}" data-flash="${flash.kind}" class="alert alert-soft ${error ? 'alert-error' : 'alert-success'}">
    ${error ? ICON.error : ICON.success}
    <span><span class="sr-only">${error ? 'Error: ' : 'Done: '}</span>${flash.message}</span>
  </div>`;
}

const ALERT_TONE: Record<Tone, string> = { neutral: '', info: 'alert-info', success: 'alert-success', warning: 'alert-warning', error: 'alert-error' };
const TONE_WORD: Record<Tone, string> = { neutral: 'Note', info: 'Note', success: 'Done', warning: 'Warning', error: 'Error' };

/**
 * A message inside a page (daisyUI alert, soft style): a flag to check, a
 * refused action, an expired link. Icon and text, never colour alone.
 */
export function alert(body: Html | string, tone: Tone = 'info', o: { title?: string } = {}): Html {
  const urgent = tone === 'warning' || tone === 'error';
  return html`<div role="${urgent ? 'alert' : 'status'}" class="alert alert-soft ${ALERT_TONE[tone]} items-start">
    ${urgent ? ICON.error : tone === 'success' ? ICON.success : ICON.info}
    <div class="min-w-0">
      <span class="sr-only">${TONE_WORD[tone]}: </span>
      ${o.title ? html`<p class="font-semibold">${o.title}</p>` : ''}
      <div>${body}</div>
    </div>
  </div>`;
}

const VARIANT: Record<Variant, string> = { primary: 'btn-primary', secondary: 'btn-outline', danger: 'btn-error', ghost: 'btn-ghost' };

function buttonClass(variant: Variant, size: 'sm' | 'md' | undefined, block: boolean | undefined) {
  return `btn ${VARIANT[variant]}${size === 'sm' ? ' btn-sm' : ''}${block ? ' btn-block' : ''}`;
}

/** A form button (daisyUI btn). `block` makes it full width, as on phone forms. */
export function button(
  label: string,
  o: { variant?: Variant; type?: 'submit' | 'button'; name?: string; value?: string; size?: 'sm' | 'md'; block?: boolean; disabled?: boolean } = {},
): Html {
  return html`<button type="${o.type ?? 'submit'}" class="${buttonClass(o.variant ?? 'primary', o.size, o.block)}" ${o.name ? html`name="${o.name}" value="${o.value ?? ''}"` : ''} ${o.disabled ? 'disabled' : ''}>${label}</button>`;
}

/** A link styled as a button. */
export function linkButton(label: string, href: string, o: { variant?: Variant; size?: 'sm' | 'md'; block?: boolean } = {}): Html {
  return html`<a href="${href}" class="${buttonClass(o.variant ?? 'secondary', o.size, o.block)}">${label}</a>`;
}

/** A one-click action: a small form that POSTs `fields` to `action`. `confirm` asks first (via app.js). */
export function postButton(
  action: string,
  label: string,
  o: { variant?: Variant; size?: 'sm' | 'md'; fields?: Record<string, string | number>; confirm?: string } = {},
): Html {
  return html`<form method="post" action="${action}" class="inline-flex" ${o.confirm ? html`data-confirm="${o.confirm}"` : ''}>
    ${Object.entries(o.fields ?? {}).map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`)}
    ${button(label, { variant: o.variant, size: o.size })}
  </form>`;
}

/** A white panel with an optional <h2> title and actions (daisyUI card). */
export function card(o: { title?: string; actions?: Html; body: Html; id?: string }): Html {
  return html`<section class="card min-w-0 border border-base-300 bg-base-100 shadow-sm" ${o.id ? html`id="${o.id}"` : ''}>
    <div class="card-body gap-4 p-4 sm:p-6">
      ${o.title || o.actions
        ? html`<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            ${o.title ? html`<h2 class="card-title text-lg">${o.title}</h2>` : ''}
            ${o.actions ? html`<div class="flex flex-wrap items-center gap-2">${o.actions}</div>` : ''}
          </div>`
        : ''}
      <div class="min-w-0 space-y-3 text-sm">${o.body}</div>
    </div>
  </section>`;
}

/** A heading for a group of cards or a list, with actions on the right. */
export function sectionHeader(title: string, actions?: Html): Html {
  return html`<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <h2 class="text-lg font-semibold tracking-tight">${title}</h2>
    ${actions ? html`<div class="flex flex-wrap items-center gap-2">${actions}</div>` : ''}
  </div>`;
}

const TONE: Record<Tone, string> = { neutral: 'badge-neutral', info: 'badge-info', success: 'badge-success', warning: 'badge-warning', error: 'badge-error' };

/** A short label (daisyUI badge, soft style). The text carries the meaning; colour only backs it up. */
export function badge(text: string, tone: Tone = 'neutral'): Html {
  return html`<span class="badge badge-soft ${TONE[tone]} whitespace-nowrap">${text}</span>`;
}

/** Urgent, High or Routine. */
export function urgencyBadge(urgency: string): Html {
  return badge(humanise(urgency), urgency === 'urgent' ? 'error' : urgency === 'high' ? 'warning' : 'neutral');
}

const STATUS_TONE: Record<string, Tone> = {
  gathering: 'neutral',
  awaiting_photos: 'warning',
  checking: 'info',
  maintenance_request: 'warning',
  confirmed: 'success',
  rejected: 'error',
  urgent: 'error',
  open: 'info',
  active: 'info',
  sent: 'info',
  quoted: 'info',
  quoting: 'info',
  scheduled: 'info',
  awaiting_owner: 'warning',
  requested: 'warning',
  reminded: 'warning',
  approved: 'success',
  done: 'success',
  closed: 'success',
  receipt_forwarded: 'success',
  declined: 'error',
  declined_by_owner: 'error',
  not_chosen: 'neutral',
  cancelled: 'neutral',
};

/** Statuses whose words come from the domain language rather than `humanise`. */
const STATUS_LABEL: Record<string, string> = {
  maintenance_request: 'Maintenance Request',
  urgent: 'Urgent Repair',
  awaiting_owner: 'Awaiting Property Owner',
  declined_by_owner: 'Declined by Property Owner',
};

/** Any status from the core (Job, Quote, Quote Request, approval...), in words. */
export function statusBadge(status: string): Html {
  return badge(STATUS_LABEL[status] ?? humanise(status), STATUS_TONE[status] ?? 'neutral');
}

/** "Nothing here yet" (layout adapted from HyperUI's empty states, https://hyperui.dev/components/application/empty-states). */
export function emptyState(text: string, action?: Html): Html {
  return html`<div class="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-content/20 px-4 py-8 text-center">
    <span class="text-base-content/50">${ICON.inbox}</span>
    <p class="max-w-prose text-sm text-base-content/75">${text}</p>
    ${action ?? ''}
  </div>`;
}

/**
 * A data table (daisyUI table). It scrolls sideways inside its own frame on
 * phones, never the page. `caption` names it for screen readers.
 */
export function table(headers: string[], rows: Html[][], o: { caption?: string } = {}): Html {
  return html`<div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
    <table class="table table-sm sm:table-md">
      ${o.caption ? html`<caption class="sr-only">${o.caption}</caption>` : ''}
      <thead>
        <tr>
          ${headers.map((h) => html`<th scope="col">${h}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => html`<tr class="align-top">${row.map((cell) => html`<td class="min-w-28">${cell}</td>`)}</tr>`)}
      </tbody>
    </table>
  </div>`;
}

/**
 * A labelled form control (daisyUI fieldset, input, select, textarea,
 * file-input, checkbox). The label's `for` matches the control's id,
 * `field-<name>` unless `id` is given (give one when a name repeats on a page).
 * `hint` is tied to the control with aria-describedby.
 */
export function field(o: {
  label: string;
  name: string;
  type?: FieldType;
  value?: string | number | null;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string;
  multiple?: boolean;
  accept?: string;
  step?: string;
  id?: string;
  autocomplete?: string;
  min?: string | number;
  max?: string | number;
  rows?: number;
  /** For checkboxes. */
  checked?: boolean;
}): Html {
  const id = o.id ?? `field-${o.name}`;
  const type = o.type ?? 'text';
  const hintId = `${id}-hint`;
  const hint = o.hint ? html`<p id="${hintId}" class="label text-xs">${o.hint}</p>` : '';
  const common = html`id="${id}" name="${o.name}" ${o.required ? 'required' : ''} ${o.multiple ? 'multiple' : ''} ${o.hint ? html`aria-describedby="${hintId}"` : ''}`;

  if (type === 'checkbox') {
    return html`<div class="fieldset">
      <label for="${id}" class="flex cursor-pointer items-start gap-3 py-1 text-sm">
        <input ${common} type="checkbox" class="checkbox checkbox-primary checkbox-sm mt-0.5" value="${o.value ?? 'on'}" ${o.checked ? 'checked' : ''} />
        <span>${o.label}</span>
      </label>
      ${hint}
    </div>`;
  }

  const control =
    type === 'textarea'
      ? html`<textarea ${common} class="textarea w-full" rows="${o.rows ?? 4}" placeholder="${o.placeholder ?? ''}">${o.value ?? ''}</textarea>`
      : type === 'select'
        ? html`<select ${common} class="select w-full ${o.multiple ? 'h-auto min-h-28 py-2' : ''}">
            ${o.placeholder ? html`<option value="">${o.placeholder}</option>` : ''}
            ${(o.options ?? []).map((opt) => html`<option value="${opt.value}" ${String(o.value ?? '') === opt.value ? 'selected' : ''}>${opt.label}</option>`)}
          </select>`
        : type === 'file'
          ? html`<input ${common} type="file" class="file-input w-full" ${o.accept ? html`accept="${o.accept}"` : ''} />`
          : html`<input ${common} type="${type}" class="input w-full" value="${o.value ?? ''}" placeholder="${o.placeholder ?? ''}" ${o.autocomplete ? html`autocomplete="${o.autocomplete}"` : ''} ${o.step ? html`step="${o.step}"` : ''} ${o.min !== undefined ? html`min="${o.min}"` : ''} ${o.max !== undefined ? html`max="${o.max}"` : ''} />`;
  return html`<div class="fieldset">
    <label for="${id}" class="fieldset-legend text-sm font-medium">${o.label}</label>
    ${control} ${hint}
  </div>`;
}

const STAT_TONE: Record<Tone, string> = { neutral: '', info: 'text-info', success: 'text-success', warning: 'text-warning', error: 'text-error' };

/** One number with its label (daisyUI stat). Put several in `statGroup`. */
export function stat(o: { label: string; value: string | number; hint?: string; tone?: Tone }): Html {
  return html`<div class="stat min-w-0 rounded-box border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
    <div class="stat-title text-sm">${o.label}</div>
    <div class="stat-value text-2xl break-words whitespace-normal tabular-nums sm:text-3xl ${STAT_TONE[o.tone ?? 'neutral']}">${o.value}</div>
    ${o.hint ? html`<div class="stat-desc">${o.hint}</div>` : ''}
  </div>`;
}

/** A row of stats: two columns on phones, as many as fit on wider screens. */
export function statGroup(items: Html[]): Html {
  return html`<div class="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">${items}</div>`;
}

/**
 * Progress through stages (daisyUI steps, https://daisyui.com/components/steps/),
 * as for the Tenant's tracker. Done stages are ticked and say so to screen
 * readers; the first stage not done is the current one. Vertical on phones and
 * horizontal on wide screens, or always vertical with `vertical`.
 */
export function steps(items: { label: string; done: boolean; detail?: string }[], o: { vertical?: boolean } = {}): Html {
  const current = items.findIndex((item) => !item.done);
  const responsive = !o.vertical;
  return html`<ol class="steps steps-vertical ${responsive ? 'lg:steps-horizontal' : ''} w-full">
    ${items.map(
      (item, i) =>
        html`<li class="step ${item.done ? 'step-primary' : ''}" ${item.done ? html`data-content="✓"` : ''} ${i === current ? html`aria-current="step"` : ''}>
          <div class="pb-2 text-start ${responsive ? 'lg:px-1 lg:text-center' : ''}">
            <span class="block text-sm ${item.done || i === current ? 'font-semibold' : 'text-base-content/80'}">${item.label}<span class="sr-only">${item.done ? ' (done)' : i === current ? ' (next)' : ''}</span></span>
            ${item.detail ? html`<span class="block text-xs text-base-content/75">${item.detail}</span>` : ''}
          </div>
        </li>`,
    )}
  </ol>`;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g;

/** Text with its http(s) links made clickable, everything still escaped. */
function linkified(text: string): (Html | string)[] {
  const parts: (Html | string)[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    parts.push(text.slice(last, match.index));
    parts.push(html`<a class="link" href="${match[0]}" target="_blank" rel="noopener noreferrer">${match[0]}</a>`);
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

const BUBBLE_TONE: Record<Tone, string> = { neutral: '', info: 'chat-bubble-info', success: 'chat-bubble-success', warning: 'chat-bubble-warning', error: 'chat-bubble-error' };

/**
 * One message in a conversation (daisyUI chat, https://daisyui.com/components/chat/).
 * Line breaks in `text` are kept; when it is a string, links in it can be
 * followed. Without a tone, `end` bubbles are primary and `start` bubbles grey.
 */
export function chatBubble(o: { side: 'start' | 'end'; header: Html | string; text: Html | string; footer?: Html | string; tone?: Tone }): Html {
  const tone = o.tone ? BUBBLE_TONE[o.tone] : o.side === 'end' ? 'chat-bubble-primary' : '';
  return html`<div class="chat ${o.side === 'end' ? 'chat-end' : 'chat-start'}">
    <div class="chat-header flex-wrap items-center text-xs text-base-content/75">${o.header}</div>
    <div class="chat-bubble ${tone} text-sm whitespace-pre-wrap">${typeof o.text === 'string' ? linkified(o.text) : o.text}</div>
    ${o.footer ? html`<div class="chat-footer text-xs text-base-content/75">${o.footer}</div>` : ''}
  </div>`;
}

/**
 * Links that switch between views of one page, such as "Mine" and "All"
 * (daisyUI tabs, border style). They are links, so they use aria-current,
 * not the ARIA tab pattern.
 */
export function tabs(items: { label: string; href: string; active: boolean; count?: number }[], label = 'Views'): Html {
  return html`<nav class="tabs tabs-border" aria-label="${label}">
    ${items.map(
      (item) =>
        html`<a href="${item.href}" class="tab gap-2 ${item.active ? 'tab-active font-semibold' : ''}" ${item.active ? html`aria-current="page"` : ''}>
          ${item.label}
          ${item.count !== undefined ? html`<span class="badge badge-sm ${item.active ? 'badge-primary' : 'badge-soft badge-neutral'}">${item.count}</span>` : ''}
        </a>`,
    )}
  </nav>`;
}

/**
 * Events in order, newest last (daisyUI timeline, vertical and compact with the
 * icon snapped to the top, https://daisyui.com/components/timeline/).
 */
export function timeline(items: { at: string; title: string; detail?: string }[]): Html {
  return html`<ol class="timeline timeline-vertical timeline-compact timeline-snap-icon">
    ${items.map(
      (item, i) =>
        html`<li>
          ${i > 0 ? html`<hr class="bg-base-300" />` : ''}
          <div class="timeline-middle text-primary">${ICON.dot}</div>
          <div class="timeline-end min-w-0 ${i < items.length - 1 ? 'mb-5' : ''}">
            <p class="text-xs text-base-content/75">${item.at}</p>
            <p class="text-sm font-medium">${item.title}</p>
            ${item.detail ? html`<p class="text-sm whitespace-pre-line text-base-content/80">${item.detail}</p>` : ''}
          </div>
          ${i < items.length - 1 ? html`<hr class="bg-base-300" />` : ''}
        </li>`,
    )}
  </ol>`;
}

/** Photo thumbnails, each opening the full image in a new tab. `alt` defaults to "Photo n of m". */
export function photoGrid(items: { src: string; caption?: Html | string; alt?: string }[]): Html {
  return html`<ul role="list" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    ${items.map(
      (item, i) =>
        html`<li>
          <figure class="flex flex-col items-stretch gap-1.5">
            <a href="${item.src}" target="_blank" rel="noopener" class="block overflow-hidden rounded-box border border-base-300 bg-base-200">
              <img src="${item.src}" alt="${item.alt ?? `Photo ${i + 1} of ${items.length}`}" loading="lazy" decoding="async" class="aspect-square w-full object-cover" />
              <span class="sr-only">(opens full size in a new tab)</span>
            </a>
            ${item.caption ? html`<figcaption class="text-xs text-base-content/80">${item.caption}</figcaption>` : ''}
          </figure>
        </li>`,
    )}
  </ul>`;
}

/** Label and value pairs (layout adapted from HyperUI's details lists, https://hyperui.dev/components/application/details-list). */
export function dl(items: [string, Html | string][]): Html {
  return html`<dl class="divide-y divide-base-300 text-sm">
    ${items.map(
      ([term, value]) =>
        html`<div class="grid grid-cols-1 gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-3 sm:gap-4">
          <dt class="font-medium text-base-content/75">${term}</dt>
          <dd class="min-w-0 break-words sm:col-span-2">${value}</dd>
        </div>`,
    )}
  </dl>`;
}

export function formatMoney(cents: number | null): string {
  return cents === null ? '—' : (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

export function formatWhen(iso: string | null, timeZone = 'Australia/Sydney'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "awaiting_owner" -> "Awaiting owner" */
export function humanise(value: string): string {
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Decorative icons (Heroicons outline, MIT, https://heroicons.com). Always aria-hidden: the text beside them carries the meaning. */
const svg = (d: string, size = 'size-5') =>
  html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" class="${size} shrink-0" aria-hidden="true" focusable="false"><path stroke-linecap="round" stroke-linejoin="round" d="${d}" /></svg>`;

const ICON = {
  menu: svg('M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5', 'size-6'),
  home: svg('m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25', 'size-6'),
  success: svg('M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'),
  error: svg('M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z'),
  info: svg('m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z'),
  inbox: svg('M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z', 'size-10'),
  dot: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-4" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6" /></svg>`,
};
