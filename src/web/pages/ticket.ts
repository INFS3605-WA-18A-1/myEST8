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
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
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
  formatAge,
  formatMoney,
  formatWhen,
  humanise,
  linkButton,
  page,
  photoGrid,
  postButton,
  sectionHeader,
  statusBadge,
  steps,
  table,
  timeline,
  urgencyBadge,
  type Html,
} from '../ui.ts';

type TicketView = Awaited<ReturnType<PropertyManagerActions['ticket']>>;
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
  /** Now, in the Agency's clock, for how long ago the Ticket was reported. */
  now: Date;
};

/** Shown to explain the rule; the core enforces it. */
const MIN_QUOTES = 2;
const FIRST_ROUND = 3;
const FREE_SLOTS_SHOWN = 3;
const DEFAULT_VISIT_HOURS = 2;
/** WhatsApp is paused as a channel, but messages that came by it still say so. */
const CHANNELS = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' } as const;
const nothing = html``;

/** The Ticket view under /tickets/:id and every Job action on it. */
export function ticketPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/:id', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const ticket = await findTicket(actions, c.req.param('id'));
    if (!ticket) {
      const body = emptyState('There is no such Ticket in your Agency.', linkButton('Back to Tickets', '/tickets'));
      return c.html(page({ title: 'Ticket not found', pm, active: 'tickets', flash, body, shell: await shellInfo(c) }), 404);
    }
    const { timeZone } = actions.agency();
    const [suggest, freeSlots] = await Promise.all([suggestionsFor(actions, ticket, c.req.query('suggest')), freeSlotsFor(actions, ticket)]);
    const extras: Extras = { timeZone, suggest, freeSlots, now: actions.now() };
    return c.html(
      page({
        title: `Ticket #${ticket.ticketId}`,
        actions: html`${shareButton({
          title: `Ticket #${ticket.ticketId}: ${ticket.description}`,
          text: `Ticket #${ticket.ticketId} at ${ticket.propertyAddress}: ${ticket.description}`,
          url: shareUrl(c, `/tickets/${ticket.ticketId}`),
          note: COLLEAGUES_ONLY,
        })}${urgencyMenu(ticket)}${closeControl(ticket)}`,
        shell: await shellInfo(c),
        pm,
        active: 'tickets',
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

  onPost(pages, '/:id/read', async ({ actions, ticket }) => {
    await actions.markTicketRead(ticket.ticketId);
    return 'Messages marked read';
  });

  onPost(pages, '/:id/jobs', async ({ actions, ticket, form }) => {
    const trade = tradeFrom(form);
    await actions.addJob(ticket.ticketId, trade);
    return `${humanise(trade)} Job added`;
  });

  onPost(pages, '/:id/jobs/:jobId/trade', async ({ actions, ticket, form, params }) => {
    const job = jobIn(ticket, params.jobId);
    const trade = tradeFrom(form);
    await actions.setJobTrade(job.jobId, trade);
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

  onPost(pages, '/:id/quotes/:quoteId/confirm', async ({ actions, ticket, form, params, timeZone }) => {
    const { quote } = quoteIn(ticket, params.quoteId);
    const time = text(form, 'proposedTime');
    await actions.confirmQuote(quote.quoteId, {
      ...(text(form, 'price') ? { priceCents: cents(form, 'price', 'the price') } : {}),
      proposedTime: time ? localToIso(time, timeZone) : null,
    });
    const confirmed = quoteIn(await actions.ticket(ticket.ticketId), params.quoteId).quote;
    return `Quote from ${confirmed.businessName} confirmed at ${formatMoney(confirmed.priceCents)}`;
  });

  onPost(pages, '/:id/quotes/:quoteId/choose', async ({ actions, ticket, form, params }) => {
    const { quote } = quoteIn(ticket, params.quoteId);
    await actions.chooseQuote(quote.quoteId, text(form, 'reason') || undefined);
    const chosen = quoteIn(await actions.ticket(ticket.ticketId), params.quoteId).quote;
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
    const booked = jobIn(await actions.ticket(ticket.ticketId), params.jobId).workOrder!;
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

  onPost(pages, '/:id/jobs/:jobId/rate', async ({ actions, ticket, form, params }) => {
    const job = jobIn(ticket, params.jobId);
    const score = int(form, 'score', 'the rating');
    await actions.rateTradie(job.jobId, score);
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
      const ticket = await loadTicket(actions, params.id);
      const ok = await run({ actions, ticket, timeZone: actions.agency().timeZone, form, params });
      return { ok, redirect: ticketPath };
    });
  });
}

async function loadTicket(actions: PropertyManagerActions, raw: string | undefined): Promise<TicketView> {
  const ticketId = Number(raw);
  if (!Number.isInteger(ticketId)) notFound('Ticket');
  return actions.ticket(ticketId);
}

async function findTicket(actions: PropertyManagerActions, raw: string | undefined): Promise<TicketView | null> {
  try {
    return await loadTicket(actions, raw);
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

async function suggestionsFor(actions: PropertyManagerActions, ticket: TicketView, raw: string | undefined): Promise<Extras['suggest']> {
  const workOrderId = Number(raw);
  const active = ticket.jobs.some((j) => j.workOrder?.workOrderId === workOrderId && j.workOrder.status === 'active');
  if (!raw || !active) return null;
  try {
    return { workOrderId, slots: await actions.suggestTimes(workOrderId), error: null };
  } catch (error) {
    if (error instanceof ActionError) return { workOrderId, slots: [], error: error.message };
    throw error;
  }
}

async function freeSlotsFor(actions: PropertyManagerActions, ticket: TicketView): Promise<Map<number, Slot[]>> {
  const waiting = ticket.jobs.flatMap((job) => {
    const approved = job.status === 'approved' && !job.workOrder ? job.quotes.find((q) => q.status === 'approved') : undefined;
    return approved ? [{ jobId: job.jobId, tradieId: approved.tradieId }] : [];
  });
  const found = await Promise.all(waiting.map(async (w) => [w.jobId, (await actions.freeSlots(w.tradieId)).slice(0, FREE_SLOTS_SHOWN)] as const));
  return new Map<number, Slot[]>(found);
}

// The page

/**
 * The header with the Next step first in reading order after the issue; then the
 * Jobs (where the next action is) in the main column, and what the Tenant reported,
 * the Ticket's details and the logs beside them. On phones the Jobs come first.
 */
function ticketBody(t: TicketView, x: Extras): Html {
  return html`${ticketHeader(t, x)}
    <div class="grid items-start gap-4 lg:grid-cols-3">
      <div class="min-w-0 space-y-4 lg:col-span-2">
        ${t.jobs.map((job) => jobCard(t, job, x))}
        ${t.status === 'open' ? addJobCard(t) : nothing}
      </div>
      <div class="min-w-0 space-y-4">
        ${reportCard(t)} ${detailsCard(t)} ${timelineCard(t, x)} ${messagesCard(t, x)}
      </div>
    </div>`;
}

/**
 * The Ticket's header, hand-built in the docket's shape (number and Urgency in the
 * stub, a dashed perforation) because it reads the issue first and links the
 * address: the issue, the address, the Tenant, status and age, the Max Repair Cost,
 * the Repair Cost once there is one, and the one Next step.
 */
function ticketHeader(t: TicketView, x: Extras): Html {
  const overMax = t.repairCostCents > t.maxRepairCostCents;
  const stub = t.urgency === 'high' ? 'bg-high-bg text-high' : 'bg-page text-ink';
  const address = html`<a class="link" href="/properties/${t.propertyId}">${t.propertyAddress}</a>`;
  return html`<header class="ticket-head">
    <div class="ticket-stub ${stub}">
      <span class="num text-[26px] leading-none font-bold [font-family:var(--font-head)]">#${t.ticketId}</span>
      <span class="text-sm font-semibold [font-family:var(--font-head)]">${humanise(t.urgency)}<span class="sr-only"> Urgency</span></span>
    </div>
    <div aria-hidden="true" class="ticket-perf"></div>
    <div class="min-w-0 flex-1 space-y-3 p-4">
      <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div class="min-w-0 flex-1 basis-80 space-y-1">
          <h2 class="text-xl leading-tight font-semibold break-words [font-family:var(--font-head)]">${t.description}</h2>
          <p class="break-words font-medium">${address}</p>
        </div>
        ${t.repairCostCents > 0
          ? html`<div class="shrink-0 sm:text-right">
              <p class="text-xs text-muted">Repair Cost</p>
              <p class="num text-[22px] leading-tight font-semibold [font-family:var(--font-head)] ${overMax ? 'text-high' : ''}">${formatMoney(t.repairCostCents)}</p>
              ${overMax ? html`<p class="text-xs text-high">Over the Max Repair Cost, with the Property Owner's approval</p>` : nothing}
            </div>`
          : nothing}
      </div>
      <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>Tenant ${t.tenantName}</span>
        <span>${statusBadge(t.status)}</span>
        <time datetime="${t.reportedAt}">${reportedAgo(t.reportedAt, x.now)}</time>
        <span class="num">Max Repair Cost ${formatMoney(t.maxRepairCostCents)}</span>
        ${t.checkUrgency ? html`<span class="flex items-center gap-2">${badge('Check Urgency', 'warning')} The intake agent wasn't sure.</span>` : nothing}
      </p>
      ${nextStepLine(t, x)}
    </div>
  </header>`;
}

type NextStep = { text: string; href: string; decision: boolean; job?: JobView };

/**
 * The one thing to do next on the Ticket: the first Job waiting on the Property
 * Manager's decision, else the first Job waiting on someone else, else closing.
 * A decision gets the Wattle stripe.
 */
function nextStepLine(t: TicketView, x: Extras): Html {
  const step = nextStep(t, x);
  if (!step) return nothing;
  const job = step.job && t.jobs.length > 1 ? html` <span class="text-sm text-muted">${jobLabel(t, step.job.jobId)}</span>` : nothing;
  return html`<p class="ticket-next ${step.decision ? 'is-decision' : ''}" data-next-step>
    <span class="ticket-next-label">Next step</span>
    <a class="link font-semibold" href="${step.href}">${step.text}</a>${job}
  </p>`;
}

function nextStep(t: TicketView, x: Extras): NextStep | null {
  if (t.status !== 'open') return null;
  const steps = t.jobs.map((job) => jobStep(t, job, x)).filter((s): s is NextStep => s !== null);
  const step = steps.find((s) => s.decision) ?? steps[0];
  if (step) return step;
  if (t.jobs.some(isOpen)) return null;
  const done = t.jobs.some((j) => j.status === 'done');
  return { text: done ? 'Close the Ticket: every Job is done' : 'Close the Ticket: every Job is cancelled', href: '#close-ticket', decision: true };
}

/** What a Job waits on, and whether that is the Property Manager. */
function jobStep(t: TicketView, job: JobView, x: Extras): NextStep | null {
  const at = (section: string) => `#job-${job.jobId}-${section}`;
  const decide = (text: string, section: string): NextStep => ({ text, href: at(section), decision: true, job });
  const wait = (text: string, section: string): NextStep => ({ text, href: at(section), decision: false, job });
  switch (job.status) {
    case 'quoting': {
      const open = job.quotes.filter((q) => q.status === 'open');
      const unchecked = open.filter((q) => !q.confirmed);
      const confirmed = open.filter((q) => q.confirmed);
      const waiting = job.quoteRequests.filter((r) => r.status === 'sent' || r.status === 'reminded');
      if (!job.quoteRequests.length) return decide(job.checkTrade ? 'Check the Trade, then send Quote Requests' : 'Send Quote Requests', 'tradies');
      if (unchecked.length) {
        const names = andList(unchecked.map((q) => q.businessName));
        return decide(`Check ${unchecked.length} ${plural(unchecked.length, 'Quote')} from ${names}`, 'quotes');
      }
      if (confirmed.length >= MIN_QUOTES) return decide(`Choose a Quote: ${confirmed.length} confirmed`, 'quotes');
      if (waiting.length) {
        const oldest = waiting.reduce((a, b) => (a.sentAt < b.sentAt ? a : b));
        const names = andList(waiting.map((r) => r.businessName));
        return wait(`Waiting on ${plural(waiting.length, 'a Quote', 'Quotes')} from ${names}, asked ${formatAge(oldest.sentAt, x.now)}`, 'requests');
      }
      if (confirmed.length === 1) return decide(`Choose ${confirmed[0]!.businessName}'s Quote with a reason, or ask more Tradies`, 'quotes');
      return decide('Ask more Tradies to quote', 'tradies');
    }
    case 'awaiting_owner': {
      const quote = job.quotes.find((q) => q.quoteId === job.approval?.quoteId);
      return wait(`Waiting on the Property Owner to approve ${formatMoney(quote?.priceCents ?? null)}`, 'approval');
    }
    case 'approved': {
      const approved = job.quotes.find((q) => q.status === 'approved');
      if (job.workOrder) return null;
      return decide(approved ? `Send the Work Order to ${approved.businessName}` : 'Send the Work Order', 'work-order');
    }
    case 'scheduled': {
      const wo = job.workOrder;
      if (!wo) return null;
      if (wo.status === 'active' && wo.rescheduleRequestedBy) {
        return decide(`Find a new time: the ${wo.rescheduleRequestedBy === 'tenant' ? 'Tenant' : 'Tradie'} asked for another`, 'work-order');
      }
      return wait(`Visit ${formatWhen(wo.start, x.timeZone)} with ${wo.businessName}`, 'work-order');
    }
    case 'done':
      return lastEvent(t, 'tradie_rated', job.jobId) ? null : decide(`Rate ${job.workOrder?.businessName ?? 'the Tradie'}`, 'rating');
    default:
      return null;
  }
}

