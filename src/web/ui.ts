// The design system: page layouts and components as HTML. Interpolated values are
// escaped by `html`; use `raw` only for markup this module builds itself.
//
// Built on daisyUI 5 components (https://daisyui.com, MIT) styled by the "myest8"
// theme and the tokens in static/app.css (docs/design-system.md), with Tailwind
// utilities generated in the browser by Tailwind's browser build. Some layouts are
// adapted from HyperUI (https://hyperui.dev, MIT); each component says where it came from.

import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { ShellInfo } from './shell.ts';

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
 * divide-base-300, text-base-content/75...) and for the design tokens (text-muted,
 * border-line, bg-page, text-urgent...) without redefining them.
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
    --color-ink: var(--ink);
    --color-page: var(--page);
    --color-surface: var(--surface);
    --color-muted: var(--muted);
    --color-line: var(--line);
    --color-control: var(--control);
    --color-action: var(--action);
    --color-hivis: var(--hivis);
    --color-urgent: var(--urgent);
    --color-urgent-bg: var(--urgent-bg);
    --color-high: var(--high);
    --color-high-bg: var(--high-bg);
    --color-done: var(--done);
    --color-done-bg: var(--done-bg);
    --color-rail-text: var(--rail-text);
    --color-rail-muted: var(--rail-muted);
  }
</style>`;

/**
 * The document's head. The inline script marks the page as having JavaScript
 * before the first paint, so the rail can become a drawer only when it can open.
 */
function head(title: string): Html {
  return html`<meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} - myEST8</title>
    <script>document.documentElement.classList.add('js')</script>
    <link rel="preload" href="/assets/fonts/barlow-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
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

/**
 * The rail: the logotype, the four sections with their icons (the current one
 * gets the hi-vis bar and aria-current), and the Agency's name at the bottom.
 * On phones it is a drawer when JavaScript is on, and a row above the page otherwise.
 */
function rail(active: NavKey | undefined, agencyName: string | undefined, counts: Partial<Record<NavKey, number>>): Html {
  return html`<aside id="rail" class="rail" aria-label="Sections">
    <a href="/" class="rail-logo">myEST8</a>
    <nav aria-label="Main">
      <ul class="rail-nav">
        ${NAV.map((item) => {
          const count = counts[item.key];
          return html`<li>
            <a href="${item.href}" class="rail-link" ${item.key === active ? html`aria-current="page"` : ''}>${NAV_ICON[item.key]}<span>${item.label}</span>${count !== undefined ? html`<span class="rail-count num">${count}</span>` : ''}</a>
          </li>`;
        })}
      </ul>
    </nav>
    ${agencyName ? html`<p class="rail-agency">${agencyName}</p>` : ''}
  </aside>`;
}

/** The Property Manager's name, opening a menu with Sign out. */
function userMenu(name: string): Html {
  return html`<details class="user-menu" data-menu>
    <summary>${name}${ICON.chevron}</summary>
    <div class="user-menu-panel">${postButton('/logout', 'Sign out', { variant: 'ghost', size: 'sm' })}</div>
  </details>`;
}

/**
 * The top bar: the menu button (drawer only), the page title, the page's controls,
 * then today's date and the user menu. Under 1024px the controls drop to a second
 * row under the title, so the title always has room.
 */
function topBar(
  title: string,
  o: { menu: boolean; controls?: Html; today?: string; pm?: { name: string } | null },
): Html {
  return html`<header class="topbar">
    ${o.menu ? html`<button type="button" class="menu-button" data-drawer-toggle aria-controls="rail" aria-expanded="false" aria-label="Menu">${ICON.menu}</button>` : ''}
    <h1 class="topbar-title">${title}</h1>
    ${o.controls ? html`<div class="topbar-controls">${o.controls}</div>` : ''}
    <div class="topbar-end">
      ${o.today ? html`<time class="topbar-date">${o.today}</time>` : ''}
      ${o.pm ? userMenu(o.pm.name) : ''}
    </div>
  </header>`;
}

