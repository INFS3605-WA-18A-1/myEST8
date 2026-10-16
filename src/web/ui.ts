// The design system: page layouts and components as HTML. Interpolated values are
// escaped by `html`; use `raw` only for markup this module builds itself.
//
// Built on daisyUI 5 components (https://daisyui.com, MIT) styled by the "myest8"
// theme and the tokens in static/app.css (docs/design-system.md), with Tailwind
// utilities generated in the browser by Tailwind's browser build. Some layouts are
// adapted from HyperUI (https://hyperui.dev, MIT); each component says where it came from.

import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { Role } from '../shared.ts';
import { icon } from './icons.ts';
import type { ShellInfo } from './shell.ts';

/** What each role is called on screen ("Property Owner"): the same words the core uses in its refusals. */
export const ROLE_LABEL: Record<Role, string> = { tenant: 'Tenant', owner: 'Property Owner', tradie: 'Tradie', building_manager: 'Building Manager' };

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;
export type Flash = { kind: 'ok' | 'error'; message: string };
export type NavKey =
  | 'dashboard'
  | 'dispatch'
  | 'requests'
  | 'tickets'
  | 'approvals'
  | 'schedule'
  | 'properties'
  | 'tradies'
  | 'settings'
  | 'simulator';
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
    --color-action-hover: var(--action-hover);
    --color-info-bg: var(--info-bg);
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
export function head(title: string, o: { css?: string[]; runtime?: boolean } = {}): Html {
  return html`<meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} - myEST8</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
    <script>document.documentElement.classList.add('js');try{if(localStorage.getItem('rail')==='collapsed')document.documentElement.classList.add('rail-collapsed')}catch(e){}</script>
    <link rel="preload" href="/assets/fonts/red-hat-text-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/assets/fonts/lexend-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/assets/daisyui.css" />
    <link rel="stylesheet" href="/assets/app.css" />
    ${(o.css ?? []).map((file) => html`<link rel="stylesheet" href="/assets/${file}" />`)}
    ${o.runtime === false ? '' : html`<script src="/assets/tailwind.js"></script>${TAILWIND_THEME}`}
    <script src="/assets/app.js" defer></script>`;
}

/**
 * The places a Property Manager works, in three groups with a gap between them: the
 * day's work (Dashboard to Schedule), what the Agency looks after (Properties and
 * Tradies), then Settings.
 */
const NAV: { key: NavKey; label: string; href: string }[][] = [
  [
    { key: 'dashboard', label: 'Dashboard', href: '/' },
    { key: 'dispatch', label: 'Dispatch', href: '/dispatch' },
    { key: 'requests', label: 'Requests', href: '/requests' },
    { key: 'tickets', label: 'Tickets', href: '/tickets' },
    { key: 'approvals', label: 'Approvals', href: '/approvals' },
    { key: 'schedule', label: 'Schedule', href: '/calendar' },
  ],
  [
    { key: 'properties', label: 'Properties', href: '/properties' },
    { key: 'tradies', label: 'Tradies', href: '/tradies' },
  ],
  [{ key: 'settings', label: 'Settings', href: '/settings' }],
];

/** The demo's Phone simulator: not a place to work, so it sits quietly at the bottom of the rail. */
const SIMULATOR = { key: 'simulator', label: 'Phone simulator (demo)', href: '/demo' } as const;

/** One rail link with its icon, aria-current when it is the page shown, and an optional count. */
function railLink(item: { key: NavKey; label: string; href: string }, active: NavKey | undefined, count: number | undefined, cls = 'rail-link'): Html {
  return html`<a href="${item.href}" class="${cls}" ${item.key === active ? html`aria-current="page"` : ''}>${NAV_ICON[item.key]}<span class="rail-label">${item.label}${count ? html`<span class="rail-count num">${count}<span class="sr-only"> waiting</span></span>` : ''}</span></a>`;
}