/** "Reported 2 days ago", in the Agency's clock's hours and days. */
function reportedAgo(iso: string, now: Date): string {
  const hours = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000));
  if (hours < 24) return `Reported ${hours} ${plural(hours, 'hour')} ago`;
  const days = Math.floor(hours / 24);
  return `Reported ${days} ${plural(days, 'day')} ago`;
}

/** Who looks after the Ticket, what else goes wrong at the Property, and what the intake agent's photo check said. */
function detailsCard(t: TicketView): Html {
  return card({
    title: 'Ticket details',
    body: dl([
      ['Property Manager', t.propertyManager],
      ['Frequent issues here', frequentIssues(t)],
      ...(t.imageMatch
        ? [['Photo check', html`${badge(humanise(t.imageMatch.result), t.imageMatch.result === 'matches' ? 'success' : 'warning')} <span class="text-muted">${t.imageMatch.reason}</span>`] as [string, Html]]
        : []),
    ]),
  });
}

/** Close Ticket, or why it can't be closed yet. */
function closeControl(t: TicketView): Html {
  const openJobs = t.jobs.filter(isOpen).length;
  if (t.status !== 'open') return badge('Closed', 'success');
  if (openJobs === 0) {
    return html`<div id="close-ticket">
      ${postButton(`/tickets/${t.ticketId}/close`, 'Close Ticket', { confirm: 'Close this Ticket? The Tenant and Property Owner will be told.' })}
    </div>`;
  }
  return html`<div id="close-ticket" class="flex flex-col items-start gap-1 sm:items-end">
    ${button('Close Ticket', { type: 'button', variant: 'secondary', size: 'sm', disabled: true })}
    <p class="text-xs text-muted">Close once every Job is done or cancelled (${openJobs} still open).</p>
  </div>`;
}

