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
  aiFilled,
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
  jobStageLabel,
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
type RequestView = JobView['quoteRequests'][number];
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
        shell: await shellInfo(c),
        pm,
        active: 'tickets',
        flash,
        body: ticketBody(ticket, extras, shareButton({
          title: `Ticket #${ticket.ticketId}: ${ticket.description}`,
          text: `Ticket #${ticket.ticketId} at ${ticket.propertyAddress}: ${ticket.description}`,
          url: shareUrl(c, `/tickets/${ticket.ticketId}`),
          note: COLLEAGUES_ONLY,
        })),
      }),
    );
  });

  onPost(pages, '/:id/urgency', async ({ actions, ticket, form }) => {
    const urgency = text(form, 'urgency') as Urgency;
    await actions.changeUrgency({ ticketId: ticket.ticketId }, urgency);
    return `Urgency changed to ${humanise(urgency)}`;
  });

  onPost(pages, '/:id/summary', async ({ actions, ticket, form }) => {
    await actions.editSummary({ ticketId: ticket.ticketId }, text(form, 'summary'));
    return 'Summary saved';
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

  onPost(pages, '/:id/quotes/:quoteId/proceed', async ({ actions, ticket, form, params }) => {
    const { quote } = quoteIn(ticket, params.quoteId);
    await actions.proceedOnEstimate(quote.quoteId, {
      capCents: cents(form, 'cap', 'the Not-to-exceed Cap'),
      ...(text(form, 'reason') ? { reason: text(form, 'reason') } : {}),
      confirm: text(form, 'confirm') === 'yes',
    });
    const chosen = quoteIn(await actions.ticket(ticket.ticketId), params.quoteId).quote;
    return chosen.status === 'awaiting_owner'
      ? `Proceeding on ${chosen.businessName}'s Estimate. Its Not-to-exceed Cap takes the Repair Cost over the Max Repair Cost, so the Property Owner has been asked to approve it.`
      : `Proceeding on ${chosen.businessName}'s Estimate, capped at ${formatMoney(chosen.notToExceedCents)}`;
  });

  // Site Inspections, one Tradie at a time. Booking fields: `start` (a local date and time) and `minutes` (default 60).
  onPost(pages, '/:id/quote-requests/:quoteRequestId/inspection', async ({ actions, ticket, form, params, timeZone }) => {
    const request = requestIn(ticket, params.quoteRequestId);
    const start = text(form, 'start');
    if (!start) throw new ActionError('invalid', 'Pick a time for the Site Inspection');
    const minutes = text(form, 'minutes') ? int(form, 'minutes', 'the visit length') : undefined;
    await actions.bookInspection(request.quoteRequestId, { start: localToIso(start, timeZone), ...(minutes ? { durationMinutes: minutes } : {}) });
    return `Site Inspection booked with ${request.businessName}. They and the Tenant have been told.`;
  });

  onPost(pages, '/:id/quote-requests/:quoteRequestId/inspection-needed', async ({ actions, ticket, form, params }) => {
    const request = requestIn(ticket, params.quoteRequestId);
    const needed = text(form, 'needed') === 'yes';
    await actions.setInspectionNeeded(request.quoteRequestId, needed);
    return needed
      ? `${request.businessName} will give a Firm Quote after a Site Inspection`
      : `${request.businessName} can give a Firm Quote without a Site Inspection`;
  });

  onPost(pages, '/:id/work-orders/:workOrderId/inspected', async ({ actions, ticket, params }) => {
    const id = Number(params.workOrderId);
    const visit = ticket.jobs.flatMap((j) => j.inspections.visits).find((v) => v.workOrderId === id) ?? notFound('Work Order');
    await actions.markInspected(visit.workOrderId);
    return `${visit.businessName}'s Site Inspection marked done. They have been asked for their Firm Quote.`;
  });

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

function requestIn(ticket: TicketView, raw: string | undefined): RequestView {
  return ticket.jobs.flatMap((j) => j.quoteRequests).find((r) => r.quoteRequestId === Number(raw)) ?? notFound('Quote Request');
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
 * The header, the stage tracker and the Next block first; then the Jobs (where the
 * next action is) with the timeline under them in the main column, and what the
 * Tenant reported, the Ticket's details and the messages beside them. On phones it is
 * one column: the Jobs, what the Tenant reported, the details, the timeline, the
 * messages. `share` is the Share button, which sits in the header with the Ticket's
 * other tools.
 */
function ticketBody(t: TicketView, x: Extras, share: Html): Html {
  return html`${ticketHeader(t, x, share)} ${stageTracker(t, x)} ${nextStepLine(t, x)}
    <div class="ticket-layout">
      <div class="ticket-main">
        <div class="ticket-jobs">
          ${t.jobs.map((job) => jobCard(t, job, x))}
          ${jobsFoot(t)}
        </div>
        <div class="ticket-history">${timelineCard(t, x)}</div>
      </div>
      <div class="ticket-side">
        <div class="ticket-report">${reportCard(t)} ${detailsCard(t)}</div>
        <div class="ticket-messages">${messagesCard(t, x)}</div>
      </div>
    </div>`;
}

/**
 * The Ticket's header, hand-built in the docket's large shape (the number at 40px and
 * Urgency in the stub, a dashed perforation) because it reads the Summary first, with
 * the address linked under it: then the Tenant, status, age, Repair Cost (once there
 * is one) and Max Repair Cost in one line. Share, Change Urgency and Close Ticket
 * (once it can work) sit at its top right from 1024px and under the facts on phones.
 */
function ticketHeader(t: TicketView, x: Extras, share: Html): Html {
  const overMax = t.repairCostCents > t.maxRepairCostCents;
  const stub = t.urgency === 'high' ? 'bg-high-bg text-high' : 'bg-page text-ink';
  return html`<header class="ticket-head">
    <div class="ticket-stub ${stub}">
      <span class="ticket-number num">#${t.ticketId}</span>
      <span class="ticket-urgency">${humanise(t.urgency)}<span class="sr-only"> Urgency</span></span>
    </div>
    <div aria-hidden="true" class="ticket-perf"></div>
    <div class="ticket-head-body">
      <div class="ticket-head-main">
        ${summaryBlock(t)}
        <p class="ticket-address"><a class="link" href="/properties/${t.propertyId}">${t.propertyAddress}</a></p>
        <p class="ticket-meta">
          <span>Tenant ${t.tenantName}</span>
          <span>${statusBadge(t.status)}</span>
          <time datetime="${t.reportedAt}">${reportedAgo(t.reportedAt, x.now)}</time>
          ${t.repairCostCents > 0
            ? html`<span class="num ${overMax ? 'text-high' : 'text-ink'}">Repair Cost <strong>${formatMoney(t.repairCostCents)}</strong>${overMax ? ", over the Max Repair Cost with the Property Owner's approval" : ''}</span>`
            : nothing}
          <span class="num">Max Repair Cost ${formatMoney(t.maxRepairCostCents)}</span>
          ${t.checkUrgency ? html`<span class="flex items-center gap-2">${badge('Check urgency', 'warning')} The intake agent wasn't sure.</span>` : nothing}
        </p>
      </div>
      <div class="ticket-tools">${share}${urgencyMenu(t)}${closeControl(t)}</div>
    </div>
  </header>`;
}

/** The Summary (else the Tenant's words), on the AI tint when AI wrote it, with a small form to edit it. */
function summaryBlock(t: TicketView): Html {
  const words = t.summary ?? t.description;
  const edit = t.status === 'open'
    ? html`<details class="ticket-summary-edit">
        <summary class="btn btn-ghost btn-sm" aria-label="Edit the Summary">Edit</summary>
        <form method="post" action="/tickets/${t.ticketId}/summary" class="space-y-2">
          ${field({ id: 'ticket-summary', label: 'Summary', name: 'summary', type: 'textarea', rows: 2, value: words, required: true, hint: 'One line, 160 characters at most.' })}
          ${button('Save Summary', { size: 'sm' })}
        </form>
      </details>`
    : nothing;
  const issue = html`<h2 class="ticket-issue">${words}</h2>`;
  return t.summaryBy === 'ai'
    ? aiFilled(issue, { edit })
    : html`<div class="ticket-summary">${issue}${edit}</div>`;
}

type NextStep = { text: string; href: string; decision: boolean; job?: JobView };

/**
 * The one thing to do next on the Ticket: the first Job waiting on the Property
 * Manager's decision, else the first Job waiting on someone else, else closing.
 * A decision gets the Wattle bar.
 */
function nextStepLine(t: TicketView, x: Extras): Html {
  const step = nextStep(t, x);
  if (!step) return nothing;
  const job = step.job && t.jobs.length > 1 ? html` <span class="text-sm text-muted">${jobLabel(t, step.job.jobId)}</span>` : nothing;
  return html`<p class="ticket-next ${step.decision ? 'is-decision' : ''}" data-next-step>
    <span class="ticket-next-label">Next</span>
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

/** What a Job waits on, and whether that is the Property Manager. Quoting Jobs follow `decision`. */
function jobStep(t: TicketView, job: JobView, x: Extras): NextStep | null {
  const at = (section: string) => `#job-${job.jobId}-${section}`;
  const decide = (text: string, section: string): NextStep => ({ text, href: at(section), decision: true, job });
  const wait = (text: string, section: string): NextStep => ({ text, href: at(section), decision: false, job });
  switch (job.status) {
    case 'quoting': {
      const open = job.quotes.filter((q) => q.status === 'open');
      const unchecked = open.filter((q) => !q.confirmed);
      const firm = open.filter((q) => q.confirmed && q.stage === 'firm');
      const waiting = job.quoteRequests.filter((r) => r.status === 'sent' || r.status === 'reminded');
      const forFirm = job.quoteRequests.filter((r) => r.status === 'inspected' || (r.status === 'estimated' && !r.inspectionNeeded));
      const booked = job.quoteRequests.filter((r) => r.status === 'inspection_booked');
      if (job.decision === 'check_quotes' && unchecked.length) {
        const names = andList(unchecked.map((q) => q.businessName));
        return decide(`Check ${unchecked.length} ${plural(unchecked.length, 'Quote')} from ${names}`, 'quotes');
      }
      if (job.decision === 'book_inspection') {
        const names = andList(job.quoteRequests.filter((r) => r.status === 'estimated' && r.inspectionNeeded).map((r) => r.businessName));
        return decide(`Book a Site Inspection with ${names}`, 'inspections');
      }
      if (job.decision === 'choose_quote') return decide(`Choose a Firm Quote: ${firm.length} in`, 'quotes');
      if (!job.quoteRequests.length) return decide(job.checkTrade ? 'Check the Trade, then send Quote Requests' : 'Send Quote Requests', 'tradies');
      if (waiting.length) {
        const oldest = waiting.reduce((a, b) => (a.sentAt < b.sentAt ? a : b));
        const names = andList(waiting.map((r) => r.businessName));
        return wait(`Waiting on ${plural(waiting.length, 'an Estimate', 'Estimates')} from ${names}, asked ${formatAge(oldest.sentAt, x.now)}`, 'requests');
      }
      if (booked.length) return wait(`Waiting on the Site ${plural(booked.length, 'Inspection')} with ${andList(booked.map((r) => r.businessName))}`, 'inspections');
      if (forFirm.length) return wait(`Waiting on ${plural(forFirm.length, 'a Firm Quote', 'Firm Quotes')} from ${andList(forFirm.map((r) => r.businessName))}`, 'quotes');
      if (firm.length === 1) return decide(`Choose ${firm[0]!.businessName}'s Firm Quote with a reason, or ask more Tradies`, 'quotes');
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
      return lastEvent(t, 'tradie_rated', job.jobId) ? null : decide(`Rate the Tradie: ${job.workOrder?.businessName ?? 'how did they do'}`, 'rating');
    default:
      return null;
  }
}

/**
 * Where the Ticket stands across the top: Quoting (Site Inspections included), With
 * Property Owner, Ready to book, Booked, Done. It
 * follows the Job the Next block is about, named when the Ticket has several.
 */
function stageTracker(t: TicketView, x: Extras): Html {
  const live = t.jobs.filter((j) => j.status !== 'cancelled');
  const job = nextStep(t, x)?.job ?? live.find(isOpen) ?? live.at(-1);
  if (!job) return nothing;
  const order = ['quoting', 'awaiting_owner', 'approved', 'scheduled', 'done'];
  const current = order.indexOf(job.status);
  const items = order.map((status, i) => ({ label: jobStageLabel(status), done: job.status === 'done' || i < current }));
  const name = t.jobs.length > 1 ? html`<p class="ticket-stages-job">${jobLabel(t, job.jobId)}</p>` : nothing;
  return html`<nav class="ticket-stages" aria-label="Where the Ticket stands">${name}${steps(items, { horizontal: true, ...(job.status === 'done' ? {} : { current }) })}</nav>`;
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
    body: facts([
      ['Property Manager', t.propertyManager],
      ['Frequent issues here', frequentIssues(t)],
      ...(t.imageMatch
        ? [['Photo check', html`${badge(humanise(t.imageMatch.result), t.imageMatch.result === 'matches' ? 'success' : 'warning')} <span class="text-muted">${t.imageMatch.reason}</span>`] as [string, Html]]
        : []),
    ]),
  });
}

/** Close Ticket, offered once every Job is done or cancelled. */
function closeControl(t: TicketView): Html {
  if (t.status !== 'open' || t.jobs.some(isOpen)) return nothing;
  return html`<div id="close-ticket">
    ${postButton(`/tickets/${t.ticketId}/close`, 'Close Ticket', { size: 'sm', confirm: 'Close this Ticket? The Tenant and Property Owner will be told.' })}
  </div>`;
}

/**
 * Under the Jobs while the Ticket is open: another Job, folded away, and while a Job
 * is open, when the Ticket can be closed.
 */
function jobsFoot(t: TicketView): Html {
  if (t.status !== 'open') return nothing;
  const openJobs = t.jobs.filter(isOpen).length;
  return html`<div class="ticket-jobs-foot">
    <details class="ticket-add-job">
      <summary>Add another Job</summary>
      <form method="post" action="/tickets/${t.ticketId}/jobs" class="ticket-inline-form">
        <div class="min-w-48 flex-1">
          ${field({ label: 'Trade', name: 'trade', type: 'select', options: tradeOptions(), hint: 'When the issue needs another Trade as well.' })}
        </div>
        ${button('Add Job', { variant: 'secondary' })}
      </form>
    </details>
    ${openJobs ? html`<p class="ticket-close-hint">Close once every Job is done or cancelled (${openJobs} still open).</p>` : nothing}
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
      ${facts([
        ...(t.summary ? [["The Tenant's words", t.description] as [string, string]] : []),
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
    actions: html`${statusBadge(job.status, { job: true })} ${job.checkTrade ? badge('Check trade', 'warning') : nothing}`,
    body: html`${nextAction(t, job, x)}
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
    ${inspectionsSection(t, job, x)}
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
  const trade = job.status === 'quoting' && !job.quoteRequests.length && !job.checkTrade ? tradeForm(t, job) : nothing;
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
  return html`<form method="post" action="/tickets/${t.ticketId}/jobs/${job.jobId}/trade" class="ticket-inline-form">
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
  const ticked = new Set(job.recommendations.filter((r) => r.preselected).map((r) => r.tradieId));
  const rule = job.requestRule;
  const anyLeft = job.recommendations.some((r) => !r.requested);
  const rows = job.recommendations.map((r, i) => recommendationRow(job, r, i + 1, ticked.has(r.tradieId), x));
  return html`<section class="space-y-3">
    ${header}
    <p class="text-muted">
      Ranked by myEST8 rating, then Google rating, then median previous Quote.
      ${firstRound ? 'Send the first round to three or four Tradies; the top three are ticked.' : 'Invite more Tradies if the Job is short of Quotes.'}
    </p>
    ${rule?.singleReason ? alert(rule.singleReason, 'info') : (rule?.minimum ?? MIN_QUOTES) > 1
      ? html`<p class="text-sm text-muted">Send Quote Requests to at least ${rule?.minimum === 3 ? 'three' : 'two'} Tradies.</p>`
      : nothing}
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
        ${r.nominated ? badge('Nominated', 'success') : nothing}
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
  estimated: 'Estimate in',
  inspection_booked: 'Site Inspection booked',
  inspected: 'Inspected, Firm Quote to come',
  firm_quoted: 'Firm Quote in',
  declined: 'Declined',
  closed: 'Closed',
};

/**
 * Every Quote Request on the Job while it is getting Quotes: how many were asked and
 * have given an Estimate, then each Tradie with how their request stands and how long
 * ago they were asked. Each moves on its own.
 */
function quoteRequestsWaiting(job: JobView, x: Extras): Html {
  const waiting = job.quoteRequests.filter((r) => r.status === 'sent' || r.status === 'reminded').length;
  const estimated = job.quoteRequests.filter((r) => r.estimate !== null).length;
  const asked = job.quoteRequests.length;
  return html`<section class="space-y-2" id="job-${job.jobId}-requests">
    ${sectionHeader('Quote Requests')}
    <p class="text-sm text-muted">${asked} asked: ${estimated} gave an Estimate, ${waiting} waiting on a reply.</p>
    <ul role="list" class="divide-y divide-line rounded-[4px] border border-line text-sm">
      ${job.quoteRequests.map((r) => {
        const live = r.status !== 'declined' && r.status !== 'closed';
        return html`<li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
          ${tradieLink(r.tradieId, r.businessName)}
          <span class="${live ? '' : 'text-muted'}"
            >${REPLY[r.status] ?? humanise(r.status)}, <span class="text-muted"
              >asked <time datetime="${r.sentAt}" title="${formatWhen(r.sentAt, x.timeZone)}">${formatAge(r.sentAt, x.now)}</time></span
            ></span
          >
        </li>`;
      })}
    </ul>
  </section>`;
}

function ratingsCell(q: QuoteView): Html {
  return html`<span class="num">myEST8 ${q.myEst8Rating.average.toFixed(1)}<br />${q.googleRating ? (q.googleRating.rating === null ? 'Google no rating' : `Google ${q.googleRating.rating.toFixed(1)}`) : 'Not on Google'}</span>`;
}

function quoteTradieCell(q: QuoteView): Html {
  return html`<div class="space-y-1">
    <div>${tradieLink(q.tradieId, q.businessName)}${q.hasPdf ? html` <span class="text-xs text-muted">PDF attached</span>` : nothing}</div>
    <div class="flex flex-wrap gap-1">${q.confirmed ? badge('Confirmed', 'success') : badge('Needs checking', 'warning')}</div>
    ${q.reason ? html`<p class="text-sm">Gone ahead with one Quote: ${q.reason}</p>` : nothing}
  </div>`;
}

/**
 * The Job's Quotes in two tables that are never merged: Firm Quotes (fixed prices for a
 * defined scope, the ones to choose from) and Estimates (ballparks, each saying whether
 * the Tradie needs a Site Inspection). An Estimate a Firm Quote superseded stays, marked.
 * A Quote that still needs checking folds its correct-and-confirm form into its action.
 */
function quotesSection(t: TicketView, job: JobView, x: Extras): Html {
  const getting = job.status === 'quoting';
  const firm = job.quotes.filter((q) => q.stage === 'firm');
  const estimates = job.quotes.filter((q) => q.stage === 'estimate');
  const firmIn = firm.filter((q) => q.confirmed).length;
  const unchecked = job.quotes.filter((q) => q.status === 'open' && !q.confirmed).length;
  const advice =
    firmIn < MIN_QUOTES
      ? 'myEST8 needs two Firm Quotes before you choose one. To go ahead with fewer, record why.'
      : 'Compare the Firm Quotes and choose one.';
  const firmTable = firm.length
    ? html`<h3 class="font-semibold">Firm Quotes</h3>
        ${table(
          ['Tradie', 'Price', 'Scope of work', 'Takes', 'Can start', 'Proposed time', 'Ratings', 'Action'],
          firm.map((q) => [
            quoteTradieCell(q),
            html`<span class="num font-semibold">${formatMoney(q.priceCents)}</span>`,
            html`${q.scopeOfWork ?? 'Not given'}`,
            html`${q.durationDays ? `${q.durationDays} ${plural(q.durationDays, 'day')}` : 'Not given'}`,
            html`${q.availableDates.length ? q.availableDates.map(formatDate).join(', ') : 'Not given'}`,
            html`${q.proposedTime ? formatWhen(q.proposedTime, x.timeZone) : 'None given'}`,
            ratingsCell(q),
            quoteAction(t, job, q, firmIn, x),
          ]),
          { caption: `Firm Quotes for the ${humanise(job.trade)} Job`, rowHeader: true, stack: 'labelled', align: ['left', 'right'] },
        )}`
    : nothing;
  const estimateTable = estimates.length
    ? html`<h3 class="font-semibold">Estimates</h3>
        <p class="text-sm text-muted">Ballparks from the description and photos. Not binding, and not compared with Firm Quotes.</p>
        ${table(
          ['Tradie', 'Estimate', 'Site Inspection', 'Proposed time', 'Ratings', 'Action'],
          estimates.map((q) => {
            const request = job.quoteRequests.find((r) => r.quoteRequestId === q.quoteRequestId);
            return [
              quoteTradieCell(q),
              html`<span class="num">${formatMoney(q.priceCents)}</span>`,
              inspectionCell(t, q, request),
              html`${q.proposedTime ? formatWhen(q.proposedTime, x.timeZone) : 'None given'}`,
              ratingsCell(q),
              quoteAction(t, job, q, firmIn, x),
            ];
          }),
          { caption: `Estimates for the ${humanise(job.trade)} Job`, rowHeader: true, stack: 'labelled', align: ['left', 'right'] },
        )}`
    : nothing;
  return html`<section class="space-y-3" id="job-${job.jobId}-quotes">
    ${sectionHeader('Quotes')}
    ${getting
      ? html`<p class="text-sm text-muted">${firmIn} ${plural(firmIn, 'Firm Quote')}, ${estimates.length} ${plural(estimates.length, 'Estimate')}${unchecked ? `, ${unchecked} to check` : ''}. ${advice}</p>`
      : nothing}
    ${firmTable} ${estimateTable}
  </section>`;
}

/** Whether the Tradie needs a Site Inspection (with the Call-out Fee), and the Property Manager's override while it can change. */
function inspectionCell(t: TicketView, q: QuoteView, request: RequestView | undefined): Html {
  const needed = request?.inspectionNeeded ?? !!q.needsInspection;
  const fee = q.calloutFeeCents ? ` (Call-out Fee ${formatMoney(q.calloutFeeCents)})` : '';
  const words = needed ? `Needed${fee}` : 'Not needed';
  const overridden = request?.inspectionOverride !== null && request?.inspectionOverride !== undefined;
  const toggle = request && request.status === 'estimated' && q.status === 'open'
    ? postButton(`/tickets/${t.ticketId}/quote-requests/${request.quoteRequestId}/inspection-needed`, needed ? 'Not needed' : 'Ask for one', {
        variant: 'ghost',
        size: 'sm',
        fields: { needed: needed ? 'no' : 'yes' },
      })
    : nothing;
  return html`<span>${words}${overridden ? html` <span class="text-xs text-muted">(set by you)</span>` : nothing}</span> ${toggle}`;
}

/** What can be done to one Quote: check it, choose a Firm Quote, proceed on an Estimate, or nothing (its status says where it stands). */
function quoteAction(t: TicketView, job: JobView, q: QuoteView, firmIn: number, x: Extras): Html {
  const open = q.status === 'open';
  if (open && !q.confirmed) return confirmForm(t, q, x);
  if (open && job.status === 'quoting' && q.stage === 'firm') return chooseForm(t, q, firmIn);
  const request = job.quoteRequests.find((r) => r.quoteRequestId === q.quoteRequestId);
  if (open && q.stage === 'estimate' && request?.canProceedOnEstimate) return proceedForm(t, job, q, request);
  if (q.status === 'approved' && q.notToExceedCents !== null) return html`${statusBadge(q.status)} <span class="text-sm">Capped at ${formatMoney(q.notToExceedCents)}</span>`;
  return open ? nothing : statusBadge(q.status);
}

/** Proceed on an Estimate with a Not-to-exceed Cap, folded away: for a cheap routine Job, instead of waiting for Firm Quotes. */
function proceedForm(t: TicketView, job: JobView, q: QuoteView, request: RequestView): Html {
  const estimates = job.quoteRequests.filter((r) => r.estimate?.confirmed).length;
  return html`<details class="quote-check">
    <summary class="btn btn-outline btn-sm btn-block">Proceed on Estimate</summary>
    <form method="post" action="/tickets/${t.ticketId}/quotes/${q.quoteId}/proceed" class="mt-3 space-y-2">
      <p class="text-xs text-muted">The Tradie may charge up to the Not-to-exceed Cap, which counts towards the Repair Cost.</p>
      ${field({ id: `quote-${q.quoteId}-cap`, label: 'Not-to-exceed Cap ($)', name: 'cap', value: q.priceCents === null ? '' : (q.priceCents / 100).toFixed(2), required: true })}
      ${estimates < MIN_QUOTES ? field({ id: `quote-${q.quoteId}-proceed-reason`, label: 'Why go ahead with one Estimate?', name: 'reason', type: 'textarea', rows: 2 }) : nothing}
      ${request.proceedNeedsConfirm
        ? html`<label class="flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox checkbox-sm" name="confirm" value="yes" /> This Ticket isn't Routine. Go ahead anyway.</label>`
        : nothing}
      ${button('Proceed on this Estimate', { size: 'sm', block: true })}
    </form>
  </details>`;
}

const VISIT_WORDS: Record<string, string> = {
  confirmed: 'Confirmed',
  not_confirmed: 'Not confirmed yet',
  reschedule_requested: 'Asked for another time',
  done: 'Done',
};

/**
 * Site Inspections, per Tradie: each booked one with its state and Mark done, then a
 * booking form for each Tradie who needs one and hasn't got it, prefilled with their
 * first free slot. A Tradie who doesn't need one never shows here.
 */
function inspectionsSection(t: TicketView, job: JobView, x: Extras): Html {
  const { visits, slots } = job.inspections;
  if (!visits.length && !slots.length) return nothing;
  const rows = visits.map((v) => {
    const done = v.visit === 'done';
    return html`<li class="site-visit">
      <div class="site-visit-who">${tradieLink(v.tradieId, v.businessName)} ${badge('Site inspection', 'neutral', { outline: true })}</div>
      <div class="site-visit-when">${formatRange(v.start, v.end, x.timeZone)}</div>
      <div class="site-visit-state">${badge(VISIT_WORDS[v.visit] ?? humanise(v.visit), done ? 'success' : v.visit === 'reschedule_requested' ? 'warning' : 'neutral')}</div>
      <div class="site-visit-action">
        ${done ? nothing : postButton(`/tickets/${t.ticketId}/work-orders/${v.workOrderId}/inspected`, 'Mark done', { variant: 'secondary', size: 'sm' })}
      </div>
    </li>`;
  });
  const forms = slots.map((s) => {
    const id = `request-${s.quoteRequestId}-inspection`;
    return html`<form method="post" action="/tickets/${t.ticketId}/quote-requests/${s.quoteRequestId}/inspection" class="site-form-row">
      <div class="site-form-field">
        ${field({
          id,
          label: `${s.businessName} needs a Site Inspection`,
          name: 'start',
          type: 'datetime-local',
          value: s.slots[0] ? isoToLocal(s.slots[0].start, x.timeZone) : '',
          required: true,
          hint: s.slots.length ? `${x.timeZone} time, one hour.` : 'No free time found in the next 14 days. Pick one.',
        })}
      </div>
      ${s.slots.length > 1
        ? html`<div class="site-form-slots" role="group" aria-label="Other times for ${s.businessName}">
            <span class="text-sm text-muted">Other times:</span>
            ${s.slots.slice(1).map((slot) => html`<button type="button" class="btn btn-outline btn-sm" data-fill="${id}" data-value="${isoToLocal(slot.start, x.timeZone)}">${formatWhen(slot.start, x.timeZone)}</button>`)}
          </div>`
        : nothing}
      ${button('Book Site Inspection', { size: 'sm' })}
    </form>`;
  });
  return html`<section class="space-y-3" id="job-${job.jobId}-inspections">
    ${sectionHeader('Site Inspections')}
    <p class="text-sm text-muted">Only for Tradies who need to see the issue before a Firm Quote. Each visit is booked on its own; the Tradie and the Tenant are told.</p>
    ${rows.length ? html`<ul role="list" class="site-visits">${rows}</ul>` : nothing}
    ${forms.length ? html`<div class="site-form space-y-3">${forms}</div>` : nothing}
  </section>`;
}

/** An ISO date ("2026-10-20") as "Tue 20 Oct". */
function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
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
    <form method="post" action="/tickets/${t.ticketId}/jobs/${job.jobId}/work-order" class="ticket-inline-form">
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
    <form method="post" action="${accept}" class="ticket-inline-form">
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

/** The Ticket's history, in a collapsible side panel that starts open, with runs of like events told once. */
function timelineCard(t: TicketView, x: Extras): Html {
  const events = timelineGroups(t.timeline).map((group) => describeGroup(t, group, x));
  return collapsible('Timeline', events.length ? timeline(events) : emptyState('Nothing has happened yet.'));
}

/** Events that read as one line when they come one after another: "Quotes received from Drip Doctors and Pete's Plumbing". */
const GROUPED = new Set(['quote_requests_sent', 'quote_received', 'estimate_received', 'firm_quote_received', 'tradie_declined']);

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
    case 'estimate_received':
      return byJob ? { at, title: `${names.length} Estimates received`, detail: byJob } : { at, title: `Estimates received from ${andList(names)}` };
    case 'firm_quote_received':
      return byJob ? { at, title: `${names.length} Firm Quotes received`, detail: byJob } : { at, title: `Firm Quotes received from ${andList(names)}` };
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
    case 'estimate_received':
      return { title: `Estimate received from ${tradie}`, detail: details(job, d.needsInspection ? 'Needs a Site Inspection first' : undefined) };
    case 'firm_quote_received':
      return { title: `Firm Quote received from ${tradie}`, detail: details(job, price) };
    case 'inspection_need_set':
      return { title: d.needed ? `Site Inspection asked of ${tradie}` : `${tradie} can quote firm without a Site Inspection`, detail: job };
    case 'inspection_booked':
      return { title: `Site Inspection booked with ${tradie}`, detail: details(job, visit) };
    case 'inspected':
      return { title: `${tradie} inspected the site`, detail: job };
    case 'proceeded_on_estimate': {
      const cap = typeof d.capCents === 'number' ? `Not-to-exceed Cap ${formatMoney(d.capCents)}` : undefined;
      const reason = typeof d.reason === 'string' ? `Only one Estimate: ${d.reason}` : undefined;
      return { title: `Proceeding on ${tradie}'s Estimate`, detail: details(job, price ? `Estimate ${price}` : undefined, cap, reason) };
    }
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
    if (pathname.startsWith('/q/')) return 'quote page link';
    return `${hostname} link`;
  } catch {
    return 'link';
  }
}

// Small helpers

/** Label and value pairs in a narrow column, each value beside its label. */
function facts(items: [string, Html | string][]): Html {
  return html`<dl class="ticket-facts">
    ${items.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}
  </dl>`;
}

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
