import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { addMs, HOUR_MS, invalid, iso, median, notFound, withoutContactDetails, type Trade } from './shared.ts';
import type { OpenItem } from './tickets.ts';

const QUOTE_REMINDER_MS = 48 * HOUR_MS;
const MORE_QUOTES_PROMPT_MS = 72 * HOUR_MS;
const OWNER_REMINDER_MS = 24 * HOUR_MS;
const OWNER_ALERT_MS = 48 * HOUR_MS;
const MIN_QUOTES = 2;

type QuoteRequestStatus = 'sent' | 'reminded' | 'quoted' | 'declined' | 'closed';
type QuoteStatus = 'open' | 'awaiting_owner' | 'approved' | 'declined_by_owner' | 'not_chosen';
type ApprovalStatus = 'requested' | 'reminded' | 'approved' | 'declined' | 'cancelled';

type QuoteRequestRow = { id: number; agency_id: number; job_id: number; ticket_id: number; tradie_id: number; status: QuoteRequestStatus; sent_at: string };
type QuoteRow = {
  id: number;
  agency_id: number;
  job_id: number;
  ticket_id: number;
  quote_request_id: number;
  tradie_id: number;
  trade: Trade;
  price_cents: number | null;
  proposed_time: string | null;
  confirmed: number;
  status: QuoteStatus;
  pdf_file_id: number | null;
  single_quote_reason: string | null;
  received_at: string;
};
type ApprovalRow = { id: number; agency_id: number; quote_id: number; job_id: number; ticket_id: number; owner_id: number; status: ApprovalStatus; requested_at: string };

const WAITING: QuoteRequestStatus[] = ['sent', 'reminded'];
const OPEN_APPROVAL: ApprovalStatus[] = ['requested', 'reminded'];