function frequentIssues(t: TicketView): string {
  if (!t.frequentIssues.length) return 'None yet';
  return t.frequentIssues.map((f) => `${humanise(f.trade)} (${f.tickets} ${plural(f.tickets, 'Ticket')})`).join(', ');
}

/** Change Urgency, folded into a small menu beside Share and Close Ticket while the Ticket is open. */
function urgencyMenu(t: TicketView): Html {
  if (t.status !== 'open') return nothing;
  const options = [
    { value: 'high', label: 'High' },
    { value: 'routine', label: 'Routine' },
  ];
  return html`<details class="ticket-menu" data-menu>
    <summary class="btn btn-outline btn-sm">Change Urgency</summary>
    <div class="ticket-menu-panel">
      <form method="post" action="/tickets/${t.ticketId}/urgency" class="space-y-3">
        ${field({ label: 'Urgency', name: 'urgency', type: 'select', value: t.urgency, options, hint: 'Urgent issues never become Tickets.' })}
        ${button('Save Urgency', { size: 'sm', block: true })}
      </form>
    </div>
  </details>`;
}

/** The photos the Tenant sent first, each with what its metadata check said, then their guided answers. */
function reportCard(t: TicketView): Html {
  const a = t.answers;
  const photos = t.photos.length
    ? photoGrid(t.photos.map((p) => ({ src: `/files/${p.fileId}`, caption: photoCaption(p) })))
    : html`<p class="text-sm text-muted">${t.noPhotos ? 'No photos arrived within 48 hours.' : 'No photos.'}</p>`;
  return card({
    title: 'What the Tenant reported',
    body: html`<div class="space-y-4">
      ${photos}
      ${dl([
        ['Where', a.location ?? '—'],
        ['Started', a.started ?? '—'],
        ['Getting worse', a.worsening ? humanise(a.worsening) : '—'],
        ['Usually home', a.availability ? AVAILABILITY_LABELS[a.availability] : '—'],
      ])}
    </div>`,
  });
}

