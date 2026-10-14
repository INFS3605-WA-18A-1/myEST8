// The Property Manager's dashboard: a short overview of what needs a decision (Maintenance
// Requests to confirm and alerts) and the next seven days of bookings. The lists live on
// /requests and /tickets. Also the actions on Maintenance Requests and the inbox (their
// pages redirect back to /requests), and /files/:id for photos.

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import { ActionError, type Urgency } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { formAction, text } from '../forms.ts';
import { shellInfo } from '../shell.ts';
import { badge, countStrip, emptyState, flashFrom, humanise, linkButton, page, section, segmented, type Html } from '../ui.ts';
import type { Booking } from './calendar.ts';
import { alertRow, requestRow, streetOf, PHOTO_FLAG, ROLE_LABEL } from './requests.ts';
import { finishSetupBanner } from './welcome.ts';

export { PHOTO_FLAG, ROLE_LABEL };

/** How many Maintenance Requests and alerts the dashboard lists before pointing at /requests. */
const SHOWN = 5;

/** File types safe to show in the browser. Anything else (HTML, SVG...) downloads instead. */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

/** The dashboard at /, the actions on Maintenance Requests and the inbox, and /files/:id for photos. */
export function dashboardPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const filter = filterOf(c);
    const view = await actions.dashboard({ filter });
    const { timeZone } = actions.agency();
    const now = actions.now();
    const q = filter === 'all' ? '?filter=all' : '';
    const needReceipt = view.urgentRepairs.filter((u) => u.status === 'reminder_sent').length;
    const requests = [...view.maintenanceRequests].sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));

    return c.html(
      page({
        title: 'Dashboard',
        pm,
        active: 'dashboard',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        controls: segmented([
          { label: 'Mine', href: '/', active: filter === 'mine' },
          { label: 'All', href: '/?filter=all', active: filter === 'all' },
        ]),
        body: html`
          ${(await finishSetupBanner(actions))}
          ${countStrip([
            { label: 'Maintenance Requests to confirm', count: requests.length, href: `/requests${q}` },
            { label: 'Open Tickets', count: view.tickets.length, href: `/tickets${q}` },
            { label: 'Alerts', count: view.alerts.length, href: '/approvals' },
            { label: 'Urgent Repairs needing a receipt', count: needReceipt, href: `/requests${q}#urgent-repairs` },
          ])}
          ${section({
            title: 'Needs your decision',
            id: 'decisions',
            body: html`<div class="grid gap-6">
              <div id="requests" class="grid gap-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h3 class="section-title">Maintenance Requests to confirm</h3>
                  ${linkButton('See all requests', `/requests${q}`, { variant: 'ghost', size: 'sm' })}
                </div>
                ${requests.length
                  ? html`${requests.slice(0, SHOWN).map((r) => requestRow(r, q, now))}${requests.length > SHOWN
                      ? html`<p class="text-sm text-muted">Showing ${SHOWN} of ${requests.length}.</p>`
                      : ''}`
                  : emptyState('No Maintenance Requests waiting for you.')}
              </div>
              <div id="alerts" class="grid gap-2 border-t border-line pt-4">
                <h3 class="section-title">Alerts</h3>
                ${view.alerts.length
                  ? html`${view.alerts.slice(0, SHOWN).map((a) => alertRow(a, timeZone))}${view.alerts.length > SHOWN
                      ? html`<p class="text-sm text-muted">Showing ${SHOWN} of ${view.alerts.length}.</p>`
                      : ''}`
                  : emptyState('No alerts.')}
              </div>
            </div>`,
          })}
          ${nextSevenDays(view.calendar, now, timeZone)}
        `,
      }),
    );
  });

  pages.post('/requests/:issueId{[0-9]+}/confirm', (c) =>
    formAction(c, back(c), async () => {
      const ticketId = await c.var.actions.confirmMaintenanceRequest(idParam(c, 'issueId'));
      return { ok: 'Confirmed. The Ticket is open and the Tenant has been told.', redirect: `/tickets/${ticketId}` };
    }),
  );

  pages.post('/requests/:issueId{[0-9]+}/reject', (c) =>
    formAction(c, back(c), async (form) => {
      const issueId = idParam(c, 'issueId');
      await c.var.actions.rejectMaintenanceRequest(issueId, text(form, 'reason'));
      return { ok: 'Rejected. The Tenant has been told why.' };
    }),
  );

  pages.post('/requests/:issueId{[0-9]+}/urgency', (c) =>
    formAction(c, back(c), async (form) => {
      const issueId = idParam(c, 'issueId');
      const urgency = text(form, 'urgency') as Urgency;
      await c.var.actions.changeUrgency({ issueId }, urgency);
      return {
        ok:
          urgency === 'urgent'
            ? 'Now an Urgent Repair. The Tenant has been reminded to arrange it with a Nominated Tradie.'
            : `Urgency changed to ${humanise(urgency)}`,
      };
    }),
  );

  pages.post('/inbox/:itemId{[0-9]+}/link', (c) =>
    formAction(c, back(c), async (form) => {
      const personId = text(form, 'personId');
      if (!personId) throw new ActionError('invalid', 'Choose who sent this message');
      await c.var.actions.linkSender(idParam(c, 'itemId'), Number(personId));
      return { ok: 'Sender linked. Their next message will be recognised.' };
    }),
  );

  pages.post('/inbox/:itemId{[0-9]+}/route', (c) =>
    formAction(c, back(c), async () => {
      await c.var.actions.routeInboxItem(idParam(c, 'itemId'));
      return { ok: 'Message routed with the best guess' };
    }),
  );

  pages.post('/inbox/:itemId{[0-9]+}/dismiss', (c) =>
    formAction(c, back(c), async () => {
      await c.var.actions.dismissInboxItem(idParam(c, 'itemId'));
      return { ok: 'Message dismissed' };
    }),
  );

  pages.get('/files/:id{[0-9]+}', async (c) => {
    const file = await c.var.actions.file(idParam(c, 'id'));
    if (!file) return c.notFound();
    const inline = INLINE_TYPES.has(file.contentType.toLowerCase());
    return c.body(new Uint8Array(file.content), 200, {
      'content-type': inline ? file.contentType : 'application/octet-stream',
      'content-disposition': inline ? 'inline' : `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=3600',
    });
  });

  return pages;
}