/**
 * The rail: the logo and the places in NAV with their icons (the current one gets
 * the Wattle bar and aria-current; Requests and Approvals carry a count when
 * something is waiting), then at the bottom the demo's Phone simulator, the
 * Collapse menu button and the Agency's name. From 1024px the button folds the
 * rail to a strip of icons whose labels show as tooltips (app.js remembers the
 * choice in this browser). On phones it is a drawer when JavaScript is on, and a
 * block above the page otherwise.
 */
function rail(active: NavKey | undefined, agencyName: string | undefined, counts: Partial<Record<NavKey, number>>, demo: boolean): Html {
  return html`<aside id="rail" class="rail" aria-label="Sections">
    <a href="/" class="rail-logo">${logo()}</a>
    <nav aria-label="Main" class="rail-menu">
      <ul class="rail-nav">
        ${NAV[0]!.map((item) => html`<li>${railLink(item, active, counts[item.key])}</li>`)}
      </ul>
      ${NAV.slice(1).map(
        (group) => html`<ul class="rail-nav rail-gap">
          ${group.map((item) => html`<li>${railLink(item, active, counts[item.key])}</li>`)}
        </ul>`,
      )}
      ${demo ? html`<ul class="rail-nav rail-foot"><li>${railLink(SIMULATOR, active, counts.simulator, 'rail-link is-quiet')}</li></ul>` : ''}
    </nav>
    <button type="button" class="rail-toggle" data-rail-toggle aria-controls="rail" aria-expanded="true">${ICON.sidebar}<span class="rail-label">Collapse menu</span></button>
    ${agencyName ? html`<p class="rail-agency">${agencyName}</p>` : ''}
  </aside>`;
}