/** The subtitle and buttons under the top bar (nothing when a page has neither). */
function contentHead(subtitle: Html | string | undefined, actions: Html | undefined): Html | string {
  if (!subtitle && !actions) return '';
  return html`<div class="page-head">
    ${subtitle ? html`<p class="page-subtitle">${subtitle}</p>` : html`<span></span>`}
    ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

/**
 * A signed-in Property Manager's page: the rail (with the Agency's name), the top
 * bar with the title as the page's only <h1>, the flash under it, then `body`.
 * Top-level elements in `body` are spaced apart. `shell` (from shellInfo) adds the
 * Agency's name and today's date; `controls` sit in the top bar.
 */
export function page(o: {
  title: string;
  pm?: { name: string } | null;
  active?: NavKey;
  flash?: Flash | null;
  body: Html;
  /** A line under the title. */
  subtitle?: Html | string;
  /** Buttons beside the subtitle. */
  actions?: Html;
  /** Controls in the top bar, such as the Mine/All segmented control. */
  controls?: Html;
  /** The Agency's name for the rail and today's date for the top bar. */
  shell?: ShellInfo;
  /** Counts shown beside rail links. */
  navCounts?: Partial<Record<NavKey, number>>;
}): Html {
  const signedIn = Boolean(o.pm);
  return html`<!doctype html>
    <html lang="en-AU" data-theme="${THEME}">
      <head>
        ${head(o.title)}
      </head>
      <body>
        <a href="#main" class="skip-link">Skip to content</a>
        <div class="app-shell ${signedIn ? 'has-rail' : ''}" data-shell>
          ${signedIn ? rail(o.active, o.shell?.agencyName, o.navCounts ?? {}) : ''}
          <div class="app-main">
            ${topBar(o.title, { menu: signedIn, controls: o.controls, today: o.shell?.today, pm: o.pm })}
            ${o.flash ? html`<div class="app-flash">${flashMessage(o.flash)}</div>` : ''}
            <main id="main" class="app-content">
              ${contentHead(o.subtitle, o.actions)}
              <div class="app-body-stack">${o.body}</div>
            </main>
          </div>
          ${signedIn ? html`<div class="drawer-scrim" data-drawer-scrim></div>` : ''}
        </div>
      </body>
    </html>`;
}

const TENANT_FOOTER = 'Questions? Reply to the message your Property Manager sent you.';

/**
 * A page for someone who isn't signed in: a Tenant using an upload or tracker
 * link, or a Property Manager signing in or up. Phone first, a centred column
 * under a logotype bar, with no rail. `width` picks the column: narrow (400px) for
 * a single form so its heading lines up with it, default (560px), or wide (1120px).
 * `wide` is the older way to ask for wide. `titleSize: 'hero'` makes the title a
 * headline (40px from 768px, 32px on phones) for the landing page. `headerActions`
 * sit at the right of the bar; `footer` replaces the line for Tenants.
 */
export function publicPage(o: {
  title: string;
  flash?: Flash | null;
  body: Html;
  subtitle?: Html | string;
  width?: 'narrow' | 'default' | 'wide';
  /** The same as width: 'wide'. */
  wide?: boolean;
  titleSize?: 'page' | 'hero';
  headerActions?: Html;
  footer?: Html | string;
}): Html {
  const width = o.width ?? (o.wide ? 'wide' : 'default');
  const widthClass = width === 'default' ? '' : `is-${width}`;
  const titleClass = o.titleSize === 'hero' ? 'page-title is-hero' : 'page-title';
  return html`<!doctype html>
    <html lang="en-AU" data-theme="${THEME}">
      <head>
        ${head(o.title)}
      </head>
      <body>
        <a href="#main" class="skip-link">Skip to content</a>
        <header class="public-bar">
          <div class="public-bar-inner ${widthClass}">
            <span class="logotype">myEST8</span>
            ${o.headerActions ? html`<div class="ml-auto flex items-center gap-2">${o.headerActions}</div>` : ''}
          </div>
        </header>
        <main id="main" class="public-main ${widthClass}">
          ${o.flash ? flashMessage(o.flash) : ''}
          <div class="app-body-stack">
            <div class="page-head">
              <h1 class="${titleClass}">${o.title}</h1>
              ${o.subtitle ? html`<p class="page-subtitle">${o.subtitle}</p>` : ''}
            </div>
            ${o.body}
          </div>
        </main>
        <footer class="public-footer ${widthClass}">${o.footer ?? TENANT_FOOTER}</footer>
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

/** The message after an action, one line under the top bar. app.js adds a close button and fades "ok" ones. */
export function flashMessage(flash: Flash): Html {
  const error = flash.kind === 'error';
  return html`<div role="${error ? 'alert' : 'status'}" data-flash="${flash.kind}" class="alert alert-soft ${error ? 'alert-error' : 'alert-success'} py-2 text-sm">
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

const VARIANT: Record<Variant, string> = { primary: 'btn-primary', secondary: 'btn-outline', danger: 'btn-danger', ghost: 'btn-ghost' };

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

/** The section box shared by card() and section(). */
function panel(o: { title?: string; actions?: Html; body: Html; id?: string }): Html {
  return html`<section class="section" ${o.id ? html`id="${o.id}"` : ''}>
    ${o.title || o.actions
      ? html`<div class="section-head">
          ${o.title ? html`<h2 class="section-title">${o.title}</h2>` : ''}
          ${o.actions ? html`<div class="section-actions">${o.actions}</div>` : ''}
        </div>`
      : ''}
    <div class="section-body">${o.body}</div>
  </section>`;
}

/** A surface with a hairline border and an optional <h2> title and actions (a section, not a card). */
export function card(o: { title?: string; actions?: Html; body: Html; id?: string }): Html {
  return panel(o);
}

/** A titled section: a surface with a hairline, the heading on the left and actions on the right. */
export function section(o: { title: string; actions?: Html; body: Html; id?: string }): Html {
  return panel(o);
}

/** A heading for a group of cards or a list, with actions on the right. */
export function sectionHeader(title: string, actions?: Html): Html {
  return html`<div class="section-head">
    <h2 class="section-title">${title}</h2>
    ${actions ? html`<div class="section-actions">${actions}</div>` : ''}
  </div>`;
}

const TONE: Record<Tone, string> = { neutral: 'badge-neutral', info: 'badge-info', success: 'badge-success', warning: 'badge-warning', error: 'badge-error' };

/** A short label (daisyUI badge, soft style). The text carries the meaning; colour only backs it up. */
export function badge(text: string, tone: Tone = 'neutral'): Html {
  return html`<span class="badge badge-soft ${TONE[tone]} whitespace-nowrap">${text}</span>`;
}

/** Urgent, High or Routine. Routine is uncoloured: its word is the signal. */
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

/** "Nothing here yet": one sentence and the action to take (layout adapted from HyperUI's empty states, https://hyperui.dev/components/application/empty-states). */
export function emptyState(text: string, action?: Html): Html {
  return html`<div class="empty-state">
    <p>${text}</p>
    ${action ?? ''}
  </div>`;
}

/**
 * A data table (daisyUI table). It scrolls sideways inside its own frame on
 * phones, never the page. `caption` names it for screen readers.
 */
export function table(headers: string[], rows: Html[][], o: { caption?: string } = {}): Html {
  return html`<div class="table-frame">
    <table class="table table-sm">
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
 * A labelled form control (daisyUI input, select, textarea, file-input, checkbox,
 * styled as a field). The label's `for` matches the control's id,
 * `field-<name>` unless `id` is given (give one when a name repeats on a page).
 * `hint` is tied to the control with aria-describedby, and so is `error`, which
 * also marks the control aria-invalid.
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
  /** Why the posted value was refused, shown under the control. */
  error?: string;
}): Html {
  const id = o.id ?? `field-${o.name}`;
  const type = o.type ?? 'text';
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hint = o.hint ? html`<p id="${hintId}" class="field-hint">${o.hint}</p>` : '';
  const error = o.error ? html`<p id="${errorId}" class="field-error">${o.error}</p>` : '';
  const describedBy = [o.error ? errorId : '', o.hint ? hintId : ''].filter(Boolean).join(' ');
  const common = html`id="${id}" name="${o.name}" ${o.required ? 'required' : ''} ${o.multiple ? 'multiple' : ''} ${describedBy ? html`aria-describedby="${describedBy}"` : ''} ${o.error ? html`aria-invalid="true"` : ''}`;
  const invalid = o.error ? ' input-error' : '';

  if (type === 'checkbox') {
    return html`<div class="fieldset">
      <label for="${id}" class="flex cursor-pointer items-start gap-3 py-1 text-sm">
        <input ${common} type="checkbox" class="checkbox checkbox-primary checkbox-sm mt-0.5" value="${o.value ?? 'on'}" ${o.checked ? 'checked' : ''} />
        <span>${o.label}</span>
      </label>
      ${error} ${hint}
    </div>`;
  }

  const control =
    type === 'textarea'
      ? html`<textarea ${common} class="textarea w-full${invalid.replace('input', 'textarea')}" rows="${o.rows ?? 4}" placeholder="${o.placeholder ?? ''}">${o.value ?? ''}</textarea>`
      : type === 'select'
        ? html`<select ${common} class="select w-full${invalid.replace('input', 'select')} ${o.multiple ? 'h-auto min-h-28 py-2' : ''}">
            ${o.placeholder ? html`<option value="">${o.placeholder}</option>` : ''}
            ${(o.options ?? []).map((opt) => html`<option value="${opt.value}" ${String(o.value ?? '') === opt.value ? 'selected' : ''}>${opt.label}</option>`)}
          </select>`
        : type === 'file'
          ? html`<input ${common} type="file" class="file-input w-full" ${o.accept ? html`accept="${o.accept}"` : ''} />`
          : html`<input ${common} type="${type}" class="input w-full${invalid}" value="${o.value ?? ''}" placeholder="${o.placeholder ?? ''}" ${o.autocomplete ? html`autocomplete="${o.autocomplete}"` : ''} ${o.step ? html`step="${o.step}"` : ''} ${o.min !== undefined ? html`min="${o.min}"` : ''} ${o.max !== undefined ? html`max="${o.max}"` : ''} />`;
  return html`<div class="fieldset">
    <label for="${id}" class="field-label">${o.label}</label>
    ${control} ${error} ${hint}
  </div>`;
}