function photoCaption(p: Photo): Html {
  if (p.metadata === 'flagged') return html`${badge('Flagged', 'warning')} ${p.reasons.map((r) => PHOTO_FLAG[r] ?? humanise(r)).join(', ')}`;
  return p.metadata === 'ok' ? badge('Metadata OK', 'success') : badge('No metadata');
}

/** One Job: where it is, the one next action, and the details below it. A cancelled Job is collapsed. */
function jobCard(t: TicketView, job: JobView, x: Extras): Html {
  if (job.status === 'cancelled') return cancelledJob(t, job, x);
  return card({
    id: `job-${job.jobId}`,
    title: jobLabel(t, job.jobId),
    actions: html`${statusBadge(job.status)} ${job.checkTrade ? badge('Check Trade', 'warning') : nothing}`,
    body: html`${jobSteps(job)}
      ${nextAction(t, job, x)}
      ${jobMore(t, job, x)}`,
  });
}

/** A cancelled Job stays on the record, closed until someone opens it. */
function cancelledJob(t: TicketView, job: JobView, x: Extras): Html {
  return html`<section class="section" id="job-${job.jobId}">
    <details>
      <summary class="section-head cursor-pointer">
        <h2 class="section-title">${jobLabel(t, job.jobId)}</h2>
        ${statusBadge(job.status)}
      </summary>
      <div class="section-body mt-3">
        <p>This Job was cancelled.</p>
        ${job.quoteRequests.length ? quoteRequestsSection(job, x) : nothing}
      </div>
    </details>
  </section>`;
}

/** Progress through the Job: Quoting, the Property Owner's approval when it needed one, Booked, Done. */
function jobSteps(job: JobView): Html {
  const approvalNeeded = job.approval !== null || job.status === 'awaiting_owner';
  const approved = job.status === 'approved' || job.status === 'scheduled' || job.status === 'done';
  const items = [
    { label: 'Quoting', done: job.status !== 'quoting' },
    ...(approvalNeeded ? [{ label: 'Property Owner approval', done: approved }] : []),
    { label: 'Booked', done: job.status === 'scheduled' || job.status === 'done' },
    { label: 'Done', done: job.status === 'done' },
  ];
  return steps(items, { horizontal: true });
}

/** The one thing to do next on the Job, by its status. */
function nextAction(t: TicketView, job: JobView, x: Extras): Html {
  switch (job.status) {
    case 'quoting':
      return quotingAction(t, job, x);
    case 'awaiting_owner':
      return job.approval ? approvalSection(t, job, job.approval, x) : nothing;
    case 'approved':
      return job.workOrder ? workOrderDetails(t, job.workOrder, x) : workOrderForm(t, job, x);
    case 'scheduled':
      return job.workOrder ? workOrderDetails(t, job.workOrder, x) : nothing;
    case 'done':
      return ratingSection(t, job);
    default:
      return nothing;
  }
}

/**
 * While quoting: the Trade if the intake agent wasn't sure, the Quotes compared
 * side by side, who has been asked and who hasn't replied, then the Tradies to ask
 * (folded away once the first round has gone).
 */
