import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { ProviderRefusedError, UndeliverableError } from './ports.ts';
import { addMs, dollars, HOUR_MS, invalid, iso, median, newToken, notFound, withoutContactDetails, type Trade } from './shared.ts';
import type { OpenItem } from './tickets.ts';
import { wallClock } from './zoned-time.ts';

const QUOTE_REMINDER_MS = 48 * HOUR_MS;
const FIRM_QUOTE_REMINDER_MS = 48 * HOUR_MS;
const MORE_QUOTES_PROMPT_MS = 72 * HOUR_MS;
const OWNER_REMINDER_MS = 24 * HOUR_MS;
const OWNER_ALERT_MS = 48 * HOUR_MS;
/** Firm Quotes a Job needs before one can be chosen without a reason (and Estimates, to proceed on one without a reason). */
export const MIN_QUOTES = 2;
/** Quote Requests a Job needs (sent and new together) before the Property Manager compares prices. */
export const MIN_QUOTE_REQUESTS = 2;
/** The most Tradies `recommend` returns, and how many of them start ticked. */
const MAX_RECOMMENDED = 4;
const PRESELECTED = 3;
/** The most start dates a Firm Quote lists. */
const MAX_AVAILABLE_DATES = 3;
const MAX_SCOPE_LENGTH = 2000;
/** The most a Quote, Call-out Fee or Not-to-exceed Cap may be: anything more is a typo, never a repair price. */
const MAX_QUOTE_CENTS = 1_000_000_00;
const MAX_DURATION_DAYS = 365;

/**
 * Where one Tradie's Quote Request stands. Each moves on its own (ADR 0009):
 * sent -> (reminded) -> estimated -> [inspection_booked -> inspected] -> firm_quoted,
 * or declined, or closed (another Quote was approved, or the Job was cancelled).
 */
export type QuoteRequestStatus = 'sent' | 'reminded' | 'estimated' | 'inspection_booked' | 'inspected' | 'firm_quoted' | 'declined' | 'closed';
/** An Estimate (a ballpark, non-binding) or a Firm Quote (a fixed price for a defined scope). Never compared as if equal. */
export type QuoteStage = 'estimate' | 'firm';
/** `superseded`: an Estimate the same Tradie's Firm Quote has replaced; it stays on record. */
export type QuoteStatus = 'open' | 'superseded' | 'awaiting_owner' | 'approved' | 'declined_by_owner' | 'not_chosen';
type ApprovalStatus = 'requested' | 'reminded' | 'approved' | 'declined' | 'cancelled';

type QuoteRequestRow = {
  id: number;
  agency_id: number;
  job_id: number;
  ticket_id: number;
  tradie_id: number;
  status: QuoteRequestStatus;
  sent_at: string;
  token: string;
  inspection_override: boolean | null;
};
type QuoteRow = {
  id: number;
  agency_id: number;
  job_id: number;
  ticket_id: number;
  quote_request_id: number;
  tradie_id: number;
  trade: Trade;
  stage: QuoteStage;
  price_cents: number | null;
  proposed_time: string | null;
  confirmed: number;
  status: QuoteStatus;
  pdf_file_id: number | null;
  single_quote_reason: string | null;
  received_at: string;
  supersedes_quote_id: number | null;
  needs_inspection: boolean;
  callout_fee_cents: number | null;
  scope_of_work: string | null;
  duration_days: number | null;
  available_dates: unknown;
  not_to_exceed_cents: number | null;
};
type CancelledVisit = { id: number; ticket_id: number; job_id: number; tradie_id: number; start: string; end: string };
type ApprovalRow = { id: number; agency_id: number; quote_id: number; job_id: number; ticket_id: number; owner_id: number; status: ApprovalStatus; requested_at: string };

/** Waiting on the Tradie's Estimate. */
const AWAITING_ESTIMATE: QuoteRequestStatus[] = ['sent', 'reminded'];
/** Still in the running: not declined, closed or done. */
const LIVE: QuoteRequestStatus[] = ['sent', 'reminded', 'estimated', 'inspection_booked', 'inspected', 'firm_quoted'];
const OPEN_APPROVAL: ApprovalStatus[] = ['requested', 'reminded'];

/** What a Tradie gives with an Estimate on the quote page. */
export type EstimateInput = { priceCents: number; proposedTime?: string | null; needsInspection: boolean; calloutFeeCents?: number | null };
/** What a Tradie gives with a Firm Quote on the quote page. `availableDates` are ISO dates ("2026-10-20"). */
export type FirmQuoteInput = {
  priceCents: number;
  scopeOfWork: string;
  durationDays: number;
  availableDates: string[];
  proposedTime?: string | null;
  pdf?: { filename: string; contentType: string; content: Uint8Array } | null;
};

/** The ISO dates stored for a Firm Quote. */
function datesOf(value: unknown): string[] {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : [];
}

/** What a Quote counts towards the Repair Cost: the Not-to-exceed Cap when proceeding on an Estimate, else its price. */
const costOf = (q: QuoteRow) => q.not_to_exceed_cents ?? q.price_cents!;

/** Refuses a send of Quote Requests that reached no Tradie, naming each and why. */
function refuseNoneSent(unreached: { tradie: string; reason: string }[]): never {
  invalid(`No Quote Requests were sent. Couldn't reach ${unreached.map((u) => `${u.tradie}: ${u.reason}`).join('; ')}`);
}

/** Whether a whole number of cents above zero. */
const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** Refuses an amount that isn't whole cents above zero with `message`, and one over MAX_QUOTE_CENTS as a typo, against `field`. */
function requireAmount(n: unknown, message: string, field?: string): asserts n is number {
  if (!isCents(n)) invalid(message, field);
  if (n > MAX_QUOTE_CENTS) invalid(`Check the amount: it is over ${dollars(MAX_QUOTE_CENTS)}`, field);
}

