// The Ticket view under /tickets/:id: one Ticket's Jobs from Quote Requests to
// Work Order, Property Owner approval, rescheduling, completion and closing, with
// the timeline and message log. Reads and changes go only through c.var.actions,
// and every POST goes through formAction back to the Ticket.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, notFound, TRADES, type Trade, type Urgency } from '../../shared.ts';
import { AVAILABILITY_LABELS, templates, type TemplateName } from '../../templates.ts';
import type { WebEnv } from '../env.ts';
import { PHOTO_FLAG } from './dashboard.ts';
import { cents, formAction, int, isoToLocal, list, localToIso, text, type FormValues } from '../forms.ts';
import {
  alert,
  badge,
  button,
  card,
  chatBubble,
  dl,
  emptyState,
  field,
  flashFrom,
  formatMoney,
  formatWhen,
  humanise,
  linkButton,
  page,
  photoGrid,
  postButton,
  sectionHeader,
  stat,
  statGroup,
  statusBadge,
  table,
  timeline,
  urgencyBadge,
  type Html,
} from '../ui.ts';

type TicketView = ReturnType<PropertyManagerActions['ticket']>;
type JobView = TicketView['jobs'][number];
type QuoteView = JobView['quotes'][number];
type WorkOrderView = NonNullable<JobView['workOrder']>;
type Recommendation = JobView['recommendations'][number];
type Photo = TicketView['photos'][number];
type Message = TicketView['messages'][number];
type TimelineEvent = TicketView['timeline'][number];
type Slot = { start: string; end: string };

/** What the Ticket view shows besides the Ticket itself. */
type Extras = {
  timeZone: string;
  /** Reschedule suggestions for one Work Order, when the page is opened with ?suggest=<workOrderId>. */
  suggest: { workOrderId: number; slots: Slot[]; error: string | null } | null;
  /** The approved Tradie's next free slots, for each Job waiting for its Work Order. */
  freeSlots: Map<number, Slot[]>;
};

/** Shown to explain the rule; the core enforces it. */
const MIN_QUOTES = 2;
const FIRST_ROUND = 3;
const FREE_SLOTS_SHOWN = 3;
const DEFAULT_VISIT_HOURS = 2;
const CHANNELS = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' } as const;
const nothing = html``;