function quotingAction(t: TicketView, job: JobView, x: Extras): Html {
  const declined = job.approval?.status === 'declined';
  return html`<div class="space-y-6">
    ${declined ? alert('The Property Owner said NO. Choose another Quote.', 'warning') : nothing}
    ${job.checkTrade && !job.quoteRequests.length ? tradeForm(t, job) : nothing}
    ${job.quotes.length ? quotesSection(t, job, x) : nothing}
    ${job.quoteRequests.length ? quoteRequestsWaiting(job, x) : nothing}
    ${job.quoteRequests.length
      ? html`<details class="group" id="job-${job.jobId}-tradies">
          <summary class="cursor-pointer text-sm font-medium text-action">Ask more Tradies</summary>
          <div class="mt-3">${recommendationsSection(t, job, x)}</div>
        </details>`
      : html`<div id="job-${job.jobId}-tradies">${recommendationsSection(t, job, x)}</div>`}
  </div>`;
}

/** Secondary details, collapsed: the Trade, Quote Requests, Quotes and approval not in the main view, the finished Work Order, and cancelling. */
function jobMore(t: TicketView, job: JobView, x: Extras): Html {
  const quoting = job.status === 'quoting';
  const trade = quoting && !job.quoteRequests.length && !job.checkTrade ? tradeForm(t, job) : nothing;
  const requests = !quoting && job.quoteRequests.length ? quoteRequestsSection(job, x) : nothing;
  const quotes = !quoting && job.quotes.length ? quotesSection(t, job, x) : nothing;
  const approval = job.approval && job.status !== 'awaiting_owner' ? approvalSection(t, job, job.approval, x) : nothing;
  const workOrder = job.workOrder && job.status === 'done' ? workOrderDetails(t, job.workOrder, x) : nothing;
  const cancel = isOpen(job)
    ? postButton(`/tickets/${t.ticketId}/jobs/${job.jobId}/cancel`, 'Cancel Job', {
        variant: 'ghost',
        size: 'sm',
        confirm: `Cancel the ${jobLabel(t, job.jobId)}? Its Quote Requests close and any booked visit is freed.`,
      })
    : nothing;
  return html`<details class="group">
    <summary class="cursor-pointer text-sm font-medium text-action">More about this Job</summary>
    <div class="mt-3 space-y-6">
      ${trade} ${requests} ${quotes} ${approval} ${workOrder}
      <div>${cancel}</div>
    </div>
  </details>`;
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
  const rows = job.recommendations.map((r, i) => recommendationRow(job, r, i + 1, ticked.has(r.tradieId), x));
  return html`<section class="space-y-3">
    ${header}
    <p class="text-muted">
      Ranked by myEST8 rating, then Google rating, then median previous Quote.
      ${firstRound ? 'Send the first round to 3–4 Tradies; the top three are ticked.' : 'Invite more Tradies if the Job is short of Quotes.'}
    </p>
    <form method="post" action="/tickets/${t.ticketId}/jobs/${job.jobId}/quote-requests" class="space-y-3">
      ${compactTable(['Tradie', 'Rating', 'Google', 'Median Quote', 'Ask'], rows, `Recommended Tradies for the ${humanise(job.trade)} Job`)}
      ${anyLeft ? button('Send Quote Requests', { block: true }) : html`<p>Every recommended Tradie has been asked.</p>`}
    </form>
  </section>`;
}

/** A table with no minimum cell width, so a Tradie list fits the main column; it still scrolls inside its frame if it must. */
function compactTable(headers: string[], rows: Html[][], caption: string): Html {
  return html`<div class="table-frame">
    <table class="table table-sm">
      <caption class="sr-only">${caption}</caption>
      <thead>
        <tr>${headers.map((h) => html`<th scope="col">${h}</th>`)}</tr>
      </thead>
      <tbody>
        ${rows.map((row) => html`<tr class="align-top">${row.map((cell) => html`<td>${cell}</td>`)}</tr>`)}
      </tbody>
    </table>
  </div>`;
}

/** One recommended Tradie as a table row. The two ratings sit in their own columns, never combined; bookings sit under the name. */
function recommendationRow(job: JobView, r: Recommendation, rank: number, ticked: boolean, x: Extras): Html[] {
  const id = `job-${job.jobId}-tradie-${r.tradieId}`;
  return [
    html`<div class="space-y-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label for="${id}" class="font-semibold">${rank}. ${r.businessName}</label>
        ${r.requested ? badge('Already asked', 'info') : nothing}
        <a class="link text-xs" href="/tradies/${r.tradieId}">Profile</a>
      </div>
      ${r.bookings.length
        ? html`<ul role="list" class="text-xs text-muted">
            ${r.bookings.map((b) => html`<li>Booked ${formatRange(b.start, b.end, x.timeZone)} by ${b.propertyManager}</li>`)}
          </ul>`
        : nothing}
    </div>`,
    html`<span class="num whitespace-nowrap">${myEst8Rating(r)}</span>`,
    html`<span class="whitespace-nowrap">${googleRating(r.googleRating)}</span>`,
    html`<span class="num">${
      r.medianQuoteCents === null ? 'No previous Quotes' : `Median Quote ${formatMoney(r.medianQuoteCents)} (${r.previousQuotes.length} previous)`
    }</span>`,
    html`<input
      type="checkbox"
      class="checkbox checkbox-sm"
      id="${id}"
      name="tradieIds"
      value="${r.tradieId}"
      ${ticked && !r.requested ? 'checked' : ''}
      ${r.requested ? 'disabled' : ''}
    />`,
  ];
}