/** The Property Manager's name, opening a menu with Sign out. */
function userMenu(name: string): Html {
  return html`<details class="user-menu" data-menu>
    <summary><span class="user-menu-name">${name}</span>${ICON.chevron}</summary>
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
  /** Whether the rail shows the Simulator link (demo deployments only). Defaults to the shell's, else false. */
  demo?: boolean;
  /** Fills the page with no rail, for the onboarding wizard: the rest of the app comes after setup. */
  fullPage?: boolean;
}): Html {
  const withRail = Boolean(o.pm) && !o.fullPage;
  return html`<!doctype html>
    <html lang="en-AU" data-theme="${THEME}">
      <head>
        ${head(o.title)}
      </head>
      <body>
        <a href="#main" class="skip-link">Skip to content</a>
        <div class="app-shell ${withRail ? 'has-rail' : ''}" data-shell>
          ${withRail ? rail(o.active, o.shell?.agencyName, o.navCounts ?? o.shell?.counts ?? {}, o.demo ?? o.shell?.demo ?? false) : ''}
          <div class="app-main">
            ${topBar(o.title, { menu: withRail, controls: o.controls, today: o.shell?.today, pm: o.pm })}
            ${o.flash ? html`<div class="app-flash">${flashMessage(o.flash)}</div>` : ''}
            <main id="main" class="app-content">
              ${contentHead(o.subtitle, o.actions)}
              <div class="app-body-stack">${o.body}</div>
            </main>
          </div>
          ${withRail ? html`<div class="drawer-scrim" data-drawer-scrim></div>` : ''}
        </div>
      </body>
    </html>`;
}

const TENANT_FOOTER = 'Questions? Reply to the message your Property Manager sent you.';

/**
 * A page for someone who isn't signed in: a Tenant using an upload or tracker
 * link, or a Property Manager signing in or up. Phone first, a centred column
 * under a bar with the logo, and no rail. `width` picks the column: narrow (400px) for
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
  /** Extra stylesheets under /assets/ for this page, after app.css: "landing.css" or "auth.css". */
  css?: string[];
  /** False for a page that needs no Tailwind browser runtime (the Tenant pages): it is not loaded. */
  runtime?: boolean;
  /** Who the page is from (a Tenant's Agency): its name leads the bar and the logo goes small at the right. */
  brand?: string;
}): Html {
  const width = o.width ?? (o.wide ? 'wide' : 'default');
  const widthClass = width === 'default' ? '' : `is-${width}`;
  const titleClass = o.titleSize === 'hero' ? 'page-title is-hero' : 'page-title';
  return html`<!doctype html>
    <html lang="en-AU" data-theme="${THEME}">
      <head>
        ${head(o.title, { css: o.css ?? [], runtime: o.runtime !== false })}
      </head>
      <body>
        <a href="#main" class="skip-link">Skip to content</a>
        <header class="public-bar">
          <div class="public-bar-inner ${widthClass}">
            ${o.brand
              ? html`<span class="public-brand">${o.brand}</span><span class="logotype ml-auto">${logo({ size: 'sm' })}</span>`
              : html`<span class="logotype">${logo()}</span>`}
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

/** Button sizes: `sm` 32px for rows and lanes, `md` (default) 36px, `lg` 44px for a page's main way in. All are 44px on phones. */
export type ButtonSize = 'sm' | 'md' | 'lg';

function buttonClass(variant: Variant, size: ButtonSize | undefined, block: boolean | undefined) {
  return `btn ${VARIANT[variant]}${size === 'sm' ? ' btn-sm' : size === 'lg' ? ' btn-lg' : ''}${block ? ' btn-block' : ''}`;
}

/** A form button (daisyUI btn). `block` makes it full width, as on phone forms. */
export function button(
  label: string,
  o: { variant?: Variant; type?: 'submit' | 'button'; name?: string; value?: string; size?: ButtonSize; block?: boolean; disabled?: boolean } = {},
): Html {
  return html`<button type="${o.type ?? 'submit'}" class="${buttonClass(o.variant ?? 'primary', o.size, o.block)}" ${o.name ? html`name="${o.name}" value="${o.value ?? ''}"` : ''} ${o.disabled ? 'disabled' : ''}>${label}</button>`;
}

/** A link styled as a button. */
export function linkButton(label: string, href: string, o: { variant?: Variant; size?: ButtonSize; block?: boolean } = {}): Html {
  return html`<a href="${href}" class="${buttonClass(o.variant ?? 'secondary', o.size, o.block)}">${label}</a>`;
}

/** A one-click action: a small form that POSTs `fields` to `action`. `confirm` asks first (via app.js). */
export function postButton(
  action: string,
  label: string,
  o: { variant?: Variant; size?: ButtonSize; fields?: Record<string, string | number>; confirm?: string } = {},
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

/**
 * A short label (daisyUI badge, soft style). The text carries the meaning; colour only backs it up.
 * `outline` adds a hairline boundary and a white fill, keeping the tone's text colour: for a badge
 * that sits straight on the Paper page (a neutral badge's own fill is Paper, so it would read as loose text).
 */
export function badge(text: string, tone: Tone = 'neutral', o: { wrap?: boolean; outline?: boolean } = {}): Html {
  return toneBadge(text, `${TONE[tone]}${o.outline ? ' is-outline' : ''}`, o.wrap);
}

/** A badge with its class given: for the quiet looks (Routine, cancelled) that have no Tone. */
function toneBadge(text: string, toneClass: string, wrap = false): Html {
  // `wrap` lets a long label break onto a second line inside its column instead of running out of it.
  return html`<span class="badge badge-soft ${toneClass} ${wrap ? 'max-w-full whitespace-normal text-left' : 'whitespace-nowrap'}">${text}</span>`;
}

/** Urgent, High or Routine. Routine is quiet: muted text on a hairline, so its word is the only signal. */
export function urgencyBadge(urgency: string): Html {
  if (urgency === 'urgent') return badge(humanise(urgency), 'error');
  if (urgency === 'high') return badge(humanise(urgency), 'warning');
  return toneBadge(humanise(urgency), 'badge-muted');
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
  declined_by_owner: 'Declined by Property Owner',
};

/**
 * The Job stages in workflow order, with the words every screen uses for them (the
 * dashboard lanes, the Ticket's step indicator and every status badge).
 */
export const JOB_STAGES: { status: string; label: string }[] = [
  { status: 'quoting', label: 'Quoting' },
  { status: 'awaiting_owner', label: 'With Property Owner' },
  { status: 'approved', label: 'Ready to book' },
  { status: 'scheduled', label: 'Booked' },
  { status: 'done', label: 'Done' },
  { status: 'cancelled', label: 'Cancelled' },
];

/** The label for a Job stage ("scheduled" is "Booked"). Other values are humanised. */
export function jobStageLabel(status: string): string {
  return JOB_STAGES.find((stage) => stage.status === status)?.label ?? humanise(status);
}

/** Each Job stage's badge tone, from the design doc's table. Cancelled is muted. */
const JOB_TONE: Record<string, Tone | 'muted'> = {
  quoting: 'info',
  awaiting_owner: 'warning',
  approved: 'info',
  scheduled: 'info',
  done: 'success',
  cancelled: 'muted',
};

/** Statuses that name a Job stage on any screen, so their words need no `job` flag. */
const JOB_WORDS = new Set(['quoting', 'awaiting_owner', 'scheduled', 'done', 'cancelled']);

/**
 * Any status from the core (Job, Quote, Quote Request, approval...), in words. A Job's
 * `approved` is "Ready to book", but on a Quote or approval it is "Approved": pass
 * `{ job: true }` on a Job's status.
 */
export function statusBadge(status: string, o: { job?: boolean } = {}): Html {
  const stage = JOB_STAGES.find((s) => s.status === status);
  if (stage && (o.job || JOB_WORDS.has(status))) {
    const tone = JOB_TONE[stage.status];
    return tone === 'muted' ? toneBadge(stage.label, 'badge-muted') : badge(stage.label, tone);
  }
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
 * phones, never the page. `caption` names it for screen readers. `align` gives each
 * column 'left' (the default) or 'right'; right-aligned figures get the tabular `num` class.
 * `stack: true` turns each row into a block on phones (under 640px), its cells one
 * under the other and the header hidden, for lists whose cells explain themselves
 * (the Tickets list: badges and an age). `stack: 'labelled'` does the same but puts
 * each column's header beside its value (label left, value right), for rows of
 * plain values such as names, money and counts (Properties, Tradies). The first
 * cell leads the row unlabelled, and so does any column with an empty header.
 *
 * `rowHeader: true` makes each row's first cell its row header (`<th scope="row">`),
 * so a screen reader names the row by it (an address, a Tradie). `rowAttributes`
 * gives row i the attributes in `rowAttributes[i]` (`data-row`, `data-selected`,
 * `aria-*`...): values are escaped, `true` writes a bare attribute, and `false` or
 * undefined leaves it out.
 */
export function table(
  headers: string[],
  rows: Html[][],
  o: {
    caption?: string;
    align?: ('left' | 'right')[];
    stack?: boolean | 'labelled';
    rowHeader?: boolean;
    rowAttributes?: (RowAttributes | undefined)[];
  } = {},
): Html {
  const right = (i: number) => o.align?.[i] === 'right';
  const labelled = o.stack === 'labelled';
  // A stacked table sets its cells' widths in app.css, as they become blocks on phones.
  const cellClass = (i: number) => [o.stack ? '' : 'min-w-28', right(i) ? 'num text-right' : ''].filter(Boolean).join(' ');
  const label = (i: number) => (labelled && i > 0 && headers[i] ? html` data-label="${headers[i]}"` : '');
  const cell = (content: Html, i: number) => {
    const cls = cellClass(i) ? html` class="${cellClass(i)}"` : '';
    return o.rowHeader && i === 0 ? html`<th scope="row"${cls}>${content}</th>` : html`<td${cls}${label(i)}>${content}</td>`;
  };
  return html`<div class="table-frame${o.stack ? ' is-stacked' : ''}${labelled ? ' is-labelled' : ''}">
    <table class="table table-sm">
      ${o.caption ? html`<caption class="sr-only">${o.caption}</caption>` : ''}
      <thead>
        <tr>
          ${headers.map((h, i) => html`<th scope="col"${right(i) ? html` class="text-right"` : ''}>${h}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${rows.map((row, r) => html`<tr${rowAttributes(o.rowAttributes?.[r])}>${row.map(cell)}</tr>`)}
      </tbody>
    </table>
  </div>`;
}

/** Attributes for one table row: a value is escaped, `true` is a bare attribute, `false` leaves it out. */
export type RowAttributes = Record<string, string | number | boolean | undefined>;

const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]*$/;

function rowAttributes(attributes: RowAttributes | undefined): Html | string {
  if (!attributes) return '';
  const parts = Object.entries(attributes).flatMap(([name, value]) => {
    // Names can't be escaped, so only plain lower-case names (data-row, aria-label, role) are allowed.
    if (!ATTRIBUTE_NAME.test(name)) throw new Error(`Not an attribute name: ${name}`);
    if (value === false || value === undefined) return [];
    return value === true ? [html` ${raw(name)}`] : [html` ${raw(name)}="${value}"`];
  });
  return html`${parts}`;
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
        <input ${common} type="checkbox" class="checkbox checkbox-primary checkbox-sm mt-1${o.error ? ' checkbox-error' : ''}" value="${o.value ?? 'on'}" ${o.checked ? 'checked' : ''} />
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
          ? html`<input ${common} type="file" class="file-input w-full${invalid.replace('input', 'file-input')}" ${o.accept ? html`accept="${o.accept}"` : ''} />`
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
 * as for the Tenant's tracker. Done stages are ticked (--done) and say so to screen
 * readers; the current one is --action, and the stages to come are --line. The
 * current stage is the first not done unless `current` says otherwise. Vertical on
 * phones and horizontal on wide screens, or always vertical with `vertical`.
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
        html`<li class="step ${o.horizontal ? 'min-w-0' : ''} ${item.done || i === current ? 'step-primary' : ''}" ${item.done ? html`data-content="✓"` : ''} ${i === current ? html`aria-current="step"` : ''}>
          <div class="pb-2 ${o.horizontal ? 'px-1 text-center' : `text-start ${responsive ? 'lg:px-1 lg:text-center' : ''}`}">
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
 * followed. Without a tone, `end` bubbles are Harbour with white text and `start`
 * bubbles sit on Paper. Links in a bubble take its text colour, underlined, so
 * they read on every fill.
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
 * control in a page's top bar, use `segmented`. Count chips here are quiet: Wattle is
 * for decisions only.
 */
export function tabs(items: { label: string; href: string; active: boolean; count?: number }[], label = 'Views'): Html {
  return html`<nav class="tabs tabs-border" aria-label="${label}">
    ${items.map(
      (item) =>
        html`<a href="${item.href}" class="tab gap-2 ${item.active ? 'tab-active font-semibold' : ''}" ${item.active ? html`aria-current="page"` : ''}>
          ${item.label}
          ${item.count !== undefined ? html`<span class="count-chip">${item.count}</span>` : ''}
        </a>`,
    )}
  </nav>`;
}

/**
 * The same links as `tabs`, stacked down the left of a page with many sections
 * (Settings). The current one is a white tab with the Wattle bar and aria-current.
 * On phones the list becomes a row that scrolls sideways.
 */
export function sideTabs(items: { label: string; href: string; active: boolean }[], label = 'Sections'): Html {
  return html`<nav class="side-tabs" aria-label="${label}">
    <ul>
      ${items.map((item) => html`<li><a href="${item.href}" class="side-tab" ${item.active ? html`aria-current="page"` : ''}>${item.label}</a></li>`)}
    </ul>
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
          <div class="timeline-end min-w-0 ${i < items.length - 1 ? 'mb-3' : ''}">
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
          <figure class="flex flex-col items-stretch gap-2">
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

/**
 * Label and value pairs. The label column has a fixed, readable width (8 to 12rem)
 * whatever the box's width, so a value sits next to its label rather than across a
 * wide card; in a box narrower than about 480px the label stacks over its value.
 * The box decides, not the screen (a container query on `.facts` in app.css).
 */
export function dl(items: [string, Html | string][]): Html {
  return html`<dl class="facts">
    ${items.map(
      ([term, value]) =>
        html`<div class="facts-row">
          <dt class="facts-term">${term}</dt>
          <dd class="facts-value">${value}</dd>
        </div>`,
    )}
  </dl>`;
}

/** Text clamped to `lines` lines, ending in an ellipsis; `title` gives the full text on hover. */
function clipped(text: string, lines: 1 | 2 | 3, className = '', title = text): Html {
  return html`<span class="line-clamp-${lines} ${className}" title="${title}">${text}</span>`;
}

/**
 * Text that wraps to at most `lines` lines (1 to 3) and then ends in an ellipsis, with
 * the full text as its title. Use it instead of cutting text to fit: words are never
 * cut mid-word without the ellipsis.
 */
export function clip(text: string, o: { lines?: 1 | 2 | 3 } = {}): Html {
  return clipped(text, o.lines ?? 1);
}

/**
 * A Ticket in a table row, read in the docket's order: the issue, which links to the
 * Ticket, with its number quiet beside it and the unread messages as a dot and words;
 * then the address, muted, linking to the Property when `propertyHref` is given. In a
 * `stack` table the issue's link covers the whole row (the address stays its own link).
 */
export function ticketCell(o: { ticketId: number; issue: string; address?: string; propertyHref?: string; unread?: number }): Html {
  return html`<div class="ticket-cell">
    <p class="ticket-cell-head">
      <a href="/tickets/${o.ticketId}" class="ticket-cell-issue">${o.issue}</a>
      <span class="ticket-cell-number num">#${o.ticketId}</span>
      ${o.unread ? html`<span class="ticket-cell-unread"><span class="unread-dot" aria-hidden="true"></span>${o.unread} unread</span>` : ''}
    </p>
    ${o.address
      ? o.propertyHref
        ? html`<a href="${o.propertyHref}" class="ticket-cell-address">${o.address}</a>`
        : html`<p class="ticket-cell-address">${o.address}</p>`
      : ''}
  </div>`;
}

/**
 * A Ticket as a work-order docket, read in the order a Property Manager reads it:
 * the issue (up to three lines), the address, a dashed perforation, then the
 * tear-off stub with the status (the Urgency badge and `meta`, such as Trades and
 * what the Ticket waits on) and a foot with the number, the unread dot and `age`. The whole docket
 * is one link. `street` shows in place of the full address. `decision` adds the
 * Wattle stripe of anything waiting on the Property Manager. `unread` adds the
 * unread dot, with the words for screen readers. Without `href` it is a picture of
 * a docket, not a link (the landing page's workflow).
 *
 * `size: 'large'` is the Ticket page's header: the stub with a 26px number first,
 * then the address and the issue, as the page is already about that one Ticket.
 * `lines` is how many lines the issue may take before its ellipsis: 3 on a board
 * docket and 2 on the large one by default (the dashboard's lanes ask for 2).
 */
export function docket(o: {
  number: number;
  href?: string;
  urgency: string;
  address: string;
  street?: string;
  issue: string;
  meta: Html[];
  age?: string;
  unread?: number;
  decision?: boolean;
  size?: 'default' | 'large';
  lines?: 1 | 2 | 3;
}): Html {
  const unread = o.unread
    ? html`<span><span class="unread-dot" aria-hidden="true"></span><span class="sr-only">unread messages</span></span>`
    : '';
  const perf = html`<span class="docket-perf" aria-hidden="true"></span>`;
  const inner =
    o.size === 'large'
      ? html`<span class="docket-stub">
            <span class="docket-number num">#${o.number}</span>
            ${urgencyBadge(o.urgency)}
          </span>
          ${perf}
          <span class="docket-body">
            ${clipped(o.street ?? o.address, 1, 'docket-address', o.address)}
            ${clipped(o.issue, o.lines ?? 2, 'docket-issue')}
            <span class="docket-meta">${o.meta.map((item) => html`<span>${item}</span>`)}${unread}</span>
          </span>`
      : html`<span class="docket-body">
            ${clipped(o.issue, o.lines ?? 3, 'docket-issue')}
            ${clipped(o.street ?? o.address, 1, 'docket-address', o.address)}
          </span>
          ${perf}
          <span class="docket-status">
            ${urgencyBadge(o.urgency)}
            ${o.meta.map((item) => html`<span>${item}</span>`)}
          </span>
          <span class="docket-foot">
            <span class="docket-number num">#${o.number}</span>${unread}
            ${o.age ? html`<span class="ml-auto">${o.age}</span>` : ''}
          </span>`;
  const cls = `docket${o.size === 'large' ? ' is-large' : ''}${o.decision ? ' is-decision' : ''}`;
  return o.href ? html`<a href="${o.href}" class="${cls}">${inner}</a>` : html`<div class="${cls}">${inner}</div>`;
}

/**
 * The count strip: one row of counts that link into the queues. Decision counts
 * take the Wattle chip; the others a quiet one.
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
 * A compact queue row: an optional photo thumbnail, then the title (a link when
 * `href` is given) with the actions such as Confirm and Review beside it, a detail
 * line, and the badges with the meta (an age) at the end of their row.
 * `decision` (default false) marks a row that needs the Property Manager's decision:
 * only those get the 4px Wattle stripe on the left.
 */
export function queueRow(o: {
  href?: string;
  thumb?: Html;
  title: string;
  detail?: string;
  badges?: Html[];
  meta?: string;
  actions?: Html;
  decision?: boolean;
}): Html {
  const badges = o.badges && o.badges.length > 0;
  return html`<article class="queue-row${o.decision ? ' is-decision' : ''}">
    ${o.thumb ? html`<div class="queue-thumb">${o.thumb}</div>` : ''}
    <div class="queue-main">
      <div class="queue-head">
        ${o.href ? html`<a href="${o.href}" class="queue-title">${o.title}</a>` : html`<p class="queue-title">${o.title}</p>`}
        ${o.actions ? html`<div class="queue-actions">${o.actions}</div>` : ''}
      </div>
      ${o.detail ? html`<p class="queue-detail">${o.detail}</p>` : ''}
      ${badges || o.meta
        ? html`<div class="queue-badges">${badges ? o.badges : ''}${o.meta ? html`<span class="queue-meta">${o.meta}</span>` : ''}</div>`
        : ''}
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
 * inside about 300px. The body is focusable so the keyboard can scroll it. The
 * lane is a Paper tray; the dockets in it are white.
 */
export function lane(o: { title: string; count: number; body: Html }): Html {
  return html`<section class="lane">
    <div class="lane-head">
      <h3 class="lane-title">${o.title}</h3>
      <span class="lane-count num">${o.count}</span>
    </div>
    <div class="lane-body" tabindex="0" role="region" aria-label="${o.title}">${o.body}</div>
  </section>`;
}

/** Formats cents as Australian dollars, or an em dash when there is no amount. */
export function formatMoney(cents: number | null): string {
  return cents === null ? '—' : (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

/** Three-letter month names, written out here so ICU versions can't change them ("Sep", never "Sept"). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The parts of a moment in a time zone, each read from Intl and written in our own words. */
function zonedParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: part('weekday').slice(0, 3),
    day: part('day'),
    month: MONTHS[Number(part('month')) - 1] ?? '',
    time: `${part('hour')}:${part('minute')} ${part('dayPeriod').replace(/\./g, '').toLowerCase()}`,
  };
}

/** A timestamp in the Agency's time zone, such as "Mon 12 Oct, 9:00 am". */
export function formatWhen(iso: string | null, timeZone = 'Australia/Sydney'): string {
  if (!iso) return '—';
  const p = zonedParts(iso, timeZone);
  return `${p.weekday} ${p.day} ${p.month}, ${p.time}`;
}

/** The time of day in the Agency's time zone, such as "9:00 am". */
export function formatTime(iso: string | null, timeZone = 'Australia/Sydney'): string {
  if (!iso) return '—';
  return zonedParts(iso, timeZone).time;
}

/** A day in the Agency's time zone, short form, such as "Wed 7 Oct". */
export function formatDay(iso: string | null, timeZone = 'Australia/Sydney'): string {
  if (!iso) return '—';
  const p = zonedParts(iso, timeZone);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** How long ago a moment was, against `now`: "2 days ago", "1 hour ago", "just now". */
export function formatAge(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'} ago`;
  if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, 'hour');
  return unit(Math.floor(hours / 24), 'day');
}

/** "awaiting_owner" -> "Awaiting owner" */
export function humanise(value: string): string {
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The app's icons (Phosphor, regular weight, via icon()). Always aria-hidden: the
 * text beside them carries the meaning.
 */
const ICON = {
  menu: icon('list', { size: 'size-6' }),
  chevron: icon('caret-down', { size: 'size-4' }),
  success: icon('check-circle'),
  error: icon('warning-circle'),
  info: icon('info'),
  dot: icon('circle', { weight: 'fill', size: 'size-4' }),
  sidebar: icon('sidebar-simple', { size: 'size-[18px]' }),
};

/** The rail's icons, 18px (the Phone simulator's 16px, as it is quieter). */
const NAV_ICON: Record<NavKey, Html> = {
  dashboard: icon('squares-four', { size: 'size-[18px]' }),
  dispatch: icon('map-pin', { size: 'size-[18px]' }),
  requests: icon('tray', { size: 'size-[18px]' }),
  tickets: icon('ticket', { size: 'size-[18px]' }),
  approvals: icon('seal-check', { size: 'size-[18px]' }),
  schedule: icon('calendar-blank', { size: 'size-[18px]' }),
  properties: icon('house-line', { size: 'size-[18px]' }),
  tradies: icon('wrench', { size: 'size-[18px]' }),
  settings: icon('gear-six', { size: 'size-[18px]' }),
  simulator: icon('device-mobile', { size: 'size-4' }),
};

/**
 * The logo mark: the key tag. A house-shaped tag with the key ring's hole at the
 * top and an 8 cut out of it, the tag every Agency hangs on its key board. One
 * solid shape in one colour (currentColor), on a 256 grid, so it holds at 16px.
 * favicon.svg is the same path.
 */
const LOGO_MARK =
  'M128 14 L208 94 L208 232 Q208 244 196 244 L60 244 Q48 244 48 232 L48 94 Z M128 46 A12 12 0 1 0 128.01 46 Z M146.49 152.53 A34 34 0 1 0 109.51 152.53 A40 40 0 1 0 146.49 152.53 Z M128 106 A16 16 0 1 0 128.01 106 Z M128 170 A20 20 0 1 0 128.01 170 Z';

/**
 * The logo: the key tag beside the "myEST8" wordmark in Lexend, a light "my" and a
 * bold "EST8". The mark is hidden from screen readers, so the logo's accessible
 * name is "myEST8". Put it inside a link or heading; `sm` is a 20px mark, `md`
 * (default) 28px. The mark is Harbour on light surfaces and Wattle in the rail.
 */
export function logo(o: { size?: 'sm' | 'md' } = {}): Html {
  return html`<span class="logo is-${o.size ?? 'md'}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" class="logo-mark" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="${LOGO_MARK}" /></svg><span class="logo-word"><span class="logo-my">my</span>EST8</span></span>`;
}