/** The Ticket view under /tickets/:id and every Job action on it. */
export function ticketPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/:id', (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const ticket = findTicket(actions, c.req.param('id'));
    if (!ticket) {
      const body = emptyState('There is no such Ticket in your Agency.', linkButton('Back to the dashboard', '/'));
      return c.html(page({ title: 'Ticket not found', pm, active: 'dashboard', flash, body }), 404);
    }
    const { timeZone } = actions.agency();
    const extras: Extras = {
      timeZone,
      suggest: suggestionsFor(actions, ticket, c.req.query('suggest')),
      freeSlots: freeSlotsFor(actions, ticket),
    };
    return c.html(
      page({
        title: `Ticket ${ticket.ticketId}: ${ticket.propertyAddress}`,
        subtitle: `${ticket.tenantName} reported it ${formatWhen(ticket.reportedAt, timeZone)}`,
        actions: closeControl(ticket),
        pm,
        active: 'dashboard',
        flash,
        body: ticketBody(ticket, extras),
      }),
    );
  });

  onPost(pages, '/:id/urgency', async ({ actions, ticket, form }) => {
    const urgency = text(form, 'urgency') as Urgency;
    await actions.changeUrgency({ ticketId: ticket.ticketId }, urgency);
    return `Urgency changed to ${humanise(urgency)}`;
  });

  onPost(pages, '/:id/close', async ({ actions, ticket }) => {
    await actions.closeTicket(ticket.ticketId);
    return 'Ticket closed. The Tenant and Property Owner have been told.';
  });

  onPost(pages, '/:id/read', ({ actions, ticket }) => {
    actions.markTicketRead(ticket.ticketId);
    return 'Messages marked read';
  });

  onPost(pages, '/:id/jobs', ({ actions, ticket, form }) => {
    const trade = tradeFrom(form);
    actions.addJob(ticket.ticketId, trade);
    return `${humanise(trade)} Job added`;
  });

  onPost(pages, '/:id/jobs/:jobId/trade', ({ actions, ticket, form, params }) => {
    const job = jobIn(ticket, params.jobId);
    const trade = tradeFrom(form);
    actions.setJobTrade(job.jobId, trade);
    return `Trade changed to ${humanise(trade)}`;
  });

  onPost(pages, '/:id/jobs/:jobId/cancel', async ({ actions, ticket, params }) => {
    const job = jobIn(ticket, params.jobId);
    await actions.cancelJob(job.jobId);
    return `${jobLabel(ticket, job.jobId)} cancelled`;
  });

  onPost(pages, '/:id/jobs/:jobId/quote-requests', async ({ actions, ticket, form, params }) => {
    const job = jobIn(ticket, params.jobId);
    const tradieIds = [...new Set(list(form, 'tradieIds').map(Number))];
    await actions.sendQuoteRequests(job.jobId, tradieIds);
    const n = tradieIds.length;
    return `Quote ${plural(n, 'Request')} sent to ${n} ${plural(n, 'Tradie')}`;
  });

  onPost(pages, '/:id/quotes/:quoteId/confirm', ({ actions, ticket, form, params, timeZone }) => {
    const { quote } = quoteIn(ticket, params.quoteId);
    const time = text(form, 'proposedTime');
    actions.confirmQuote(quote.quoteId, {
      ...(text(form, 'price') ? { priceCents: cents(form, 'price', 'the price') } : {}),
      proposedTime: time ? localToIso(time, timeZone) : null,
    });
    const confirmed = quoteIn(actions.ticket(ticket.ticketId), params.quoteId).quote;
    return `Quote from ${confirmed.businessName} confirmed at ${formatMoney(confirmed.priceCents)}`;
  });

  onPost(pages, '/:id/quotes/:quoteId/choose', async ({ actions, ticket, form, params }) => {
    const { quote } = quoteIn(ticket, params.quoteId);
    await actions.chooseQuote(quote.quoteId, text(form, 'reason') || undefined);
    const chosen = quoteIn(actions.ticket(ticket.ticketId), params.quoteId).quote;
    return chosen.status === 'awaiting_owner'
      ? `Quote from ${chosen.businessName} chosen. It takes the Repair Cost over the Max Repair Cost, so the Property Owner has been asked to approve it.`
      : `Quote from ${chosen.businessName} chosen and approved`;
  });

  onPost(pages, '/:id/jobs/:jobId/work-order', async ({ actions, ticket, form, params, timeZone }) => {
    const job = jobIn(ticket, params.jobId);
    const start = text(form, 'start');
    await actions.sendWorkOrder(job.jobId, {
      ...(start ? { start: localToIso(start, timeZone) } : {}),
      durationMinutes: visitMinutes(form),
    });
    const booked = jobIn(actions.ticket(ticket.ticketId), params.jobId).workOrder!;
    return `Work Order sent to ${booked.businessName} for ${formatWhen(booked.start, timeZone)}`;
  });

  onPost(
    pages,
    '/:id/work-orders/:workOrderId/accept',
    async ({ actions, ticket, form, params, timeZone }) => {
      const workOrder = workOrderIn(ticket, params.workOrderId);
      const local = text(form, 'local');
      const start = local ? localToIso(local, timeZone) : text(form, 'start');
      if (!start) throw new ActionError('invalid', 'Pick a new time');
      await actions.acceptTime(workOrder.workOrderId, start);
      return `Visit moved to ${formatWhen(start, timeZone)}. ${workOrder.businessName} and the Tenant have been told.`;
    },
    // A refused time keeps the suggestions open.
    (params) => `?suggest=${encodeURIComponent(params.workOrderId ?? '')}`,
  );

  onPost(pages, '/:id/jobs/:jobId/rate', ({ actions, ticket, form, params }) => {
    const job = jobIn(ticket, params.jobId);
    const score = int(form, 'score', 'the rating');
    actions.rateTradie(job.jobId, score);
    return `${job.workOrder?.businessName ?? 'The Tradie'} rated ${score} out of 5`;
  });

  return pages;
}

// Actions

type ActionInput = {
  actions: PropertyManagerActions;
  ticket: TicketView;
  timeZone: string;
  form: FormValues;
  params: Record<string, string | undefined>;
};

/**
 * POST `path` on the Ticket: loads it, runs `run`, and redirects back to the Ticket
 * with the returned message, or with the reason the action was refused.
 */
function onPost(
  pages: Hono<WebEnv>,
  path: string,
  run: (input: ActionInput) => Promise<string> | string,
  backQuery?: (params: Record<string, string | undefined>) => string,
) {
  pages.post(path, (c) => {
    const params = c.req.param() as Record<string, string | undefined>;
    const ticketPath = `/tickets/${encodeURIComponent(params.id ?? '')}`;
    return formAction(c, `${ticketPath}${backQuery?.(params) ?? ''}`, async (form) => {
      const actions = c.var.actions;
      const ticket = loadTicket(actions, params.id);
      const ok = await run({ actions, ticket, timeZone: actions.agency().timeZone, form, params });
      return { ok, redirect: ticketPath };
    });
  });
}

function loadTicket(actions: PropertyManagerActions, raw: string | undefined): TicketView {
  const ticketId = Number(raw);
  if (!Number.isInteger(ticketId)) notFound('Ticket');
  return actions.ticket(ticketId);
}

function findTicket(actions: PropertyManagerActions, raw: string | undefined): TicketView | null {
  try {
    return loadTicket(actions, raw);
  } catch (error) {
    if (error instanceof ActionError && error.code === 'not_found') return null;
    throw error;
  }
}

function jobIn(ticket: TicketView, raw: string | undefined): JobView {
  return ticket.jobs.find((j) => j.jobId === Number(raw)) ?? notFound('Job');
}

function quoteIn(ticket: TicketView, raw: string | undefined): { job: JobView; quote: QuoteView } {
  for (const job of ticket.jobs) {
    const quote = job.quotes.find((q) => q.quoteId === Number(raw));
    if (quote) return { job, quote };
  }
  notFound('Quote');
}