function googleRating(g: Recommendation['googleRating']): string {
  if (!g) return 'Not on Google';
  if (g.rating === null) return 'Google: no rating yet';
  return `Google ${g.rating.toFixed(1)} (${g.reviewCount ?? 0} reviews)`;
}

function myEst8Rating(r: Recommendation): string {
  const { average, count } = r.myEst8Rating;
  return `myEST8 ${average.toFixed(1)} (${count} ${plural(count, 'rating')})`;
}

/** Every Quote Request on the Job, with when it went and what came back. */
function quoteRequestsSection(job: JobView, x: Extras): Html {
  const rows = job.quoteRequests.map((r) => [
    tradieLink(r.tradieId, r.businessName),
    html`${formatWhen(r.sentAt, x.timeZone)}`,
    statusBadge(r.status),
  ]);
  return html`<section class="space-y-3">${sectionHeader('Quote Requests')} ${table(['Tradie', 'Sent', 'Status'], rows)}</section>`;
}

const REPLY: Record<string, string> = {
  sent: 'No reply yet',
  reminded: 'No reply after a reminder',
  quoted: 'Quoted',
  declined: 'Declined',
  closed: 'Closed',
};

/** While quoting: who has been asked, who hasn't replied yet and how long ago they were asked. */
function quoteRequestsWaiting(job: JobView, x: Extras): Html {
  const waiting = job.quoteRequests.filter((r) => r.status === 'sent' || r.status === 'reminded').length;
  const quoted = job.quoteRequests.filter((r) => r.status === 'quoted').length;
  const asked = job.quoteRequests.length;
  return html`<section class="space-y-2" id="job-${job.jobId}-requests">
    ${sectionHeader('Quote Requests')}
    <p class="text-sm text-muted">${asked} asked: ${quoted} quoted, ${waiting} waiting on a reply.</p>
    <ul role="list" class="divide-y divide-line rounded-[4px] border border-line text-sm">
      ${job.quoteRequests.map((r) => {
        const open = r.status === 'sent' || r.status === 'reminded';
        return html`<li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
          ${tradieLink(r.tradieId, r.businessName)}
          <span class="${open ? '' : 'text-muted'}"
            >${REPLY[r.status] ?? humanise(r.status)}, <span class="text-muted"
              >asked <time datetime="${r.sentAt}" title="${formatWhen(r.sentAt, x.timeZone)}">${formatAge(r.sentAt, x.now)}</time></span
            ></span
          >
        </li>`;
      })}
    </ul>
  </section>`;
}

/**
 * The Job's Quotes compared: one column per Quote (Tradie, price, proposed time,
 * both ratings, whether it is confirmed) with its action at the foot. A Quote that
 * still needs checking folds its correct-and-confirm form under the column. On a
 * narrow screen each Quote is a compact block instead.
 */
function quotesSection(t: TicketView, job: JobView, x: Extras): Html {
  const confirmed = job.quotes.filter((q) => q.confirmed).length;
  const quoting = job.status === 'quoting';
  const unchecked = job.quotes.filter((q) => q.status === 'open' && !q.confirmed).length;
  const advice =
    confirmed < MIN_QUOTES
      ? 'myEST8 needs two confirmed Quotes before you choose one. To go ahead with fewer, record why.'
      : 'Compare them and choose one.';
  const ratings = new Map(job.recommendations.map((r) => [r.tradieId, r]));
  const showRatings = job.quotes.some((q) => ratings.has(q.tradieId));
  const rows = showRatings ? 6 : 5;
  return html`<section class="space-y-3" id="job-${job.jobId}-quotes">
    ${sectionHeader('Quotes')}
    ${quoting
      ? html`<p class="text-sm text-muted">
          ${confirmed} confirmed${unchecked ? `, ${unchecked} to check` : ''}. ${advice}
        </p>`
      : nothing}
    <div class="quote-compare-frame">
      <ul role="list" class="quote-compare" style="--quote-rows: ${rows}">
        ${job.quotes.map((q) => quoteColumn(t, job, q, confirmed, showRatings ? (ratings.get(q.tradieId) ?? null) : undefined, x))}
      </ul>
    </div>
  </section>`;
}

/** One Quote's column. `rating` is undefined when no Quote on the Job has ratings to show. */
function quoteColumn(t: TicketView, job: JobView, q: QuoteView, confirmed: number, rating: Recommendation | null | undefined, x: Extras): Html {
  const open = q.status === 'open';
  const cell = (label: string, value: Html | string) =>
    html`<div class="quote-cell"><span class="quote-label">${label}</span><span class="quote-value">${value}</span></div>`;
  const action =
    open && !q.confirmed
      ? confirmForm(t, q, x)
      : open && q.confirmed && job.status === 'quoting'
        ? chooseForm(t, q, confirmed)
        : open
          ? nothing
          : statusBadge(q.status);
  return html`<li class="quote-column ${q.status === 'approved' ? 'is-approved' : ''}">
    <div class="quote-tradie">${tradieLink(q.tradieId, q.businessName)}</div>
    <p class="quote-price num">${formatMoney(q.priceCents)}</p>
    ${cell('Proposed time', q.proposedTime ? formatWhen(q.proposedTime, x.timeZone) : 'None given')}
    ${rating === undefined
      ? nothing
      : cell(
          'Ratings',
          rating
            ? html`<span class="quote-ratings"><span class="num">${myEst8Rating(rating)}</span><span>${googleRating(rating.googleRating)}</span></span>`
            : '—',
        )}
    <div class="quote-state">
      ${q.confirmed ? badge('Confirmed', 'success') : badge('Needs checking', 'warning')}
      ${q.hasPdf ? badge('PDF attached', 'info') : nothing}
      ${q.reason ? html`<span class="block w-full text-sm">Chosen with one Quote: ${q.reason}</span>` : nothing}
    </div>
    <div class="quote-action">${action}</div>
  </li>`;
}