const STAT_TONE: Record<Tone, string> = { neutral: '', info: 'text-info', success: 'text-success', warning: 'text-warning', error: 'text-error' };

/** One number with its label, compact (a tile, not a card). Put several in `statGroup`. */
export function stat(o: { label: string; value: string | number; hint?: string; tone?: Tone }): Html {
  return html`<div class="stat-tile">
    <div class="stat-tile-label">${o.label}</div>
    <div class="stat-tile-value ${STAT_TONE[o.tone ?? 'neutral']}">${o.value}</div>
    ${o.hint ? html`<div class="stat-tile-hint">${o.hint}</div>` : ''}
  </div>`;
}

/** A row of stats: two columns on phones, as many as fit on wider screens. */
export function statGroup(items: Html[]): Html {
  return html`<div class="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">${items}</div>`;
}

/**
 * Progress through stages (daisyUI steps, https://daisyui.com/components/steps/),
 * as for the Tenant's tracker. Done stages are ticked and say so to screen
 * readers; the first stage not done is the current one. Vertical on phones and
 * horizontal on wide screens, or always vertical with `vertical`.
 */
export function steps(
  items: { label: string; done: boolean; detail?: string; href?: string }[],
  o: {
    vertical?: boolean;
    /** Always horizontal, with small labels on phones: a wizard's short step names. */
    horizontal?: boolean;
    /** The stage being shown, when it isn't simply the first one not done (a wizard's step). */
    current?: number;
  } = {},
): Html {
  const current = o.current ?? items.findIndex((item) => !item.done);
  const responsive = !o.vertical && !o.horizontal;
  const direction = o.horizontal ? 'steps-horizontal' : `steps-vertical ${responsive ? 'lg:steps-horizontal' : ''}`;
  return html`<ol class="steps ${direction} w-full">
    ${items.map(
      (item, i) =>
        html`<li class="step ${o.horizontal ? 'min-w-0' : ''} ${item.done || (o.current !== undefined && i === current) ? 'step-primary' : ''}" ${item.done ? html`data-content="✓"` : ''} ${i === current ? html`aria-current="step"` : ''}>
          <div class="pb-2 ${o.horizontal ? 'px-0.5 text-center' : `text-start ${responsive ? 'lg:px-1 lg:text-center' : ''}`}">
            <span class="block ${o.horizontal ? 'text-xs sm:text-sm' : 'text-sm'} ${item.done || i === current ? 'font-semibold' : 'text-muted'}"
              >${item.href && i !== current ? html`<a class="link link-hover" href="${item.href}">${item.label}</a>` : item.label}<span class="sr-only"
                >${item.done ? ' (done)' : ''}${i === current ? (o.current === undefined ? ' (next)' : ' (this step)') : ''}</span
              ></span
            >
            ${item.detail ? html`<span class="block text-xs text-muted">${item.detail}</span>` : ''}
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
 * followed. Without a tone, `end` bubbles are the action colour and `start`
 * bubbles sit on the page colour.
 */
export function chatBubble(o: { side: 'start' | 'end'; header: Html | string; text: Html | string; footer?: Html | string; tone?: Tone }): Html {
  const tone = o.tone ? BUBBLE_TONE[o.tone] : o.side === 'end' ? 'chat-bubble-primary' : '';
  return html`<div class="chat ${o.side === 'end' ? 'chat-end' : 'chat-start'}">
    <div class="chat-header flex-wrap items-center">${o.header}</div>
    <div class="chat-bubble ${tone} whitespace-pre-wrap">${typeof o.text === 'string' ? linkified(o.text) : o.text}</div>
    ${o.footer ? html`<div class="chat-footer">${o.footer}</div>` : ''}
  </div>`;
}

/**
 * Links that switch between views of one page (daisyUI tabs, border style). They
 * are links, so they use aria-current, not the ARIA tab pattern. For the Mine/All
 * control in a page's top bar, use `segmented`.
 */
export function tabs(items: { label: string; href: string; active: boolean; count?: number }[], label = 'Views'): Html {
  return html`<nav class="tabs tabs-border" aria-label="${label}">
    ${items.map(
      (item) =>
        html`<a href="${item.href}" class="tab gap-2 ${item.active ? 'tab-active font-semibold' : ''}" ${item.active ? html`aria-current="page"` : ''}>
          ${item.label}
          ${item.count !== undefined ? html`<span class="count-chip ${item.active ? 'is-decision' : ''}">${item.count}</span>` : ''}
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
          ${i > 0 ? html`<hr class="bg-line" />` : ''}
          <div class="timeline-middle text-primary">${ICON.dot}</div>
          <div class="timeline-end min-w-0 ${i < items.length - 1 ? 'mb-5' : ''}">
            <p class="text-xs text-muted">${item.at}</p>
            <p class="text-sm font-medium">${item.title}</p>
            ${item.detail ? html`<p class="text-sm whitespace-pre-line text-muted">${item.detail}</p>` : ''}
          </div>
          ${i < items.length - 1 ? html`<hr class="bg-line" />` : ''}
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
            <a href="${item.src}" target="_blank" rel="noopener" class="block overflow-hidden rounded-box border border-line bg-page">
              <img src="${item.src}" alt="${item.alt ?? `Photo ${i + 1} of ${items.length}`}" loading="lazy" decoding="async" class="aspect-square w-full object-cover" />
              <span class="sr-only">(opens full size in a new tab)</span>
            </a>
            ${item.caption ? html`<figcaption class="text-xs text-muted">${item.caption}</figcaption>` : ''}
          </figure>
        </li>`,
    )}
  </ul>`;
}

/** Label and value pairs (layout adapted from HyperUI's details lists, https://hyperui.dev/components/application/details-list). */
export function dl(items: [string, Html | string][]): Html {
  return html`<dl class="divide-y divide-line text-sm">
    ${items.map(
      ([term, value]) =>
        html`<div class="grid grid-cols-1 gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-3 sm:gap-4">
          <dt class="font-medium text-muted">${term}</dt>
          <dd class="min-w-0 break-words sm:col-span-2">${value}</dd>
        </div>`,
    )}
  </dl>`;
}

/**
 * A Ticket as a work-order docket: the number and urgency word in a stub, a
 * dashed perforation, then the address, the issue and a meta row. The whole
 * docket is one link. `unread` adds the unread dot, with the words for screen readers.
 */
export function docket(o: { number: number; href: string; urgency: string; address: string; issue: string; meta: Html[]; unread?: number }): Html {
  const stub = o.urgency === 'urgent' ? 'is-urgent' : o.urgency === 'high' ? 'is-high' : '';
  return html`<a href="${o.href}" class="docket">
    <span class="docket-stub ${stub}">
      <span class="docket-number num">#${o.number}</span>
      <span class="docket-urgency">${humanise(o.urgency)}</span>
    </span>
    <span class="docket-perf" aria-hidden="true"></span>
    <span class="docket-body">
      <span class="docket-address">${o.address}</span>
      <span class="docket-issue">${o.issue}</span>
      <span class="docket-meta">
        ${o.meta.map((item) => html`<span>${item}</span>`)}
        ${o.unread ? html`<span><span class="unread-dot" aria-hidden="true"></span><span class="sr-only">unread messages</span></span>` : ''}
      </span>
    </span>
  </a>`;
}

/**
 * The count strip: one 36px row of counts that link into the queues. Decision
 * counts take the hi-vis chip; the others a quiet one.
 */
export function countStrip(items: { label: string; count: number; href: string; decision?: boolean }[]): Html {
  return html`<nav aria-label="Counts">
    <ul class="count-strip">
      ${items.map(
        (item) =>
          html`<li><a href="${item.href}" class="count-item"><span class="count-chip ${item.decision ? 'is-decision' : ''}">${item.count}</span><span class="count-label">${item.label}</span></a></li>`,
      )}
    </ul>
  </nav>`;
}

/**
 * A compact queue row with the 4px hi-vis stripe on its left: an optional photo
 * thumbnail, the title (a link when `href` is given), a detail line, badges, a
 * meta line and actions such as Confirm and Review.
 */
export function queueRow(o: { href?: string; thumb?: Html; title: string; detail?: string; badges?: Html[]; meta?: string; actions?: Html }): Html {
  return html`<article class="queue-row">
    ${o.thumb ? html`<div class="queue-thumb">${o.thumb}</div>` : ''}
    <div class="queue-main">
      ${o.href ? html`<a href="${o.href}" class="queue-title">${o.title}</a>` : html`<p class="queue-title">${o.title}</p>`}
      ${o.detail ? html`<p class="queue-detail">${o.detail}</p>` : ''}
      ${o.badges && o.badges.length > 0 ? html`<div class="queue-badges">${o.badges}</div>` : ''}
      ${o.meta ? html`<p class="queue-meta">${o.meta}</p>` : ''}
      ${o.actions ? html`<div class="queue-actions">${o.actions}</div>` : ''}
    </div>
  </article>`;
}

/** The Mine/All control: links with the current one filled and aria-current. */
export function segmented(items: { label: string; href: string; active: boolean }[]): Html {
  return html`<nav class="segmented" aria-label="Views">
    ${items.map((item) => html`<a href="${item.href}" class="segmented-item" ${item.active ? html`aria-current="page"` : ''}>${item.label}</a>`)}
  </nav>`;
}

/**
 * A board column (a lane): a heading with its count, and a body that scrolls
 * inside about 300px. The body is focusable so the keyboard can scroll it.
 */
export function lane(o: { title: string; count: number; body: Html }): Html {
  return html`<section class="lane">
    <div class="lane-head">
      <h3 class="lane-title">${o.title}</h3>
      <span class="count-chip">${o.count}</span>
    </div>
    <div class="lane-body" tabindex="0" role="region" aria-label="${o.title}">${o.body}</div>
  </section>`;
}

/** Formats cents as Australian dollars, or an em dash when there is no amount. */
export function formatMoney(cents: number | null): string {
  return cents === null ? '—' : (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

/** A timestamp in the Agency's time zone, such as "Fri 9 Oct, 2:05 pm". */
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
  chevron: svg('m19.5 8.25-7.5 7.5-7.5-7.5', 'size-4'),
  success: svg('M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'),
  error: svg('M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z'),
  info: svg('m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z'),
  dot: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-4" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6" /></svg>`,
};

/** The rail's icons, 18px, stroke 1.75. */
const NAV_ICON: Record<NavKey, Html> = {
  dashboard: svg('M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z', 'size-[18px]'),
  calendar: svg('M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5', 'size-[18px]'),
  setup: svg('M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z', 'size-[18px]'),
  simulator: svg('M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3', 'size-[18px]'),
};