function workOrderIn(ticket: TicketView, raw: string | undefined): WorkOrderView {
  const job = ticket.jobs.find((j) => j.workOrder?.workOrderId === Number(raw));
  return job?.workOrder ?? notFound('Work Order');
}

function tradeFrom(form: FormValues): Trade {
  const chosen = text(form, 'trade');
  return TRADES.find((t) => t === chosen) ?? invalidTrade();
}

function invalidTrade(): never {
  throw new ActionError('invalid', 'Choose a Trade from the list');
}

/** The visit length typed in hours ("2", "1.5"), as minutes. */
function visitMinutes(form: FormValues): number {
  const typed = text(form, 'hours');
  if (!typed) return DEFAULT_VISIT_HOURS * 60;
  const hours = Number(typed);
  if (!Number.isFinite(hours) || hours <= 0) throw new ActionError('invalid', 'Enter the visit length in hours');
  return Math.round(hours * 60);
}

function suggestionsFor(actions: PropertyManagerActions, ticket: TicketView, raw: string | undefined): Extras['suggest'] {
  const workOrderId = Number(raw);
  const active = ticket.jobs.some((j) => j.workOrder?.workOrderId === workOrderId && j.workOrder.status === 'active');
  if (!raw || !active) return null;
  try {
    return { workOrderId, slots: actions.suggestTimes(workOrderId), error: null };
  } catch (error) {
    if (error instanceof ActionError) return { workOrderId, slots: [], error: error.message };
    throw error;
  }
}

function freeSlotsFor(actions: PropertyManagerActions, ticket: TicketView): Map<number, Slot[]> {
  const slots = new Map<number, Slot[]>();
  for (const job of ticket.jobs) {
    if (job.status !== 'approved' || job.workOrder) continue;
    const approved = job.quotes.find((q) => q.status === 'approved');
    if (approved) slots.set(job.jobId, actions.freeSlots(approved.tradieId).slice(0, FREE_SLOTS_SHOWN));
  }
  return slots;
}

// The page

function ticketBody(t: TicketView, x: Extras): Html {
  return html`${summaryCard(t, x)} ${reportCard(t)} ${t.jobs.map((job) => jobCard(t, job, x))}
    ${t.status === 'open' ? addJobCard(t) : nothing}
    <div class="grid gap-6 lg:grid-cols-2">${timelineCard(t, x)} ${messagesCard(t, x)}</div>`;
}