/** The fields read from the Tradie's reply, folded under "Check and confirm" until the Property Manager opens them. */
function confirmForm(t: TicketView, q: QuoteView, x: Extras): Html {
  return html`<details class="quote-check">
    <summary class="btn btn-primary btn-sm btn-block">Check and confirm</summary>
    <form method="post" action="/tickets/${t.ticketId}/quotes/${q.quoteId}/confirm" class="mt-3 space-y-2">
      <p class="text-xs text-muted">
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
    </form>
  </details>`;
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
  return html`<section class="space-y-3" id="job-${job.jobId}-approval">
    ${sectionHeader('Property Owner approval', statusBadge(approval.status))}
    <p>
      Asked ${formatWhen(approval.requestedAt, x.timeZone)} to approve ${quote ? `${quote.businessName}'s` : 'the'} Quote of
      ${formatMoney(quote?.priceCents ?? null)}, which takes the Repair Cost to ${formatMoney(repairCost)}, over the Max Repair Cost of
      ${formatMoney(t.maxRepairCostCents)}. The Property Owner replies YES or NO.
    </p>
    ${waiting
      ? html`<p class="text-muted">
          ${approval.status === 'reminded' ? 'Reminded after 24 hours.' : 'A reminder goes after 24 hours.'}
          You'll get an alert if there's no reply after 48 hours.
        </p>`
      : nothing}
  </section>`;
}

function workOrderForm(t: TicketView, job: JobView, x: Extras): Html {
  const approved = job.quotes.find((q) => q.status === 'approved');
  const free = x.freeSlots.get(job.jobId) ?? [];
  return html`<section class="space-y-3" id="job-${job.jobId}-work-order">
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
    variant: wo.rescheduleRequestedBy ? 'primary' : 'secondary',
    size: 'sm',
  });
  const tenant = wo.visitConfirmed
    ? badge('Confirmed the visit', 'success')
    : active
      ? badge('Not confirmed yet', 'warning')
      : html`—`;
  const asker = wo.rescheduleRequestedBy === 'tenant' ? 'Tenant' : 'Tradie';
  return html`<section class="space-y-3" id="job-${wo.jobId}-work-order">
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
  return html`<div class="space-y-3 rounded-[8px] bg-page p-3">
    <h3 class="font-semibold">New times</h3>
    <p class="text-muted">
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
  return html`<section class="space-y-3" id="job-${job.jobId}-rating">
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

/** The Ticket's history, in a collapsible side panel that starts open, with runs of like events told once. */
function timelineCard(t: TicketView, x: Extras): Html {
  const events = timelineGroups(t.timeline).map((group) => describeGroup(t, group, x));
  return collapsible('Timeline', events.length ? timeline(events) : emptyState('Nothing has happened yet.'));
}

/** Events that read as one line when they come one after another: "Quotes received from Drip Doctors and Pete's Plumbing". */
const GROUPED = new Set(['quote_requests_sent', 'quote_received', 'tradie_declined']);

/** The timeline in runs: consecutive events of a grouped kind, and a Quote chosen then approved straight away. */
function timelineGroups(events: TimelineEvent[]): TimelineEvent[][] {
  const groups: TimelineEvent[][] = [];
  for (const event of events) {
    const group = groups.at(-1);
    const first = group?.[0] as Record<string, unknown> | undefined;
    const d = event as Record<string, unknown>;
    const sameRun = first !== undefined && first.kind === event.kind && GROUPED.has(event.kind);
    const approvedOutright =
      group?.length === 1 && first?.kind === 'quote_chosen' && event.kind === 'quote_approved' && first.jobId === d.jobId && first.tradie === d.tradie;
    if (group && (sameRun || approvedOutright)) group.push(event);
    else groups.push([event]);
  }
  return groups;
}

/** A run of events in words, dated from its first to its last. */
function describeGroup(t: TicketView, group: TimelineEvent[], x: Extras): { at: string; title: string; detail?: string } {
  const first = group[0]!;
  const last = group.at(-1)!;
  const from = formatWhen(first.at, x.timeZone);
  const at = from === formatWhen(last.at, x.timeZone) ? from : formatRange(first.at, last.at, x.timeZone);
  if (group.length === 1) return { at, ...describeEvent(t, first, x) };
  const d = group as Record<string, unknown>[];
  if (last.kind === 'quote_approved') {
    const chosen = describeEvent(t, first, x);
    return { at, title: `Quote from ${String(d[0]!.tradie)} chosen and approved`, ...(chosen.detail ? { detail: chosen.detail } : {}) };
  }
  // Per Job, the Tradies each event names, when the Ticket has several Jobs.
  const tradiesOf = (e: Record<string, unknown>) => (Array.isArray(e.tradies) ? e.tradies.map(String) : typeof e.tradie === 'string' ? [e.tradie] : []);
  const names = d.flatMap(tradiesOf);
  const byJob = t.jobs.length > 1 ? jobLines(t, d, tradiesOf) : undefined;
  switch (first.kind) {
    case 'quote_requests_sent':
      return { at, title: `Quote Requests sent to ${names.length} Tradies`, detail: byJob ?? names.join(', ') };
    case 'quote_received':
      return byJob ? { at, title: `${names.length} Quotes received`, detail: byJob } : { at, title: `Quotes received from ${andList(names)}` };
    default:
      return byJob
        ? { at, title: `${names.length} Tradies declined their Quote Requests`, detail: byJob }
        : { at, title: `${andList(names)} declined their Quote Requests` };
  }
}

/** "Job 1: Plumbing: Drip Doctors, Pete's Plumbing", one line per Job, in the order the Jobs were added. */
function jobLines(t: TicketView, events: Record<string, unknown>[], tradiesOf: (e: Record<string, unknown>) => string[]): string {
  return t.jobs
    .map((job) => {
      const names = events.filter((e) => e.jobId === job.jobId).flatMap(tradiesOf);
      return names.length ? `${jobLabel(t, job.jobId)}: ${names.join(', ')}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/** A section whose heading opens and closes its body. */
