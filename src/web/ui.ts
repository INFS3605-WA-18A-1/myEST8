// The design system: page layouts and components as HTML. Interpolated values are
// escaped by `html`; use `raw` only for markup this module builds itself.

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
  | 'password'
  | 'textarea'
  | 'select'
  | 'file';

/** A signed-in Property Manager's page. */
export function page(o: { title: string; pm?: { name: string } | null; active?: NavKey; flash?: Flash | null; body: Html }): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${o.title} · myEST8</title>
        <link rel="stylesheet" href="/assets/daisyui.css" />
        <script src="/assets/tailwind.js"></script>
      </head>
      <body>
        <nav>
          <a href="/">myEST8</a> <a href="/calendar">Calendar</a> <a href="/setup">Setup</a> <a href="/demo">Simulator</a>
          ${o.pm ? html`<span>${o.pm.name}</span> ${postButton('/logout', 'Sign out', { variant: 'ghost', size: 'sm' })}` : ''}
        </nav>
        <main>${o.flash ? flashMessage(o.flash) : ''}<h1>${o.title}</h1>${o.body}</main>
      </body>
    </html>`;
}

/** A page for people who don't sign in: Tenants using an upload or tracker link. Phone first. */
export function publicPage(o: { title: string; flash?: Flash | null; body: Html }): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${o.title}</title>
        <link rel="stylesheet" href="/assets/daisyui.css" />
        <script src="/assets/tailwind.js"></script>
      </head>
      <body>
        <main>${o.flash ? flashMessage(o.flash) : ''}<h1>${o.title}</h1>${o.body}</main>
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

export function flashMessage(flash: Flash): Html {
  return html`<div role="${flash.kind === 'error' ? 'alert' : 'status'}" class="alert ${flash.kind === 'error' ? 'alert-error' : 'alert-success'}">${flash.message}</div>`;
}

const VARIANT: Record<Variant, string> = { primary: 'btn-primary', secondary: 'btn-outline', danger: 'btn-error', ghost: 'btn-ghost' };

export function button(
  label: string,
  o: { variant?: Variant; type?: 'submit' | 'button'; name?: string; value?: string; size?: 'sm' | 'md' } = {},
): Html {
  return html`<button type="${o.type ?? 'submit'}" class="btn ${VARIANT[o.variant ?? 'primary']} ${o.size === 'sm' ? 'btn-sm' : ''}" ${o.name ? html`name="${o.name}" value="${o.value ?? ''}"` : ''}>${label}</button>`;
}

export function linkButton(label: string, href: string, o: { variant?: Variant; size?: 'sm' | 'md' } = {}): Html {
  return html`<a href="${href}" class="btn ${VARIANT[o.variant ?? 'secondary']} ${o.size === 'sm' ? 'btn-sm' : ''}">${label}</a>`;
}

/** A one-click action: a small form that POSTs `fields` to `action`. */
export function postButton(
  action: string,
  label: string,
  o: { variant?: Variant; size?: 'sm' | 'md'; fields?: Record<string, string | number>; confirm?: string } = {},
): Html {
  return html`<form method="post" action="${action}" class="inline" ${o.confirm ? html`onsubmit="return confirm(this.dataset.confirm)" data-confirm="${o.confirm}"` : ''}>
    ${Object.entries(o.fields ?? {}).map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`)}
    ${button(label, { variant: o.variant, size: o.size })}
  </form>`;
}

export function card(o: { title?: string; actions?: Html; body: Html }): Html {
  return html`<section class="card">
    ${o.title || o.actions ? html`<header><h2>${o.title ?? ''}</h2>${o.actions ?? ''}</header>` : ''}
    <div>${o.body}</div>
  </section>`;
}

const TONE: Record<Tone, string> = { neutral: 'badge-ghost', info: 'badge-info', success: 'badge-success', warning: 'badge-warning', error: 'badge-error' };

export function badge(text: string, tone: Tone = 'neutral'): Html {
  return html`<span class="badge ${TONE[tone]}">${text}</span>`;
}

export function urgencyBadge(urgency: string): Html {
  return badge(humanise(urgency), urgency === 'urgent' ? 'error' : urgency === 'high' ? 'warning' : 'neutral');
}

const STATUS_TONE: Record<string, Tone> = {
  approved: 'success',
  done: 'success',
  closed: 'success',
  receipt_forwarded: 'success',
  scheduled: 'info',
  quoting: 'info',
  awaiting_owner: 'warning',
  requested: 'warning',
  reminded: 'warning',
  declined: 'error',
  declined_by_owner: 'error',
  cancelled: 'neutral',
};

/** Any status from the core (Job, Quote, Quote Request, approval...), in words. */
export function statusBadge(status: string): Html {
  return badge(humanise(status), STATUS_TONE[status] ?? 'neutral');
}

export function emptyState(text: string): Html {
  return html`<p class="empty">${text}</p>`;
}

export function table(headers: string[], rows: Html[][]): Html {
  return html`<table class="table">
    <thead><tr>${headers.map((h) => html`<th>${h}</th>`)}</tr></thead>
    <tbody>${rows.map((row) => html`<tr>${row.map((cell) => html`<td>${cell}</td>`)}</tr>`)}</tbody>
  </table>`;
}

/** A labelled form control. */
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
}): Html {
  const id = `field-${o.name}`;
  const type = o.type ?? 'text';
  const common = html`id="${id}" name="${o.name}" ${o.required ? 'required' : ''} ${o.multiple ? 'multiple' : ''}`;
  const control =
    type === 'textarea'
      ? html`<textarea ${common} placeholder="${o.placeholder ?? ''}">${o.value ?? ''}</textarea>`
      : type === 'select'
        ? html`<select ${common}>${(o.options ?? []).map((opt) => html`<option value="${opt.value}" ${String(o.value ?? '') === opt.value ? 'selected' : ''}>${opt.label}</option>`)}</select>`
        : html`<input ${common} type="${type}" value="${o.value ?? ''}" placeholder="${o.placeholder ?? ''}" ${o.accept ? html`accept="${o.accept}"` : ''} ${o.step ? html`step="${o.step}"` : ''} />`;
  return html`<label for="${id}">${o.label}</label>${control}${o.hint ? html`<p>${o.hint}</p>` : ''}`;
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