function summaryCard(t: TicketView, x: Extras): Html {
  const openJobs = t.jobs.filter(isOpen).length;
  const overMax = t.repairCostCents > t.maxRepairCostCents;
  const unread = t.messages.filter((m) => m.unread).length;
  return card({
    title: t.description,
    body: html`${statGroup([
        stat({
          label: 'Repair Cost',
          value: formatMoney(t.repairCostCents),
          hint: overMax
            ? `Over the Max Repair Cost of ${formatMoney(t.maxRepairCostCents)}, with the Property Owner's approval`
            : `Max Repair Cost ${formatMoney(t.maxRepairCostCents)}`,
          tone: overMax ? 'warning' : 'neutral',
        }),
        stat({ label: 'Open Jobs', value: openJobs, hint: `${t.jobs.length} in total` }),
        stat({ label: 'Unread messages', value: unread, tone: unread ? 'warning' : 'neutral' }),
      ])}
      ${dl([
        ['Property', t.propertyAddress],
        ['Tenant', t.tenantName],
        ['Property Manager', t.propertyManager],
        ['Status', statusBadge(t.status)],
        [
          'Urgency',
          html`${urgencyBadge(t.urgency)}
          ${t.checkUrgency ? html`${badge('Check Urgency', 'warning')} <span class="text-xs">The intake agent wasn't sure.</span>` : nothing}`,
        ],
        ['Reported', formatWhen(t.reportedAt, x.timeZone)],
        ['Frequent issues here', frequentIssues(t)],
      ])}
      ${t.status === 'open' ? urgencyForm(t) : nothing}`,
  });
}

/** Close Ticket, or why it can't be closed yet. */
function closeControl(t: TicketView): Html {
  const openJobs = t.jobs.filter(isOpen).length;
  if (t.status !== 'open') return badge('Closed', 'success');
  if (openJobs === 0) {
    return postButton(`/tickets/${t.ticketId}/close`, 'Close Ticket', {
      confirm: 'Close this Ticket? The Tenant and Property Owner will be told.',
    });
  }
  return html`<div class="flex flex-col items-start gap-1 sm:items-end">
    ${button('Close Ticket', { type: 'button', variant: 'secondary', size: 'sm', disabled: true })}
    <p class="text-xs text-base-content/75">Close once every Job is done or cancelled (${openJobs} still open).</p>
  </div>`;
}

function frequentIssues(t: TicketView): string {
  if (!t.frequentIssues.length) return 'None yet';
  return t.frequentIssues.map((f) => `${humanise(f.trade)} (${f.tickets} ${plural(f.tickets, 'Ticket')})`).join(', ');
}

function urgencyForm(t: TicketView): Html {
  const options = [
    { value: 'high', label: 'High' },
    { value: 'routine', label: 'Routine' },
  ];
  return html`<form method="post" action="/tickets/${t.ticketId}/urgency" class="flex flex-wrap items-end gap-3">
    <div class="min-w-48 flex-1">
      ${field({
        label: 'Change Urgency',
        name: 'urgency',
        type: 'select',
        value: t.urgency,
        options,
        hint: 'A Ticket is High or Routine. Urgent issues are Urgent Repairs, which the Tenant arranges, so they never become Tickets.',
      })}
    </div>
    ${button('Save Urgency', { variant: 'secondary' })}
  </form>`;
}

function reportCard(t: TicketView): Html {
  const a = t.answers;
  return card({
    title: 'What the Tenant reported',
    body: html`${dl([
        ['Where', a.location ?? '—'],
        ['Started', a.started ?? '—'],
        ['Getting worse', a.worsening ? humanise(a.worsening) : '—'],
        ['Usually home', a.availability ? AVAILABILITY_LABELS[a.availability] : '—'],
      ])}
      ${t.photos.length
        ? photoGrid(t.photos.map((p) => ({ src: `/files/${p.fileId}`, caption: photoCaption(p) })))
        : emptyState(t.noPhotos ? 'No photos arrived within 48 hours.' : 'No photos.')}
      ${t.imageMatch ? html`<p>Image match: ${humanise(t.imageMatch.result)}. ${t.imageMatch.reason}</p>` : nothing}`,
  });
}

function photoCaption(p: Photo): Html {
  if (p.metadata === 'flagged') return html`${badge('Flagged', 'warning')} ${p.reasons.map((r) => PHOTO_FLAG[r] ?? humanise(r)).join(', ')}`;
  return p.metadata === 'ok' ? badge('Metadata OK', 'success') : badge('No metadata');
}

function jobCard(t: TicketView, job: JobView, x: Extras): Html {
  const cancel = isOpen(job)
    ? postButton(`/tickets/${t.ticketId}/jobs/${job.jobId}/cancel`, 'Cancel Job', {
        variant: 'ghost',
        size: 'sm',
        confirm: `Cancel the ${jobLabel(t, job.jobId)}? Its Quote Requests close and any booked visit is freed.`,
      })
    : nothing;
  return card({
    id: `job-${job.jobId}`,
    title: jobLabel(t, job.jobId),
    actions: html`${statusBadge(job.status)} ${job.checkTrade ? badge('Check Trade', 'warning') : nothing} ${cancel}`,
    body: html`<div class="space-y-6">
      ${job.status === 'quoting' && !job.quoteRequests.length ? tradeForm(t, job) : nothing}
      ${job.status === 'quoting' ? recommendationsSection(t, job, x) : nothing}
      ${job.quoteRequests.length ? quoteRequestsSection(job, x) : nothing}
      ${job.quotes.length ? quotesSection(t, job, x) : nothing}
      ${job.approval ? approvalSection(t, job, job.approval, x) : nothing}
      ${job.workOrder ? workOrderDetails(t, job.workOrder, x) : job.status === 'approved' ? workOrderForm(t, job, x) : nothing}
      ${job.status === 'done' ? ratingSection(t, job) : nothing}
    </div>`,
  });
}

function tradeForm(t: TicketView, job: JobView): Html {
  return html`<form method="post" action="/tickets/${t.ticketId}/jobs/${job.jobId}/trade" class="flex flex-wrap items-end gap-3">
    <div class="min-w-48 flex-1">
      ${field({
        id: `job-${job.jobId}-trade`,
        label: 'Trade',
        name: 'trade',
        type: 'select',
        value: job.trade,
        options: tradeOptions(),
        hint: job.checkTrade
          ? "The intake agent wasn't sure of the Trade. Check it before sending Quote Requests."
          : 'The Trade can change until Quote Requests are sent.',
      })}
    </div>
    ${button('Change Trade', { variant: 'secondary' })}
  </form>`;
}

function recommendationsSection(t: TicketView, job: JobView, x: Extras): Html {
  const header = sectionHeader('Recommended Tradies');
  if (!job.recommendations.length) {
    const none = `No Tradies in the Agency do ${humanise(job.trade).toLowerCase()} work yet.`;
    return html`<section class="space-y-3">${header} ${emptyState(none, linkButton('Add a Tradie', '/setup', { size: 'sm' }))}</section>`;
  }
  const firstRound = job.quoteRequests.length === 0;
  const ticked = new Set(firstRound ? job.recommendations.slice(0, FIRST_ROUND).map((r) => r.tradieId) : []);
  const anyLeft = job.recommendations.some((r) => !r.requested);
  return html`<section class="space-y-3">
    ${header}
    <p class="text-base-content/75">
      Ranked by myEST8 rating, then Google rating, then median previous Quote.
      ${firstRound ? 'Send the first round to 3–4 Tradies; the top three are ticked.' : 'Invite more Tradies if the Job is short of Quotes.'}
    </p>
    <form method="post" action="/tickets/${t.ticketId}/jobs/${job.jobId}/quote-requests" class="space-y-3">
      <ul role="list" class="space-y-2">
        ${job.recommendations.map((r, i) => recommendationItem(job, r, i + 1, ticked.has(r.tradieId), x))}
      </ul>
      ${anyLeft ? button('Send Quote Requests', { block: true }) : html`<p>Every recommended Tradie has been asked.</p>`}
    </form>
  </section>`;
}

function recommendationItem(job: JobView, r: Recommendation, rank: number, ticked: boolean, x: Extras): Html {
  const id = `job-${job.jobId}-tradie-${r.tradieId}`;
  const { average, count } = r.myEst8Rating;
  return html`<li class="flex items-start gap-3 rounded-box border border-base-300 p-3">
    <input
      type="checkbox"
      class="checkbox checkbox-primary checkbox-sm mt-0.5"
      id="${id}"
      name="tradieIds"
      value="${r.tradieId}"
      ${ticked && !r.requested ? 'checked' : ''}
      ${r.requested ? 'disabled' : ''}
    />
    <div class="min-w-0 flex-1 space-y-1">
      <div class="flex flex-wrap items-center gap-2">
        <label for="${id}" class="font-semibold">${rank}. ${r.businessName}</label>
        ${r.requested ? badge('Already asked', 'info') : nothing}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1">
        <span>myEST8 ${average.toFixed(1)} (${count} ${plural(count, 'rating')})</span>
        <span>${googleRating(r.googleRating)}</span>
        <span>
          ${r.medianQuoteCents === null
            ? 'No previous Quotes'
            : `Median Quote ${formatMoney(r.medianQuoteCents)} (${r.previousQuotes.length} previous)`}
        </span>
      </div>
      ${r.bookings.length
        ? html`<ul role="list" class="text-xs text-base-content/75">
            ${r.bookings.map((b) => html`<li>Booked ${formatRange(b.start, b.end, x.timeZone)} by ${b.propertyManager}</li>`)}
          </ul>`
        : nothing}
    </div>
    <a class="link shrink-0" href="/tradies/${r.tradieId}">Profile</a>
  </li>`;
}

function googleRating(g: Recommendation['googleRating']): string {
  if (!g) return 'Not on Google';
  if (g.rating === null) return 'Google: no rating yet';
  return `Google ${g.rating.toFixed(1)} (${g.reviewCount ?? 0} reviews)`;
}

function quoteRequestsSection(job: JobView, x: Extras): Html {
  const rows = job.quoteRequests.map((r) => [
    tradieLink(r.tradieId, r.businessName),
    html`${formatWhen(r.sentAt, x.timeZone)}`,
    statusBadge(r.status),
  ]);
  return html`<section class="space-y-3">${sectionHeader('Quote Requests')} ${table(['Tradie', 'Sent', 'Status'], rows)}</section>`;
}

function quotesSection(t: TicketView, job: JobView, x: Extras): Html {
  const confirmed = job.quotes.filter((q) => q.confirmed).length;
  const advice =
    confirmed < MIN_QUOTES
      ? 'myEST8 needs two confirmed Quotes before you choose one. To go ahead with fewer, record why.'
      : 'Compare them side by side and choose one.';
  return html`<section class="space-y-3">
    ${sectionHeader('Quotes')}
    ${job.status === 'quoting' ? html`<p class="text-base-content/75">${confirmed} confirmed. ${advice}</p>` : nothing}
    <ul role="list" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      ${job.quotes.map((q) => html`<li class="min-w-0">${quoteCard(t, job, q, confirmed, x)}</li>`)}
    </ul>
  </section>`;
}

function quoteCard(t: TicketView, job: JobView, q: QuoteView, confirmed: number, x: Extras): Html {
  const open = q.status === 'open';
  return html`<article class="h-full space-y-2 rounded-box border p-3 ${q.status === 'approved' ? 'border-success' : 'border-base-300'}">
    <header class="flex flex-wrap items-start justify-between gap-2">${tradieLink(q.tradieId, q.businessName)} ${statusBadge(q.status)}</header>
    <p class="text-2xl font-semibold tabular-nums">${formatMoney(q.priceCents)}</p>
    <p>Proposed time: ${q.proposedTime ? formatWhen(q.proposedTime, x.timeZone) : 'none given'}</p>
    <p class="flex flex-wrap gap-1">
      ${q.confirmed ? badge('Confirmed', 'success') : badge('Needs checking', 'warning')}
      ${q.hasPdf ? badge('PDF attached', 'info') : nothing}
    </p>
    ${q.reason ? html`<p>Chosen with one Quote: ${q.reason}</p>` : nothing}
    ${open && !q.confirmed ? confirmForm(t, q, x) : nothing}
    ${open && q.confirmed && job.status === 'quoting' ? chooseForm(t, q, confirmed) : nothing}
  </article>`;
}

function confirmForm(t: TicketView, q: QuoteView, x: Extras): Html {
  return html`<form method="post" action="/tickets/${t.ticketId}/quotes/${q.quoteId}/confirm" class="space-y-2">
    <p class="text-xs text-base-content/75">
      Check what was read from the reply${q.hasPdf ? ' and its PDF' : ''} and correct anything wrong. Only confirmed Quotes count.
    </p>
    ${field({
      id: `quote-${q.quoteId}-price`,
      label: 'Price ($)',
      name: 'price',
      value: q.priceCents === null ? '' : (q.priceCents / 100).toFixed(2),
      required: true,
    })}
    ${field({
      id: `quote-${q.quoteId}-time`,
      label: 'Proposed time',
      name: 'proposedTime',
      type: 'datetime-local',
      value: q.proposedTime ? isoToLocal(q.proposedTime, x.timeZone) : '',
      hint: `${x.timeZone} time. Leave empty if the Tradie gave none.`,
    })}
    ${button('Confirm Quote', { size: 'sm', block: true })}
  </form>`;
}

function chooseForm(t: TicketView, q: QuoteView, confirmed: number): Html {
  const question = `Choose ${q.businessName}'s Quote of ${formatMoney(q.priceCents)}?`;
  return html`<form method="post" action="/tickets/${t.ticketId}/quotes/${q.quoteId}/choose" class="space-y-2" data-confirm="${question}">
    ${confirmed < MIN_QUOTES
      ? field({
          id: `quote-${q.quoteId}-reason`,
          label: 'Why go ahead with one Quote?',
          name: 'reason',
          type: 'textarea',
          rows: 2,
          hint: 'For example a specialist or time-critical Job.',
        })
      : nothing}
    ${button('Choose this Quote', { size: 'sm', block: true })}
  </form>`;
}

