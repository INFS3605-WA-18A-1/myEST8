// The design system: page layouts and components as HTML. Interpolated values are
// escaped by `html`; use `raw` only for markup this module builds itself.
//
// Built on daisyUI 5 components (https://daisyui.com, MIT) styled by the "myest8"
// theme and the tokens in static/app.css (docs/design-system.md), with Tailwind
// utilities prebuilt into static/tw.css (npm run css). Some layouts are
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
  | 'tickets'
  | 'archive'
  | 'approvals'
  | 'schedule'
  | 'properties'
  | 'tradies'
  | 'tenants'
  | 'owners'
  | 'building-managers'
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
 * The document's head. The inline script marks the page as having JavaScript
 * before the first paint, so the rail can become a drawer only when it can open.
 */
export function head(title: string, o: { css?: string[]; runtime?: boolean } = {}): Html {
  return html`<meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} - myEST8</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
    <script>document.documentElement.classList.add('js');try{if(localStorage.getItem('rail')==='collapsed')document.documentElement.classList.add('rail-collapsed')}catch(e){}</script>
    <link rel="preload" href="/assets/fonts/public-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/assets/fonts/bricolage-grotesque-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/assets/daisyui.css" />
    <link rel="stylesheet" href="/assets/app.css" />
    ${(o.css ?? []).map((file) => html`<link rel="stylesheet" href="/assets/${file}" />`)}
    ${o.runtime === false ? '' : html`<link rel="stylesheet" href="/assets/tw.css" />`}
    <script src="/assets/app.js" defer></script>`;
}

/**
 * The places a Property Manager works, in three groups with a gap between them: the
 * day's work (Dashboard to Schedule), the Profiles of who and what the Agency looks
 * after (Properties, Tradies, Tenants, Property Owners and Building Managers, under a quiet heading), then Settings.
 */
const NAV: { label?: string; items: { key: NavKey; label: string; href: string }[] }[] = [
  {
    items: [
      { key: 'dashboard', label: 'Dashboard', href: '/' },
      { key: 'dispatch', label: 'Dispatch', href: '/dispatch' },
      { key: 'tickets', label: 'Tickets', href: '/tickets' },
      { key: 'archive', label: 'Archive', href: '/archive' },
      { key: 'approvals', label: 'Approvals', href: '/approvals' },
      { key: 'schedule', label: 'Schedule', href: '/calendar' },
    ],
  },
  {
    label: 'Profiles',
    items: [
      { key: 'properties', label: 'Properties', href: '/properties' },
      { key: 'tradies', label: 'Tradies', href: '/tradies' },
      { key: 'tenants', label: 'Tenants', href: '/tenants' },
      { key: 'owners', label: 'Property Owners', href: '/owners' },
      { key: 'building-managers', label: 'Building Managers', href: '/building-managers' },
    ],
  },
  { items: [{ key: 'settings', label: 'Settings', href: '/settings' }] },
];

/** The demo's Phone simulator: not a place to work, so it sits quietly at the bottom of the rail. */
const SIMULATOR = { key: 'simulator', label: 'Phone simulator (demo)', href: '/demo' } as const;

/** One rail link with its icon, aria-current when it is the page shown, and an optional count. */
function railLink(item: { key: NavKey; label: string; href: string }, active: NavKey | undefined, count: number | undefined, cls = 'rail-link'): Html {
  // Only the counts that mean "needs you" (Tickets' new Maintenance Requests, Approvals) are a Wattle chip; any other count is a plain numeral.
  const decision = item.key === 'tickets' || item.key === 'approvals' ? html` data-decision` : '';
  return html`<a href="${item.href}" class="${cls}" ${item.key === active ? html`aria-current="page"` : ''}${decision}>${NAV_ICON[item.key]}<span class="rail-label">${item.label}${count ? html`<span class="rail-count num">${count}<span class="sr-only"> waiting</span></span>` : ''}</span></a>`;
}

/**
 * The rail: the logo and the places in NAV with their icons (the current one gets
 * the 4px Wattle bar, weight 600 and aria-current; Tickets and Approvals carry a count when
 * something is waiting), then at the bottom the demo's Phone simulator, the
 * Collapse menu button and the Agency's name. From 1024px the button folds the
 * rail to a strip of icons whose labels show as tooltips (app.js remembers the
 * choice in this browser). On phones it is a drawer when JavaScript is on, and a
 * block above the page otherwise.
 */