function collapsible(title: string, body: Html): Html {
  return html`<section class="section">
    <details open>
      <summary class="section-head cursor-pointer">
        <h2 class="section-title">${title}</h2>
      </summary>
      <div class="section-body mt-3">${body}</div>
    </details>
  </section>`;
}

/** A timeline event in words, with the Tradie, price or visit it was about, and its Job when the Ticket has several. */
function describeEvent(t: TicketView, event: TimelineEvent, x: Extras): { title: string; detail?: string } {
  const d = event as Record<string, unknown>;
  const job = typeof d.jobId === 'number' && t.jobs.length > 1 ? jobLabel(t, d.jobId) : undefined;
  const tradie = typeof d.tradie === 'string' ? d.tradie : 'The Tradie';
  const price = typeof d.priceCents === 'number' ? formatMoney(d.priceCents) : undefined;
  const visit = typeof d.visitStart === 'string' && typeof d.visitEnd === 'string' ? formatRange(d.visitStart, d.visitEnd, x.timeZone) : undefined;
  // One fact per line.
  const details = (...parts: (string | undefined)[]) => parts.filter(Boolean).join('\n') || undefined;
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

/** How many of the latest messages show before "Show all". */
const LATEST_MESSAGES = 6;

/**
 * The message log, as a collapsible side panel, with the mark-read control when
 * something is unread. The latest few show; the older ones open above them, and
 * start open when one of them is unread.
 */
function messagesCard(t: TicketView, x: Extras): Html {
  const unread = t.messages.filter((m) => m.unread).length;
  const read = unread ? postButton(`/tickets/${t.ticketId}/read`, 'Mark messages read', { variant: 'secondary', size: 'sm' }) : nothing;
  const older = t.messages.slice(0, -LATEST_MESSAGES);
  const latest = t.messages.slice(-LATEST_MESSAGES);
  const log = t.messages.length
    ? html`${older.length
          ? html`<details class="ticket-older" ${older.some((m) => m.unread) ? 'open' : ''}>
              <summary class="cursor-pointer text-sm font-medium text-action">Show all ${t.messages.length} messages</summary>
              <div>${older.map((m) => messageBubble(m, x))}</div>
            </details>`
          : nothing}
        <div>${latest.map((m) => messageBubble(m, x))}</div>`
    : emptyState('No messages yet.');
  return collapsible(unread ? `Messages (${unread} unread)` : 'Messages', html`${read} ${log}`);
}

/** Inbound messages on the left, what myEST8 sent on the right; unread ones stand out. */
function messageBubble(m: Message, x: Extras): Html {
  const subject = m.template ? html`: <span class="font-medium">${templateSubject(m.template)}</span>` : nothing;
  return chatBubble({
    side: m.direction === 'in' ? 'start' : 'end',
    header: html`${m.direction === 'in' ? 'From' : 'To'} ${m.address} by ${CHANNELS[m.channel]}${subject}`,
    text: shortLinks(m.text),
    footer: html`${formatWhen(m.at, x.timeZone)}${m.unread ? html` ${badge('Unread', 'warning')}` : nothing}${m.deliveryError ? html` ${badge(m.deliveryError, 'error')}` : nothing}`,
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
    parts.push(html`<a class="link" href="${match[0]}" title="${match[0]}" target="_blank" rel="noopener noreferrer">${linkName(match[0])}</a>`);
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
    return `${hostname} link`;
  } catch {
    return 'link';
  }
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

function plural(n: number, word: string, many = `${word}s`) {
  return n === 1 ? word : many;
}

/** "A", "A and B", "A, B and C". */
function andList(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