/** Tradie recommendation, Quote Requests, Estimates and Firm Quotes, choosing, Property Owner approval and Repair Cost. */
export function createQuotes({ db, clock, worker, ports, files, settings, modules }: Context) {

  const { profiles, tickets, notifications } = modules;
  const businessName = async (tradieId: number) => {
    const tradie = await profiles.person(tradieId);
    return tradie.businessName ?? tradie.name;
  };
  const quoteLink = (request: QuoteRequestRow) => `${settings.baseUrl}/q/${request.token}`;

  async function quoteRequestsOf(jobId: number) {
    return await all<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE job_id = ? ORDER BY id', jobId);
  }

  async function quoteRequestRow(id: number) {
    return await one<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE id = ?', id);
  }

  async function quotesOf(jobId: number) {
    return await all<QuoteRow>(db, 'SELECT * FROM quotes WHERE job_id = ? ORDER BY id', jobId);
  }

  async function quoteOf(quoteRequestId: number, stage: QuoteStage) {
    return await one<QuoteRow>(db, 'SELECT * FROM quotes WHERE quote_request_id = ? AND stage = ?', quoteRequestId, stage);
  }

  /** Tradies on the Job with a confirmed Quote of either stage. */
  async function pricedCount(jobId: number) {
    return (await one<{ n: number }>(db, 'SELECT count(DISTINCT quote_request_id) AS n FROM quotes WHERE job_id = ? AND confirmed = 1', jobId))!.n;
  }

  /** Confirmed Firm Quotes on the Job, whatever became of them. */
  async function firmCount(jobId: number) {
    return (await one<{ n: number }>(db, `SELECT count(*) AS n FROM quotes WHERE job_id = ? AND stage = 'firm' AND confirmed = 1`, jobId))!.n;
  }

  async function quoteInAgency(agencyId: number, quoteId: number) {
    const quote = await one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ? AND agency_id = ?', quoteId, agencyId);
    if (!quote) notFound('Quote');
    return quote;
  }

  async function requestInAgency(agencyId: number, quoteRequestId: number) {
    const request = await one<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE id = ? AND agency_id = ?', quoteRequestId, agencyId);
    if (!request) notFound('Quote Request');
    return request;
  }

  /** Whether the Tradie must inspect before a Firm Quote: the Property Manager's say, else the Tradie's on their Estimate. */
  function inspectionNeeded(request: QuoteRequestRow, estimate: QuoteRow | undefined) {
    return request.inspection_override ?? estimate?.needs_inspection ?? false;
  }

  /** Whether the Tradie may give their Firm Quote now: after the Site Inspection, or straight after an Estimate that needs none. */
  function firmQuoteAllowed(request: QuoteRequestRow, estimate: QuoteRow | undefined) {
    return request.status === 'inspected' || (request.status === 'estimated' && !!estimate && !inspectionNeeded(request, estimate));
  }

  /**
   * Each Quote Request's latest confirmed Quote with the Trade: the Firm Quote where
   * there is one, else the Estimate. Oldest first.
   */
  async function previousQuotes(tradieId: number, trade: Trade) {
    return (await all<{ price_cents: number; received_at: string; job_id: number; stage: QuoteStage; id: number }>(
      db,
      `SELECT * FROM (
         SELECT DISTINCT ON (quote_request_id) id, price_cents, received_at, job_id, stage FROM quotes
         WHERE tradie_id = ? AND trade = ? AND confirmed = 1 ORDER BY quote_request_id, (stage = 'firm') DESC, id DESC
       ) latest ORDER BY received_at, id`,
      tradieId,
      trade,
    )).map((q) => ({ priceCents: q.price_cents, at: q.received_at, jobId: q.job_id, stage: q.stage }));
  }

  /** The total of a Ticket's approved Quotes: each Firm Quote's price, or the Not-to-exceed Cap of an Estimate proceeded on. */
  async function repairCost(ticketId: number) {
    return (await one<{ total: number }>(
      db,
      `SELECT coalesce(sum(coalesce(not_to_exceed_cents, price_cents)), 0) AS total FROM quotes WHERE ticket_id = ? AND status = 'approved'`,
      ticketId,
    ))!.total;
  }

  async function jobPlace(jobId: number) {
    const job = await tickets.job(jobId);
    const ticket = await tickets.ticket(job.ticketId);
    return { job, ticket, property: await profiles.property(ticket.propertyId) };
  }

  /**
   * Cancels the active Site Inspections matching `where` (on `work_orders`), recording each on
   * the timeline with `why`: another Quote was approved, the Tradie declined, or the Job was cancelled. The Tenant is
   * no longer asked to confirm them. Inside a transaction; returns the visits, to tell once it commits.
   */
  async function cancelInspections(where: string, id: number, why: 'quote_approved' | 'declined' | 'job_cancelled') {
    const cancelled = await all<CancelledVisit>(
      db,
      `UPDATE work_orders SET status = 'cancelled' WHERE ${where} AND kind = 'inspection' AND status = 'active' RETURNING id, ticket_id, job_id, tradie_id, start, "end"`,
      id,
    );
    for (const v of cancelled) {
      await tickets.recordEvent(v.ticket_id, 'inspection_cancelled', { jobId: v.job_id, tradie: await businessName(v.tradie_id), visitStart: v.start, visitEnd: v.end, why });
      await modules.intake.stopWaitingOnVisit((await tickets.ticket(v.ticket_id)).tenantId, v.id);
    }
    return cancelled;
  }

  /** Tells the Tenant each cancelled Site Inspection is off, so they don't wait in for it. */
  async function tellTenantsCancelled(cancelled: CancelledVisit[]) {
    for (const v of cancelled) {
      const ticket = await tickets.ticket(v.ticket_id);
      await notifications.send(
        ticket.tenantId,
        'tenant.inspection_cancelled',
        { tradieBusinessName: await businessName(v.tradie_id), visitStart: v.start },
        { issueId: ticket.issueId },
      );
    }
  }

  /**
   * Approves a chosen Quote, cancels every Site Inspection still to happen on the Job (the
   * chosen Tradie's included) and closes the other Quote Requests. Returns the requests
   * passed over and the visits cancelled, to tell.
   */
  async function approveQuote(quote: QuoteRow) {
    const job = await tickets.job(quote.job_id);
    return transaction(db, async () => {
      await run(db, `UPDATE quotes SET status = 'approved' WHERE id = ?`, quote.id);
      await tickets.setJobStatus(job.id, 'approved');
      await tickets.recordEvent(job.ticketId, 'quote_approved', {
        jobId: job.id,
        tradie: await businessName(quote.tradie_id),
        priceCents: costOf(quote),
        stage: quote.stage,
      });
      const cancelled = await cancelInspections('job_id = ?', job.id, 'quote_approved');
      const others = (await quoteRequestsOf(job.id)).filter((r) => r.id !== quote.quote_request_id && LIVE.includes(r.status));
      for (const request of others) {
        await run(db, `UPDATE quote_requests SET status = 'closed' WHERE id = ?`, request.id);
        await run(db, `UPDATE quotes SET status = 'not_chosen' WHERE quote_request_id = ? AND status = 'open'`, request.id);
      }
      return { passedOver: others, cancelled };
    });
  }

  /**
   * Tells the Tradies whose Quote Requests closed when another Quote was approved, each in one
   * message that also calls off their Site Inspection if one was booked, and the Tenant of each
   * Site Inspection cancelled.
   */
  async function tellPassedOver(quote: QuoteRow, { passedOver, cancelled }: Awaited<ReturnType<typeof approveQuote>>) {
    const { job, ticket, property } = await jobPlace(quote.job_id);
    for (const request of passedOver) {
      const visit = cancelled.find((v) => v.tradie_id === request.tradie_id);
      await notifications.send(
        request.tradie_id,
        'tradie.not_chosen',
        { trade: job.trade, suburb: property.suburb, ...(visit ? { inspectionStart: visit.start } : {}) },
        { issueId: ticket.issueId },
      );
    }
    await tellTenantsCancelled(cancelled);
  }

  /**
   * Approves `quote` when `costCents` keeps the Ticket's Repair Cost within the Max Repair
   * Cost, else asks the Property Owner. Runs inside the caller's transaction; returns what
   * to send once it commits.
   */
  async function approveOrAskOwner(quote: QuoteRow, costCents: number) {
    const { job, ticket, property } = await jobPlace(quote.job_id);
    const repairCostCents = (await repairCost(ticket.id)) + costCents;
    if (repairCostCents <= property.maxRepairCostCents) return { approved: true as const, quote, closed: await approveQuote(quote) };

    await run(db, `UPDATE quotes SET status = 'awaiting_owner' WHERE id = ?`, quote.id);
    await tickets.setJobStatus(job.id, 'awaiting_owner');
    await tickets.recordEvent(ticket.id, 'approval_requested', { jobId: job.id, repairCostCents });
    const approvalId = await run(
      db,
      `INSERT INTO approvals (agency_id, quote_id, job_id, ticket_id, owner_id, status, requested_at) VALUES (?, ?, ?, ?, ?, 'requested', ?) RETURNING id`,
      quote.agency_id,
      quote.id,
      job.id,
      ticket.id,
      property.ownerId,
      iso(clock.now()),
    );
    return { approved: false as const, quote, job, ticket, property, repairCostCents, approvalId, costCents };
  }

  async function afterDecision(outcome: Awaited<ReturnType<typeof approveOrAskOwner>>) {
    if (outcome.approved) return tellPassedOver(outcome.quote, outcome.closed);
    const { quote, job, ticket, property, repairCostCents, approvalId, costCents } = outcome;
    await notifications.send(
      property.ownerId,
      'owner.approval_request',
      {
        propertyAddress: property.address,
        trade: job.trade,
        tradieBusinessName: await businessName(quote.tradie_id),
        quotePriceCents: costCents,
        repairCostCents,
        maxRepairCostCents: property.maxRepairCostCents,
      },
      { issueId: ticket.issueId },
    );
    await worker.schedule('quotes.owner_reminder', { approvalId }, addMs(clock.now(), OWNER_REMINDER_MS));
  }

  /** Inserts an Estimate for a request still waiting on one, and moves the request on. Inside a transaction. */
  async function insertEstimate(
    request: QuoteRequestRow,
    e: { priceCents: number | null; proposedTime: string | null; needsInspection: boolean; calloutFeeCents: number | null; pdfFileId: number | null; confirmed: boolean },
  ) {
    const job = await tickets.job(request.job_id);
    await run(
      db,
      `INSERT INTO quotes (agency_id, job_id, ticket_id, quote_request_id, tradie_id, trade, stage, price_cents, proposed_time, confirmed, status,
         pdf_file_id, received_at, needs_inspection, callout_fee_cents)
       VALUES (?, ?, ?, ?, ?, ?, 'estimate', ?, ?, ?, 'open', ?, ?, ?, ?)`,
      request.agency_id,
      job.id,
      request.ticket_id,
      request.id,
      request.tradie_id,
      job.trade,
      e.priceCents,
      e.proposedTime,
      e.confirmed ? 1 : 0,
      e.pdfFileId,
      iso(clock.now()),
      e.needsInspection,
      e.needsInspection ? e.calloutFeeCents : null,
    );
    await run(db, `UPDATE quote_requests SET status = 'estimated' WHERE id = ?`, request.id);
    await tickets.recordEvent(request.ticket_id, 'estimate_received', {
      jobId: job.id,
      tradie: await businessName(request.tradie_id),
      ...(e.needsInspection ? { needsInspection: true } : {}),
    });
  }

  /** A future instant from a form or reply, or null when left out. */
  function futureTime(value: string | null | undefined, field: string) {
    if (value === undefined || value === null || value === '') return null;
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) invalid(`${value} is not a time`, field);
    if (at < clock.now()) invalid('Pick a time in the future', field);
    return iso(at);
  }

  /** Sends the Tradie their quote page for the Firm Quote, when a price arrives by message after their Estimate. */
  async function sendFirmQuoteLink(request: QuoteRequestRow, template: 'tradie.firm_quote_link' | 'tradie.firm_quote_request' | 'tradie.firm_quote_reminder') {
    const { job, ticket, property } = await jobPlace(request.job_id);
    await notifications.send(
      request.tradie_id,
      template,
      { trade: job.trade, suburb: property.suburb, propertyAddress: property.address, quoteLink: quoteLink(request) },
      { issueId: ticket.issueId },
    );
  }

  /** Sends the Tradie their Quote Request message with their quote page link. The Tenant's photos go with it by email only. */
  async function sendQuoteRequest(request: QuoteRequestRow) {
    const { job, ticket, property } = await jobPlace(request.job_id);
    const issue = await tickets.issue(ticket.issueId);
    const byEmail = (await notifications.channelFor(request.tradie_id)) === 'email';
    await notifications.send(
      request.tradie_id,
      'tradie.quote_request',
      {
        trade: job.trade,
        urgency: ticket.urgency,
        description: withoutContactDetails(issue.summary ?? issue.description),
        suburb: property.suburb,
        quoteLink: quoteLink(request),
      },
      { issueId: issue.id, attachmentFileIds: byEmail ? (await tickets.photos(issue.id)).map((p) => p.fileId) : [] },
    );
  }

  worker.on<{ quoteRequestId: number }>('quotes.reminder', async ({ quoteRequestId }) => {
    // Only a request still waiting is reminded, even if the Tradie's reply lands at the same moment.
    const request = await one<QuoteRequestRow>(db, `UPDATE quote_requests SET status = 'reminded' WHERE id = ? AND status = 'sent' RETURNING *`, quoteRequestId);
    if (!request) return;
    const { job, ticket, property } = await jobPlace(request.job_id);
    await notifications.send(
      request.tradie_id,
      'tradie.quote_reminder',
      { trade: job.trade, suburb: property.suburb, quoteLink: quoteLink(request) },
      { issueId: ticket.issueId },
    );
  });

  worker.on<{ quoteRequestId: number }>('quotes.firm_quote_reminder', async ({ quoteRequestId }) => {
    const request = await quoteRequestRow(quoteRequestId);
    if (request?.status !== 'inspected' || (await tickets.job(request.job_id)).status !== 'quoting') return;
    await sendFirmQuoteLink(request, 'tradie.firm_quote_reminder');
  });

  worker.on<{ approvalId: number }>('quotes.owner_reminder', async ({ approvalId }) => {
    const approval = await one<ApprovalRow>(db, `UPDATE approvals SET status = 'reminded' WHERE id = ? AND status = 'requested' RETURNING *`, approvalId);
    if (!approval) return;
    const quote = (await one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ?', approval.quote_id))!;
    const { job, ticket, property } = await jobPlace(approval.job_id);
    await notifications.send(
      approval.owner_id,
      'owner.approval_reminder',
      { propertyAddress: property.address, trade: job.trade, quotePriceCents: costOf(quote) },
      { issueId: ticket.issueId },
    );
  });

  /** What a send of Quote Requests must meet: see `quoteRequestRule`. */
  async function requestRule(agencyId: number, jobId: number, trade: Trade) {
    const askedIds = new Set((await quoteRequestsOf(jobId)).map((r) => r.tradie_id));
    const available = (await profiles.tradiesWithTrade(agencyId, trade)).filter((t) => !askedIds.has(t.id)).length;
    const canReachTwo = askedIds.size + available >= MIN_QUOTE_REQUESTS;
    const minimum = canReachTwo ? Math.max(1, MIN_QUOTE_REQUESTS - askedIds.size) : 1;
    return {
      asked: askedIds.size,
      available,
      /** New Quote Requests the next send must hold. */
      minimum,
      /** Set when the Agency has too few Tradies for the Trade to ask two, so one is allowed. */
      singleReason: !canReachTwo
        ? `Your Agency has only ${askedIds.size + available === 1 ? 'one' : 'no'} ${trade.replace('_', ' ')} Tradie, so one Quote Request is allowed`
        : null,
    };
  }

  /** A Quote as the Property Manager's screens show it. Estimate and Firm Quote fields are null on the other stage. */
  async function quoteView(q: QuoteRow, supersededBy: number | null) {
    return {
      quoteId: q.id,
      quoteRequestId: q.quote_request_id,
      tradieId: q.tradie_id,
      businessName: await businessName(q.tradie_id),
      stage: q.stage,
      priceCents: q.price_cents,
      proposedTime: q.proposed_time,
      confirmed: !!q.confirmed,
      status: q.status,
      hasPdf: q.pdf_file_id !== null,
      pdfFileId: q.pdf_file_id,
      reason: q.single_quote_reason,
      receivedAt: q.received_at,
      /** Estimate: whether the Tradie said they need a Site Inspection, and its Call-out Fee. */
      needsInspection: q.stage === 'estimate' ? q.needs_inspection : null,
      calloutFeeCents: q.stage === 'estimate' ? q.callout_fee_cents : null,
      /** Firm Quote: the scope of work, the projected timeline in days, and the ISO dates the Tradie can start. */
      scopeOfWork: q.scope_of_work,
      durationDays: q.duration_days,
      availableDates: q.stage === 'firm' ? datesOf(q.available_dates) : [],
      /** The Estimate a Firm Quote supersedes, and the Firm Quote that superseded an Estimate. */
      supersedesQuoteId: q.supersedes_quote_id,
      supersededByQuoteId: supersededBy,
      /** Set on an Estimate the Property Manager proceeded on: the most the Tradie may charge. */
      notToExceedCents: q.not_to_exceed_cents,
    };
  }

  /** Whether the Property Manager may proceed on this Estimate (before the Routine check, which `confirm` can pass). */
  function proceedRefusal(request: QuoteRequestRow, estimate: QuoteRow): string | null {
    if (estimate.stage !== 'estimate') return 'Only an Estimate can be proceeded on';
    if (estimate.status !== 'open') return 'This Estimate can no longer be proceeded on';
    if (!estimate.confirmed) return 'Confirm the Estimate before proceeding on it';
    if (inspectionNeeded(request, estimate)) return 'This Tradie needs a Site Inspection before they can give a Firm Quote, so you cannot proceed on their Estimate';
    if (request.status !== 'estimated') return 'This Tradie has a Site Inspection on the way: wait for their Firm Quote';
    return null;
  }

  /** The no-login quote page's view of one Quote Request: no Tenant, no address until a Site Inspection is booked. */
  async function quotePage(request: QuoteRequestRow) {
    const { job, ticket, property } = await jobPlace(request.job_id);
    const issue = await tickets.issue(ticket.issueId);
    const agency = await profiles.agency(request.agency_id);
    const estimate = await quoteOf(request.id, 'estimate');
    const firm = await quoteOf(request.id, 'firm');
    const inspection = await modules.scheduling.inspectionFor(request.id);
    const approved = await one<QuoteRow>(db, `SELECT * FROM quotes WHERE job_id = ? AND status = 'approved'`, job.id);
    const withOwner = job.status === 'awaiting_owner' ? await one<QuoteRow>(db, `SELECT * FROM quotes WHERE job_id = ? AND status = 'awaiting_owner'`, job.id) : undefined;
    const outcome: 'open' | 'chosen' | 'with_owner' | 'on_hold' | 'not_chosen' | 'declined' | 'closed' =
      approved?.quote_request_id === request.id
        ? 'chosen'
        : withOwner?.quote_request_id === request.id
          ? 'with_owner'
          : request.status === 'declined'
            ? 'declined'
            : request.status === 'closed'
              ? approved || job.status === 'awaiting_owner'
                ? 'not_chosen'
                : 'closed'
              : job.status === 'quoting'
                ? 'open'
                : job.status === 'awaiting_owner'
                  ? 'on_hold'
                  : 'closed';
    const needed = inspectionNeeded(request, estimate);
    const next: 'estimate' | 'wait_for_booking' | 'wait_for_inspection' | 'firm_quote' | 'done' =
      outcome !== 'open'
        ? 'done'
        : AWAITING_ESTIMATE.includes(request.status)
          ? 'estimate'
          : request.status === 'inspection_booked'
            ? 'wait_for_inspection'
            : request.status === 'inspected' || (request.status === 'estimated' && !needed)
              ? 'firm_quote'
              : request.status === 'estimated'
                ? 'wait_for_booking'
                : 'done';
    return {
      quoteRequestId: request.id,
      agencyName: agency.name,
      timeZone: agency.timeZone,
      tradieName: await businessName(request.tradie_id),
      trade: job.trade,
      urgency: ticket.urgency,
      suburb: property.suburb,
      /** The street address, only once the Tradie has a Site Inspection booked there. */
      propertyAddress: inspection ? property.address : null,
      issue: withoutContactDetails(issue.summary ?? issue.description),
      status: request.status,
      /**
       * `open` while the Tradie can still quote; `with_owner` while their Quote waits on the
       * Property Owner, `on_hold` while another does; otherwise how it ended for them.
       */
      outcome,
      /** What the page asks for next. */
      next,
      inspectionNeeded: needed,
      inspection: inspection ? { start: inspection.start, end: inspection.end, status: inspection.status } : null,
      estimate: estimate
        ? {
            priceCents: estimate.price_cents,
            proposedTime: estimate.proposed_time,
            needsInspection: estimate.needs_inspection,
            calloutFeeCents: estimate.callout_fee_cents,
            receivedAt: estimate.received_at,
            notToExceedCents: estimate.not_to_exceed_cents,
          }
        : null,
      firmQuote: firm
        ? {
            priceCents: firm.price_cents,
            scopeOfWork: firm.scope_of_work,
            durationDays: firm.duration_days,
            availableDates: datesOf(firm.available_dates),
            proposedTime: firm.proposed_time,
            hasPdf: firm.pdf_file_id !== null,
            receivedAt: firm.received_at,
          }
        : null,
    };
  }

  return {
    /**
     * At most four of the Agency's Tradies with the Job's Trade: the Property's Nominated Tradies
     * first, then myEST8 rating, Google rating, median previous Firm Quote (none last: Estimates
     * are never compared with Firm Quotes, so they don't count). The first three that
     * have not been asked yet are `preselected`.
     */
    async recommend(agencyId: number, jobId: number) {
      const job = await tickets.jobInAgency(agencyId, jobId);
      const requested = new Set((await quoteRequestsOf(jobId)).map((r) => r.tradie_id));
      const nominatedIds = new Set((await profiles.property((await tickets.ticket(job.ticketId)).propertyId)).nominatedTradieIds);
      const tradies = await profiles.tradiesWithTrade(agencyId, job.trade);
      const recommendations = await Promise.all(
        tradies.map(async (tradie) => {
          const previous = await previousQuotes(tradie.id, job.trade);
          return {
            tradieId: tradie.id,
            businessName: tradie.businessName ?? tradie.name,
            myEst8Rating: await profiles.myEst8Rating(tradie.id),
            googleRating: tradie.googlePlaceId ? { rating: tradie.googleRating, reviewCount: tradie.googleReviewCount } : null,
            previousQuotes: previous,
            /** Of the Tradie's previous Firm Quotes only, and how many there were. */
            medianQuoteCents: median(previous.filter((q) => q.stage === 'firm').map((q) => q.priceCents)),
            firmQuoteCount: previous.filter((q) => q.stage === 'firm').length,
            bookings: await modules.scheduling.bookings(agencyId, tradie.id),
            requested: requested.has(tradie.id),
            nominated: nominatedIds.has(tradie.id),
          };
        }),
      );
      const ranked = recommendations
        .sort(
          (a, b) =>
            Number(b.nominated) - Number(a.nominated) ||
            b.myEst8Rating.average - a.myEst8Rating.average ||
            (b.googleRating?.rating ?? -1) - (a.googleRating?.rating ?? -1) ||
            (a.medianQuoteCents ?? Infinity) - (b.medianQuoteCents ?? Infinity) ||
            a.businessName.localeCompare(b.businessName),
        )
        .slice(0, MAX_RECOMMENDED);
      return ranked.map((r, i) => ({ ...r, preselected: i < PRESELECTED && !r.requested }));
    },

    /**
     * What the next send of Quote Requests must hold: `minimum` new requests (two for a first
     * round, one for a later round that reaches two with those already sent), and `singleReason`,
     * set when the Agency has too few Tradies for the Trade to reach two, saying why one is allowed.
     */
    async quoteRequestRule(agencyId: number, jobId: number) {
      const job = await tickets.jobInAgency(agencyId, jobId);
      return requestRule(agencyId, job.id, job.trade);
    },

    /**
     * The Jobs where a Tradie is still in the running, soonest asked first: asked to quote on a
     * Job nobody has been chosen for yet, or on one held up while the Property Owner decides
     * (`withOwner` when it is the Tradie's own Quote they decide on).
     */
    async undecidedJobsOf(tradieId: number) {
      const rows = await all<{ job_id: number; with_owner: boolean }>(
        db,
        `SELECT r.job_id, EXISTS (SELECT 1 FROM quotes q WHERE q.quote_request_id = r.id AND q.status = 'awaiting_owner') AS with_owner
         FROM quote_requests r JOIN jobs j ON j.id = r.job_id
         WHERE r.tradie_id = ? AND r.status IN (${LIVE.map((s) => `'${s}'`).join(', ')}) AND j.status IN ('quoting', 'awaiting_owner')
         ORDER BY r.id`,
        tradieId,
      );
      return Promise.all(
        rows.map(async ({ job_id, with_owner }) => {
          const { job, property } = await jobPlace(job_id);
          return { jobId: job.id, trade: job.trade, propertyAddress: property.address, withOwner: with_owner };
        }),
      );
    },

    /**
     * The Jobs a Tradie's approved Quote is for that are Ready to book, with no Work Order sent yet,
     * soonest approved first.
     */
    async unbookedJobsOf(tradieId: number) {
      const rows = await all<{ job_id: number }>(
        db,
        `SELECT q.job_id FROM quotes q JOIN jobs j ON j.id = q.job_id
         WHERE q.tradie_id = ? AND q.status = 'approved' AND j.status = 'approved'
         ORDER BY q.id`,
        tradieId,
      );
      return Promise.all(
        rows.map(async ({ job_id }) => {
          const { job, property } = await jobPlace(job_id);
          return { jobId: job.id, trade: job.trade, propertyAddress: property.address };
        }),
      );
    },

    /**
     * Asks each Tradie for an Estimate, each with their own quote page link. A Tradie none of the
     * Agency's channels reaches, or whose message fails to send, is named in `unreached` with why,
     * and has no Quote Request; the others are still asked. Refuses when none can be reached,
     * recording nothing.
     */
    async sendQuoteRequests(agencyId: number, jobId: number, tradieIds: number[]) {
      // Checked and recorded in one transaction, so a double submit can't ask a Tradie twice.
      const { ticket, tradies, unreached, requests } = await transaction(db, async () => {
        const { job, ticket } = await jobPlace((await tickets.jobInAgency(agencyId, jobId)).id);
        if (job.status !== 'quoting') invalid('Quote Requests can only be sent while the Job is getting Quotes');
        if (!tradieIds.length) invalid('Choose at least one Tradie');
        const already = new Set((await quoteRequestsOf(jobId)).map((r) => r.tradie_id));
        const chosen = [];
        for (const id of new Set(tradieIds)) chosen.push(await profiles.personInAgency(agencyId, id, 'tradie'));
        for (const tradie of chosen) {
          if (tradie.removedAt) invalid(`${tradie.businessName ?? tradie.name} has been removed from the Agency`);
          if (!tradie.trades.includes(job.trade)) invalid(`${tradie.businessName ?? tradie.name} doesn't do ${job.trade} work`);
          if (already.has(tradie.id)) invalid(`${tradie.businessName ?? tradie.name} has already been asked to quote`);
        }
        const rule = await requestRule(agencyId, jobId, job.trade);
        if (chosen.length < rule.minimum) invalid('Send Quote Requests to at least two Tradies');
        const tradies = [];
        const unreached: { tradie: string; reason: string }[] = [];
        for (const tradie of chosen) {
          try {
            await notifications.channelFor(tradie.id);
            tradies.push(tradie);
          } catch (error) {
            if (!(error instanceof UndeliverableError)) throw error;
            unreached.push({ tradie: tradie.businessName ?? tradie.name, reason: error.userReason });
          }
        }
        if (!tradies.length) refuseNoneSent(unreached);
        const requests: QuoteRequestRow[] = [];
        for (const tradie of tradies) {
          requests.push(
            (await one<QuoteRequestRow>(
              db,
              `INSERT INTO quote_requests (agency_id, job_id, ticket_id, tradie_id, status, sent_at, token) VALUES (?, ?, ?, ?, 'sent', ?, ?) RETURNING *`,
              agencyId,
              jobId,
              ticket.id,
              tradie.id,
              iso(clock.now()),
              newToken(),
            ))!,
          );
        }
        return { ticket, tradies, unreached, requests };
      });
      const reached: string[] = [];
      for (const [i, tradie] of tradies.entries()) {
        const name = tradie.businessName ?? tradie.name;
        try {
          await sendQuoteRequest(requests[i]!);
        } catch (error) {
          // No message went out, so the Quote Request (nothing is attached to it yet) goes too, and the Tradie can be asked again.
          await run(db, 'DELETE FROM quote_requests WHERE id = ?', requests[i]!.id);
          if (error instanceof UndeliverableError || error instanceof ProviderRefusedError) {
            unreached.push({ tradie: name, reason: error.userReason });
          } else {
            console.error(`Quote Request to ${name} failed to send`, error);
            unreached.push({ tradie: name, reason: "the message couldn't be sent" });
          }
          continue;
        }
        await worker.schedule('quotes.reminder', { quoteRequestId: requests[i]!.id }, addMs(clock.now(), QUOTE_REMINDER_MS));
        reached.push(name);
      }
      if (!reached.length) refuseNoneSent(unreached);
      await tickets.recordEvent(ticket.id, 'quote_requests_sent', { jobId, tradies: reached });
      return { sent: reached.length, unreached };
    },

    /**
     * Sends a Quote Request's message again, with the same link, when the Tradie says it never
     * arrived. Only while it still waits on their Estimate; its status and reminder are untouched.
     * A send that fails is the caller's to report.
     */
    async resendQuoteRequest(agencyId: number, quoteRequestId: number) {
      const request = await requestInAgency(agencyId, quoteRequestId);
      if (!AWAITING_ESTIMATE.includes(request.status)) invalid(`${await businessName(request.tradie_id)} has already replied`);
      await sendQuoteRequest(request);
    },

    /**
     * A Tradie's SMS or email reply to their Quote Request. Before an Estimate, a price is an
     * unconfirmed Estimate read from the text and any PDF (a message can't say what a Firm
     * Quote needs), and NO declines. Once they have an Estimate, a price changes nothing:
     * when they may give their Firm Quote they are sent their quote page link to give it there
     * (`firm_quote_link`); before then (a Site Inspection still to happen) nothing is sent, and
     * the message waits for the Property Manager.
     */
    async recordTradieReply(
      quoteRequestId: number,
      reply: { kind: 'quote' | 'decline'; text: string; pdfFileId: number | null },
    ): Promise<'estimate' | 'declined' | 'firm_quote_link' | 'ignored'> {
      const waiting = await quoteRequestRow(quoteRequestId);
      if (!waiting || !LIVE.includes(waiting.status)) return 'ignored';
      if (reply.kind === 'quote' && !AWAITING_ESTIMATE.includes(waiting.status)) {
        if ((await tickets.job(waiting.job_id)).status !== 'quoting') return 'ignored';
        if (!firmQuoteAllowed(waiting, await quoteOf(waiting.id, 'estimate'))) return 'ignored';
        await sendFirmQuoteLink(waiting, 'tradie.firm_quote_link');
        return 'firm_quote_link';
      }
      const read =
        reply.kind === 'quote'
          ? await ports.quoteReader.read({
              text: reply.text,
              ...(reply.pdfFileId !== null ? { pdf: (await files.get(reply.pdfFileId)).content } : {}),
            })
          : null;
      const outcome = await transaction(db, async () => {
        // Checked again: another reply may have been recorded while the quote reader read this one.
        const request = (await quoteRequestRow(quoteRequestId))!;
        if (!read) {
          if (!LIVE.includes(request.status) || request.status === 'firm_quoted') return 'ignored';
          await run(db, `UPDATE quote_requests SET status = 'declined' WHERE id = ?`, request.id);
          await run(db, `UPDATE quotes SET status = 'not_chosen' WHERE quote_request_id = ? AND status = 'open'`, request.id);
          await tickets.recordEvent(request.ticket_id, 'tradie_declined', { jobId: request.job_id, tradie: await businessName(request.tradie_id) });
          return { cancelled: await cancelInspections('quote_request_id = ?', request.id, 'declined') };
        }
        if (!AWAITING_ESTIMATE.includes(request.status)) return 'ignored';
        await insertEstimate(request, {
          priceCents: read.priceCents ?? null,
          proposedTime: read.proposedTime ? iso(read.proposedTime) : null,
          needsInspection: false,
          calloutFeeCents: null,
          pdfFileId: reply.pdfFileId,
          confirmed: false,
        });
        return 'estimate';
      });
      if (typeof outcome === 'string') return outcome;
      await tellTenantsCancelled(outcome.cancelled);
      return 'declined';
    },

    /**
     * The Tradie's Estimate from their quote page: a price, optionally their earliest time,
     * and whether they need a Site Inspection before a Firm Quote (with its Call-out Fee).
     * Typed by the Tradie, so it needs no checking. Refuses field by field.
     */
    async submitEstimate(quoteRequestId: number, input: EstimateInput) {
      requireAmount(input.priceCents, 'Enter your Estimate in dollars', 'price');
      const proposedTime = futureTime(input.proposedTime, 'proposedTime');
      const fee = input.needsInspection ? (input.calloutFeeCents ?? null) : null;
      if (fee !== null && (!Number.isInteger(fee) || fee < 0)) invalid('Enter the Call-out Fee in dollars, or leave it empty', 'calloutFee');
      if (fee !== null && fee > MAX_QUOTE_CENTS) invalid(`Check the Call-out Fee: it is over ${dollars(MAX_QUOTE_CENTS)}`, 'calloutFee');
      await transaction(db, async () => {
        const request = await quoteRequestRow(quoteRequestId);
        if (!request) notFound('Quote Request');
        if ((await tickets.job(request.job_id)).status !== 'quoting' || !LIVE.includes(request.status)) invalid('This Quote Request has closed');
        if (!AWAITING_ESTIMATE.includes(request.status)) invalid('You have already given an Estimate');
        await insertEstimate(request, {
          priceCents: input.priceCents,
          proposedTime,
          needsInspection: !!input.needsInspection,
          calloutFeeCents: fee,
          pdfFileId: null,
          confirmed: true,
        });
      });
    },

    /**
     * The Tradie's Firm Quote from their quote page: a fixed price, the scope of work, how many
     * days it takes, and one to three dates they can start. Allowed once they have an Estimate,
     * and after the Site Inspection when one is needed. It is a new Quote that supersedes the
     * Estimate, which stays on record.
     */
    async submitFirmQuote(quoteRequestId: number, input: FirmQuoteInput, o: { enteredBy?: 'property_manager' } = {}) {
      const request = await quoteRequestRow(quoteRequestId);
      if (!request) notFound('Quote Request');
      const { timeZone } = await profiles.agency(request.agency_id);
      requireAmount(input.priceCents, 'Enter your Firm Quote in dollars', 'price');
      const scope = (input.scopeOfWork ?? '').trim();
      if (!scope) invalid('Describe the scope of work: what you will do for this price', 'scopeOfWork');
      if (scope.length > MAX_SCOPE_LENGTH) invalid(`Keep the scope of work under ${MAX_SCOPE_LENGTH} characters`, 'scopeOfWork');
      if (!Number.isInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > MAX_DURATION_DAYS) {
        invalid(`Enter how many days the work takes, from 1 to ${MAX_DURATION_DAYS}`, 'durationDays');
      }
      const today = wallClock(clock.now(), timeZone);
      const todayIso = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
      const dates = [...new Set((input.availableDates ?? []).map((d) => d.trim()).filter(Boolean))].sort();
      if (!dates.length) invalid('Give at least one date you can start', 'availableDates');
      if (dates.length > MAX_AVAILABLE_DATES) invalid(`Give at most ${MAX_AVAILABLE_DATES} dates you can start`, 'availableDates');
      for (const date of dates) {
        const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
        if (!valid) invalid(`${date} is not a date`, 'availableDates');
        if (date < todayIso) invalid('Pick start dates from today on', 'availableDates');
      }
      const proposedTime = futureTime(input.proposedTime, 'proposedTime');
      if (input.pdf && input.pdf.contentType !== 'application/pdf') invalid('Attach your quote as a PDF', 'pdf');

      /** Refuses unless the request may take a Firm Quote now; returns its Estimate. */
      const firmQuoteRequest = async (current: QuoteRequestRow) => {
        if ((await tickets.job(current.job_id)).status !== 'quoting' || !LIVE.includes(current.status)) invalid('This Quote Request has closed');
        if (current.status === 'firm_quoted') invalid('You have already given a Firm Quote');
        const estimate = await quoteOf(current.id, 'estimate');
        if (!estimate || AWAITING_ESTIMATE.includes(current.status)) invalid('Give your Estimate first');
        if (current.status === 'inspection_booked') invalid('Give your Firm Quote after your Site Inspection');
        if (!firmQuoteAllowed(current, estimate)) invalid('Your Site Inspection comes first: the Property Manager will book it with you');
        return estimate;
      };
      // Checked before the PDF is saved, so a refused Firm Quote leaves no file behind; and again inside.
      await firmQuoteRequest(request);
      const pdfFileId = input.pdf ? await files.save(request.agency_id, input.pdf) : null;
      await transaction(db, async () => {
        const current = (await quoteRequestRow(quoteRequestId))!;
        const estimate = await firmQuoteRequest(current);
        const job = await tickets.job(current.job_id);
        await run(
          db,
          `INSERT INTO quotes (agency_id, job_id, ticket_id, quote_request_id, tradie_id, trade, stage, price_cents, proposed_time, confirmed, status,
             pdf_file_id, received_at, supersedes_quote_id, scope_of_work, duration_days, available_dates)
           VALUES (?, ?, ?, ?, ?, ?, 'firm', ?, ?, 1, 'open', ?, ?, ?, ?, ?, ?::jsonb)`,
          current.agency_id,
          job.id,
          current.ticket_id,
          current.id,
          current.tradie_id,
          job.trade,
          input.priceCents,
          proposedTime,
          pdfFileId,
          iso(clock.now()),
          estimate.id,
          scope,
          input.durationDays,
          JSON.stringify(dates),
        );
        await run(db, `UPDATE quotes SET status = 'superseded' WHERE id = ? AND status = 'open'`, estimate.id);
        await run(db, `UPDATE quote_requests SET status = 'firm_quoted' WHERE id = ?`, current.id);
        await tickets.recordEvent(current.ticket_id, 'firm_quote_received', {
          jobId: job.id,
          tradie: await businessName(current.tradie_id),
          priceCents: input.priceCents,
          ...(o.enteredBy ? { enteredBy: o.enteredBy } : {}),
        });
      }).catch(async (error: unknown) => {
        if (pdfFileId !== null) await files.remove(pdfFileId);
        throw error;
      });
    },

    /**
     * The Property Manager enters a Firm Quote the Tradie sent another way (a PDF by email, say),
     * for a Quote Request in their Agency. Checked exactly as one from the quote page.
     */
    async enterFirmQuote(agencyId: number, quoteRequestId: number, input: FirmQuoteInput) {
      const request = await requestInAgency(agencyId, quoteRequestId);
      await this.submitFirmQuote(request.id, input, { enteredBy: 'property_manager' });
    },

    /**
     * The Property Manager overrides whether this Tradie needs a Site Inspection before their
     * Firm Quote: `true` to ask for one, `false` to let them quote firm without it.
     */
    async setInspectionNeeded(agencyId: number, quoteRequestId: number, needed: boolean) {
      await transaction(db, async () => {
        const request = await requestInAgency(agencyId, quoteRequestId);
        if (!['sent', 'reminded', 'estimated'].includes(request.status) || (await tickets.job(request.job_id)).status !== 'quoting') {
          invalid('Whether a Site Inspection is needed can only change before one is booked');
        }
        await run(db, 'UPDATE quote_requests SET inspection_override = ? WHERE id = ?', needed, request.id);
        await tickets.recordEvent(request.ticket_id, 'inspection_need_set', { jobId: request.job_id, tradie: await businessName(request.tradie_id), needed });
      });
    },

    /**
     * Confirms an Estimate read from a Tradie's message, as read or with the Property Manager's
     * corrections. Only confirmed Quotes count. A Firm Quote is binding as the Tradie gave it, and
     * one typed on the quote page arrives confirmed, so neither is ever confirmed (or rewritten) here.
     */
    async confirmQuote(agencyId: number, quoteId: number, edits: { priceCents?: number; proposedTime?: string | null } = {}) {
      return transaction(db, async () => {
        const quote = await quoteInAgency(agencyId, quoteId);
        if (quote.stage === 'firm') invalid("A Firm Quote is binding as the Tradie gave it, so it can't be changed");
        if (quote.status !== 'open') invalid('This Quote can no longer be changed');
        if (quote.confirmed) invalid('This Estimate is already confirmed');
        const price = edits.priceCents ?? quote.price_cents;
        requireAmount(price, 'Enter the price before confirming the Quote', 'price');
        const time = edits.proposedTime === undefined ? quote.proposed_time : edits.proposedTime;
        if (time !== null && Number.isNaN(Date.parse(time))) invalid(`${time} is not a time`);
        await run(
          db,
          'UPDATE quotes SET price_cents = ?, proposed_time = ?, confirmed = 1 WHERE id = ?',
          price,
          time === null ? null : iso(new Date(time)),
          quoteId,
        );
      });
    },

    /**
     * Chooses a Firm Quote, then approves it or asks the Property Owner if it takes the Repair
     * Cost over the Max Repair Cost. An Estimate is never chosen: see `proceedOnEstimate`.
     */
    async chooseQuote(agencyId: number, quoteId: number, reason?: string) {
      // Decided in one transaction: two Quotes chosen for a Job at once can't both be approved.
      const outcome = await transaction(db, async () => {
        const quote = await quoteInAgency(agencyId, quoteId);
        if (quote.stage !== 'firm') {
          invalid('An Estimate is not a Firm Quote and is never chosen as one. Wait for Firm Quotes, or proceed on the Estimate with a Not-to-exceed Cap.');
        }
        if (!quote.confirmed) invalid('Confirm the Quote before choosing it');
        if (quote.status !== 'open') invalid('This Quote can no longer be chosen');
        const { job, ticket } = await jobPlace(quote.job_id);
        if (job.status !== 'quoting') invalid('This Job is not choosing a Quote');
        const why = reason?.trim() || null;
        const onlyOne = (await firmCount(job.id)) < MIN_QUOTES;
        if (onlyOne && !why) {
          invalid('Choose a Firm Quote once the Job has at least two, or record why you are going ahead with one');
        }
        await run(db, 'UPDATE quotes SET single_quote_reason = ? WHERE id = ?', onlyOne ? why : null, quote.id);
        await tickets.recordEvent(ticket.id, 'quote_chosen', {
          jobId: job.id,
          tradie: await businessName(quote.tradie_id),
          priceCents: quote.price_cents,
          ...(onlyOne ? { reason: why } : {}),
        });
        return approveOrAskOwner(quote, quote.price_cents!);
      });
      await afterDecision(outcome);
    },

    /**
     * Goes ahead on a Tradie's Estimate without waiting for a Firm Quote, for a cheap routine
     * Job: the Tradie may charge at most `capCents`, the Not-to-exceed Cap, which counts towards
     * the Repair Cost. Refused when the Tradie needs a Site Inspection, when the cap is below the
     * Estimate, and on a Ticket that isn't Routine unless `confirm` is set. A reason is needed
     * while the Job has fewer than two Tradies' confirmed Quotes.
     */
    async proceedOnEstimate(agencyId: number, quoteId: number, options: { capCents: number; reason?: string; confirm?: boolean }) {
      const outcome = await transaction(db, async () => {
        const estimate = await quoteInAgency(agencyId, quoteId);
        const request = (await quoteRequestRow(estimate.quote_request_id))!;
        const refusal = proceedRefusal(request, estimate);
        if (refusal) invalid(refusal);
        const { job, ticket } = await jobPlace(estimate.job_id);
        if (job.status !== 'quoting') invalid('This Job is not choosing a Quote');
        requireAmount(options.capCents, 'Enter the Not-to-exceed Cap in dollars', 'cap');
        if (options.capCents < estimate.price_cents!) {
          invalid(`The Not-to-exceed Cap can't be below the Estimate of ${dollars(estimate.price_cents!)}`, 'cap');
        }
        if (ticket.urgency !== 'routine' && !options.confirm) {
          invalid(`Proceeding on an Estimate is for Routine Jobs, and this Ticket is ${ticket.urgency === 'high' ? 'High' : ticket.urgency}. Wait for Firm Quotes, or confirm to go ahead anyway.`);
        }
        const why = options.reason?.trim() || null;
        const onlyOne = (await pricedCount(job.id)) < MIN_QUOTES;
        if (onlyOne && !why) invalid('Proceed on an Estimate once the Job has at least two, or record why you are going ahead with one');
        await run(db, 'UPDATE quotes SET not_to_exceed_cents = ?, single_quote_reason = ? WHERE id = ?', options.capCents, why, estimate.id);
        await tickets.recordEvent(ticket.id, 'proceeded_on_estimate', {
          jobId: job.id,
          tradie: await businessName(estimate.tradie_id),
          priceCents: estimate.price_cents,
          capCents: options.capCents,
          ...(why ? { reason: why } : {}),
          ...(ticket.urgency !== 'routine' ? { notRoutine: true } : {}),
        });
        return approveOrAskOwner({ ...estimate, not_to_exceed_cents: options.capCents }, options.capCents);
      });
      await afterDecision(outcome);
    },

    /**
     * YES approves the Quote. NO declines it, and the Property Manager can choose another; an
     * Estimate declined loses its Not-to-exceed Cap, which was only ever the proposal.
     */
    async recordOwnerAnswer(approvalId: number, answer: 'yes' | 'no') {
      const approved = await transaction(db, async () => {
        const approval = (await one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE id = ?', approvalId))!;
        if (!OPEN_APPROVAL.includes(approval.status)) return null;
        const quote = (await one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ?', approval.quote_id))!;
        await run(db, 'UPDATE approvals SET status = ?, answered_at = ? WHERE id = ?', answer === 'yes' ? 'approved' : 'declined', iso(clock.now()), approval.id);
        if (answer === 'yes') return { quote, closed: await approveQuote(quote) };
        await run(db, `UPDATE quotes SET status = 'declined_by_owner', not_to_exceed_cents = NULL WHERE id = ?`, quote.id);
        await tickets.setJobStatus(approval.job_id, 'quoting');
        await tickets.recordEvent(approval.ticket_id, 'owner_declined', { jobId: approval.job_id, priceCents: costOf(quote) });
        return null;
      });
      if (approved) await tellPassedOver(approved.quote, approved.closed);
    },

    /** A Site Inspection is booked for this request (scheduling.bookInspection checks it may be). Inside its transaction. */
    async inspectionBooked(quoteRequestId: number) {
      await run(db, `UPDATE quote_requests SET status = 'inspection_booked' WHERE id = ? AND status = 'estimated'`, quoteRequestId);
    },

    /**
     * The Tradie's Site Inspection is done: they are asked for their Firm Quote on their quote
     * page, and reminded after 48 hours if it hasn't come.
     */
    async inspected(quoteRequestId: number) {
      const request = await one<QuoteRequestRow>(
        db,
        `UPDATE quote_requests SET status = 'inspected' WHERE id = ? AND status = 'inspection_booked' RETURNING *`,
        quoteRequestId,
      );
      if (!request) return;
      await sendFirmQuoteLink(request, 'tradie.firm_quote_request');
      await worker.schedule('quotes.firm_quote_reminder', { quoteRequestId }, addMs(clock.now(), FIRM_QUOTE_REMINDER_MS));
    },

    /** Whether this Quote Request may have a Site Inspection booked now, or why not. */
    async inspectionBookable(agencyId: number, quoteRequestId: number) {
      const request = await requestInAgency(agencyId, quoteRequestId);
      if ((await tickets.job(request.job_id)).status !== 'quoting') invalid('Site Inspections can only be booked while the Job is getting Quotes');
      if (AWAITING_ESTIMATE.includes(request.status)) invalid('Book a Site Inspection once the Tradie has given an Estimate');
      if (request.status === 'inspection_booked') invalid('This Tradie already has a Site Inspection booked');
      if (request.status !== 'estimated') invalid('This Tradie is past the Site Inspection');
      return { quoteRequestId: request.id, jobId: request.job_id, ticketId: request.ticket_id, tradieId: request.tradie_id };
    },

    /** Quote Requests on the Job whose Tradie needs a Site Inspection that isn't booked yet. */
    async needingInspection(jobId: number) {
      const out = [];
      for (const r of await quoteRequestsOf(jobId)) {
        if (r.status !== 'estimated') continue;
        if (inspectionNeeded(r, await quoteOf(r.id, 'estimate'))) out.push({ quoteRequestId: r.id, tradieId: r.tradie_id });
      }
      return out;
    },

    async hasQuoteRequests(jobId: number) {
      return (await quoteRequestsOf(jobId)).length > 0;
    },

    /**
     * A cancelled Job stops waiting for Quotes and approval, and its Site Inspections are off.
     * Returns the cancelled inspections; pass them to `inspectionsCancelled` once the cancel commits.
     */
    async jobCancelled(jobId: number) {
      return transaction(db, async () => {
        const cancelled = await cancelInspections('job_id = ?', jobId, 'job_cancelled');
        await run(
          db,
          `UPDATE quote_requests SET status = 'closed' WHERE job_id = ? AND status IN ('sent', 'reminded', 'estimated', 'inspection_booked', 'inspected', 'firm_quoted')`,
          jobId,
        );
        await run(db, `UPDATE quotes SET status = 'not_chosen' WHERE job_id = ? AND status IN ('open', 'awaiting_owner')`, jobId);
        await run(db, `UPDATE approvals SET status = 'cancelled' WHERE job_id = ? AND status IN ('requested', 'reminded')`, jobId);
        return cancelled;
      });
    },

    /** Tells each Tenant their cancelled Site Inspection is off (after the cancel commits). */
    async inspectionsCancelled(cancelled: CancelledVisit[]) {
      await tellTenantsCancelled(cancelled);
    },

    /**
     * What a Tradie's message may answer: a Quote Request waiting on their Estimate, or on
     * their Firm Quote after the Site Inspection. A booked Site Inspection is a Work Order
     * (scheduling.itemsWaitingOn).
     */
    async itemsWaitingOn(tradieId: number): Promise<OpenItem[]> {
      return Promise.all((await all<QuoteRequestRow>(
        db,
        `SELECT r.* FROM quote_requests r JOIN jobs j ON j.id = r.job_id
         WHERE r.tradie_id = ? AND j.status = 'quoting' AND r.status IN ('sent', 'reminded', 'inspected') ORDER BY r.id DESC`,
        tradieId,
      )).map(async (r) => {
        const { job, property } = await jobPlace(r.job_id);
        return {
          ref: `quote_request:${r.id}`,
          summary: r.status === 'inspected' ? `Firm Quote: ${job.trade} job at ${property.address}` : `Quote Request: ${job.trade} job in ${property.suburb}`,
        };
      }));
    },

    /** A Property Owner's approvals, newest first, including those already decided or cancelled. */
    async approvalsFor(ownerId: number) {
      const rows = await all<ApprovalRow>(db, 'SELECT * FROM approvals WHERE owner_id = ? ORDER BY requested_at DESC, id DESC', ownerId);
      return Promise.all(
        rows.map(async (a) => {
          const issue = await tickets.issue((await tickets.ticket(a.ticket_id)).issueId);
          return { ticketId: a.ticket_id, status: a.status, requestedAt: a.requested_at, description: issue.summary ?? issue.description };
        }),
      );
    },

    async approvalsWaitingOn(ownerId: number): Promise<OpenItem[]> {
      return Promise.all((await all<ApprovalRow>(
        db,
        `SELECT * FROM approvals WHERE owner_id = ? AND status IN ('requested', 'reminded') ORDER BY id DESC`,
        ownerId,
      )).map(async (a) => {
        const { job, property } = await jobPlace(a.job_id);
        return { ref: `approval:${a.id}`, summary: `Approval request: ${job.trade} job at ${property.address}` };
      }));
    },

    /** The Ticket a Quote Request is for, and whether the Tradie has given their Estimate. */
    async quoteRequest(id: number) {
      const row = await quoteRequestRow(id);
      return row ? { ticketId: row.ticket_id, status: row.status, estimated: !AWAITING_ESTIMATE.includes(row.status) } : null;
    },

    async approval(id: number) {
      const row = await one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE id = ?', id);
      return row ? { ticketId: row.ticket_id } : null;
    },

    /** The Job's approved Quote: who does the work, what it counts towards the Repair Cost, and when they proposed. */
    async approvedQuote(jobId: number) {
      const row = await one<QuoteRow>(db, `SELECT * FROM quotes WHERE job_id = ? AND status = 'approved'`, jobId);
      return row
        ? { tradieId: row.tradie_id, stage: row.stage, priceCents: costOf(row), notToExceedCents: row.not_to_exceed_cents, proposedTime: row.proposed_time }
        : null;
    },

    repairCost,
    previousQuotes,

    /** The Quote Request a quote page link is for, or null for an unknown link. */
    async requestIdByToken(token: string) {
      const row = await one<{ id: number }>(db, 'SELECT id FROM quote_requests WHERE token = ?', token);
      return row?.id ?? null;
    },

    /** What the Tradie's quote page shows, or null for an unknown link. */
    async quotePage(token: string) {
      const request = await one<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE token = ?', token);
      return request ? quotePage(request) : null;
    },

    /**
     * Quote Requests, each with its Tradie's Estimate, Site Inspection and Firm Quote, every
     * Quote of both stages, and approval status for one Job.
     */
    async jobView(agencyId: number, jobId: number) {
      const job = await tickets.job(jobId);
      const approval = await one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE job_id = ? ORDER BY id DESC LIMIT 1', jobId);
      const { ticket } = await jobPlace(jobId);
      const rows = await quotesOf(jobId);
      const supersededBy = new Map(rows.filter((q) => q.supersedes_quote_id !== null).map((q) => [q.supersedes_quote_id!, q.id]));
      const quotes = await Promise.all(rows.map((q) => quoteView(q, supersededBy.get(q.id) ?? null)));
      return {
        recommendations: job.status === 'quoting' ? await this.recommend(agencyId, jobId) : [],
        /** For the send form: new requests it must hold (`minimum`), and why one is enough when it is. */
        requestRule: job.status === 'quoting' ? await requestRule(agencyId, jobId, job.trade) : null,
        quoteRequests: await Promise.all((await quoteRequestsOf(jobId)).map(async (r) => {
          const estimateRow = rows.find((q) => q.quote_request_id === r.id && q.stage === 'estimate');
          const estimate = quotes.find((q) => q.quoteRequestId === r.id && q.stage === 'estimate') ?? null;
          const refusal = estimateRow ? proceedRefusal(r, estimateRow) : 'No Estimate yet';
          return {
            quoteRequestId: r.id,
            tradieId: r.tradie_id,
            businessName: await businessName(r.tradie_id),
            status: r.status,
            sentAt: r.sent_at,
            /** Whether a Site Inspection comes before the Firm Quote: the Property Manager's override, else the Tradie's answer. */
            inspectionNeeded: inspectionNeeded(r, estimateRow),
            /** Set when the Property Manager overrode the Tradie's answer. */
            inspectionOverride: r.inspection_override,
            estimate,
            /** The latest Site Inspection not cancelled, or null. */
            inspection: await modules.scheduling.inspectionFor(r.id),
            firmQuote: quotes.find((q) => q.quoteRequestId === r.id && q.stage === 'firm') ?? null,
            /** Whether the Property Manager may proceed on this Estimate now; `proceedNeedsConfirm` when the Ticket isn't Routine. */
            canProceedOnEstimate: job.status === 'quoting' && refusal === null,
            proceedNeedsConfirm: ticket.urgency !== 'routine',
          };
        })),
        /** Every Quote on the Job, Estimates and Firm Quotes alike, oldest first. Compare by `stage`, never across it. */
        quotes,
        approval: approval
          ? { approvalId: approval.id, quoteId: approval.quote_id, status: approval.status, requestedAt: approval.requested_at }
          : null,
      };
    },

    /** How many Quote Requests each Tradie has answered with a Quote a Property Manager confirmed, by Tradie id (none counted are left out). */
    async quoteCounts(tradieIds: number[]) {
      if (!tradieIds.length) return new Map<number, number>();
      return new Map(
        (await all<{ tradie_id: number; n: number }>(
          db,
          `SELECT tradie_id, count(DISTINCT quote_request_id) AS n FROM quotes
           WHERE confirmed = 1 AND tradie_id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value)) GROUP BY tradie_id`,
          JSON.stringify(tradieIds),
        )).map((r) => [r.tradie_id, r.n]),
      );
    },

    /**
     * For many Jobs in three queries, by Job id: Quote Requests not declined (`asked`),
     * Estimates in (`received`) and confirmed (`confirmed`), open Quotes of either stage
     * still to check (`toCheck`), confirmed open Firm Quotes (`firm`), and Tradies who need a
     * Site Inspection not yet booked (`toInspect`). A Job with none of these is left out.
     */
    async quotingOf(jobIds: number[]) {
      const counts = new Map<number, { asked: number; received: number; confirmed: number; toCheck: number; firm: number; toInspect: number }>();
      if (!jobIds.length) return counts;
      const ids = JSON.stringify(jobIds);
      const inJobs = (column = 'job_id') => `${column} IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value))`;
      const of = (jobId: number) =>
        counts.get(jobId) ?? counts.set(jobId, { asked: 0, received: 0, confirmed: 0, toCheck: 0, firm: 0, toInspect: 0 }).get(jobId)!;
      for (const r of await all<{ job_id: number; asked: number; to_inspect: number }>(
        db,
        `SELECT r.job_id, count(*) FILTER (WHERE r.status != 'declined') AS asked,
           count(*) FILTER (WHERE r.status = 'estimated' AND coalesce(r.inspection_override, e.needs_inspection, false)) AS to_inspect
         FROM quote_requests r LEFT JOIN quotes e ON e.quote_request_id = r.id AND e.stage = 'estimate'
         WHERE ${inJobs('r.job_id')} GROUP BY r.job_id`,
        ids,
      )) {
        Object.assign(of(r.job_id), { asked: r.asked, toInspect: r.to_inspect });
      }
      for (const r of await all<{ job_id: number; received: number; confirmed: number; to_check: number; firm: number }>(
        db,
        `SELECT job_id,
           count(*) FILTER (WHERE stage = 'estimate') AS received,
           count(*) FILTER (WHERE stage = 'estimate' AND confirmed = 1) AS confirmed,
           count(*) FILTER (WHERE status = 'open' AND confirmed = 0) AS to_check,
           count(*) FILTER (WHERE stage = 'firm' AND status = 'open' AND confirmed = 1) AS firm
         FROM quotes WHERE ${inJobs()} GROUP BY job_id`,
        ids,
      )) {
        Object.assign(of(r.job_id), { received: r.received, confirmed: r.confirmed, toCheck: r.to_check, firm: r.firm });
      }
      return counts;
    },

    /**
     * The Quotes waiting on a Property Owner because approving them would take the
     * Ticket's Repair Cost over the Property's Max Repair Cost, longest waiting first.
     * Each says by how much, and whether the Owner has been reminded or has stayed silent
     * long enough to alert the Property Manager.
     */
    async waitingOnOwner(agencyId: number, propertyIds: number[] | null) {
      const now = clock.now();
      const approvals = await all<ApprovalRow>(
        db,
        `SELECT * FROM approvals WHERE agency_id = ? AND status IN ('requested', 'reminded') ORDER BY requested_at, id`,
        agencyId,
      );
      // Each approval's lookups run side by side; the list keeps the approvals' order.
      const waiting = await Promise.all(approvals.map(async (a) => {
        const { job, ticket, property } = await jobPlace(a.job_id);
        if (propertyIds !== null && !propertyIds.includes(property.id)) return null;
        const quote = (await one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ?', a.quote_id))!;
        const owner = await profiles.person(a.owner_id);
        const repairCostCents = (await repairCost(ticket.id)) + costOf(quote);
        return {
          approvalId: a.id,
          ticketId: ticket.id,
          jobId: job.id,
          trade: job.trade,
          propertyId: property.id,
          propertyAddress: property.address,
          ownerName: owner.name,
          ownerMobile: owner.mobile,
          tradieBusinessName: await businessName(quote.tradie_id),
          quotePriceCents: costOf(quote),
          quoteStage: quote.stage,
          repairCostCents,
          maxRepairCostCents: property.maxRepairCostCents,
          overByCents: repairCostCents - property.maxRepairCostCents,
          requestedAt: a.requested_at,
          reminded: a.status === 'reminded',
          silent: addMs(a.requested_at, OWNER_ALERT_MS) <= now,
        };
      }));
      return waiting.filter((w) => w !== null);
    },

    /** Jobs short of Quotes 72 hours after the first Quote Requests, and Property Owners silent for 48 hours. */
    async alerts(agencyId: number, propertyIds: number[] | null) {
      const now = clock.now();
      const mine = async (ticketId: number) => propertyIds === null || propertyIds.includes((await tickets.ticket(ticketId)).propertyId);
      // Only Jobs still getting Quotes can be short of them: the rest of the history isn't read.
      const firstRequests = await all<{ job_id: number; ticket_id: number; first_sent: string }>(
        db,
        `SELECT r.job_id, r.ticket_id, min(r.sent_at) AS first_sent FROM quote_requests r JOIN jobs j ON j.id = r.job_id
         WHERE r.agency_id = ? AND j.status = 'quoting' GROUP BY r.job_id, r.ticket_id ORDER BY r.job_id, r.ticket_id`,
        agencyId,
      );
      // Each one's lookups run side by side; the lists keep the order they were read in.
      const quotePrompts = await Promise.all(
        firstRequests.map(async (r) => {
          if (addMs(r.first_sent, MORE_QUOTES_PROMPT_MS) > now || !(await mine(r.ticket_id))) return null;
          const confirmedQuotes = await pricedCount(r.job_id);
          if (confirmedQuotes >= MIN_QUOTES) return null;
          return {
            kind: 'invite_more_tradies' as const,
            ticketId: r.ticket_id,
            jobId: r.job_id,
            propertyAddress: (await jobPlace(r.job_id)).property.address,
            confirmedQuotes,
          };
        }),
      );
      const approvals = await all<ApprovalRow>(
        db,
        `SELECT * FROM approvals WHERE agency_id = ? AND status IN ('requested', 'reminded') ORDER BY requested_at, id`,
        agencyId,
      );
      const silentOwners = await Promise.all(
        approvals.map(async (a) => {
          if (addMs(a.requested_at, OWNER_ALERT_MS) > now || !(await mine(a.ticket_id))) return null;
          const owner = await profiles.person(a.owner_id);
          return {
            kind: 'owner_no_reply' as const,
            ticketId: a.ticket_id,
            jobId: a.job_id,
            propertyAddress: (await jobPlace(a.job_id)).property.address,
            ownerName: owner.name,
            ownerPhone: owner.mobile,
            requestedAt: a.requested_at,
          };
        }),
      );
      return [...quotePrompts.filter((p) => p !== null), ...silentOwners.filter((o) => o !== null)];
    },
  };
}

export type Quotes = ReturnType<typeof createQuotes>;