function rail(active: NavKey | undefined, agencyName: string | undefined, counts: Partial<Record<NavKey, number>>, demo: boolean, setupHref?: string): Html {
  return html`<aside id="rail" class="rail" aria-label="Sections">
    <a href="/" class="rail-logo">${logo()}</a>
    <nav aria-label="Main" class="rail-menu">
      ${NAV.map(
        (group, i) => html`${group.label ? html`<p class="rail-group" id="rail-group-${i}">${group.label}</p>` : ''}<ul class="rail-nav${i > 0 && !group.label ? ' rail-gap' : ''}" ${group.label ? html`aria-labelledby="rail-group-${i}"` : ''}>
          ${group.items.map((item) => html`<li>${railLink(item, active, counts[item.key])}</li>`)}
        </ul>`,
      )}
      ${demo ? html`<ul class="rail-nav rail-foot"><li>${railLink(SIMULATOR, active, counts.simulator, 'rail-link is-quiet')}</li></ul>` : ''}
    </nav>
    ${setupHref ? html`<ul class="rail-nav rail-setup"><li><a href="${setupHref}" class="rail-link rail-setup-link">${ICON.setup}<span class="rail-label">Setup guide</span></a></li></ul>` : ''}
    <button type="button" class="rail-toggle" data-rail-toggle aria-controls="rail" aria-expanded="true">${ICON.sidebar}<span class="rail-label">Collapse menu</span></button>
    ${agencyName ? html`<p class="rail-agency">${agencyName}</p>` : ''}
  </aside>`;
}

/** The Property Manager's name, opening a menu with Sign out. */
function userMenu(name: string): Html {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return html`<details class="user-menu" data-menu>
    <summary><span class="user-menu-avatar" aria-hidden="true">${initials}</span><span class="user-menu-name">${name}</span>${ICON.chevron}</summary>
    <div class="user-menu-panel">${postButton('/logout', 'Sign out', { variant: 'ghost', size: 'sm' })}</div>
  </details>`;
}

/**
 * The page header, the first row of the content column: the menu button (drawer only)
 * and the page title (the page's only <h1>) on the left; the page's controls, today's
 * date and the user menu on the right of the same row. On phones the row wraps, the
 * title first and the controls under it.
 */
function pageHeader(
  title: string,
  o: { menu: boolean; controls?: Html; today?: string; pm?: { name: string } | null; back?: { label: string; href: string }; titleExtra?: Html },
): Html {
  return html`<header class="page-header${o.back ? ' has-back' : ''}">
    ${o.back ? html`<a class="page-back" href="${o.back.href}">${icon('caret-left', { size: 'size-3.5' })}${o.back.label}</a>` : ''}
    <div class="page-header-lead">
      ${o.menu ? html`<button type="button" class="menu-button" data-drawer-toggle aria-controls="rail" aria-expanded="false" aria-label="Menu">${ICON.menu}</button>` : ''}
      <h1 class="page-title">${title}</h1>
      ${o.titleExtra ?? ''}
    </div>
    <div class="page-header-end">
      ${o.controls ? html`<div class="page-header-controls">${o.controls}</div>` : ''}
      ${o.today ? html`<time class="page-header-date">${icon('calendar-blank', { size: 'size-4' })}${o.today}</time>` : ''}
      ${o.pm ? html`<a class="page-header-bell" href="/#alerts" aria-label="Alerts" title="Alerts">${icon('bell', { size: 'size-5' })}</a>${userMenu(o.pm.name)}` : ''}
    </div>
  </header>`;
}

