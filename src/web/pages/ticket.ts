// The Ticket view under /tickets/:id: one Ticket's Jobs from Quote Requests to
// Work Order, Property Owner approval, rescheduling, completion and closing, with
// the timeline and message log. Reads and changes go only through c.var.actions.
// The Summary is an inline edit (saveDetails, so a refusal stays under the field);
// every other POST goes through formAction back to the Ticket.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, notFound, TRADES, type Trade, type Urgency } from '../../shared.ts';
import { AVAILABILITY_LABELS } from '../../templates.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { PHOTO_FLAG } from './dashboard.ts';
import { DATE_INPUTS, firmQuoteFrom } from './quote-form.ts';
import { cents, formAction, int, isoToLocal, list, localToIso, text, type FormValues } from '../forms.ts';
import { conversationDialog, conversationList, conversations, type Conversation, type MessageContact } from '../messages.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import {
  alert,
  badge,
  button,
  card,
  dl,
  editSwap,
  emptyState,
  entityLink,
  field,
  flashFrom,
  formatAge,
  formatDay,
  formatMoney,
  formatWhen,
  humanise,
  inlineEdit,
  JOB_TRACKER_STAGES,
  linkButton,
  page,
  photoGrid,
  postButton,
  ratingChip,
  sectionHeader,
  statusBadge,
  steps,
  table,
  timeline,
  withFlash,
  urgencyBadge,
  type Html,
  type StepState,
} from '../ui.ts';
import { saveDetails, valueOf, type DetailsEdit } from './onboarding-forms.ts';

type TicketView = Awaited<ReturnType<PropertyManagerActions['ticket']>>;
type JobView = TicketView['jobs'][number];
type QuoteView = JobView['quotes'][number];
type RequestView = JobView['quoteRequests'][number];
/** An Estimate as a Tradie's Quote Request carries it (without the Tradie's ratings). */
type EstimateView = NonNullable<RequestView['estimate']>;
type WorkOrderView = NonNullable<JobView['workOrder']>;
type Recommendation = JobView['recommendations'][number];
type Photo = TicketView['photos'][number];
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
  /** Why the Property Owner cannot be asked to approve, or null when a channel reaches them. */
  ownerUnreached: string | null;
};

/** Shown to explain the rule; the core enforces it. */
const MIN_QUOTES = 2;
const FREE_SLOTS_SHOWN = 3;
export const DEFAULT_VISIT_HOURS = 2;
const MB = 1024 * 1024;
const nothing = html``;