function filterOf(c: Context<WebEnv>): 'mine' | 'all' {
  return c.req.query('filter') === 'all' ? 'all' : 'mine';
}

/** Back to the Maintenance Requests page, keeping "mine" or "all". */
function back(c: Context<WebEnv>) {
  return filterOf(c) === 'all' ? '/requests?filter=all' : '/requests';
}

function idParam(c: Context<WebEnv>, name: string) {
  return Number(c.req.param(name));
}

// Next 7 days

/**
 * Today and the six days after it, in the Agency's time zone. Each day with bookings
 * gets a row (today always has one); the empty days between them collapse into a
 * single muted line.
 */
function nextSevenDays(bookings: Booking[], now: Date, timeZone: string): Html {
  const today = dayKey(now, timeZone);
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const day = dayKey(new Date(b.start), timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  const rows: Html[] = [];
  let quiet: string[] = [];
  const flushQuiet = () => {
    if (quiet.length) rows.push(html`<li class="px-2 py-2 text-sm text-muted">Nothing booked ${dayRange(quiet)}</li>`);
    quiet = [];
  };
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    const dayBookings = byDay.get(day) ?? [];
    if (i > 0 && !dayBookings.length) {
      quiet.push(day);
      continue;
    }
    flushQuiet();
    rows.push(dayRow(day, dayBookings, i === 0, timeZone));
  }
  flushQuiet();
  return section({
    title: 'Next 7 days',
    id: 'next-7-days',
    actions: linkButton('Open the schedule', '/dispatch', { variant: 'ghost', size: 'sm' }),
    body: html`<ol class="grid">${rows}</ol>`,
  });
}

/** One day: its date (today is highlighted), then its bookings or "Nothing booked today". */
function dayRow(day: string, bookings: Booking[], isToday: boolean, timeZone: string): Html {
  return html`<li class="grid gap-2 border-t border-line px-2 py-2 first:border-t-0 sm:grid-cols-[7rem_minmax(0,1fr)] ${isToday ? 'rounded bg-page' : ''}" ${isToday ? html`aria-current="date"` : ''}>
    <p class="text-sm font-semibold"><time datetime="${day}">${dayLabel(day, true)}</time>${isToday ? html` ${badge('Today', 'info')}` : ''}</p>
    ${bookings.length
      ? html`<ul class="grid gap-1.5">${bookings.map((b) => bookingLine(b, timeZone))}</ul>`
      : html`<p class="text-sm text-muted">Nothing booked today</p>`}
  </li>`;
}

/** One booking: its time, the Tradie's business name (linked to the profile) and the street (linked to the Ticket). */
function bookingLine(b: Booking, timeZone: string): Html {
  const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(b.start));
  return html`<li class="flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm">
    <time datetime="${b.start}" class="num shrink-0 font-semibold">${time}</time>
    <a class="link min-w-0 truncate" href="/tradies/${b.tradieId}">${b.businessName}</a>
    <a class="link min-w-0 truncate" href="/tickets/${b.ticketId}">${streetOf(b.propertyAddress)}</a>
  </li>`;
}

/** A day as "Thu 8 Oct", or "Thu 8" when a range of days is named after its last day (en-GB writes it without a comma). */
function dayLabel(day: string, withMonth: boolean) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: withMonth ? 'short' : undefined }).format(new Date(`${day}T00:00:00Z`));
}

/** "Fri 9 – Mon 12 Oct" for a run of days, or "Mon 12 Oct" for one. */
function dayRange(days: string[]) {
  const first = days[0] ?? '';
  const last = days.at(-1) ?? first;
  return first === last ? dayLabel(first, true) : `${dayLabel(first, false)} – ${dayLabel(last, true)}`;
}


/** The calendar day ("2026-10-12") that an instant falls on in the time zone. */
function dayKey(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