function approvalSection(t: TicketView, job: JobView, approval: NonNullable<JobView['approval']>, x: Extras): Html {
  const quote = job.quotes.find((q) => q.quoteId === approval.quoteId);
  const asked = lastEvent(t, 'approval_requested', job.jobId);
  const repairCost = typeof asked?.repairCostCents === 'number' ? asked.repairCostCents : null;
  const waiting = approval.status === 'requested' || approval.status === 'reminded';
  return html`<section class="space-y-3">
    ${sectionHeader('Property Owner approval', statusBadge(approval.status))}
    <p>
      Asked ${formatWhen(approval.requestedAt, x.timeZone)} to approve ${quote ? `${quote.businessName}'s` : 'the'} Quote of
      ${formatMoney(quote?.priceCents ?? null)}, which takes the Repair Cost to ${formatMoney(repairCost)}, over the Max Repair Cost of
      ${formatMoney(t.maxRepairCostCents)}. The Property Owner replies YES or NO.
    </p>
    ${waiting
      ? html`<p class="text-base-content/75">
          ${approval.status === 'reminded' ? 'Reminded after 24 hours.' : 'A reminder goes after 24 hours.'}
          You'll get an alert if there's no reply after 48 hours.
        </p>`
      : nothing}
    ${approval.status === 'declined' && job.status === 'quoting' ? alert('The Property Owner said NO. Choose another Quote.', 'warning') : nothing}
  </section>`;
}

function workOrderForm(t: TicketView, job: JobView, x: Extras): Html {
  const approved = job.quotes.find((q) => q.status === 'approved');
  const free = x.freeSlots.get(job.jobId) ?? [];
  return html`<section class="space-y-3">
    ${sectionHeader('Work Order')}
    <p>
      ${approved ? `${approved.businessName}'s Quote of ${formatMoney(approved.priceCents)} is approved.` : ''}
      Send the Work Order to book the visit: the Tradie gets the address, and the Tenant and Property Owner are told the time.
    </p>
    <form method="post" action="/tickets/${t.ticketId}/jobs/${job.jobId}/work-order" class="flex flex-wrap items-end gap-3">
      <div class="min-w-56 flex-1">
        ${field({
          id: `job-${job.jobId}-start`,
          label: 'Start',
          name: 'start',
          type: 'datetime-local',
          value: approved?.proposedTime ? isoToLocal(approved.proposedTime, x.timeZone) : '',
          hint: approved?.proposedTime ? "The Quote's proposed time." : 'The Quote has no proposed time. Pick one.',
        })}
      </div>
      <div class="w-32">
        ${field({ id: `job-${job.jobId}-hours`, label: 'Length (hours)', name: 'hours', type: 'number', value: DEFAULT_VISIT_HOURS, step: '0.5', min: '0.5' })}
      </div>
      ${button('Send Work Order')}
    </form>
    ${free.length && approved
      ? html`<p class="flex flex-wrap items-center gap-1">
          ${approved.businessName} is free from ${free.map((s) => badge(formatWhen(s.start, x.timeZone)))}
        </p>`
      : nothing}
  </section>`;
}

function workOrderDetails(t: TicketView, wo: WorkOrderView, x: Extras): Html {
  const active = wo.status === 'active';
  const suggesting = x.suggest?.workOrderId === wo.workOrderId;
  const suggest = linkButton('Suggest new times', `/tickets/${t.ticketId}?suggest=${wo.workOrderId}`, {
    size: 'sm',
    variant: wo.rescheduleRequestedBy ? 'primary' : 'secondary',
  });
  const tenant = wo.visitConfirmed
    ? badge('Confirmed the visit', 'success')
    : active
      ? badge('Not confirmed yet', 'warning')
      : html`—`;
  const asker = wo.rescheduleRequestedBy === 'tenant' ? 'Tenant' : 'Tradie';
  return html`<section class="space-y-3">
    ${sectionHeader('Work Order', active && !suggesting ? suggest : undefined)}
    ${active && wo.rescheduleRequestedBy ? alert(`The ${asker} asked for another time.`, 'warning') : nothing}
    ${dl([
      ['Visit', formatRange(wo.start, wo.end, x.timeZone)],
      ['Tradie', tradieLink(wo.tradieId, wo.businessName)],
      ['Tenant', tenant],
      ...(wo.status === 'done' ? [['Done', 'The Tradie replied DONE'] as [string, string]] : []),
    ])}
    ${suggesting && x.suggest ? suggestionsPanel(t, wo, x.suggest, x) : nothing}
  </section>`;
}

function suggestionsPanel(t: TicketView, wo: WorkOrderView, suggest: NonNullable<Extras['suggest']>, x: Extras): Html {
  const accept = `/tickets/${t.ticketId}/work-orders/${wo.workOrderId}/accept`;
  const slots = suggest.error
    ? alert(suggest.error, 'error')
    : suggest.slots.length
      ? html`<ul role="list" class="space-y-2">
          ${suggest.slots.map(
            (slot) => html`<li class="flex flex-wrap items-center justify-between gap-2">
              <span>${formatRange(slot.start, slot.end, x.timeZone)}</span>
              ${postButton(accept, 'Move here', { size: 'sm', fields: { start: slot.start } })}
            </li>`,
          )}
        </ul>`
      : emptyState('No suggested time fits in the next 14 days. Pick another time below.');
  return html`<div class="space-y-3 rounded-box bg-base-200 p-3">
    <h3 class="font-semibold">New times</h3>
    <p class="text-base-content/75">
      Free for ${wo.businessName}, inside the Tenant's availability and as long as the current visit, over the next 14 days. The Tradie
      and the Tenant are told the new time.
    </p>
    ${slots}
    <form method="post" action="${accept}" class="flex flex-wrap items-end gap-3">
      <div class="min-w-56 flex-1">
        ${field({
          id: `work-order-${wo.workOrderId}-local`,
          label: 'Pick another time',
          name: 'local',
          type: 'datetime-local',
          required: true,
          hint: `${x.timeZone} time. The Tradie must be free then.`,
        })}
      </div>
      ${button('Move visit', { variant: 'secondary' })}
    </form>
    ${linkButton('Hide new times', `/tickets/${t.ticketId}`, { variant: 'ghost', size: 'sm' })}
  </div>`;
}

function ratingSection(t: TicketView, job: JobView): Html {
  const tradie = job.workOrder?.businessName ?? 'the Tradie';
  const rated = lastEvent(t, 'tradie_rated', job.jobId);
  const tenant = lastEvent(t, 'tenant_rated', job.jobId);
  const form = html`<form method="post" action="/tickets/${t.ticketId}/jobs/${job.jobId}/rate" class="space-y-2">
    <p>How did ${tradie} do? 1 is poor, 5 is excellent. It feeds their myEST8 rating.</p>
    <div class="flex flex-wrap gap-2">
      ${[1, 2, 3, 4, 5].map((n) => button(String(n), { name: 'score', value: String(n), variant: 'secondary' }))}
    </div>
  </form>`;
  return html`<section class="space-y-3">
    ${sectionHeader('Rating')}
    <p>${tenant ? `The Tenant rated the fix ${String(tenant.score)} out of 5.` : 'Waiting for the Tenant to say if it was fixed properly.'}</p>
    ${rated ? html`<p>${tradie} was rated ${String(rated.score)} out of 5.</p>` : form}
  </section>`;
}

function addJobCard(t: TicketView): Html {
  return card({
    title: 'Add another Job',
    body: html`<form method="post" action="/tickets/${t.ticketId}/jobs" class="flex flex-wrap items-end gap-3">
      <div class="min-w-48 flex-1">
        ${field({ label: 'Trade', name: 'trade', type: 'select', options: tradeOptions(), hint: 'When the issue needs another Trade as well.' })}
      </div>
      ${button('Add Job', { variant: 'secondary' })}
    </form>`,
  });
}

function timelineCard(t: TicketView, x: Extras): Html {
  const events = t.timeline.map((e) => ({ at: formatWhen(e.at, x.timeZone), ...describeEvent(t, e, x) }));
  return card({ title: 'Timeline', body: events.length ? timeline(events) : emptyState('Nothing has happened yet.') });
}

/** A timeline event in words, with the Tradie, price or visit it was about. */
function describeEvent(t: TicketView, event: TimelineEvent, x: Extras): { title: string; detail?: string } {
  const d = event as Record<string, unknown>;
  const job = typeof d.jobId === 'number' ? jobLabel(t, d.jobId) : undefined;
  const tradie = typeof d.tradie === 'string' ? d.tradie : 'The Tradie';
  const price = typeof d.priceCents === 'number' ? formatMoney(d.priceCents) : undefined;
  const visit = typeof d.visitStart === 'string' && typeof d.visitEnd === 'string' ? formatRange(d.visitStart, d.visitEnd, x.timeZone) : undefined;
  const details = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ') || undefined;
  switch (event.kind) {
    case 'reported':
      return { title: 'Reported by the Tenant' };
    case 'confirmed':
      return { title: 'Confirmed as a Ticket' };
    case 'urgency_changed':
      return { title: `Urgency changed to ${humanise(String(d.urgency))}` };
    case 'job_added':
      return { title: `${humanise(String(d.trade))} Job added` };
    case 'trade_changed':
      return { title: `Trade changed to ${humanise(String(d.trade))}`, detail: job };
    case 'job_cancelled':
      return { title: 'Job cancelled', detail: job };
    case 'quote_requests_sent': {
      const names = Array.isArray(d.tradies) ? d.tradies.map(String) : [];
      const title = `Quote ${plural(names.length, 'Request')} sent to ${names.length} ${plural(names.length, 'Tradie')}`;
      return { title, detail: details(job, names.join(', ')) };
    }
    case 'tradie_declined':
      return { title: `${tradie} declined the Quote Request`, detail: job };
    case 'quote_received':
      return { title: `Quote received from ${tradie}`, detail: job };
    case 'quote_chosen': {
      const reason = typeof d.reason === 'string' ? `Only one Quote: ${d.reason}` : undefined;
      return { title: `Quote from ${tradie} chosen`, detail: details(job, price, reason) };
    }
    case 'approval_requested': {
      const total = typeof d.repairCostCents === 'number' ? `Repair Cost would be ${formatMoney(d.repairCostCents)}` : undefined;
      return { title: 'Property Owner asked to approve', detail: details(job, total) };
    }
    case 'quote_approved':
      return { title: `Quote from ${tradie} approved`, detail: details(job, price) };
    case 'owner_declined':
      return { title: 'Property Owner declined the Quote', detail: details(job, price) };
    case 'work_order_sent':
      return { title: `Work Order sent to ${tradie}`, detail: details(job, visit) };
    case 'reschedule_requested':
      return { title: `${d.by === 'tenant' ? 'Tenant' : 'Tradie'} asked for another time`, detail: job };
    case 'visit_confirmed':
      return { title: 'Tenant confirmed the visit', detail: job };
    case 'visit_moved':
      return { title: 'Visit moved', detail: details(job, visit) };
    case 'job_done':
      return { title: `${tradie} finished the Job`, detail: job };
    case 'tenant_rated':
      return { title: `Tenant rated the fix ${String(d.score)} out of 5`, detail: job };
    case 'tradie_rated':
      return { title: `Tradie rated ${String(d.score)} out of 5`, detail: job };
    case 'closed':
      return { title: 'Ticket closed' };
    default:
      return { title: humanise(event.kind), detail: job };
  }
}

function messagesCard(t: TicketView, x: Extras): Html {
  const unread = t.messages.filter((m) => m.unread).length;
  return card({
    title: unread ? `Messages (${unread} unread)` : 'Messages',
    actions: unread ? postButton(`/tickets/${t.ticketId}/read`, 'Mark messages read', { variant: 'secondary', size: 'sm' }) : undefined,
    body: t.messages.length ? html`<div>${t.messages.map((m) => messageBubble(m, x))}</div>` : emptyState('No messages yet.'),
  });
}

/** Inbound messages on the left, what myEST8 sent on the right; unread ones stand out. */
function messageBubble(m: Message, x: Extras): Html {
  const subject = m.template ? ` · ${templateSubject(m.template)}` : '';
  return chatBubble({
    side: m.direction === 'in' ? 'start' : 'end',
    header: `${m.direction === 'in' ? 'From' : 'To'} ${m.address} · ${CHANNELS[m.channel]}${subject}`,
    text: m.text,
    footer: `${formatWhen(m.at, x.timeZone)}${m.unread ? ' · Unread' : ''}`,
    tone: m.unread ? 'warning' : undefined,
  });
}

// Small helpers

function tradieLink(tradieId: number, name: string): Html {
  return html`<a class="link font-semibold" href="/tradies/${tradieId}">${name}</a>`;
}

/** "Plumbing Job", or "Job 2: Plumbing" when the Ticket has several. */
function jobLabel(t: TicketView, jobId: number): string {
  const index = t.jobs.findIndex((j) => j.jobId === jobId);
  const job = t.jobs[index];
  if (!job) return 'Job';
  return t.jobs.length > 1 ? `Job ${index + 1}: ${humanise(job.trade)}` : `${humanise(job.trade)} Job`;
}

function lastEvent(t: TicketView, kind: string, jobId: number): Record<string, unknown> | undefined {
  return t.timeline.findLast((e) => e.kind === kind && (e as Record<string, unknown>).jobId === jobId) as Record<string, unknown> | undefined;
}

function isOpen(job: JobView) {
  return job.status !== 'done' && job.status !== 'cancelled';
}

function tradeOptions() {
  return TRADES.map((trade) => ({ value: trade, label: humanise(trade) }));
}

function templateSubject(name: string): string {
  return name in templates ? templates[name as TemplateName].subject : humanise(name);
}

/** "Tue 13 Oct, 9:00 am – 11:00 am", with the end's date only when it's another day. */
function formatRange(start: string, end: string, timeZone: string): string {
  const sameDay = isoToLocal(start, timeZone).slice(0, 10) === isoToLocal(end, timeZone).slice(0, 10);
  const until = sameDay
    ? new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(end))
    : formatWhen(end, timeZone);
  return `${formatWhen(start, timeZone)} – ${until}`;
}

function plural(n: number, word: string) {
  return n === 1 ? word : `${word}s`;
}