/** The subtitle and buttons under the page header (nothing when a page has neither). */
function contentHead(subtitle: Html | string | undefined, actions: Html | undefined): Html | string {
  if (!subtitle && !actions) return '';
  return html`<div class="page-head">
    ${subtitle ? html`<p class="page-subtitle">${subtitle}</p>` : html`<span></span>`}
    ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

/**
 * A signed-in Property Manager's page: the rail (with the Agency's name), then the
 * content column, whose first row is the page header (the title as the page's only
 * <h1>, with the controls, date and user menu on its right), then the flash, then
 * `body`. Top-level elements in `body` are spaced apart. `shell` (from shellInfo) adds
 * the Agency's name and today's date; `controls` sit in the page header.
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
  /** Controls in the page header, such as the Mine/All segmented control. */
  controls?: Html;
  /** A link back to the list this page came from, above the title. */
  back?: { label: string; href: string };
  /** Beside the title, such as the Ticket's Urgency. */
  titleExtra?: Html;
  /** The Agency's name for the rail and today's date for the page header. */
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
          ${withRail ? rail(o.active, o.shell?.agencyName, o.navCounts ?? o.shell?.counts ?? {}, o.demo ?? o.shell?.demo ?? false, o.shell?.setupHref) : ''}
          <div class="app-main">
            <main id="main" class="app-content">
              ${pageHeader(o.title, { menu: withRail, controls: o.controls, today: o.shell?.today, pm: o.pm, back: o.back, titleExtra: o.titleExtra })}
              ${o.flash ? flashMessage(o.flash) : ''}
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
  /** False for a page that needs no Tailwind utilities (the Tenant pages): tw.css is not loaded. */
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
  // The message goes in the query, before any #fragment, so the page still scrolls to it.
  const at = path.indexOf('#');
  const [base, fragment] = at === -1 ? [path, ''] : [path.slice(0, at), path.slice(at)];
  return `${base}${base.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(message)}${fragment}`;
}

/** The message after an action, one line under the page header. app.js adds a close button and fades "ok" ones. */
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

/**
 * A choice saved from a no-login page (a booked visit, a confirmed one, a job marked
 * done, an upload), in green with a tick: "✓ Booked: Mon 16 Nov, 9:00 am". It stays on
 * the page rather than fading like a flash, and every link from the same email shows it
 * again. `.tenant-done` is in tenant.css, which every no-login page loads.
 */
export function doneBox(message: Html | string): Html {
  return html`<div role="status" class="tenant-done"><span aria-hidden="true">✓</span> ${message}</div>`;
}

const VARIANT: Record<Variant, string> = { primary: 'btn-primary', secondary: 'btn-outline', danger: 'btn-danger', ghost: 'btn-ghost' };

/** Button sizes: `sm` 32px for rows and lanes, `md` (default) 36px, `lg` 44px for a page's main way in. All are 44px on phones. */
export type ButtonSize = 'sm' | 'md' | 'lg';

function buttonClass(variant: Variant, size: ButtonSize | undefined, block: boolean | undefined) {
  return `btn ${VARIANT[variant]}${size === 'sm' ? ' btn-sm' : size === 'lg' ? ' btn-lg' : ''}${block ? ' btn-block' : ''}`;
}

/** A form button (daisyUI btn). `block` makes it full width, as on phone forms; `icon` is a Phosphor icon name shown before the label; `formaction` sends a form's fields somewhere other than its own action. */
export function button(
  label: string,
  o: { variant?: Variant; type?: 'submit' | 'button'; name?: string; value?: string; size?: ButtonSize; block?: boolean; disabled?: boolean; icon?: string; formaction?: string } = {},
): Html {
  return html`<button type="${o.type ?? 'submit'}" class="${buttonClass(o.variant ?? 'primary', o.size, o.block)}" ${o.name ? html`name="${o.name}" value="${o.value ?? ''}"` : ''} ${o.disabled ? 'disabled' : ''} ${o.formaction ? html`formaction="${o.formaction}"` : ''}>${o.icon ? icon(o.icon, { size: 'size-4' }) : ''}${label}</button>`;
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

/** The pen at the side of a details block: a link that opens its edit form in the page (`?edit=details`), with no JavaScript. `label` names it. */
export function editPen(label: string, href: string): Html {
  return html`<a href="${href}" class="icon-btn" aria-label="${label}" title="${label}">${icon('pencil-simple', { size: 'size-[18px]' })}</a>`;
}

/** The form that takes a details block's place: its fields, a refusal that isn't about one field, then Save and a Cancel back to the plain view. */
export function detailsForm(o: { action: string; cancel: string; fields: Html; refusal?: string }): Html {
  return html`<form method="post" action="${o.action}" class="details-form">
    ${o.refusal ? alert(o.refusal, 'error') : ''}
    ${o.fields}
    <div class="details-actions">${button('Save')}${linkButton('Cancel', o.cancel, { variant: 'ghost' })}</div>
  </form>`;
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

const URGENCY_ICON: Record<string, string> = { urgent: 'warning-octagon', high: 'arrow-fat-up' };

/**
 * Urgent, High or Routine. Urgent and High carry an icon so they stand out at a glance:
 * Urgent is solid Rust, High tinted Ochre; Routine stays quiet (muted on a hairline).
 */
export function urgencyBadge(urgency: string): Html {
  const tone = urgency === 'urgent' ? 'badge-error' : urgency === 'high' ? 'badge-warning' : 'badge-muted';
  const glyph = URGENCY_ICON[urgency];
  return html`<span class="badge badge-soft ${tone} urgency-badge urgency-${urgency} whitespace-nowrap">${glyph ? icon(glyph, { weight: 'fill', size: 'size-3' }) : ''}${humanise(urgency)}</span>`;
}

export type EntityKind = 'property' | 'tenant' | 'tradie' | 'person' | 'ticket';
const ENTITY_ICON: Record<EntityKind, string> = { property: 'house-line', tenant: 'user', tradie: 'wrench', person: 'user', ticket: 'ticket' };

/**
 * A link to another record (a Property, a Tenant, a Tradie) where it is mentioned beside
 * something else: a chip with the record's icon and name, so it reads as "go to that
 * record" rather than as underlined text.
 */
export function entityLink(kind: EntityKind, label: string, href: string): Html {
  return html`<a class="entity-link entity-link-${kind}" href="${href}">${icon(ENTITY_ICON[kind], { size: 'size-4' })}<span>${label}</span></a>`;
}

/**
 * The title of a row in a list, linking to its record: Night and semibold, underlined
 * only on hover. In a `stack` table it covers the whole row, so the row is the target.
 */
export function rowLink(label: string, href: string): Html {
  return html`<a class="row-link" href="${href}">${label}</a>`;
}

/** A phone number or email address that calls or writes, with its icon. */
export function contactLink(kind: 'mobile' | 'email', value: string): Html {
  return kind === 'mobile'
    ? html`<a class="contact-link num" href="tel:${value}">${icon('phone', { size: 'size-4' })}<span>${value}</span></a>`
    : html`<a class="contact-link is-email" href="mailto:${value}">${icon('envelope-simple', { size: 'size-4' })}<span>${value}</span></a>`;
}

const PROFILE_PATH: Record<Role, string> = {
  tenant: '/tenants',
  owner: '/owners',
  tradie: '/tradies',
  building_manager: '/building-managers',
};

/** Where a person's profile lives. */
export function profileHref(role: Role, id: number): string {
  return `${PROFILE_PATH[role]}/${id}`;
}

/** "A", "A and B", "A, B and C". `or` stands in for `and`. */
function englishList(items: Html[], conjunction: 'and' | 'or'): Html {
  if (items.length <= 1) return items[0] ?? html``;
  if (items.length === 2) return html`${items[0]} ${conjunction} ${items[1]}`;
  const head = items.slice(0, -1);
  return html`${head.map((item, i) => (i === 0 ? item : html`, ${item}`))} ${conjunction} ${items.at(-1)}`;
}

/**
 * A quiet note under a shared mobile or email. "Also" on a profile, "Could be" on an
 * Inbox card. Each person is a link to their profile.
 */
export function sharedAddressNote(lead: 'Also' | 'Could be', others: { label: string; href: string }[]): Html {
  if (!others.length) return html``;
  const links = others.map((o) => html`<a href="${o.href}">${o.label}</a>`);
  const line = lead === 'Could be' ? html`${lead} ${englishList(links, 'or')}.` : html`${lead} ${englishList(links, 'and')}`;
  return html`<p class="shared-with text-sm text-muted">${line}</p>`;
}

/** Who else already uses `address`, as the quiet note names them. */
export function othersUsing(
  people: { id: number; role: Role; name: string; mobile: string | null; email: string | null }[],
  address: string | null,
  selfId: number,
): { label: string; href: string }[] {
  if (!address) return [];
  return people
    .filter((p) => p.id !== selfId && (p.mobile === address || p.email === address))
    .map((p) => ({ label: `${p.name} (${ROLE_LABEL[p.role]})`, href: profileHref(p.role, p.id) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.href.localeCompare(b.href));
}

/**
 * A rating as a chip: who gave it, a star, the score to one decimal and how many it is
 * from: "myEST8 ★ 4.7 (3)". `rating` null is a listing with no rating yet; `source` Google
 * with no listing at all reads "Not on Google". The words in full are for screen readers.
 */
export function ratingChip(o: { source: 'myEST8' | 'Google'; rating: number | null; count: number; onGoogle?: boolean; named?: boolean }): Html {
  if (o.source === 'Google' && o.onGoogle === false) return html`<span class="metric is-empty">Not on Google</span>`;
  if (o.rating === null) return html`<span class="metric is-empty">${o.source}: no rating yet</span>`;
  const noun = o.source === 'Google' ? (o.count === 1 ? 'review' : 'reviews') : o.count === 1 ? 'rating' : 'ratings';
  return html`<span class="metric metric-rating" title="${o.source} ${o.rating.toFixed(1)} from ${o.count} ${noun}">
    ${o.named === false ? html`<span class="sr-only">${o.source}</span>` : html`<span class="metric-source">${o.source}</span>`}${icon('star', { weight: 'fill', size: 'size-3.5' })}<strong class="num">${o.rating.toFixed(1)}</strong><span class="metric-sub num" aria-hidden="true">(${o.count})</span><span class="sr-only">from ${o.count} ${noun}</span>
  </span>`;
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
  estimated: 'info',
  inspection_booked: 'info',
  inspected: 'info',
  firm_quoted: 'success',
  superseded: 'neutral',
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
  estimated: 'Estimate in',
  inspection_booked: 'Site Inspection booked',
  inspected: 'Inspected',
  firm_quoted: 'Firm Quote in',
  superseded: 'Superseded by Firm Quote',
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

/**
 * The stages of a Job as the Ticket page's stage tracker shows them: quoting split into
 * its steps (ADR 0009), then the Job stages after it, with their words from JOB_STAGES.
 * Site inspection and With Property Owner can be skipped ("Not needed").
 */
export const JOB_TRACKER_STAGES = ['Estimates', 'Site inspection', 'Firm Quote', 'With Property Owner', 'Ready to book', 'Booked', 'Done'] as const;

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
/** A select's option. `keywords` are more words a searchable select matches it by (a Property's suburb, a Tradie's name). */
export type Option = { value: string; label: string; keywords?: string };

function optionTags(options: Option[], value: string): Html[] {
  return options.map(
    (opt) => html`<option value="${opt.value}" ${value === opt.value ? 'selected' : ''}${opt.keywords ? html` data-keywords="${opt.keywords}"` : ''}>${opt.label}</option>`,
  );
}

export function field(o: {
  label: string;
  name: string;
  type?: FieldType;
  value?: string | number | null;
  required?: boolean;
  placeholder?: string;
  options?: Option[];
  /** A select that filters its options as you type (app.js), matching each option's label and keywords. */
  search?: boolean;
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
  /** Address suggestions as you type (app.js). The field stays a plain text box without JavaScript. */
  suggest?: boolean;
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
        ? html`<select ${common} class="select w-full${invalid.replace('input', 'select')} ${o.multiple ? 'h-auto min-h-28 py-2' : ''}" ${o.search ? 'data-combobox' : ''}>
            ${o.placeholder ? html`<option value="">${o.placeholder}</option>` : ''}
            ${optionTags(o.options ?? [], String(o.value ?? ''))}
          </select>`
        : type === 'file'
          ? html`<input ${common} type="file" class="file-input w-full${invalid.replace('input', 'file-input')}" ${o.accept ? html`accept="${o.accept}"` : ''} />`
          : html`<input ${common} type="${type}" class="input w-full${invalid}" value="${o.value ?? ''}" placeholder="${o.placeholder ?? ''}" ${o.suggest ? 'data-address-suggest' : ''} ${o.autocomplete || o.suggest ? html`autocomplete="${o.suggest ? 'off' : o.autocomplete}"` : ''} ${o.step ? html`step="${o.step}"` : ''} ${o.min !== undefined ? html`min="${o.min}"` : ''} ${o.max !== undefined ? html`max="${o.max}"` : ''} />`;
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
 * Where a stage stands: done (ticked), skipped (it didn't happen and won't: muted, no
 * tick, never current), current, or upcoming.
 */
export type StepState = 'done' | 'skipped' | 'current' | 'upcoming';

/**
 * Progress through stages (daisyUI steps, https://daisyui.com/components/steps/),
 * as for the Tenant's tracker. Done stages are ticked (--done) and say so to screen
 * readers; the current one is --action, and the stages to come are --line. Each item
 * is done or not (`done`), or has its own `state` when a stage can also be skipped
 * or must be current while one before it isn't done. The current stage is the one
 * whose state is `current`, else the first neither done nor skipped, unless `current`
 * says otherwise. Vertical on phones and horizontal on wide screens, or always
 * vertical with `vertical`.
 */
export function steps(
  items: { label: string; done?: boolean; state?: StepState; detail?: string; href?: string }[],
  o: {
    vertical?: boolean;
    /** Always horizontal, with small labels on phones: a wizard's short step names. */
    horizontal?: boolean;
    /** The stage being shown, when it isn't simply the first one not done (a wizard's step). */
    current?: number;
  } = {},
): Html {
  const states = items.map((item): StepState => item.state ?? (item.done ? 'done' : 'upcoming'));
  const named = states.indexOf('current');
  const current = o.current ?? (named >= 0 ? named : states.findIndex((s) => s !== 'done' && s !== 'skipped'));
  const responsive = !o.vertical && !o.horizontal;
  const direction = o.horizontal ? 'steps-horizontal' : `steps-vertical ${responsive ? 'lg:steps-horizontal' : ''}`;
  return html`<ol class="steps ${direction} w-full">
    ${items.map((item, i) => {
      const done = states[i] === 'done';
      const skipped = states[i] === 'skipped' && i !== current;
      const strong = done || i === current;
      const cls = ['step', o.horizontal ? 'min-w-0' : '', strong ? 'step-primary' : '', skipped ? 'step-skipped' : ''].filter(Boolean).join(' ');
      return html`<li class="${cls}" ${done ? html`data-content="✓"` : ''} ${i === current ? html`aria-current="step"` : ''}>
          <div class="pb-2 ${o.horizontal ? 'px-1 text-center' : `text-start ${responsive ? 'lg:px-1 lg:text-center' : ''}`}">
            <span class="block ${o.horizontal ? 'text-xs sm:text-sm' : 'text-sm'} ${strong ? 'font-semibold' : 'text-muted'}"
              >${item.href && i !== current ? html`<a class="link link-hover" href="${item.href}">${item.label}</a>` : item.label}<span class="sr-only"
                >${done ? ' (done)' : ''}${skipped ? ' (skipped)' : ''}${i === current ? (o.current === undefined && named < 0 ? ' (next)' : ' (this step)') : ''}</span
              ></span
            >
            ${item.detail ? html`<span class="block text-xs text-muted">${item.detail}</span>` : ''}
          </div>
        </li>`;
    })}
  </ol>`;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g;

/** Text with its http(s) links made clickable, everything still escaped. */
function linkified(text: string): (Html | string)[] {
  const parts: (Html | string)[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    parts.push(text.slice(last, match.index));
    parts.push(html`<a class="link" href="${match[0]}" rel="noopener noreferrer">${match[0]}</a>`);
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
 * control in a page's header, use `segmented`. Count chips here are quiet: Wattle is
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

/**
 * Photo thumbnails, each a link to the full image in the same tab. With JavaScript,
 * app.js opens them in the photo viewer instead (data-photo-grid). `alt` defaults to "Photo n of m".
 */
export function photoGrid(items: { src: string; caption?: Html | string; alt?: string }[]): Html {
  return html`<ul role="list" data-photo-grid class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    ${items.map(
      (item, i) =>
        html`<li>
          <figure class="flex flex-col items-stretch gap-2">
            <a href="${item.src}" class="block overflow-hidden rounded-box border border-line bg-page">
              <img src="${item.src}" alt="${item.alt ?? `Photo ${i + 1} of ${items.length}`}" loading="lazy" decoding="async" class="aspect-square w-full object-cover" />
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
        ? html`<p class="ticket-cell-address">${entityLink('property', o.address, o.propertyHref)}</p>`
        : html`<p class="ticket-cell-address">${o.address}</p>`
      : ''}
  </div>`;
}

/**
 * A Ticket as a work-order docket, read in the order a Property Manager reads it: the
 * stub (the number in the display face, the Urgency badge, the unread dot and `age`), a
 * dashed perforation, then the issue (the Summary, up to three lines) at 16px, the
 * address in Slate, and the stage line (`meta`: Trades and what the Ticket waits on). The
 * whole docket is one link. `street` shows in place of the full address. `unread` adds the
 * unread dot, with the words for screen readers. `decision` is kept for callers and adds
 * the `is-decision` class, but a docket draws no Wattle of its own: decisions are listed in
 * the dashboard's "Needs your attention". Without `href` it is a picture of a docket, not a link (the landing page's
 * workflow).
 *
 * `size: 'large'` is the Ticket page's header: the same order with the number at 40px.
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
  const large = o.size === 'large';
  const unread = o.unread
    ? html`<span><span class="unread-dot" aria-hidden="true"></span><span class="sr-only">unread messages</span></span>`
    : '';
  const inner = html`<span class="docket-stub">
      <span class="docket-number num">#${o.number}</span>
      ${urgencyBadge(o.urgency)}${unread}
      ${o.age ? html`<span class="docket-age">${o.age}</span>` : ''}
    </span>
    <span class="docket-perf" aria-hidden="true"></span>
    <span class="docket-body">
      ${clipped(o.issue, o.lines ?? (large ? 2 : 3), 'docket-issue')}
      ${clipped(o.street ?? o.address, 1, 'docket-address', o.address)}
    </span>
    ${o.meta.length > 0 ? html`<span class="docket-status">${o.meta.map((item) => html`<span>${item}</span>`)}</span>` : ''}`;
  const cls = `docket${large ? ' is-large' : ''}${o.decision ? ' is-decision' : ''}`;
  return o.href ? html`<a href="${o.href}" class="${cls}">${inner}</a>` : html`<div class="${cls}">${inner}</div>`;
}

type Count = { label: string; count: number; href: string; decision?: boolean; /** The words for exactly one ("Quote to choose"), when `label` is the plural. */ one?: string };

/**
/**
 * The count sentence: one sentence under the page title in 16px, each count a link into
 * its queue ("2 Maintenance Requests to confirm, 1 Quote to choose and 1 Tradie to
 * rate."). Counts of zero are left out. A count that needs a decision is Night on a
 * Wattle chip; the others are plain links. When nothing is left, the sentence says so
 * (`empty`, "Nothing needs you right now." by default).
 */
export function countSentence(items: Count[], o: { empty?: string; label?: string } = {}): Html {
  const shown = items.filter((item) => item.count > 0);
  if (shown.length === 0) return html`<p class="count-sentence">${o.empty ?? 'Nothing needs you right now.'}</p>`;
  const link = (item: Count) =>
    html`<a href="${item.href}" class="count-link${item.decision ? ' is-decision' : ''}">${item.count} ${item.count === 1 ? (item.one ?? item.label) : item.label}</a>`;
  const parts = shown.map((item, i) => {
    const sep = i === 0 ? '' : i === shown.length - 1 ? ' and ' : ', ';
    return html`${sep}${link(item)}`;
  });
  return html`<nav aria-label="${o.label ?? 'Counts'}"><p class="count-sentence">${parts}.</p></nav>`;
}

/**
 * The count strip (the dashboard): one row of counts that link into the queues. A `tone`
 * colours a tile while its count is above zero: `attention` Wattle, `urgent` red; zeros stay plain.
 */
export function countStrip(items: { label: string; count: number; href: string; decision?: boolean; tone?: 'attention' | 'urgent' }[]): Html {
  return html`<nav aria-label="Counts">
    <ul class="count-strip">
      ${items.map(
        (item) =>
          html`<li><a href="${item.href}" class="count-item${item.tone && item.count > 0 ? ` is-${item.tone}` : ''}"><span class="count-chip ${item.decision ? 'is-decision' : ''}${item.count === 0 ? ' is-zero' : ''}">${item.count}</span><span class="count-label">${item.label}</span></a></li>`,
      )}
    </ul>
  </nav>`;
}

/**
 * Text the AI wrote (a Summary, a drafted follow-up) on the info tint, with a quiet label
 * after the sparkle: "Filled in by AI" unless `label` says more. The sparkle is the one
 * AI mark and is decorative; the label carries the meaning. Pass `edit` for the control
 * that changes it (a pencil link). Text a person wrote or edited, or the Tenant's own
 * words, is not tinted.
 */
export function aiFilled(content: Html | string, o: { label?: string; edit?: Html } = {}): Html {
  return html`<div class="ai-filled">
    <span class="ai-filled-label">${icon('sparkle', { size: 'size-3.5', weight: 'fill' })}<span>${o.label ?? 'Filled in by AI'}</span></span>
    <div class="flex items-start justify-between gap-3"><div class="min-w-0 flex-1">${content}</div>${o.edit ?? ''}</div>
  </div>`;
}

/**
 * A profile's read: the sentence is the heading, with the numbers under it.
 * Concern is Ochre, good is the done green, and a neutral chip is muted on a line.
 * The words carry the meaning. When the sentence used a model, the "Filled in by AI"
 * mark sits beside it. No history is one quiet line instead.
 */
export function profileRead(read: { sentence: string; chips: { text: string; tone: 'concern' | 'good' | 'neutral' }[]; ai: boolean } | null): Html {
  if (!read) return html`<p class="profile-read-empty">No history yet</p>`;
  const chip = (text: string, tone: 'concern' | 'good' | 'neutral') =>
    tone === 'concern'
      ? badge(text, 'warning', { wrap: true })
      : tone === 'good'
        ? badge(text, 'success', { wrap: true })
        : html`<span class="badge badge-soft badge-muted max-w-full whitespace-normal text-left">${text}</span>`;
  return html`<section class="profile-read" aria-label="At a glance">
    <div class="profile-read-line${read.ai ? ' is-ai' : ''}">
      <h2 class="profile-read-sentence">${read.sentence}</h2>
      ${read.ai ? html`<span class="ai-filled-label">${icon('sparkle', { size: 'size-3.5', weight: 'fill' })}<span>Filled in by AI</span></span>` : ''}
    </div>
    ${read.chips.length ? html`<div class="profile-read-chips">${read.chips.map((item) => chip(item.text, item.tone))}</div>` : ''}
  </section>`;
}

/**
 * A compact queue row: an optional photo thumbnail, then the title (a link when
 * `href` is given) with the actions such as Confirm and Review beside it, a detail
 * line, and the badges with the meta (an age) at the end of their row.
 * `decision` (default false) marks a row that needs the Property Manager's decision.
 * In the dashboard's "Needs your attention" those get a 4px Wattle edge; elsewhere none.
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

/**
 * The filter bar over a list (Tickets, Archive): a GET form of selects for Urgency,
 * Trade and Property that keeps the Mine/All scope in a hidden field, with an Apply
 * button (app.js submits on change when JavaScript runs) and a Clear link when any
 * filter is set. `filter` is what `listFilterOf` read from the query.
 */
export function filterBar(o: {
  action: string;
  filter: { scope: 'mine' | 'all'; urgency?: string; trade?: string; propertyId?: number };
  urgencies?: { value: string; label: string }[];
  trades?: { value: string; label: string }[];
  properties?: Option[];
}): Html {
  const f = o.filter;
  const select = (name: string, label: string, all: string, options: Option[] | undefined, value: string | undefined, search = false) =>
    options?.length
      ? html`<label class="filter-bar-field${search ? ' filter-bar-search' : ''}"><span class="filter-bar-label">${label}</span>
          <select name="${name}" class="select select-sm" ${search ? 'data-combobox' : ''}>
            <option value="">${all}</option>
            ${optionTags(options, value ?? '')}
          </select></label>`
      : '';
  const any = Boolean(f.urgency || f.trade || f.propertyId);
  return html`<form method="get" action="${o.action}" class="filter-bar" data-autosubmit role="search" aria-label="Filter">
    ${f.scope === 'all' ? html`<input type="hidden" name="filter" value="all" />` : ''}
    ${select('urgency', 'Urgency', 'Any Urgency', o.urgencies, f.urgency)}
    ${select('trade', 'Trade', 'Any Trade', o.trades, f.trade)}
    ${select('property', 'Property', 'Any Property', o.properties, f.propertyId ? String(f.propertyId) : undefined, true)}
    <button type="submit" class="btn btn-sm filter-bar-apply">Apply</button>
    ${any ? html`<a class="link filter-bar-clear" href="${o.action}${f.scope === 'all' ? '?filter=all' : ''}">Clear filters</a>` : ''}
  </form>`;
}

/** The Mine/All control: links with the current one filled and aria-current. `label` names the group; most of these are views. */
export function segmented(items: { label: string; href: string; active: boolean }[], label = 'Views'): Html {
  return html`<nav class="segmented" aria-label="${label}">
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
  setup: icon('compass', { size: 'size-[18px]' }),
};

/** The rail's icons, 18px (the Phone simulator's 16px, as it is quieter). */
const NAV_ICON: Record<NavKey, Html> = {
  dashboard: icon('squares-four', { size: 'size-[18px]' }),
  dispatch: icon('map-pin', { size: 'size-[18px]' }),
  tickets: icon('ticket', { size: 'size-[18px]' }),
  archive: icon('archive', { size: 'size-[18px]' }),
  approvals: icon('seal-check', { size: 'size-[18px]' }),
  schedule: icon('calendar-blank', { size: 'size-[18px]' }),
  properties: icon('house-line', { size: 'size-[18px]' }),
  tradies: icon('wrench', { size: 'size-[18px]' }),
  tenants: icon('users', { size: 'size-[18px]' }),
  owners: icon('key', { size: 'size-[18px]' }),
  'building-managers': icon('buildings', { size: 'size-[18px]' }),
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
 * The logo: the key tag beside the "myEST8" wordmark in Bricolage Grotesque, a light "my" and a
 * bold "EST8". The mark is hidden from screen readers, so the logo's accessible
 * name is "myEST8". Put it inside a link or heading; `sm` is a 20px mark, `md`
 * (default) 28px. The mark is only ever Night, White or Wattle.
 */
export function logo(o: { size?: 'sm' | 'md' } = {}): Html {
  return html`<span class="logo is-${o.size ?? 'md'}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" class="logo-mark" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="${LOGO_MARK}" /></svg><span class="logo-word"><span class="logo-my">my</span>EST8</span></span>`;
}