/** The Ticket view under /tickets/:id and every Job action on it. */
export function ticketPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/:id', (c) => showTicket(c, c.req.param('id')));

  // A blank or over-long Summary comes back on this page, open, with the reason under the field.
  pages.post('/:id/summary', (c) => {
    const id = c.req.param('id');
    return saveDetails(c, {
      profile: `/tickets/${encodeURIComponent(id)}`,
      ok: 'Summary saved',
      save: async (form) => {
        const ticket = await loadTicket(c.var.actions, id);
        await c.var.actions.editSummary({ ticketId: ticket.ticketId }, text(form, 'summary'));
      },
      show: (refused) => showTicket(c, id, refused),
    });
  });

  onPost(pages, '/:id/urgency', async ({ actions, ticket, form }) => {
    const urgency = text(form, 'urgency') as Urgency;
    await actions.changeUrgency({ ticketId: ticket.ticketId }, urgency);
    return `Urgency changed to ${humanise(urgency)}`;
  });

  onPost(pages, '/:id/close', async ({ actions, ticket }) => {
    await actions.closeTicket(ticket.ticketId);
    return 'Ticket closed. The Tenant and Owner have been told.';
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

  onPost(pages, '/:id/redo', async ({ actions, ticket }) => {
    const added = await actions.redoTicket(ticket.ticketId);
    return added.reopened ? 'Ticket reopened with a Job to redo the work' : 'Job added to redo the work';
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
    return quoteRequestsSent(await actions.sendQuoteRequests(job.jobId, tradieIds));
  });

  onPost(pages, '/:id/quote-requests/:quoteRequestId/resend', async ({ actions, ticket, params }) => {
    const request = requestIn(ticket, params.quoteRequestId);
    await actions.resendQuoteRequest(request.quoteRequestId);
    return `Quote Request resent to ${request.businessName}`;
  });

  onPost(pages, '/:id/approvals/:approvalId/resend', async ({ actions, ticket, params }) => {
    const approval = approvalIn(ticket, params.approvalId);
    await actions.resendApprovalRequest(approval.approvalId);
    return `Approval request resent to ${ticket.owner.name}`;
  });

  onPost(pages, '/:id/quotes/:quoteId/confirm', async ({ actions, ticket, form, params, timeZone }) => {
    const { quote } = quoteIn(ticket, params.quoteId);
    const time = text(form, 'proposedTime');
    await actions.confirmQuote(quote.quoteId, {
      ...(text(form, 'price') ? { priceCents: cents(form, 'price', 'the price') } : {}),
      proposedTime: time ? localToIso(time, timeZone) : null,
    });
    const confirmed = quoteIn(await actions.ticket(ticket.ticketId), params.quoteId).quote;
    return `${confirmed.stage === 'estimate' ? 'Estimate' : 'Quote'} from ${confirmed.businessName} confirmed at ${formatMoney(confirmed.priceCents)}`;
  });

  onPost(pages, '/:id/quotes/:quoteId/choose', async ({ actions, ticket, form, params }) => {
    const { quote } = quoteIn(ticket, params.quoteId);
    const warning = await actions.chooseQuote(quote.quoteId, text(form, 'reason') || undefined);
    if (warning) return warning;
    const chosen = quoteIn(await actions.ticket(ticket.ticketId), params.quoteId).quote;
    // "Chosen" is the Property Manager's act; only the Property Owner approves.
    return chosen.status === 'awaiting_owner'
      ? `Firm Quote from ${chosen.businessName} chosen. It takes the Repair Cost over the Max Repair Cost, so the Owner has been asked to approve it.`
      : `Firm Quote from ${chosen.businessName} chosen`;
  });

  onPost(pages, '/:id/jobs/:jobId/ask-times', async ({ actions, ticket, params }) => {
    const job = jobIn(ticket, params.jobId);
    await actions.askTradieToOfferTimes(job.jobId);
    const name = job.quotes.find((q) => q.status === 'approved')?.businessName ?? job.workOrder?.businessName ?? 'the Tradie';
    return `Asked ${name} to offer visit times`;
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

  onPost(pages, '/:id/work-orders/:workOrderId/resend', async ({ actions, ticket, form, params }) => {
    const workOrderId = visitOnTicket(ticket, params.workOrderId);
    const to = text(form, 'to');
    if (to !== 'tenant' && to !== 'tradie') throw new ActionError('invalid', 'Choose who to resend to');
    const name = await actions.resendVisitEmail(workOrderId, to);
    return `Visit email queued for ${name}`;
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

  // A Firm Quote the Tradie sent another way (a PDF by email, say), entered by the Property
  // Manager: the same fields as the Tradie's quote page, read by the same parser and checked
  // by the core the same way. A PDF of up to 10 MB, plus the form.
  pages.use(
    '/:id/quote-requests/:quoteRequestId/firm-quote',
    bodyLimit({
      maxSize: 11 * MB,
      onError: (c) => c.redirect(withFlash(`/tickets/${encodeURIComponent(c.req.param('id') ?? '')}`, 'error', 'That PDF is too big. Attach one under 10 MB.'), 303),
    }),
  );
  onPost(pages, '/:id/quote-requests/:quoteRequestId/firm-quote', async ({ actions, ticket, form, params, timeZone }) => {
    const request = requestIn(ticket, params.quoteRequestId);
    const input = await firmQuoteFrom(form, timeZone);
    await actions.enterFirmQuote(request.quoteRequestId, input);
    return `Firm Quote from ${request.businessName} saved at ${formatMoney(input.priceCents)}. It supersedes their Estimate, which stays on record.`;
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

/** Whether the Summary's editor is open, and a refused save to show again under the field. */
type SummaryEdit = { editing: boolean; refused?: DetailsEdit };

/** The Ticket page. `refused` is a Summary save that was turned down, shown with the editor open. */
async function showTicket(c: Context<WebEnv>, raw: string, refused?: DetailsEdit) {
  const { actions, pm } = c.var;
  const flash = flashFrom(c.req.url);
  const ticket = await findTicket(actions, raw);
  if (!ticket) {
    const body = emptyState('There is no such Ticket in your Agency.', linkButton('Back to Tickets', '/tickets'));
    return c.html(page({ title: 'Ticket not found', pm, active: 'tickets', flash, body, shell: await shellInfo(c) }), 404);
  }
  const { timeZone } = actions.agency();
  const shell = await shellInfo(c);
  const [suggest, freeSlots, ownerUnreached] = await Promise.all([
    suggestionsFor(actions, ticket, c.req.query('suggest')),
    freeSlotsFor(actions, ticket),
    actions.unreachedReason(ticket.owner.personId),
  ]);
  const extras: Extras = { timeZone, suggest, freeSlots, now: actions.now(), ownerUnreached };
  const edit: SummaryEdit = { editing: ticket.status === 'open' && (!!refused || c.req.query('edit') === 'summary'), refused };
  return c.html(
    page({
      title: `Ticket #${ticket.ticketId}`,
      titleNowrap: true,
      shell,
      pm,
      active: 'tickets',
      flash,
      back: { label: 'Tickets', href: '/tickets' },
      titleExtra: html`<span class="page-title-badges">${urgencyBadge(ticket.urgency)}${ticketStateChip(ticket, extras)}</span>`,
      subtitle: ticketSubtitle(ticket, extras),
      // Change Urgency, Close Ticket and Share share one row of page actions, level with the subtitle.
      actions: html`${urgencyMenu(ticket)}${closeControl(ticket)}${shareButton({
        title: `Ticket #${ticket.ticketId}: ${ticket.description}`,
        text: `Ticket #${ticket.ticketId} at ${ticket.propertyAddress}: ${ticket.description}`,
        url: shareUrl(c, `/tickets/${ticket.ticketId}`),
        note: COLLEAGUES_ONLY,
      })}`,
      body: html`${!edit.editing && refused ? alert(refused.message, 'error') : ''}${ticketBody(ticket, extras, edit)}`,
    }),
    refused ? 400 : 200,
  );
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

/** A repair or a Site Inspection on this Ticket, so a resend can't name some other visit. */
function visitOnTicket(ticket: TicketView, raw: string | undefined): number {
  const id = Number(raw);
  for (const job of ticket.jobs) {
    if (job.workOrder?.workOrderId === id) return id;
    if (job.quoteRequests.some((request) => request.inspection?.workOrderId === id)) return id;
  }
  return notFound('Work Order');
}

function approvalIn(ticket: TicketView, raw: string | undefined): NonNullable<JobView['approval']> {
  for (const job of ticket.jobs) {
    if (job.approval?.approvalId === Number(raw)) return job.approval;
  }
  return notFound('Approval');
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
export function visitMinutes(form: FormValues): number {
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
 * The page under the title and subtitle (its actions are Change Urgency, Close Ticket and Share):
 * then the Summary (with the stage ring, and the Next step along its bottom), the Jobs (and
 * Add another Job) beside what the Tenant reported (stacked while a Job is open, as its
 * tables need the room), with a column beside them (who is on the Ticket, the costs and the
 * conversations), and the Progress across the whole width underneath. Each conversation
 * opens over the page. On phones it is one column in the order the work is read: the
 * Summary, the people and their contacts, the Jobs, the report, the Progress, the
 * conversations, the costs.
 */
function ticketBody(t: TicketView, x: Extras, edit: SummaryEdit): Html {
  const paired = t.jobs.every((j) => !isOpen(j));
  const done = ticketDone(t, x);
  const convos = conversations(t.messages, messageContacts(t));
  return html`<div class="ticket-layout">
      <div class="ticket-main">
        ${heroCard(t, x, edit, done)}
        <div class="ticket-pair${paired ? ' is-paired' : ''}">
          <div class="ticket-jobs">
            ${t.jobs.map((job) => jobCard(t, job, x))}
            ${jobsFoot(t, done)}
          </div>
          <div class="ticket-report">${reportCard(t)}</div>
        </div>
      </div>
      <div class="ticket-side">
        <div class="ticket-people-costs">
          <div class="ticket-people">${peopleCard(t)}</div>
          <div class="ticket-costs-slot">${costTiles(t)}</div>
        </div>
        <div class="ticket-messages">${conversationList(convos, { timeZone: x.timeZone, now: x.now, idPrefix: CONVO_ID })}</div>
      </div>
      <div class="ticket-history">${progressCard(t, x)}</div>
    </div>
    ${convos.map((c, i) => conversationDialog(c, i, { timeZone: x.timeZone, idPrefix: CONVO_ID, markRead: `/tickets/${t.ticketId}/read`, profileHref: profileOf(t, c) }))}`;
}

/** The ids of the conversation rows and their dialogs. */
const CONVO_ID = 'ticket-convo';

/** Everyone a Ticket's messages can come from or go to: the Tenant, the Owner and every Tradie asked or booked. */
function messageContacts(t: TicketView): MessageContact[] {
  return [
    { name: t.tenantName, role: 'Tenant', mobile: t.tenantMobile, email: t.tenantEmail },
    { name: t.owner.name, role: 'Owner', mobile: t.owner.mobile, email: t.owner.email },
    ...t.tradieContacts.map((c) => ({ name: c.name, role: 'Tradie', mobile: c.mobile, email: c.email })),
  ];
}

/** The profile a conversation's person has, for the link on their name. */
function profileOf(t: TicketView, c: Conversation): string | undefined {
  if (!c.contact) return undefined;
  if (c.contact.role === 'Tenant') return `/tenants/${t.tenantId}`;
  if (c.contact.role === 'Owner') return `/owners/${t.owner.personId}`;
  const tradie = t.tradieContacts.find((d) => d.name === c.contact!.name);
  return tradie ? `/tradies/${tradie.tradieId}` : undefined;
}

/** The line under the title: the Trades, the address, when it was reported and by whom. */
function ticketSubtitle(t: TicketView, x: Extras): Html {
  const trades = [...new Set(t.jobs.filter((j) => j.status !== 'cancelled').map((j) => humanise(j.trade)))];
  return html`${trades.length ? trades.join(', ') : 'Ticket'} at ${t.propertyAddress} · ${reportedAgo(t.reportedAt, x.now).replace(/^Reported/, 'reported')} by <a class="ticket-sub-link" href="/tenants/${t.tenantId}">${t.tenantName}</a>`;
}

/** The Job the stage ring and the Progress are about: the one the Next step is about, else the first still open, else the last. */
function focusJob(t: TicketView, x: Extras): JobView | undefined {
  const live = t.jobs.filter((j) => j.status !== 'cancelled');
  return nextStep(t, x)?.job ?? live.find(isOpen) ?? live.at(-1);
}

/** Whether every Job is done (or cancelled) and the Job in focus has every stage ticked. */
function stagesComplete(t: TicketView, x: Extras): boolean {
  if (t.jobs.some(isOpen)) return false;
  const job = focusJob(t, x);
  if (!job) return false;
  const { done, total } = stageCounts(jobStages(job, x));
  return total > 0 && done === total;
}

/** Nothing left to do: a closed Ticket, or one whose every Job is done. Hides Next and Add another Job. */
function ticketDone(t: TicketView, x: Extras): boolean {
  return t.status !== 'open' || stagesComplete(t, x);
}

/** Beside the Urgency: the state a phone cannot read from the hidden stage ring. */
function ticketStateChip(t: TicketView, x: Extras): Html {
  const chip = t.status === 'open' ? (stagesComplete(t, x) ? badge('Done · ready to close', 'success') : nothing) : stagesComplete(t, x) ? badge('Closed', 'neutral') : nothing;
  // The stage ring already says Done on a wide screen; the badge is the phone's only status.
  return chip === nothing ? nothing : html`<span class="ticket-state-phone">${chip}</span>`;
}

/**
 * The Summary, its address, the stage ring and, while there is one, the Next step along the
 * bottom: the one thing to do is the first thing read, not a card further down the side.
 */
function heroCard(t: TicketView, x: Extras, edit: SummaryEdit, done: boolean): Html {
  // The ring already says Done, so the closed Ticket isn't also given a second word for it.
  const job = focusJob(t, x);
  const counts = job ? stageCounts(jobStages(job, x)) : null;
  const ringDone = Boolean(counts && counts.total > 0 && counts.done === counts.total);
  return html`<section class="ticket-hero" id="ticket-hero" aria-label="Summary">
    <div class="ticket-hero-card">
      <div class="ticket-hero-top">
        <div class="ticket-hero-text">
          ${summaryBlock(t, edit)}
          <p class="ticket-hero-meta">
            <span class="ticket-chip">${entityLink('property', t.propertyAddress, `/properties/${t.propertyId}`)}</span>
            ${t.status !== 'open' && !ringDone ? html`<span class="ticket-state is-closed">${humanise(t.status)}</span>` : nothing}
            ${t.checkUrgency ? html`<span class="text-sm text-muted">The intake agent wasn't sure of the Urgency.</span>` : nothing}
          </p>
        </div>
        ${stageRing(t, x)}
      </div>
      ${done ? nothing : nextStepLine(t, x)}
    </div>
  </section>`;
}

/** A ring filled by how many of the Job's stages are done (those that were not needed don't count), with what is left in words. */
function stageRing(t: TicketView, x: Extras): Html {
  const job = focusJob(t, x);
  if (!job) return nothing;
  const { done, total, skipped, current } = stageCounts(jobStages(job, x));
  const pct = total ? Math.round((done / total) * 100) : 0;
  return html`<div class="ticket-ring-wrap">
    <div class="ticket-ring${done === total ? ' is-done' : ''}" style="--pct:${pct}"><span class="ticket-ring-label">${done === total ? 'Done' : (current?.label ?? '')}</span></div>
    <p class="ticket-ring-note">${done === total ? `All ${total} stages done${skipped ? ` (${skipped} not needed)` : ''}` : html`${done} of ${total} stages done${skipped ? html`<br />${skipped} not needed` : nothing}`}</p>
  </div>`;
}

/** How many of a Job's stages are done, not needed or in all (a stage that was not needed isn't counted), and the one it is at. */
function stageCounts(stages: Stage[]) {
  const skipped = stages.filter((s) => s.state === 'skipped').length;
  return {
    done: stages.filter((s) => s.state === 'done').length,
    total: stages.length - skipped,
    skipped,
    current: stages.find((s) => s.state === 'current') ?? stages.find((s) => s.state === 'upcoming'),
  };
}

/** "Add another Job", a quiet control under the Jobs that opens its form in place. Hidden once everything is done. */
function addJobTile(t: TicketView, done: boolean): Html {
  if (t.status !== 'open' || done) return nothing;
  return html`<details class="ticket-add-job">
    <summary><span>Add another Job</span><span class="ticket-add-plus" aria-hidden="true">${icon('plus', { size: 'size-6' })}</span></summary>
    <form method="post" action="/tickets/${t.ticketId}/jobs" class="ticket-inline-form">
      <div class="min-w-48 flex-1">
        ${field({ label: 'Trade', name: 'trade', type: 'select', options: tradeOptions(), hint: 'When the issue needs another Trade as well.' })}
      </div>
      ${button('Add Job', { variant: 'secondary' })}
    </form>
  </details>`;
}

/**
 * "Not fixed?": once every Job is done or cancelled (or the Ticket is closed), a Job to redo
 * the latest done Job, for when the Tenant says it isn't fixed without messaging (a phone
 * call). It stays one Ticket: a closed one is reopened.
 */
function redoTile(t: TicketView): Html {
  const done = t.jobs.filter((j) => j.status === 'done').at(-1);
  if (!done || t.jobs.some(isOpen)) return nothing;
  const closed = t.status !== 'open';
  return html`<details class="ticket-add-job" id="redo-job">
    <summary><span>Not fixed? Redo the work</span><span class="ticket-add-plus" aria-hidden="true">${icon('arrow-counter-clockwise', { size: 'size-6' })}</span></summary>
    <form method="post" action="/tickets/${t.ticketId}/redo" class="ticket-inline-form"${closed ? html` data-confirm="Reopen this Ticket to redo the work?"` : nothing}>
      <p class="min-w-48 flex-1 text-sm">
        Adds a ${humanise(done.trade).toLowerCase()} Job to this Ticket to redo the work, for when the Tenant says it isn't fixed.${closed ? ' The Ticket is reopened.' : ''}
      </p>
      ${button(closed ? 'Reopen with a new Job' : 'Add a Job to redo it', { variant: 'secondary' })}
    </form>
  </details>`;
}

/** Two letters for an avatar: the first letters of the first two words ("Lena Le" is LL). */
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** Who is on the Ticket: the Tenant, the Property Manager, each Tradie booked or chosen, the Owner and any Building Manager. */
type PersonOnTicket = { name: string; role: string; href: string; mobile?: string | null; email?: string | null };

function peopleCard(t: TicketView): Html {
  const people: PersonOnTicket[] = [
    { name: t.tenantName, role: 'Tenant', href: `/tenants/${t.tenantId}`, mobile: t.tenantMobile, email: t.tenantEmail },
    // A Property Manager has no page of their own: Profiles is where the Agency's people are listed.
    { name: t.propertyManager, role: 'Property Manager', href: '/profiles' },
  ];
  // Each Tradie with a Work Order, or whose Quote was chosen (and is waiting on the Property Owner).
  const tradies = new Map<number, string>();
  for (const job of t.jobs) {
    if (job.workOrder) tradies.set(job.workOrder.tradieId, job.workOrder.businessName);
    const chosen = job.quotes.find((q) => q.status === 'approved' || q.status === 'awaiting_owner');
    if (chosen) tradies.set(chosen.tradieId, chosen.businessName);
  }
  for (const [tradieId, name] of tradies) people.push({ name, role: 'Tradie', href: `/tradies/${tradieId}` });
  people.push({ name: t.owner.name, role: 'Owner', href: `/owners/${t.owner.personId}`, mobile: t.owner.mobile, email: t.owner.email });
  if (t.buildingManager) people.push({ name: t.buildingManager.name, role: 'Building Manager', href: `/building-managers/${t.buildingManager.personId}` });
  return html`<section class="ticket-people-card is-list" aria-label="People on this Ticket">
    <h2 class="ticket-people-title">People on this Ticket</h2>
    <ul class="ticket-people-list" role="list">
      ${people.map(
        (p) => html`<li class="ticket-person">
          <a class="ticket-person-link" href="${p.href}">
            <span class="ticket-person-avatar" aria-hidden="true">${initials(p.name)}</span>
            <span class="ticket-person-text"><span class="ticket-person-name">${p.name}</span><span class="ticket-person-role">${p.role}</span></span>
          </a>
          ${p.mobile ? html`<a class="ticket-person-contact" href="sms:${p.mobile}" aria-label="Text ${p.name}" title="Text ${p.name}">${icon('chat-circle', { size: 'size-4' })}</a>` : nothing}
          ${p.email ? html`<a class="ticket-person-contact" href="mailto:${p.email}" aria-label="Email ${p.name}" title="Email ${p.name}">${icon('envelope-simple', { size: 'size-4' })}</a>` : nothing}
        </li>`,
      )}
    </ul>
  </section>`;
}

/** The Repair Cost (once there is one) and the Max Repair Cost as two tiles, with any Call-out Fees owed (never part of the Repair Cost) under them. */
function costTiles(t: TicketView): Html {
  const overMax = t.repairCostCents > t.maxRepairCostCents;
  const fees = t.jobs.reduce((sum, job) => sum + calloutFeesOwed(job).cents, 0);
  return html`<div class="ticket-costs">
      <div class="ticket-cost${overMax ? ' is-over' : ''}">
        <p class="ticket-cost-head"><span class="ticket-cost-icon" aria-hidden="true">${icon('receipt', { size: 'size-4' })}</span><span class="ticket-cost-label">Repair Cost</span></p>
        <strong class="ticket-cost-amount num">${t.repairCostCents > 0 ? formatMoney(t.repairCostCents) : '—'}</strong>
        ${overMax ? html`<span class="ticket-cost-note">Over the Max Repair Cost, with the Owner's approval</span>` : nothing}
        <a class="btn btn-sm btn-secondary" href="#ticket-costs" data-tab-link="ticket-costs">Costs</a>
      </div>
      <div class="ticket-cost is-max">
        <p class="ticket-cost-head"><span class="ticket-cost-icon" aria-hidden="true">${icon('shield', { size: 'size-4' })}</span><span class="ticket-cost-label">Max Repair Cost</span></p>
        <strong class="ticket-cost-amount num">${formatMoney(t.maxRepairCostCents)}</strong>
        <a class="btn btn-sm btn-secondary" href="/properties/${t.propertyId}">Change limit</a>
      </div>
    </div>
    ${fees > 0 ? html`<p class="ticket-fees num" data-callout-fees>Call-out Fees owed ${formatMoney(fees)}, on top of the Repair Cost</p>` : nothing}`;
}

/** Which column of the Progress board an event goes in: a stage, or the start of the Ticket. Unknown kinds follow the one before. */
const REPORTED_COLUMN = 'Reported';
const TIMELINE_COLUMN: Record<string, string> = (() => {
  const [ESTIMATES, SITE, FIRM, OWNER, READY, BOOKED, DONE] = JOB_TRACKER_STAGES;
  const columns: [string, string[]][] = [
    [REPORTED_COLUMN, ['reported', 'confirmed', 'urgency_changed', 'summary_edited', 'job_added', 'trade_changed', 'job_cancelled', 'reopened']],
    [ESTIMATES!, ['quote_requests_sent', 'tradie_declined', 'quote_received', 'estimate_received']],
    [SITE!, ['inspection_need_set', 'inspection_booked', 'inspected', 'inspection_cancelled', 'site_quotes_booked', 'site_quotes_skipped', 'site_quote_done']],
    [FIRM!, ['firm_quote_received', 'quotes_final', 'quote_chosen']],
    [OWNER!, ['approval_requested', 'owner_declined']],
    [READY!, ['quote_approved', 'work_order_sent', 'visit_times_asked', 'other_times_requested']],
    [BOOKED!, ['reschedule_requested', 'visit_confirmed', 'visit_moved']],
    [DONE!, ['job_done', 'tenant_rated', 'tradie_rated', 'closed']],
  ];
  return Object.fromEntries(columns.flatMap(([column, kinds]) => kinds.map((kind) => [kind, column])));
})();

const EVENT_ICON: Record<string, string> = {
  reported: 'chat-circle',
  confirmed: 'file-text',
  quote_requests_sent: 'file-text',
  estimate_received: 'file-text',
  firm_quote_received: 'file-text',
  quote_received: 'file-text',
  quote_chosen: 'seal-check',
  quote_approved: 'seal-check',
  approval_requested: 'seal-check',
  work_order_sent: 'wrench',
  inspected: 'wrench',
  visit_confirmed: 'calendar-check',
  visit_moved: 'calendar-check',
  job_done: 'check-circle',
  closed: 'check-circle',
  tenant_rated: 'star',
  tradie_rated: 'star',
};

/** The timeline as a board: a column for each stage that has something in it, the events in each as small cards, side by side. */
function timelineBoard(t: TicketView, x: Extras): Html {
  const job = focusJob(t, x);
  const stages = job ? jobStages(job, x) : [];
  const columns = new Map<string, { kind: string; at: string; title: string; detail?: string }[]>();
  let column = REPORTED_COLUMN;
  for (const group of timelineGroups(t.timeline)) {
    const kind = String((group[0] as Record<string, unknown>).kind);
    column = TIMELINE_COLUMN[kind] ?? column;
    columns.set(column, [...(columns.get(column) ?? []), { kind, ...describeGroup(t, group, x) }]);
  }
  if (!columns.size) return emptyState('Nothing has happened yet.');
  const [ESTIMATES, SITE] = JOB_TRACKER_STAGES;
  // The Site inspection column holds a quiet "Not needed" when the Job went without one.
  const siteSkipped = stages.some((s) => s.label === SITE && s.state === 'skipped') && columns.has(ESTIMATES!) && !columns.has(SITE!);
  const order = [REPORTED_COLUMN, ...JOB_TRACKER_STAGES].filter((c) => columns.has(c) || (siteSkipped && c === SITE));
  const currentStage = stages.find((s) => s.state === 'current')?.label;
  const currentColumn = currentStage && order.includes(currentStage) ? currentStage : order.at(-1);
  const stageDone = (label: string) => label === REPORTED_COLUMN || stages.some((s) => s.label === label && s.state === 'done');
  return html`<div class="tl-board" tabindex="0" role="region" aria-label="Timeline by stage">
    ${order.map(
      (label, i) => html`${i ? html`<span class="tl-arrow" aria-hidden="true">${icon('caret-right', { size: 'size-4' })}</span>` : nothing}<section class="tl-column"${label === currentColumn ? html` data-current="1"` : ''}>
        <h3 class="tl-head${stageDone(label) ? ' is-done' : ''}">${stageDone(label) ? icon('check', { size: 'size-3.5', weight: 'bold' }) : nothing}${label}</h3>
        <ol class="tl-cards" role="list">
          ${columns.has(label)
            ? columns.get(label)!.map(
                (e) => html`<li class="tl-card">
                  <span class="tl-title">${icon(EVENT_ICON[e.kind] ?? 'circle', { size: 'size-4' })}<b>${e.title}</b></span>
                  <time class="tl-time">${e.at}</time>
                  ${e.detail ? html`<span class="tl-detail">${e.detail}</span>` : nothing}
                </li>`,
              )
            : html`<li class="tl-card is-skipped"><b>${label}</b><span class="tl-detail">Not needed</span></li>`}
        </ol>
      </section>`,
    )}
  </div>`;
}

/** What each Quote on the Ticket was for and what it costs, with the Repair Cost, the Max and any Call-out Fees under them. */
function costsPane(t: TicketView): Html {
  const quotes = t.jobs.flatMap((job) => job.quotes.map((q) => ({ job, q })));
  const fees = t.jobs.reduce((sum, job) => sum + calloutFeesOwed(job).cents, 0);
  return html`<div class="space-y-4">
    ${quotes.length
      ? table(
          ['Tradie', 'Type', 'Amount', 'Status'],
          quotes.map(({ job, q }) => [
            html`${q.businessName}${t.jobs.length > 1 ? html` <span class="text-muted">${jobLabel(t, job.jobId)}</span>` : nothing}`,
            html`${q.stage === 'firm' ? 'Firm Quote' : 'Estimate'}`,
            html`<span class="num">${formatMoney(q.priceCents)}${q.notToExceedCents !== null ? html` <span class="text-muted">capped at ${formatMoney(q.notToExceedCents)}</span>` : nothing}</span>`,
            statusBadge(q.status),
          ]),
          { caption: 'Quotes on this Ticket', stack: true },
        )
      : html`<p class="text-sm text-muted">No Quotes yet.</p>`}
    <dl class="ticket-facts">
      <div><dt>Repair Cost</dt><dd class="num">${t.repairCostCents > 0 ? formatMoney(t.repairCostCents) : '—'}</dd></div>
      <div><dt>Max Repair Cost</dt><dd class="num">${formatMoney(t.maxRepairCostCents)}</dd></div>
      ${fees > 0 ? html`<div><dt>Call-out Fees owed</dt><dd class="num">${formatMoney(fees)}</dd></div>` : nothing}
    </dl>
  </div>`;
}

/**
 * Progress: once the Job is done, a strip of when it finished and how long it took (the
 * stage ring says how far along an open one is), then tabs: the Timeline as a board by stage, the Job's stage tracker, and the Costs. Without
 * JavaScript the three show one under another. The tools: print and expand. The Summary's pencil is on the Summary.
 */
function progressCard(t: TicketView, x: Extras): Html {
  const job = focusJob(t, x);
  const { done, total } = job ? stageCounts(jobStages(job, x)) : { done: 0, total: 0 };
  const all = total > 0 && done === total;
  const finished = job ? (lastEvent(t, 'job_done', job.jobId)?.at as string | undefined) : undefined;
  const days = finished ? Math.max(0, Math.round((new Date(finished).getTime() - new Date(t.reportedAt).getTime()) / 86_400_000)) : null;
  const jobsTab = t.jobs.length > 1 ? 'Jobs' : job ? jobLabel(t, job.jobId) : 'Job';
  const tab = (id: string, label: string, selected = false) =>
    html`<button type="button" role="tab" id="tab-${id}" class="ticket-tab" aria-controls="${id}" aria-selected="${selected ? 'true' : 'false'}">${label}</button>`;
  return html`<section class="ticket-progress" data-tabs aria-label="Progress">
    ${all
      ? html`<aside class="ticket-progress-strip is-done">
          <p class="ticket-progress-line">${icon('check-circle', { size: 'size-5' })}<span>Done${finished ? ` ${formatDay(finished, x.timeZone)}` : ''}${days !== null ? ` · took ${days} ${plural(days, 'day')}` : ''}</span></p>
        </aside>`
      : nothing}
    <div class="ticket-progress-main">
      <div class="ticket-progress-head">
        <h2 class="section-title">Progress</h2>
        <div class="ticket-progress-tools">
          <button type="button" class="icon-btn js-only" data-print aria-label="Print this Ticket" title="Print">${icon('clipboard-text', { size: 'size-[18px]' })}</button>
          <button type="button" class="icon-btn js-only" data-expand aria-pressed="false" aria-label="Expand the Progress" title="Expand">${icon('arrows-out-simple', { size: 'size-[18px]' })}</button>
        </div>
      </div>
      <div class="ticket-tablist js-only" role="tablist" aria-label="Progress views">
        ${tab('ticket-timeline', 'Timeline', true)}${tab('ticket-job', jobsTab)}${tab('ticket-costs', 'Costs')}
      </div>
      <div class="tab-panes">
        <div class="ticket-pane" role="tabpanel" id="ticket-timeline" aria-labelledby="tab-ticket-timeline">${timelineBoard(t, x)}</div>
        <div class="ticket-pane" role="tabpanel" id="ticket-job" aria-labelledby="tab-ticket-job">${stageTracker(t, x)}</div>
        <div class="ticket-pane" role="tabpanel" id="ticket-costs" aria-labelledby="tab-ticket-costs">${costsPane(t)}</div>
      </div>
    </div>
  </section>`;
}

const summaryChip = () => html`<span class="ticket-ai-chip">${icon('sparkle', { size: 'size-3.5', weight: 'fill' })}<span>Filled in by AI</span></span>`;

/**
 * The Summary (else the Tenant's words). While the Ticket is open the pencil turns that line
 * into a textarea in the same type; a closed Ticket has no pencil. "Filled in by AI" only while
 * the AI wrote it.
 */
function summaryBlock(t: TicketView, edit: SummaryEdit): Html {
  const words = t.summary ?? t.description;
  const chip = t.summaryBy === 'ai' ? summaryChip() : nothing;
  if (t.status !== 'open') {
    return html`<div class="ticket-summary">${chip}<h2 class="ticket-issue">${words}</h2></div>`;
  }
  const id = `ticket-summary-${t.ticketId}`;
  const error = edit.refused ? (edit.refused.errors.summary ?? edit.refused.message) : undefined;
  const control = field({
    label: 'Summary',
    name: 'summary',
    id,
    type: 'textarea',
    rows: 2,
    required: true,
    bare: true,
    className: 'inline-edit-headline',
    value: edit.refused ? valueOf(edit.refused.values, 'summary') : words,
    hint: 'One line, 160 characters at most.',
    error,
  });
  const line = html`<label class="sr-only" for="${id}">Summary</label>${editSwap(html`<h2 class="ticket-issue">${words}</h2>`, control)}`;
  return inlineEdit({
    id: 'ticket-summary',
    tag: 'div',
    className: 'ticket-summary',
    label: 'Summary',
    action: `/tickets/${t.ticketId}/summary`,
    edit: { label: 'Edit the Summary', href: `/tickets/${t.ticketId}?edit=summary#ticket-summary` },
    cancel: `/tickets/${t.ticketId}#ticket-summary`,
    save: 'Save Summary',
    editing: edit.editing,
    refresh: ['ticket-report'],
    view: (tools) => html`${chip}<div class="request-summary-plain"><div class="min-w-0 flex-1">${line}</div>${tools}</div>`,
  });
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
  const rating = step.job && step.href === `#job-${step.job.jobId}-rating` ? ratingForm(t, step.job) : nothing;
  return html`<div class="ticket-next-card">
    ${step.decision ? html`<span class="ticket-next-chip">Needs you</span>` : nothing}
    <p class="ticket-next ${step.decision ? 'is-decision' : ''}" data-next-step>
      <span class="ticket-next-label">Next</span>
      <a class="link font-semibold" href="${step.href}">${step.text}</a>${job}
    </p>
    ${rating}
  </div>`;
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
      const toBook = job.quoteRequests.filter((r) => r.status === 'estimated' && r.inspectionNeeded);
      // A Tradie's own row on the Job, where their next action is.
      const row = (r: { quoteRequestId: number } | undefined) => (r ? `#quote-request-${r.quoteRequestId}` : at('requests'));
      const decideAt = (text: string, href: string): NextStep => ({ text, href, decision: true, job });
      if (job.decision === 'check_quotes' && unchecked.length) {
        const names = andList(unchecked.map((q) => q.businessName));
        const noun = unchecked.every((q) => q.stage === 'estimate') ? 'Estimate' : 'Quote';
        const first = job.quoteRequests.find((r) => r.quoteRequestId === unchecked[0]!.quoteRequestId);
        return decideAt(`Check ${unchecked.length} ${plural(unchecked.length, noun)} from ${names}`, row(first));
      }
      if (job.decision === 'book_inspection' && toBook.length) {
        return decideAt(`Book a Site Inspection with ${andList(toBook.map((r) => r.businessName))}`, row(toBook[0]));
      }
      if (job.decision === 'choose_quote') return decide(`Choose a Firm Quote: ${firm.length} in`, 'quotes');
      if (!job.quoteRequests.length) return decide(job.checkTrade ? 'Check the Trade, then send Quote Requests' : 'Send Quote Requests', 'tradies');
      if (waiting.length) {
        const oldest = waiting.reduce((a, b) => (a.sentAt < b.sentAt ? a : b));
        const names = andList(waiting.map((r) => r.businessName));
        return wait(`Waiting on ${plural(waiting.length, 'an Estimate', 'Estimates')} from ${names}, asked ${formatAge(oldest.sentAt, x.now)}`, 'requests');
      }
      if (booked.length) {
        const names = andList(booked.map((r) => r.businessName));
        return { text: `Waiting on the Site ${plural(booked.length, 'Inspection')} with ${names}`, href: row(booked[0]), decision: false, job };
      }
      if (forFirm.length) {
        const names = andList(forFirm.map((r) => r.businessName));
        return wait(`Waiting on ${plural(forFirm.length, 'a Firm Quote', 'Firm Quotes')} from ${names}`, 'requests');
      }
      if (firm.length === 1) return decide(`Choose ${firm[0]!.businessName}'s Firm Quote with a reason, or ask more Tradies`, 'quotes');
      return decide('Ask more Tradies to quote', 'tradies');
    }
    case 'awaiting_owner': {
      const quote = job.quotes.find((q) => q.quoteId === job.approval?.quoteId);
      return wait(`Waiting on the Owner to approve ${formatMoney(quote?.priceCents ?? null)}`, 'approval');
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
        return decide(`Find a new time: the ${whoAsked(wo.rescheduleRequestedBy)} asked for another`, 'work-order');
      }
      const confirmed = wo.visitConfirmed ? '' : ', waiting on the Tenant to confirm';
      return wait(`Visit ${formatWhen(wo.start, x.timeZone)} with ${wo.businessName}${confirmed}`, 'work-order');
    }
    case 'done':
      return lastEvent(t, 'tradie_rated', job.jobId) ? null : decide(`Rate the Tradie: ${job.workOrder?.businessName ?? 'how did they do'}`, 'rating');
    default:
      return null;
  }
}

/**
 * Where the Ticket stands across the top, for the Job the Next block is about (named
 * when the Ticket has several): Estimates, Site inspection, Firm Quote, With Property
 * Owner, Ready to book, Booked, Done. A stage is ticked only once it has really
 * happened, never because a later one began.
 */
function stageTracker(t: TicketView, x: Extras): Html {
  const live = t.jobs.filter((j) => j.status !== 'cancelled');
  const job = nextStep(t, x)?.job ?? live.find(isOpen) ?? live.at(-1);
  if (!job) return nothing;
  const name = t.jobs.length > 1 ? html`<p class="ticket-stages-job">${jobLabel(t, job.jobId)}</p>` : nothing;
  return html`<nav class="ticket-stages" aria-label="Where the Ticket stands">${name}${steps(jobStages(job, x), { horizontal: true })}</nav>`;
}

type Stage = { label: string; state: StepState; detail?: string };

/**
 * A Job's stages and how each stands. While the Job is getting Quotes, the current stage
 * is Firm Quote once one is in (or once every Tradie can quote firm), Site inspection while
 * one is still to happen, else Estimates. Site inspection is Not needed when no Tradie
 * still in the running needs one; once the Job is decided without one it is Not held if a
 * Tradie wanted one (Not needed if none did). Firm Quote is Done once the Job is decided.
 * With Property Owner is Not needed when the Repair Cost stayed within the Max Repair Cost.
 * Booked waits on the Tenant to confirm the visit, and is ticked only once they have
 */
function jobStages(job: JobView, x: Extras): Stage[] {
  const [ESTIMATES, SITE, FIRM, OWNER, READY, BOOKED, DONE] = JOB_TRACKER_STAGES;
  const quoting = job.status === 'quoting';
  const decided = ['awaiting_owner', 'approved', 'scheduled', 'done'].includes(job.status);
  const chosen = decided ? job.quotes.find((q) => q.status === 'approved' || q.status === 'awaiting_owner') : undefined;
  const requests = job.quoteRequests;
  const estimatesIn = job.quotes.some((q) => q.stage === 'estimate');
  const firmIn = job.quotes.filter((q) => q.stage === 'firm' && q.confirmed && q.status === 'open').length;
  const inspected = requests.some((r) => r.inspection?.status === 'done');
  // Wanted by a Tradie who didn't decline; needed by one still in the running.
  const wanted = requests.some((r) => (r.inspectionNeeded || r.inspection) && r.status !== 'declined');
  const needed = requests.some((r) => (r.inspectionNeeded || r.inspection) && r.status !== 'declined' && r.status !== 'closed');
  const toInspect = requests.some((r) => r.inspectionNeeded && (r.status === 'estimated' || r.status === 'inspection_booked'));
  const stillAsked = requests.some((r) => r.status === 'sent' || r.status === 'reminded');
  const at = !quoting ? null : !estimatesIn ? ESTIMATES : toInspect && !firmIn ? SITE : FIRM;
  const state = (label: string, done: boolean): StepState => (done ? 'done' : label === at ? 'current' : 'upcoming');

  const stages: Stage[] = [{ label: ESTIMATES, state: state(ESTIMATES, estimatesIn) }];
  if (inspected) stages.push({ label: SITE, state: 'done' });
  else {
    // While a visit is booked, when the next one is.
    const next = requests.flatMap((r) => (r.inspection?.status === 'active' ? [r.inspection.start] : [])).sort()[0];
    // Not needed once every Tradie has answered and none still in the running needs one.
    const notNeeded = !needed && estimatesIn && !stillAsked;
    stages.push(
      decided && !next
        ? { label: SITE, state: 'skipped', detail: wanted ? 'Not held' : 'Not needed' }
        : notNeeded
          ? { label: SITE, state: 'skipped', detail: 'Not needed' }
          : { label: SITE, state: state(SITE, false), ...(next ? { detail: `Booked ${formatWhen(next, x.timeZone)}` } : {}) },
    );
  }

  stages.push({ label: FIRM, state: state(FIRM, decided), ...(quoting && firmIn ? { detail: `${firmIn} in` } : {}) });
  const approval = job.approval;
  if (job.status === 'awaiting_owner') stages.push({ label: OWNER, state: 'current', detail: 'Waiting on approval' });
  else if (decided && approval?.status === 'approved' && approval.quoteId === chosen?.quoteId) stages.push({ label: OWNER, state: 'done' });
  else if (decided) stages.push({ label: OWNER, state: 'skipped', detail: 'Not needed' });
  else stages.push({ label: OWNER, state: 'upcoming', ...(approval?.status === 'declined' ? { detail: 'Said no to the last one' } : {}) });

  const booked = job.status === 'scheduled' || job.status === 'done';
  stages.push({ label: READY, state: booked ? 'done' : job.status === 'approved' ? 'current' : 'upcoming' });

  const wo = job.workOrder;
  if (job.status === 'done') stages.push({ label: BOOKED, state: 'done', ...(wo?.visitConfirmed ? { detail: 'Tenant confirmed' } : {}) });
  else if (job.status === 'scheduled' && wo?.rescheduleRequestedBy) {
    stages.push({ label: BOOKED, state: 'current', detail: `${whoAsked(wo.rescheduleRequestedBy)} asked to move it` });
  } else if (job.status === 'scheduled' && wo?.visitConfirmed) stages.push({ label: BOOKED, state: 'done', detail: 'Tenant confirmed' });
  else if (job.status === 'scheduled') stages.push({ label: BOOKED, state: 'current', detail: 'Waiting on Tenant to confirm' });
  else stages.push({ label: BOOKED, state: 'upcoming' });

  const visitDue = job.status === 'scheduled' && wo?.visitConfirmed && !wo.rescheduleRequestedBy;
  stages.push({
    label: DONE,
    state: job.status === 'done' ? 'done' : visitDue ? 'current' : 'upcoming',
    ...(visitDue && wo ? { detail: `Visit ${formatWhen(wo.start, x.timeZone)}` } : {}),
  });
  return stages;
}

/** "Reported 2 days ago", in the Agency's clock's hours and days. */
function reportedAgo(iso: string, now: Date): string {
  const hours = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000));
  if (hours < 24) return `Reported ${hours} ${plural(hours, 'hour')} ago`;
  const days = Math.floor(hours / 24);
  return `Reported ${days} ${plural(days, 'day')} ago`;
}

/** Close Ticket, offered once every Job is done or cancelled. */
function closeControl(t: TicketView): Html {
  if (t.status !== 'open' || t.jobs.some(isOpen)) return nothing;
  return html`<div id="close-ticket">
    <form method="post" action="/tickets/${t.ticketId}/close" class="inline-flex" data-confirm="Close this Ticket? The Tenant and Owner will be told.">
      <button type="submit" class="btn btn-success btn-sm">${icon('check-circle', { size: 'size-4' })}Close Ticket</button>
    </form>
  </div>`;
}

/**
 * Under the Jobs while the Ticket is open: Add another Job, and when the Ticket can be closed.
 */
function jobsFoot(t: TicketView, done: boolean): Html {
  const redo = redoTile(t);
  if (t.status !== 'open') return redo === nothing ? nothing : html`<div class="ticket-jobs-foot">${redo}</div>`;
  const openJobs = t.jobs.filter(isOpen).length;
  const add = addJobTile(t, done);
  if (add === nothing && redo === nothing && !openJobs) return nothing;
  return html`<div class="ticket-jobs-foot">
    ${add}
    ${redo}
    ${openJobs ? html`<p class="ticket-close-hint">Close once every Job is done or cancelled (${openJobs} still open).</p>` : nothing}
  </div>`;
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
  const frequent = t.frequentIssues.filter((f) => f.tickets >= 2);
  const photoCheck =
    t.imageMatch && t.imageMatch.result !== 'matches'
      ? html`<p class="ticket-report-note">${badge(humanise(t.imageMatch.result), 'warning')}${t.imageMatch.reason.startsWith('Demo check:') ? nothing : html` ${t.imageMatch.reason}`}</p>`
      : nothing;
  return card({
    id: 'ticket-report',
    title: 'What the Tenant reported',
    body: html`${photoCheck}<div class="ticket-report-body">
      <div class="ticket-report-photos">${photos}</div>
      <div class="ticket-report-text">
        ${t.summary ? html`<p class="ticket-words"><span class="ticket-words-label">The Tenant's words</span> ${t.description}</p>` : nothing}
        ${facts([
          ['Where', a.location ?? '—'],
          ['Started', a.started ?? '—'],
          ['Getting worse', a.worsening ? humanise(a.worsening) : '—'],
          ['Usually home', a.availability ? AVAILABILITY_LABELS[a.availability] : '—'],
        ])}
      </div>
    </div>
    ${frequent.length ? html`<p class="ticket-report-note">Frequent here: ${frequent.map((f) => `${humanise(f.trade)} (${f.tickets} ${plural(f.tickets, 'Ticket')})`).join(', ')}</p>` : nothing}`,
  });
}

function photoCaption(p: Photo): Html {
  if (p.metadata === 'flagged') return html`${badge('Flagged', 'warning')} ${p.reasons.map((r) => PHOTO_FLAG[r] ?? humanise(r)).join(', ')}`;
  return p.metadata === 'ok' ? badge('Photo taken at the Property', 'success') : badge('No photo details');
}

/**
 * One Job: its Trade and stage, small tiles of what is known (the Tradie, the visit, the
 * price, the Tenant's rating), the one next action and the details folded below. A
 * cancelled Job is collapsed.
 */
function jobCard(t: TicketView, job: JobView, x: Extras): Html {
  if (job.status === 'cancelled') return cancelledJob(t, job, x);
  return html`<section class="section ticket-job" id="job-${job.jobId}">
    <div class="section-head">
      <h2 class="section-title ticket-job-title"><span class="ticket-job-icon" aria-hidden="true">${icon('wrench', { size: 'size-5' })}</span>${jobLabel(t, job.jobId)}</h2>
      <div class="section-actions">${job.status === 'done' ? nothing : statusBadge(job.status, { job: true })} ${job.checkTrade ? badge('Check trade', 'warning') : nothing}</div>
    </div>
    <div class="section-body">
      ${jobTiles(t, job, x)}
      ${nextAction(t, job, x)}
      ${calloutFeesLine(job)}
      ${jobMore(t, job, x)}
    </div>
  </section>`;
}

/** What is known about a Job at a glance: the Tradie, the visit, the price (capped, if it is) and both ratings, side by side. */
function jobTiles(t: TicketView, job: JobView, x: Extras): Html {
  const wo = job.workOrder;
  const approved = job.quotes.find((q) => q.status === 'approved');
  const tradie = wo?.businessName ?? approved?.businessName;
  const tenantScore = lastEvent(t, 'tenant_rated', job.jobId)?.score;
  const managerScore = lastEvent(t, 'tradie_rated', job.jobId)?.score;
  const stars = (score: unknown) => (score !== undefined ? html`<span class="ticket-star" aria-hidden="true">★</span> ${String(score)} out of 5` : 'Not yet');
  const tiles: [string, Html | string, boolean?][] = [
    ...(tradie ? ([['Tradie', tradie]] as [string, string][]) : []),
    ...(wo ? ([['Visit', visitTile(wo, x)]] as [string, Html][]) : []),
    // The price spans both columns: an odd tile alone would leave an empty half-cell beside it.
    ...(approved ? ([[approved.stage === 'firm' ? 'Firm Quote' : 'Estimate', approved.notToExceedCents !== null ? `Capped at ${formatMoney(approved.notToExceedCents)}` : formatMoney(approved.priceCents), true]] as [string, string, boolean][]) : []),
    ...(!tradie && job.status === 'quoting' ? ([['Tradies asked', String(job.quoteRequests.length)], ['Quotes in', String(job.quotes.length)]] as [string, string][]) : []),
  ];
  const ratings: [string, Html | string][] = job.status === 'done' ? [["Tenant's rating", stars(tenantScore)], ['Your rating', stars(managerScore)]] : [];
  if (!tiles.length && !ratings.length) return nothing;
  const tile = ([label, value, wide]: [string, Html | string, boolean?]) => html`<div${wide ? html` class="is-wide"` : nothing}><dt>${label}</dt><dd>${value}</dd></div>`;
  return html`<dl class="ticket-tiles">
    ${tiles.map(tile)}
    ${ratings.length ? html`<div class="ticket-tiles-pair">${ratings.map(tile)}</div>` : nothing}
  </dl>`;
}

/** The visit's time and, while it is booked, whether the Tenant has confirmed it. */
function visitTile(wo: WorkOrderView, x: Extras): Html {
  const when = formatRange(wo.start, wo.end, x.timeZone);
  if (wo.status !== 'active') return html`${when}`;
  return html`${when}<span class="ticket-tile-note${wo.visitConfirmed ? ' is-ok' : ' is-waiting'}">${wo.visitConfirmed ? 'Tenant confirmed' : 'Tenant not confirmed yet'}</span>`;
}

/** The Call-out Fees the Job owes: each Tradie's whose Site Inspection has happened, whether or not they get the Job. */
function calloutFeesOwed(job: JobView): { cents: number; tradies: string[] } {
  const owed = job.quoteRequests.filter((r) => r.inspection?.status === 'done' && r.estimate?.calloutFeeCents);
  return { cents: owed.reduce((sum, r) => sum + r.estimate!.calloutFeeCents!, 0), tradies: owed.map((r) => r.businessName) };
}

/** The Call-out Fees owed, on a line of their own near the Job's costs: they are not part of the Repair Cost. */
function calloutFeesLine(job: JobView): Html {
  const { cents, tradies } = calloutFeesOwed(job);
  if (!cents) return nothing;
  return html`<p class="callout-fees" id="job-${job.jobId}-fees">
    <span class="num font-semibold">Call-out Fees owed ${formatMoney(cents)}</span>
    <span class="text-muted">to ${andList(tradies)} for ${plural(tradies.length, 'a Site Inspection', 'Site Inspections')} done. Owed whether or not they get the Job, and not part of the Repair Cost.</span>
  </p>`;
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
      // While the Ticket is finished the Rating form sits in the Job card, where the hidden
      // Next card cannot hold it.
      return ratingSection(t, job, !ticketDone(t, x) && nextStep(t, x)?.href === `#job-${job.jobId}-rating`);
    default:
      return nothing;
  }
}

/**
 * While quoting: the Trade if the intake agent wasn't sure, then each Tradie asked on
 * their own row (where they are and their next action), then the Firm Quotes and the
 * Estimates in two tables that are never merged, then the Tradies to ask (folded away
 * once the first round has gone).
 */
function quotingAction(t: TicketView, job: JobView, x: Extras): Html {
  const declined = job.approval?.status === 'declined';
  return html`<div class="space-y-6">
    ${declined ? alert('The Owner said NO. Choose another Firm Quote.', 'warning') : nothing}
    ${job.checkTrade && !job.quoteRequests.length ? tradeForm(t, job) : nothing}
    ${job.quoteRequests.length ? tradieProgress(t, job, x) : nothing}
    ${job.quotes.length ? quotesSection(t, job, x) : nothing}
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
        variant: 'danger',
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
      Nominated Tradies first, then a blend of myEST8 rating, Google rating, job fit (how closely their past work matches this Job, judged by Jev) and median previous Firm Quote.
      ${firstRound ? 'Send the first round to three or four Tradies; the top three are ticked.' : 'Invite more Tradies if the Job is short of Quotes.'}
    </p>
    ${rule?.singleReason ? alert(rule.singleReason, 'info') : (rule?.minimum ?? MIN_QUOTES) > 1
      ? html`<p class="text-sm text-muted">Send Quote Requests to at least ${rule?.minimum === 3 ? 'three' : 'two'} Tradies.</p>`
      : nothing}
    <form method="post" action="/tickets/${t.ticketId}/jobs/${job.jobId}/quote-requests" class="space-y-3">
      ${compactTable(['Tradie', 'Rating', 'Google', 'Job fit', 'Median Firm Quote', 'Ask'], rows, `Recommended Tradies for the ${humanise(job.trade)} Job`)}
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

/** One recommended Tradie as a table row. The two ratings and the job fit sit in their own columns, never combined; bookings sit under the name. */
function recommendationRow(job: JobView, r: Recommendation, rank: number, ticked: boolean, x: Extras): Html[] {
  const id = `job-${job.jobId}-tradie-${r.tradieId}`;
  return [
    html`<div class="space-y-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label for="${id}" class="font-semibold">${rank}. ${r.businessName}</label>
        ${r.nominated ? badge('Nominated', 'success') : nothing}
        ${r.requested ? badge('Already asked', 'info') : nothing}
        ${entityLink('tradie', 'Profile', `/tradies/${r.tradieId}`)}
      </div>
      ${r.bookings.length
        ? html`<ul role="list" class="text-xs text-muted">
            ${r.bookings.map((b) => html`<li>Booked ${formatRange(b.start, b.end, x.timeZone)} by ${b.propertyManager}</li>`)}
          </ul>`
        : nothing}
    </div>`,
    ratingChip({ source: 'myEST8', rating: r.myEst8Rating.average, count: r.myEst8Rating.count, named: false }),
    ratingChip({ source: 'Google', rating: r.googleRating?.rating ?? null, count: r.googleRating?.reviewCount ?? 0, onGoogle: !!r.googleRating, named: false }),
    r.jobFit
      ? html`<span class="metric" title="Judged by Jev from their past Jobs and Google listing, ${Math.round(r.jobFit.confidence * 100)}% sure">${r.jobFit.label}</span>`
      : html`<span class="metric is-empty">Checking…</span>`,
    html`<span class="num">${
      r.medianQuoteCents === null ? 'No previous Firm Quotes' : `Median Firm Quote ${formatMoney(r.medianQuoteCents)} (${r.firmQuoteCount} previous)`
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

/** Every Quote Request on the Job, with when it went and what came back. */
function quoteRequestsSection(job: JobView, x: Extras): Html {
  const rows = job.quoteRequests.map((r) => [
    tradieLink(r.tradieId, r.businessName),
    html`${formatWhen(r.sentAt, x.timeZone)}`,
    statusBadge(r.status),
  ]);
  return html`<section class="space-y-3">${sectionHeader('Quote Requests')} ${table(['Tradie', 'Sent', 'Status'], rows)}</section>`;
}

/** What a Tradie who hasn't given an Estimate yet has done. */
const NO_REPLY: Record<string, string> = { sent: 'No reply yet', reminded: 'No reply after a reminder' };

/**
 * Each Tradie asked, on their own row, as each moves on their own (ADR 0009): how many
 * were asked and have given an Estimate, then per Tradie a chip for where they are,
 * what they have given (the Estimate, the Site Inspection, the Firm Quote) and their
 * next action: check the Estimate, book or mark the Site Inspection, say whether one is
 * needed, or enter a Firm Quote they sent another way.
 */
function tradieProgress(t: TicketView, job: JobView, x: Extras): Html {
  const waiting = job.quoteRequests.filter((r) => r.status === 'sent' || r.status === 'reminded').length;
  const estimated = job.quoteRequests.filter((r) => r.estimate !== null).length;
  const asked = job.quoteRequests.length;
  return html`<section class="space-y-2" id="job-${job.jobId}-requests">
    ${sectionHeader('Tradies quoting')}
    <p class="text-sm text-muted">${asked} asked: ${estimated} gave an Estimate, ${waiting} waiting on a reply. Each Tradie moves on their own.</p>
    <ul role="list" class="tradie-progress" aria-label="Tradies quoting for the ${humanise(job.trade)} Job">
      ${job.quoteRequests.map((r) => tradieRow(t, job, r, x))}
    </ul>
  </section>`;
}

/** A Tradie's place in staged quoting, as a chip with its word. */
function requestChip(r: RequestView): Html {
  switch (r.status) {
    case 'sent':
    case 'reminded':
      return badge('Asked');
    case 'estimated':
      return r.inspectionNeeded ? badge('Needs inspection', 'warning') : badge('Estimate in', 'info');
    case 'inspection_booked':
      return badge('Inspection booked', 'info');
    case 'inspected':
      return badge('Inspected', 'info');
    case 'firm_quoted':
      return badge('Firm Quote in', 'success');
    case 'declined':
      return badge('Declined');
    default:
      return badge('Closed');
  }
}

function tradieRow(t: TicketView, job: JobView, r: RequestView, x: Extras): Html {
  const live = r.status !== 'declined' && r.status !== 'closed';
  const asked = html`<span class="text-muted">asked <time datetime="${r.sentAt}" title="${formatWhen(r.sentAt, x.timeZone)}">${formatAge(r.sentAt, x.now)}</time></span>`;
  const e = r.estimate;
  const facts: Html[] = [];
  if (e) {
    facts.push(html`<span>Estimate <strong class="num">${formatMoney(e.priceCents)}</strong> <span class="text-muted">(non-binding)</span>${e.confirmed ? nothing : html` ${badge('Needs checking', 'warning')}`}</span>`);
    if (e.proposedTime) facts.push(html`<span>Earliest ${formatWhen(e.proposedTime, x.timeZone)}</span>`);
    if (r.inspectionNeeded) {
      const fee = e.calloutFeeCents ? ` for a Call-out Fee of ${formatMoney(e.calloutFeeCents)}` : '';
      facts.push(html`<span>Site Inspection needed${fee}${r.inspectionOverride !== null ? html` <span class="text-xs text-muted">(set by you)</span>` : nothing}</span>`);
    } else if (r.inspectionOverride === false) {
      facts.push(html`<span>No Site Inspection <span class="text-xs text-muted">(set by you)</span></span>`);
    }
  }
  if (r.firmQuote) facts.push(html`<span>Firm Quote <strong class="num">${formatMoney(r.firmQuote.priceCents)}</strong></span>`);
  return html`<li class="tradie-row${live ? '' : ' is-ended'}" id="quote-request-${r.quoteRequestId}">
    <div class="tradie-row-head">
      ${tradieLink(r.tradieId, r.businessName)} ${requestChip(r)}
      <span class="text-sm">${NO_REPLY[r.status] ? html`${NO_REPLY[r.status]}, ` : nothing}${asked}</span>
    </div>
    ${facts.length ? html`<p class="tradie-row-facts">${facts}</p>` : nothing}
    ${r.inspection ? inspectionLine(t, r.inspection, x) : nothing}
    ${job.status === 'quoting' && live ? requestActions(t, job, r, x) : nothing}
  </li>`;
}

/** A Tradie's Site Inspection: when, whether the Tenant has confirmed they'll be in, and Mark inspected once it has started. */
function inspectionLine(t: TicketView, v: NonNullable<RequestView['inspection']>, x: Extras): Html {
  const done = v.status === 'done';
  const tenant = done
    ? badge('Inspected', 'success')
    : v.rescheduleRequestedBy
      ? badge(`${whoAsked(v.rescheduleRequestedBy)} asked for another time`, 'warning')
      : v.visitConfirmed
        ? badge('Tenant confirmed', 'success')
        : badge('Tenant not confirmed yet', 'warning');
  const started = x.now >= new Date(v.start);
  const mark = done
    ? nothing
    : started
      ? postButton(`/tickets/${t.ticketId}/work-orders/${v.workOrderId}/inspected`, 'Mark inspected', { variant: 'secondary', size: 'sm' })
      : html`<span class="text-xs text-muted">Mark it inspected once the visit has started.</span>`;
  return html`<div class="tradie-row-visit">
    <span>${badge('Site inspection', 'neutral', { outline: true })} <span class="num">${formatRange(v.start, v.end, x.timeZone)}</span></span>
    ${tenant} ${mark}
    ${done ? nothing : resendVisitButtons(t, v.workOrderId)}
  </div>`;
}

/** The Tradie's next action on their row while the Job is getting Quotes. */
function requestActions(t: TicketView, job: JobView, r: RequestView, x: Extras): Html {
  const e = r.estimate;
  const actions: Html[] = [];
  if (NO_REPLY[r.status]) actions.push(resendButton(t, r));
  if (e && e.status === 'open' && !e.confirmed) actions.push(confirmForm(t, e, x));
  if (r.status === 'estimated') {
    if (r.inspectionNeeded) actions.push(bookingForm(t, job, r, x));
    actions.push(inspectionToggle(t, r));
  }
  const firmNext = r.status === 'inspected' || (r.status === 'estimated' && !r.inspectionNeeded && !!e?.confirmed);
  if (r.status === 'inspected') actions.push(html`<p class="text-sm text-muted">Waiting on their Firm Quote, asked for after the Site Inspection.</p>`);
  if (firmNext) actions.push(firmQuoteEntry(t, r, x));
  if (r.firmQuote && r.firmQuote.status === 'open') actions.push(html`<a class="link text-sm" href="#quote-${r.firmQuote.quoteId}">Compare in Firm Quotes</a>`);
  return actions.length ? html`<div class="tradie-row-actions">${actions}</div>` : nothing;
}

/** Sends the visit's current email again, to the Tenant or the Tradie. The worker does the sending. */
function resendVisitButtons(t: TicketView, workOrderId: number): Html {
  const action = `/tickets/${t.ticketId}/work-orders/${workOrderId}/resend`;
  return html`${postButton(action, 'Resend to Tenant', { variant: 'secondary', size: 'sm', fields: { to: 'tenant' } })}
    ${postButton(action, 'Resend to Tradie', { variant: 'secondary', size: 'sm', fields: { to: 'tradie' } })}`;
}

/** Sends the Quote Request message again, for a Tradie with no reply who says it never arrived. */
function resendButton(t: TicketView, r: RequestView): Html {
  return postButton(`/tickets/${t.ticketId}/quote-requests/${r.quoteRequestId}/resend`, 'Resend', { variant: 'secondary', size: 'sm' });
}

/** "Inspection needed" or "Not needed", the Property Manager's say over the Tradie's, until one is booked. */
function inspectionToggle(t: TicketView, r: RequestView): Html {
  const needed = r.inspectionNeeded;
  return postButton(`/tickets/${t.ticketId}/quote-requests/${r.quoteRequestId}/inspection-needed`, needed ? 'Site Inspection not needed' : 'Ask for a Site Inspection', {
    variant: 'ghost',
    size: 'sm',
    fields: { needed: needed ? 'no' : 'yes' },
  });
}

/** Books this Tradie's Site Inspection, prefilled with their first free slot, the others one click away. */
function bookingForm(t: TicketView, job: JobView, r: RequestView, x: Extras): Html {
  const free = job.inspections.slots.find((s) => s.quoteRequestId === r.quoteRequestId)?.slots ?? [];
  const id = `request-${r.quoteRequestId}-inspection`;
  return html`<form method="post" action="/tickets/${t.ticketId}/quote-requests/${r.quoteRequestId}/inspection" class="site-form-row">
    <div class="site-form-field">
      ${field({
        id,
        label: `Site Inspection with ${r.businessName}`,
        name: 'start',
        type: 'datetime-local',
        value: free[0] ? isoToLocal(free[0].start, x.timeZone) : '',
        required: true,
        hint: free.length ? `${x.timeZone} time, one hour, inside the Tenant's availability.` : 'No free time found in the next 14 days. Pick one.',
      })}
    </div>
    ${free.length > 1
      ? html`<div class="site-form-slots" role="group" aria-label="Other times for ${r.businessName}">
          <span class="text-sm text-muted">Other times:</span>
          ${free.slice(1).map((slot) => html`<button type="button" class="btn btn-outline btn-sm" data-fill="${id}" data-value="${isoToLocal(slot.start, x.timeZone)}">${formatWhen(slot.start, x.timeZone)}</button>`)}
        </div>`
      : nothing}
    ${button('Book Site Inspection', { size: 'sm' })}
  </form>`;
}

/** A Firm Quote the Tradie sent another way (a PDF by email, say), entered by the Property Manager: the quote page's fields, folded away. */
function firmQuoteEntry(t: TicketView, r: RequestView, x: Extras): Html {
  const id = (name: string) => `request-${r.quoteRequestId}-firm-${name}`;
  return html`<details class="ticket-fold">
    <summary>Enter a Firm Quote they sent</summary>
    <form method="post" action="/tickets/${t.ticketId}/quote-requests/${r.quoteRequestId}/firm-quote" enctype="multipart/form-data" class="ticket-fold-body space-y-2">
      <p class="text-xs text-muted">
        For a Firm Quote ${r.businessName} emailed or sent as a PDF instead of giving it on their quote page. It supersedes their Estimate, which stays on record.
      </p>
      ${field({ id: id('price'), label: 'Firm price ($)', name: 'price', required: true })}
      ${field({ id: id('scope'), label: 'Scope of work', name: 'scopeOfWork', type: 'textarea', rows: 3, required: true, hint: 'What they will do for this price.' })}
      ${field({ id: id('days'), label: 'How many days it takes', name: 'durationDays', type: 'number', min: 1, step: '1', required: true })}
      ${[
        { label: 'Preferred date and time', hint: undefined },
        { label: 'Another date and time', hint: 'Optional.' },
        { label: 'A third date and time', hint: 'Optional.' },
      ].map((inp, i) =>
        field({
          id: id(`time-${i + 1}`),
          label: inp.label,
          name: 'availableTimes',
          type: 'datetime-local',
          required: i === 0,
          hint: inp.hint ? `${x.timeZone} time. ${inp.hint}` : `${x.timeZone} time.`,
        }),
      )}
      ${field({ id: id('pdf'), label: 'Their quote as a PDF', name: 'pdf', type: 'file', accept: 'application/pdf', hint: 'Optional, under 10 MB.' })}
      ${button('Save Firm Quote', { size: 'sm', variant: 'secondary' })}
    </form>
  </details>`;
}

function ratingsCell(q: QuoteView): Html {
  return html`<span class="metric-row">
    ${ratingChip({ source: 'myEST8', rating: q.myEst8Rating.average, count: q.myEst8Rating.count })}
    ${ratingChip({ source: 'Google', rating: q.googleRating?.rating ?? null, count: q.googleRating?.reviewCount ?? 0, onGoogle: !!q.googleRating })}
  </span>`;
}

function quoteTradieCell(q: QuoteView): Html {
  return html`<div class="space-y-1">
    <div>${tradieLink(q.tradieId, q.businessName)}</div>
    ${q.reason ? html`<p class="text-sm">Gone ahead with one Quote: ${q.reason}</p>` : nothing}
  </div>`;
}

/**
 * The Job's Quotes in two tables that are never merged and never share a price column:
 * Firm Quotes (fixed prices for a defined scope, binding once accepted: the only ones
 * chosen, ranked by price among themselves) and Estimates (non-binding ballparks, each
 * saying whether the Tradie needs a Site Inspection and its Call-out Fee). An Estimate a
 * Firm Quote superseded stays listed, muted, and is never offered to choose.
 */
function quotesSection(t: TicketView, job: JobView, x: Extras): Html {
  const getting = job.status === 'quoting';
  // Open Firm Quotes first, cheapest first; then the rest as they came.
  const firm = job.quotes
    .filter((q) => q.stage === 'firm')
    .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || (a.status === 'open' ? (a.priceCents ?? 0) - (b.priceCents ?? 0) : a.quoteId - b.quoteId));
  const estimates = job.quotes.filter((q) => q.stage === 'estimate');
  const firmIn = firm.filter((q) => q.confirmed).length;
  const unchecked = job.quotes.filter((q) => q.status === 'open' && !q.confirmed).length;
  const advice =
    firmIn < MIN_QUOTES
      ? 'myEST8 needs two Firm Quotes before you choose one. To go ahead with fewer, record why.'
      : 'Compare the Firm Quotes and choose one.';
  const firmTable = firm.length
    ? html`<div class="quote-table is-firm">
        <h3 class="quote-table-title">Firm Quotes</h3>
        <p class="text-sm text-muted">Fixed prices for a defined scope of work, binding once accepted. Compared only with each other.</p>
        ${table(
          ['Tradie', 'Firm Quote', 'Scope of work', 'Takes', 'Can start', 'PDF', 'Ratings', getting ? 'Action' : 'Status'],
          firm.map((q) => [
            quoteTradieCell(q),
            html`<span class="num font-semibold">${formatMoney(q.priceCents)}</span>`,
            html`${q.scopeOfWork ?? 'Not given'}`,
            html`${q.durationDays ? `${q.durationDays} ${plural(q.durationDays, 'day')}` : 'Not given'}`,
            html`${q.availableTimes.length ? q.availableTimes.map((t) => formatWhen(t, x.timeZone)).join(', ') : 'Not given'}${q.proposedTime ? html`<br /><span class="text-xs text-muted">Proposed ${formatWhen(q.proposedTime, x.timeZone)}</span>` : nothing}`,
            q.pdfFileId !== null ? html`<a class="link" href="/files/${q.pdfFileId}">PDF</a>` : html`<span class="text-muted">None</span>`,
            ratingsCell(q),
            firmAction(t, job, q, firmIn, x),
          ]),
          {
            caption: `Firm Quotes for the ${humanise(job.trade)} Job`,
            rowHeader: true,
            stack: 'labelled',
            align: ['left', 'right'],
            rowAttributes: firm.map((q) => ({ id: `quote-${q.quoteId}` })),
          },
        )}
      </div>`
    : nothing;
  const estimateTable = estimates.length
    ? html`<div class="quote-table is-estimates">
        <h3 class="quote-table-title">Estimates ${badge('Non-binding')}</h3>
        <p class="text-sm text-muted">Ballparks from the description and photos: the final bill can differ. Never compared with Firm Quotes, and never chosen as one.</p>
        ${table(
          ['Tradie', 'Estimate', 'Site Inspection', 'Call-out Fee', 'Where it stands'],
          estimates.map((q) => {
            const request = job.quoteRequests.find((r) => r.quoteRequestId === q.quoteRequestId);
            return [
              quoteTradieCell(q),
              html`<span class="num">${formatMoney(q.priceCents)}</span>`,
              inspectionCell(q, request),
              html`<span class="num">${q.calloutFeeCents ? formatMoney(q.calloutFeeCents) : 'None'}</span>`,
              estimateStanding(job, q),
            ];
          }),
          {
            caption: `Estimates for the ${humanise(job.trade)} Job`,
            rowHeader: true,
            stack: 'labelled',
            align: ['left', 'right'],
            rowAttributes: estimates.map((q) => ({ id: `quote-${q.quoteId}`, 'data-superseded': q.status === 'superseded' })),
          },
        )}
      </div>`
    : nothing;
  return html`<section class="space-y-4" id="job-${job.jobId}-quotes">
    ${sectionHeader('Quotes')}
    ${getting
      ? html`<p class="text-sm text-muted">${firmIn} ${plural(firmIn, 'Firm Quote')}, ${estimates.length} ${plural(estimates.length, 'Estimate')}${unchecked ? `, ${unchecked} to check` : ''}. ${advice}</p>`
      : nothing}
    ${firmTable} ${estimateTable}
  </section>`;
}

/** Whether the Tradie needs a Site Inspection before their Firm Quote, and whether the Property Manager said so. */
function inspectionCell(q: QuoteView, request: RequestView | undefined): Html {
  const needed = request?.inspectionNeeded ?? !!q.needsInspection;
  const overridden = request?.inspectionOverride !== null && request?.inspectionOverride !== undefined;
  return html`<span>${needed ? 'Needed' : 'Not needed'}${overridden ? html` <span class="text-xs text-muted">(set by you)</span>` : nothing}</span>`;
}

/** Where an Estimate stands. Never Choose: a superseded one names the Firm Quote that replaced it. */
function estimateStanding(job: JobView, q: QuoteView): Html {
  const by = job.quotes.find((f) => f.quoteId === q.supersededByQuoteId);
  switch (q.status) {
    case 'superseded':
      return html`<span class="text-muted">Superseded by Firm Quote ${by ? formatMoney(by.priceCents) : ''}</span>`;
    case 'approved':
    case 'awaiting_owner':
      return q.notToExceedCents === null ? statusBadge(q.status) : html`${statusBadge(q.status)} <span class="text-sm">Capped at ${formatMoney(q.notToExceedCents)}</span>`;
    case 'open':
      return q.confirmed ? badge('Confirmed', 'success') : badge('Needs checking', 'warning');
    default:
      return statusBadge(q.status);
  }
}

/** What can be done to a Firm Quote: choose it while the Job is getting Quotes, else where it stands. */
function firmAction(t: TicketView, job: JobView, q: QuoteView, firmIn: number, x: Extras): Html {
  if (q.status === 'open' && job.status === 'quoting' && q.confirmed) return chooseForm(t, q, firmIn, x);
  return q.status === 'open' ? badge('Confirmed', 'success') : statusBadge(q.status);
}
function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
}

/** What was read from the Tradie's reply, folded under "Check Estimate" until the Property Manager opens it to correct and confirm it. */
function confirmForm(t: TicketView, q: EstimateView, x: Extras): Html {
  return html`<details class="quote-check">
    <summary class="btn btn-primary btn-sm">Check Estimate</summary>
    <form method="post" action="/tickets/${t.ticketId}/quotes/${q.quoteId}/confirm" class="mt-3 space-y-2">
      <p class="text-xs text-muted">
        Check what was read from the reply${q.hasPdf ? ' and its PDF' : ''} and correct anything wrong. Only confirmed Estimates count.
      </p>
      ${field({
        id: `quote-${q.quoteId}-price`,
        label: 'Estimate ($)',
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
      ${button('Confirm Estimate', { variant: 'confirm', size: 'sm', block: true })}
    </form>
  </details>`;
}

/** Choosing this price would take the Repair Cost over the Max Repair Cost, so the Property Owner is asked. */
function asksOwner(t: TicketView, cents: number | null): boolean {
  return t.repairCostCents + (cents ?? 0) > t.maxRepairCostCents;
}

/** The warning on an approval step when no channel reaches the Owner, with a link to add an email. */
function unreachedNote(t: TicketView, x: Extras): Html {
  if (!x.ownerUnreached) return nothing;
  return alert(
    html`${t.owner.name} can't be reached: ${x.ownerUnreached}. <a href="/owners/${t.owner.personId}?edit=details#details">Add an email</a>`,
    'warning',
  );
}

function chooseForm(t: TicketView, q: QuoteView, confirmed: number, x: Extras): Html {
  const question = `Choose ${q.businessName}'s Firm Quote of ${formatMoney(q.priceCents)}?`;
  return html`<form method="post" action="/tickets/${t.ticketId}/quotes/${q.quoteId}/choose" class="space-y-2" data-confirm="${question}">
    ${asksOwner(t, q.priceCents) ? unreachedNote(t, x) : nothing}
    ${confirmed < MIN_QUOTES
      ? field({
          id: `quote-${q.quoteId}-reason`,
          label: 'Why go ahead with one Firm Quote?',
          name: 'reason',
          type: 'textarea',
          rows: 2,
          hint: 'For example a specialist or time-critical Job.',
        })
      : nothing}
    ${button('Choose this Firm Quote', { variant: 'confirm', size: 'sm', block: true })}
  </form>`;
}

function approvalSection(t: TicketView, job: JobView, approval: NonNullable<JobView['approval']>, x: Extras): Html {
  const quote = job.quotes.find((q) => q.quoteId === approval.quoteId);
  const asked = lastEvent(t, 'approval_requested', job.jobId);
  const repairCost = typeof asked?.repairCostCents === 'number' ? asked.repairCostCents : null;
  const waiting = approval.status === 'requested' || approval.status === 'reminded';
  return html`<section class="space-y-3" id="job-${job.jobId}-approval">
    ${sectionHeader('Owner approval', statusBadge(approval.status))}
    ${unreachedNote(t, x)}
    <p>
      Asked ${formatWhen(approval.requestedAt, x.timeZone)} to approve ${quote ? `${quote.businessName}'s` : 'the'} Quote of
      ${formatMoney(quote?.priceCents ?? null)}, which takes the Repair Cost to ${formatMoney(repairCost)}, over the Max Repair Cost of
      ${formatMoney(t.maxRepairCostCents)}. The Owner replies YES or NO.
    </p>
    ${waiting
      ? html`<p class="text-muted">
          ${approval.status === 'reminded' ? 'Reminded after 24 hours.' : 'A reminder goes after 24 hours.'}
          You'll get an alert if there's no reply after 48 hours.
        </p>
        ${postButton(`/tickets/${t.ticketId}/approvals/${approval.approvalId}/resend`, 'Resend approval request', { variant: 'secondary', size: 'sm' })}`
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
      Send the Work Order to book the visit: the Tradie gets the address, and the Tenant and Owner are told the time.
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
    ${job.offeredVisit
      ? html`<p>
          ${approved?.businessName ?? 'The Tradie'} offered ${andList(job.offeredVisit.starts.map((start) => formatWhen(start, x.timeZone)))}. The Tenant is choosing.
        </p>`
      : nothing}
    ${approved ? postButton(`/tickets/${t.ticketId}/jobs/${job.jobId}/ask-times`, `Ask ${approved.businessName} to offer times`, { variant: 'secondary' }) : nothing}
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
  const asker = whoAsked(wo.rescheduleRequestedBy);
  // While it is booked the Job's tiles already say the visit, the Tradie and whether the
  // Tenant confirmed, so only what to do about it shows here.
  if (active) {
    return html`<section class="ticket-wo" id="job-${wo.jobId}-work-order" aria-label="Work Order">
      ${wo.rescheduleRequestedBy ? alert(`The ${asker} asked for another time.`, 'warning') : nothing}
      <div class="ticket-wo-actions">
        ${suggesting ? nothing : suggest}
        ${postButton(`/tickets/${t.ticketId}/jobs/${wo.jobId}/ask-times`, `Ask ${wo.businessName} to offer times`, { variant: 'secondary', size: 'sm' })}
        ${resendVisitButtons(t, wo.workOrderId)}
      </div>
      ${suggesting && x.suggest ? suggestionsPanel(t, wo, x.suggest, x) : nothing}
    </section>`;
  }
  return html`<section class="space-y-3" id="job-${wo.jobId}-work-order">
    ${sectionHeader('Work Order')}
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

function ratingSection(t: TicketView, job: JobView, inNext = false): Html {
  const rated = lastEvent(t, 'tradie_rated', job.jobId);
  // The Job's tiles carry the rating once it is given, and the Next card holds the
  // form while it waits: the section itself has nothing left to say in either case.
  if (rated || inNext) return nothing;
  return html`<section class="space-y-3" id="job-${job.jobId}-rating">
    ${sectionHeader('Rating')}
    <p>${ratedLine(t, job)}</p>${ratingForm(t, job)}
  </section>`;
}

/** What the Tenant said of the fix, or that we are waiting. */
function ratedLine(t: TicketView, job: JobView): string {
  const tenant = lastEvent(t, 'tenant_rated', job.jobId);
  return tenant ? `The Tenant rated the fix ${String(tenant.score)} out of 5.` : 'Waiting for the Tenant to say if it was fixed properly.';
}

/** How the Property Manager rates the Tradie: 1 (poor) to 5 (excellent), as five round buttons. */
function ratingForm(t: TicketView, job: JobView): Html {
  const tradie = job.workOrder?.businessName ?? 'the Tradie';
  return html`<form method="post" action="/tickets/${t.ticketId}/jobs/${job.jobId}/rate" class="ticket-rate" id="job-${job.jobId}-rating-form">
    <p>How did ${tradie} do? 1 is poor, 5 is excellent. It feeds their myEST8 rating. ${lastEvent(t, 'tenant_rated', job.jobId) ? `The Tenant gave ${String(lastEvent(t, 'tenant_rated', job.jobId)!.score)}.` : ''}</p>
    <div class="ticket-rate-buttons">
      ${[1, 2, 3, 4, 5].map((n) => button(String(n), { name: 'score', value: String(n), variant: 'secondary' }))}
    </div>
  </form>`;
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
    // Choosing is the Property Manager's act, so the line says "chosen": only the Property Owner approves.
    return { at, title: `Firm Quote from ${String(d[0]!.tradie)} chosen`, ...(chosen.detail ? { detail: chosen.detail } : {}) };
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
      return d.reworkOf ? { title: `${humanise(String(d.trade))} Job added to redo the work`, detail: 'The Tenant said it wasn\'t fixed' } : { title: `${humanise(String(d.trade))} Job added` };
    case 'reopened':
      return { title: 'Ticket reopened', detail: "The Tenant said the repair wasn't fixed" };
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
      return { title: `Estimate received from ${tradie}`, detail: details(job, d.needsInspection ? 'Needs a Site Inspection before a Firm Quote' : undefined) };
    case 'firm_quote_received':
      return {
        title: d.enteredBy === 'property_manager' ? `Firm Quote from ${tradie} entered by a Property Manager` : `Firm Quote received from ${tradie}`,
        detail: details(job, price, 'It supersedes their Estimate, which stays on record'),
      };
    case 'inspection_need_set':
      return { title: d.needed ? `Site Inspection asked of ${tradie}` : `${tradie} can give a Firm Quote without a Site Inspection`, detail: details(job, 'Set by a Property Manager') };
    case 'inspection_booked':
      return { title: `Site Inspection booked with ${tradie}`, detail: details(job, visit) };
    case 'inspected':
      return { title: `${tradie}'s Site Inspection done`, detail: details(job, 'They were asked for their Firm Quote') };
    case 'inspection_cancelled':
      return {
        title: `${tradie}'s Site Inspection cancelled`,
        detail: details(job, visit, d.why === 'declined' ? `${tradie} declined the Quote Request` : d.why === 'job_cancelled' ? 'The Job was cancelled' : 'Another Quote was approved'),
      };
    case 'quote_chosen': {
      const reason = typeof d.reason === 'string' ? `Only one Quote: ${d.reason}` : undefined;
      return { title: `Firm Quote from ${tradie} chosen`, detail: details(job, price, reason) };
    }
    case 'approval_requested': {
      const total = typeof d.repairCostCents === 'number' ? `Repair Cost would be ${formatMoney(d.repairCostCents)}` : undefined;
      return { title: 'Owner asked to approve', detail: details(job, total) };
    }
    case 'quote_approved':
      return d.stage === 'estimate'
        ? { title: `${tradie}'s Estimate approved, capped`, detail: details(job, price ? `Not-to-exceed Cap ${price}` : undefined) }
        : { title: `${d.stage === 'firm' ? 'Firm Quote' : 'Quote'} from ${tradie} approved`, detail: details(job, price) };
    case 'owner_declined':
      return { title: 'Owner declined the Quote', detail: details(job, price) };
    case 'work_order_sent':
      return { title: `Work Order sent to ${tradie}`, detail: details(job, visit) };
    case 'visit_times_asked':
      return { title: 'Asked the Tradie to offer visit times', detail: job };
    case 'reschedule_requested':
      return { title: `${whoAsked(typeof d.by === 'string' ? d.by : null)} asked for another time${d.inspection ? ' for the Site Inspection' : ''}`, detail: job };
    case 'other_times_requested':
      return { title: 'The Tenant asked for other times', detail: details(job, typeof d.note === 'string' ? d.note : undefined) };
    case 'visit_confirmed':
      return { title: d.inspection ? 'Tenant confirmed the Site Inspection' : 'Tenant confirmed the visit', detail: details(job, "They'll be home or can let the Tradie in") };
    case 'visit_moved':
      return { title: d.inspection || d.siteQuote ? 'Site Inspection moved' : 'Visit moved', detail: details(job, visit) };
    case 'job_done':
      return { title: `${tradie} finished the Job`, detail: job };
    case 'tenant_rated':
      return { title: `Tenant rated the fix ${String(d.score)} out of 5`, detail: job };
    case 'tradie_rated':
      return { title: `Tradie rated ${String(d.score)} out of 5`, detail: job };
    case 'closed':
      return { title: 'Ticket closed' };
    case 'summary_edited':
      return { title: 'Summary edited', detail: typeof d.summary === 'string' ? d.summary : undefined };
    // Kept from before staged quoting (ADR 0007), for Tickets that have them.
    case 'site_quotes_booked':
      return { title: 'Site visits booked for quotes', detail: job };
    case 'site_quotes_skipped':
      return { title: 'Quotes given without site visits', detail: job };
    case 'site_quote_done':
      return { title: `${tradie} visited to quote`, detail: job };
    case 'quotes_final':
      return { title: 'Final Quotes in', detail: job };
    default:
      return { title: humanise(event.kind), detail: job };
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
  return entityLink('tradie', name, `/tradies/${tradieId}`);
}

/** "Plumbing Job", or "Job 2: Plumbing" when the Ticket has several. */
function jobLabel(t: TicketView, jobId: number): string {
  const index = t.jobs.findIndex((j) => j.jobId === jobId);
  const job = t.jobs[index];
  if (!job) return 'Job';
  const label = t.jobs.length > 1 ? `Job ${index + 1}: ${humanise(job.trade)}` : `${humanise(job.trade)} Job`;
  return job.reworkOf ? `${label} (redo)` : label;
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

/** What sending Quote Requests says: how many went out, and who couldn't be reached and why. Shared with Dispatch. */
export function quoteRequestsSent({ sent, unreached }: Awaited<ReturnType<PropertyManagerActions['sendQuoteRequests']>>): string {
  const sentText = `Quote ${plural(sent, 'Request')} sent to ${sent} ${plural(sent, 'Tradie')}`;
  return unreached.length ? `${sentText}. Couldn't reach ${unreached.map((u) => `${u.tradie}: ${u.reason}`).join('; ')}` : sentText;
}

/** Who asked to move a visit, for the Ticket's sentences. */
function whoAsked(by: string | null | undefined): string {
  if (by === 'tenant') return 'Tenant';
  if (by === 'tradie') return 'Tradie';
  return 'Property Manager';
}

/** "A", "A and B", "A, B and C". */
function andList(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