/** Tradie recommendation, Quote Requests, Quotes, choosing a Quote, Property Owner approval and Repair Cost. */
export function createQuotes({ db, clock, worker, ports, files, modules }: Context) {

  const { profiles, tickets, notifications } = modules;
  const businessName = async (tradieId: number) => {
    const tradie = await profiles.person(tradieId);
    return tradie.businessName ?? tradie.name;
  };

  async function quoteRequestsOf(jobId: number) {
    return await all<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE job_id = ? ORDER BY id', jobId);
  }

  async function quotesOf(jobId: number) {
    return await all<QuoteRow>(db, 'SELECT * FROM quotes WHERE job_id = ? ORDER BY id', jobId);
  }

  async function confirmedCount(jobId: number) {
    return (await one<{ n: number }>(db, 'SELECT count(*) AS n FROM quotes WHERE job_id = ? AND confirmed = 1', jobId))!.n;
  }

  async function quoteInAgency(agencyId: number, quoteId: number) {
    const quote = await one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ? AND agency_id = ?', quoteId, agencyId);
    if (!quote) notFound('Quote');
    return quote;
  }

  async function previousQuotes(tradieId: number, trade: Trade) {
    return (await all<{ price_cents: number; received_at: string; job_id: number }>(
      db,
      'SELECT price_cents, received_at, job_id FROM quotes WHERE tradie_id = ? AND trade = ? AND confirmed = 1 ORDER BY received_at, id',
      tradieId,
      trade,
    )).map((q) => ({ priceCents: q.price_cents, at: q.received_at, jobId: q.job_id }));
  }

  /** The total of a Ticket's approved Quotes. */
  async function repairCost(ticketId: number) {
    return (await one<{ total: number }>(db, `SELECT coalesce(sum(price_cents), 0) AS total FROM quotes WHERE ticket_id = ? AND status = 'approved'`, ticketId))!
      .total;
  }

  async function jobPlace(jobId: number) {
    const job = await tickets.job(jobId);
    const ticket = await tickets.ticket(job.ticketId);
    return { job, ticket, property: await profiles.property(ticket.propertyId) };
  }

  /** Approves a chosen Quote and closes the Job's other Quote Requests. Returns the requests passed over, to tell. */
  async function approveQuote(quote: QuoteRow) {
    const job = await tickets.job(quote.job_id);
    return transaction(db, async () => {
      await run(db, `UPDATE quotes SET status = 'approved' WHERE id = ?`, quote.id);
      await tickets.setJobStatus(job.id, 'approved');
      await tickets.recordEvent(job.ticketId, 'quote_approved', { jobId: job.id, tradie: await businessName(quote.tradie_id), priceCents: quote.price_cents });
      const others = (await quoteRequestsOf(job.id)).filter((r) => r.id !== quote.quote_request_id && r.status !== 'declined' && r.status !== 'closed');
      for (const request of others) {
        await run(db, `UPDATE quote_requests SET status = 'closed' WHERE id = ?`, request.id);
        await run(db, `UPDATE quotes SET status = 'not_chosen' WHERE quote_request_id = ? AND status = 'open'`, request.id);
      }
      return others;
    });
  }

  /** Tells the Tradies whose Quote Requests closed when another Quote was approved. */
  async function tellPassedOver(quote: QuoteRow, passedOver: QuoteRequestRow[]) {
    const { job, ticket, property } = await jobPlace(quote.job_id);
    for (const request of passedOver) {
      await notifications.send(request.tradie_id, 'tradie.not_chosen', { trade: job.trade, suburb: property.suburb }, { issueId: ticket.issueId });
    }
  }

  worker.on<{ quoteRequestId: number }>('quotes.reminder', async ({ quoteRequestId }) => {
    // Only a request still waiting is reminded, even if the Tradie's reply lands at the same moment.
    const request = await one<QuoteRequestRow>(db, `UPDATE quote_requests SET status = 'reminded' WHERE id = ? AND status = 'sent' RETURNING *`, quoteRequestId);
    if (!request) return;
    const { job, ticket, property } = await jobPlace(request.job_id);
    await notifications.send(request.tradie_id, 'tradie.quote_reminder', { trade: job.trade, suburb: property.suburb }, { issueId: ticket.issueId });
  });

  worker.on<{ approvalId: number }>('quotes.owner_reminder', async ({ approvalId }) => {
    const approval = await one<ApprovalRow>(db, `UPDATE approvals SET status = 'reminded' WHERE id = ? AND status = 'requested' RETURNING *`, approvalId);
    if (!approval) return;
    const quote = (await one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ?', approval.quote_id))!;
    const { job, ticket, property } = await jobPlace(approval.job_id);
    await notifications.send(
      approval.owner_id,
      'owner.approval_reminder',
      { propertyAddress: property.address, trade: job.trade, quotePriceCents: quote.price_cents! },
      { issueId: ticket.issueId },
    );
  });

  return {
    /** The Agency's Tradies with the Job's Trade: myEST8 rating, then Google rating, then median Quote (none last). */
    async recommend(agencyId: number, jobId: number) {
      const job = await tickets.jobInAgency(agencyId, jobId);
      const requested = new Set((await quoteRequestsOf(jobId)).map((r) => r.tradie_id));
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
            medianQuoteCents: median(previous.map((q) => q.priceCents)),
            bookings: await modules.scheduling.bookings(agencyId, tradie.id),
            requested: requested.has(tradie.id),
          };
        }),
      );
      return recommendations.sort(
          (a, b) =>
            b.myEst8Rating.average - a.myEst8Rating.average ||
            (b.googleRating?.rating ?? -1) - (a.googleRating?.rating ?? -1) ||
            (a.medianQuoteCents ?? Infinity) - (b.medianQuoteCents ?? Infinity) ||
            a.businessName.localeCompare(b.businessName),
        );
    },

    async sendQuoteRequests(agencyId: number, jobId: number, tradieIds: number[]) {
      // Checked and recorded in one transaction, so a double submit can't ask a Tradie twice.
      const { job, ticket, property, tradies, requestIds } = await transaction(db, async () => {
        const { job, ticket, property } = await jobPlace((await tickets.jobInAgency(agencyId, jobId)).id);
        if (job.status !== 'quoting') invalid('Quote Requests can only be sent while the Job is getting Quotes');
        if (!tradieIds.length) invalid('Choose at least one Tradie');
        const already = new Set((await quoteRequestsOf(jobId)).map((r) => r.tradie_id));
        const tradies = [];
        for (const id of new Set(tradieIds)) tradies.push(await profiles.personInAgency(agencyId, id, 'tradie'));
        for (const tradie of tradies) {
          if (!tradie.trades.includes(job.trade)) invalid(`${tradie.businessName ?? tradie.name} doesn't do ${job.trade} work`);
          if (already.has(tradie.id)) invalid(`${tradie.businessName ?? tradie.name} has already been asked to quote`);
        }
        const requestIds: number[] = [];
        for (const tradie of tradies) {
          requestIds.push(
            await run(
              db,
              `INSERT INTO quote_requests (agency_id, job_id, ticket_id, tradie_id, status, sent_at) VALUES (?, ?, ?, ?, 'sent', ?) RETURNING id`,
              agencyId,
              jobId,
              ticket.id,
              tradie.id,
              iso(clock.now()),
            ),
          );
        }
        await tickets.recordEvent(ticket.id, 'quote_requests_sent', { jobId, tradies: tradies.map((t) => t.businessName ?? t.name) });
        return { job, ticket, property, tradies, requestIds };
      });
      const issue = await tickets.issue(ticket.issueId);
      const photoFileIds = (await tickets.photos(issue.id)).map((p) => p.fileId);
      for (const [i, tradie] of tradies.entries()) {
        const byEmail = (await notifications.channelFor(tradie.id)) === 'email';
        await notifications.send(
          tradie.id,
          'tradie.quote_request',
          { trade: job.trade, urgency: ticket.urgency, description: withoutContactDetails(issue.description), suburb: property.suburb },
          { issueId: issue.id, attachmentFileIds: byEmail ? photoFileIds : [] },
        );
        await worker.schedule('quotes.reminder', { quoteRequestId: requestIds[i] }, addMs(clock.now(), QUOTE_REMINDER_MS));
      }
    },

    /** A Tradie's reply to a Quote Request: an unconfirmed Quote read from the text and any PDF, or a decline. */
    async recordTradieReply(quoteRequestId: number, reply: { kind: 'quote' | 'decline'; text: string; pdfFileId: number | null }) {
      const waiting = (await one<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE id = ?', quoteRequestId))!;
      if (!WAITING.includes(waiting.status)) return;
      const read =
        reply.kind === 'quote'
          ? await ports.quoteReader.read({
              text: reply.text,
              ...(reply.pdfFileId !== null ? { pdf: (await files.get(reply.pdfFileId)).content } : {}),
            })
          : null;
      await transaction(db, async () => {
        // Checked again: another reply may have been recorded while the quote reader read this one.
        const request = (await one<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE id = ?', quoteRequestId))!;
        if (!WAITING.includes(request.status)) return;
        const job = await tickets.job(request.job_id);
        if (!read) {
          await run(db, `UPDATE quote_requests SET status = 'declined' WHERE id = ?`, request.id);
          await tickets.recordEvent(request.ticket_id, 'tradie_declined', { jobId: job.id, tradie: await businessName(request.tradie_id) });
          return;
        }
        await run(
          db,
          `INSERT INTO quotes (agency_id, job_id, ticket_id, quote_request_id, tradie_id, trade, price_cents, proposed_time, status, pdf_file_id, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
          request.agency_id,
          job.id,
          request.ticket_id,
          request.id,
          request.tradie_id,
          job.trade,
          read.priceCents ?? null,
          read.proposedTime ? iso(read.proposedTime) : null,
          reply.pdfFileId,
          iso(clock.now()),
        );
        await run(db, `UPDATE quote_requests SET status = 'quoted' WHERE id = ?`, request.id);
        await tickets.recordEvent(request.ticket_id, 'quote_received', { jobId: job.id, tradie: await businessName(request.tradie_id) });
      });
    },

    /** Confirms a Quote as read, or with the Property Manager's corrections. Only confirmed Quotes count. */
    async confirmQuote(agencyId: number, quoteId: number, edits: { priceCents?: number; proposedTime?: string | null } = {}) {
      return transaction(db, async () => {
        const quote = await quoteInAgency(agencyId, quoteId);
        if (quote.status !== 'open') invalid('This Quote can no longer be changed');
        const price = edits.priceCents ?? quote.price_cents;
        if (price === null || !Number.isInteger(price) || price <= 0) invalid('Enter the price before confirming the Quote');
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

    /** Chooses a Quote, then approves it or asks the Property Owner if it takes the Repair Cost over the Max Repair Cost. */
    async chooseQuote(agencyId: number, quoteId: number, reason?: string) {
      // Decided in one transaction: two Quotes chosen for a Job at once can't both be approved.
      const outcome = await transaction(db, async () => {
        const quote = await quoteInAgency(agencyId, quoteId);
        if (!quote.confirmed) invalid('Confirm the Quote before choosing it');
        if (quote.status !== 'open') invalid('This Quote can no longer be chosen');
        const { job, ticket, property } = await jobPlace(quote.job_id);
        if (job.status !== 'quoting') invalid('This Job is not choosing a Quote');
        const why = reason?.trim() || null;
        const onlyOne = (await confirmedCount(job.id)) < MIN_QUOTES;
        if (onlyOne && !why) {
          invalid('Choose a Quote once the Job has at least two confirmed Quotes, or record why you are going ahead with one');
        }
        const repairCostCents = (await repairCost(ticket.id)) + quote.price_cents!;
        await run(db, 'UPDATE quotes SET single_quote_reason = ? WHERE id = ?', onlyOne ? why : null, quote.id);
        await tickets.recordEvent(ticket.id, 'quote_chosen', {
          jobId: job.id,
          tradie: await businessName(quote.tradie_id),
          priceCents: quote.price_cents,
          ...(onlyOne ? { reason: why } : {}),
        });
        if (repairCostCents <= property.maxRepairCostCents) return { approved: true as const, quote, passedOver: await approveQuote(quote) };

        await run(db, `UPDATE quotes SET status = 'awaiting_owner' WHERE id = ?`, quote.id);
        await tickets.setJobStatus(job.id, 'awaiting_owner');
        await tickets.recordEvent(ticket.id, 'approval_requested', { jobId: job.id, repairCostCents });
        const approvalId = await run(
          db,
          `INSERT INTO approvals (agency_id, quote_id, job_id, ticket_id, owner_id, status, requested_at) VALUES (?, ?, ?, ?, ?, 'requested', ?) RETURNING id`,
          agencyId,
          quote.id,
          job.id,
          ticket.id,
          property.ownerId,
          iso(clock.now()),
        );
        return { approved: false as const, quote, job, ticket, property, repairCostCents, approvalId };
      });
      if (outcome.approved) return tellPassedOver(outcome.quote, outcome.passedOver);

      const { quote, job, ticket, property, repairCostCents, approvalId } = outcome;
      await notifications.send(
        property.ownerId,
        'owner.approval_request',
        {
          propertyAddress: property.address,
          trade: job.trade,
          tradieBusinessName: await businessName(quote.tradie_id),
          quotePriceCents: quote.price_cents!,
          repairCostCents,
          maxRepairCostCents: property.maxRepairCostCents,
        },
        { issueId: ticket.issueId },
      );
      await worker.schedule('quotes.owner_reminder', { approvalId }, addMs(clock.now(), OWNER_REMINDER_MS));
    },

    /** YES approves the Quote. NO declines it, and the Property Manager can choose another. */
    async recordOwnerAnswer(approvalId: number, answer: 'yes' | 'no') {
      const approved = await transaction(db, async () => {
        const approval = (await one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE id = ?', approvalId))!;
        if (!OPEN_APPROVAL.includes(approval.status)) return null;
        const quote = (await one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ?', approval.quote_id))!;
        await run(db, 'UPDATE approvals SET status = ?, answered_at = ? WHERE id = ?', answer === 'yes' ? 'approved' : 'declined', iso(clock.now()), approval.id);
        if (answer === 'yes') return { quote, passedOver: await approveQuote(quote) };
        await run(db, `UPDATE quotes SET status = 'declined_by_owner' WHERE id = ?`, quote.id);
        await tickets.setJobStatus(approval.job_id, 'quoting');
        await tickets.recordEvent(approval.ticket_id, 'owner_declined', { jobId: approval.job_id, priceCents: quote.price_cents });
        return null;
      });
      if (approved) await tellPassedOver(approved.quote, approved.passedOver);
    },

    async hasQuoteRequests(jobId: number) {
      return (await quoteRequestsOf(jobId)).length > 0;
    },

    /** A cancelled Job stops waiting for Quotes and approval. */
    async jobCancelled(jobId: number) {
      return transaction(db, async () => {
        await run(db, `UPDATE quote_requests SET status = 'closed' WHERE job_id = ? AND status IN ('sent', 'reminded', 'quoted')`, jobId);
        await run(db, `UPDATE quotes SET status = 'not_chosen' WHERE job_id = ? AND status IN ('open', 'awaiting_owner')`, jobId);
        await run(db, `UPDATE approvals SET status = 'cancelled' WHERE job_id = ? AND status IN ('requested', 'reminded')`, jobId);
      });
    },

    async itemsWaitingOn(tradieId: number): Promise<OpenItem[]> {
      return Promise.all((await all<QuoteRequestRow>(
        db,
        `SELECT * FROM quote_requests WHERE tradie_id = ? AND status IN ('sent', 'reminded') ORDER BY id DESC`,
        tradieId,
      )).map(async (r) => {
        const { job, property } = await jobPlace(r.job_id);
        return { ref: `quote_request:${r.id}`, summary: `Quote Request: ${job.trade} job in ${property.suburb}` };
      }));
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

    async quoteRequest(id: number) {
      const row = await one<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE id = ?', id);
      return row ? { ticketId: row.ticket_id } : null;
    },

    async approval(id: number) {
      const row = await one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE id = ?', id);
      return row ? { ticketId: row.ticket_id } : null;
    },

    /** The Job's approved Quote: who does the work, and when they proposed. */
    async approvedQuote(jobId: number) {
      const row = await one<QuoteRow>(db, `SELECT * FROM quotes WHERE job_id = ? AND status = 'approved'`, jobId);
      return row ? { tradieId: row.tradie_id, priceCents: row.price_cents!, proposedTime: row.proposed_time } : null;
    },

    repairCost,
    previousQuotes,

    /** Quote Requests, the side-by-side Quotes, and approval status for one Job. */
    async jobView(agencyId: number, jobId: number) {
      const job = await tickets.job(jobId);
      const approval = await one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE job_id = ? ORDER BY id DESC LIMIT 1', jobId);
      return {
        recommendations: job.status === 'quoting' ? await this.recommend(agencyId, jobId) : [],
        quoteRequests: await Promise.all((await quoteRequestsOf(jobId)).map(async (r) => ({
          quoteRequestId: r.id,
          tradieId: r.tradie_id,
          businessName: await businessName(r.tradie_id),
          status: r.status,
          sentAt: r.sent_at,
        }))),
        quotes: await Promise.all((await quotesOf(jobId)).map(async (q) => ({
          quoteId: q.id,
          tradieId: q.tradie_id,
          businessName: await businessName(q.tradie_id),
          priceCents: q.price_cents,
          proposedTime: q.proposed_time,
          confirmed: !!q.confirmed,
          status: q.status,
          hasPdf: q.pdf_file_id !== null,
          reason: q.single_quote_reason,
        }))),
        approval: approval
          ? { approvalId: approval.id, quoteId: approval.quote_id, status: approval.status, requestedAt: approval.requested_at }
          : null,
      };
    },

    /** Jobs short of Quotes 72 hours after the first Quote Requests, and Property Owners silent for 48 hours. */
    async alerts(agencyId: number, propertyIds: number[] | null) {
      const now = clock.now();
      const mine = async (ticketId: number) => propertyIds === null || propertyIds.includes((await tickets.ticket(ticketId)).propertyId);
      const firstRequests = await all<{ job_id: number; ticket_id: number; first_sent: string }>(
        db,
        'SELECT job_id, ticket_id, min(sent_at) AS first_sent FROM quote_requests WHERE agency_id = ? GROUP BY job_id, ticket_id ORDER BY job_id, ticket_id',
        agencyId,
      );
      const quotePrompts = [];
      for (const r of firstRequests) {
        if (!(await mine(r.ticket_id)) || (await tickets.job(r.job_id)).status !== 'quoting') continue;
        if (addMs(r.first_sent, MORE_QUOTES_PROMPT_MS) > now) continue;
        const confirmedQuotes = await confirmedCount(r.job_id);
        if (confirmedQuotes >= MIN_QUOTES) continue;
        quotePrompts.push({
          kind: 'invite_more_tradies' as const,
          ticketId: r.ticket_id,
          jobId: r.job_id,
          propertyAddress: (await jobPlace(r.job_id)).property.address,
          confirmedQuotes,
        });
      }
      const silentOwners = [];
      for (const a of await all<ApprovalRow>(
        db,
        `SELECT * FROM approvals WHERE agency_id = ? AND status IN ('requested', 'reminded') ORDER BY requested_at, id`,
        agencyId,
      )) {
        if (!(await mine(a.ticket_id)) || addMs(a.requested_at, OWNER_ALERT_MS) > now) continue;
        const owner = await profiles.person(a.owner_id);
        silentOwners.push({
          kind: 'owner_no_reply' as const,
          ticketId: a.ticket_id,
          jobId: a.job_id,
          propertyAddress: (await jobPlace(a.job_id)).property.address,
          ownerName: owner.name,
          ownerPhone: owner.mobile,
          requestedAt: a.requested_at,
        });
      }
      return [...quotePrompts, ...silentOwners];
    },
  };
}

export type Quotes = ReturnType<typeof createQuotes>;
