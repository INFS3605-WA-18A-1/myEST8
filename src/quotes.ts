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
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_requests (
      id INTEGER PRIMARY KEY,
      agency_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      tradie_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      UNIQUE (job_id, tradie_id)
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY,
      agency_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      quote_request_id INTEGER NOT NULL UNIQUE REFERENCES quote_requests(id),
      tradie_id INTEGER NOT NULL,
      trade TEXT NOT NULL,
      price_cents INTEGER,
      proposed_time TEXT,
      confirmed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      pdf_file_id INTEGER,
      single_quote_reason TEXT,
      received_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY,
      agency_id INTEGER NOT NULL,
      quote_id INTEGER NOT NULL REFERENCES quotes(id),
      job_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      owner_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      answered_at TEXT
    );
  `);

  const { profiles, tickets, notifications } = modules;
  const businessName = (tradieId: number) => {
    const tradie = profiles.person(tradieId);
    return tradie.businessName ?? tradie.name;
  };

  function quoteRequestsOf(jobId: number) {
    return all<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE job_id = ? ORDER BY id', jobId);
  }

  function quotesOf(jobId: number) {
    return all<QuoteRow>(db, 'SELECT * FROM quotes WHERE job_id = ? ORDER BY id', jobId);
  }

  function confirmedCount(jobId: number) {
    return one<{ n: number }>(db, 'SELECT count(*) AS n FROM quotes WHERE job_id = ? AND confirmed = 1', jobId)!.n;
  }

  function quoteInAgency(agencyId: number, quoteId: number) {
    const quote = one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ? AND agency_id = ?', quoteId, agencyId);
    if (!quote) notFound('Quote');
    return quote;
  }

  function previousQuotes(tradieId: number, trade: Trade) {
    return all<{ price_cents: number; received_at: string; job_id: number }>(
      db,
      'SELECT price_cents, received_at, job_id FROM quotes WHERE tradie_id = ? AND trade = ? AND confirmed = 1 ORDER BY received_at',
      tradieId,
      trade,
    ).map((q) => ({ priceCents: q.price_cents, at: q.received_at, jobId: q.job_id }));
  }

  /** The total of a Ticket's approved Quotes. */
  function repairCost(ticketId: number) {
    return one<{ total: number }>(db, `SELECT coalesce(sum(price_cents), 0) AS total FROM quotes WHERE ticket_id = ? AND status = 'approved'`, ticketId)!
      .total;
  }

  function jobPlace(jobId: number) {
    const job = tickets.job(jobId);
    const ticket = tickets.ticket(job.ticketId);
    return { job, ticket, property: profiles.property(ticket.propertyId) };
  }

  async function approve(quote: QuoteRow) {
    const { job, ticket, property } = jobPlace(quote.job_id);
    const passedOver = transaction(db, () => {
      run(db, `UPDATE quotes SET status = 'approved' WHERE id = ?`, quote.id);
      tickets.setJobStatus(job.id, 'approved');
      tickets.recordEvent(ticket.id, 'quote_approved', { jobId: job.id, tradie: businessName(quote.tradie_id), priceCents: quote.price_cents });
      const others = quoteRequestsOf(job.id).filter((r) => r.id !== quote.quote_request_id && r.status !== 'declined' && r.status !== 'closed');
      for (const request of others) {
        run(db, `UPDATE quote_requests SET status = 'closed' WHERE id = ?`, request.id);
        run(db, `UPDATE quotes SET status = 'not_chosen' WHERE quote_request_id = ? AND status = 'open'`, request.id);
      }
      return others;
    });
    for (const request of passedOver) {
      await notifications.send(request.tradie_id, 'tradie.not_chosen', { trade: job.trade, suburb: property.suburb }, { issueId: ticket.issueId });
    }
  }

  worker.on<{ quoteRequestId: number }>('quotes.reminder', async ({ quoteRequestId }) => {
    const request = one<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE id = ?', quoteRequestId)!;
    if (request.status !== 'sent') return;
    const { job, ticket, property } = jobPlace(request.job_id);
    run(db, `UPDATE quote_requests SET status = 'reminded' WHERE id = ?`, request.id);
    await notifications.send(request.tradie_id, 'tradie.quote_reminder', { trade: job.trade, suburb: property.suburb }, { issueId: ticket.issueId });
  });

  worker.on<{ approvalId: number }>('quotes.owner_reminder', async ({ approvalId }) => {
    const approval = one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE id = ?', approvalId)!;
    if (approval.status !== 'requested') return;
    const quote = one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ?', approval.quote_id)!;
    const { job, ticket, property } = jobPlace(approval.job_id);
    run(db, `UPDATE approvals SET status = 'reminded' WHERE id = ?`, approval.id);
    await notifications.send(
      approval.owner_id,
      'owner.approval_reminder',
      { propertyAddress: property.address, trade: job.trade, quotePriceCents: quote.price_cents! },
      { issueId: ticket.issueId },
    );
  });

  return {
    /** The Agency's Tradies with the Job's Trade: myEST8 rating, then Google rating, then median Quote (none last). */
    recommend(agencyId: number, jobId: number) {
      const job = tickets.jobInAgency(agencyId, jobId);
      const requested = new Set(quoteRequestsOf(jobId).map((r) => r.tradie_id));
      return profiles
        .tradiesWithTrade(agencyId, job.trade)
        .map((tradie) => {
          const previous = previousQuotes(tradie.id, job.trade);
          return {
            tradieId: tradie.id,
            businessName: tradie.businessName ?? tradie.name,
            myEst8Rating: profiles.myEst8Rating(tradie.id),
            googleRating: tradie.googlePlaceId ? { rating: tradie.googleRating, reviewCount: tradie.googleReviewCount } : null,
            previousQuotes: previous,
            medianQuoteCents: median(previous.map((q) => q.priceCents)),
            bookings: modules.scheduling.bookings(agencyId, tradie.id),
            requested: requested.has(tradie.id),
          };
        })
        .sort(
          (a, b) =>
            b.myEst8Rating.average - a.myEst8Rating.average ||
            (b.googleRating?.rating ?? -1) - (a.googleRating?.rating ?? -1) ||
            (a.medianQuoteCents ?? Infinity) - (b.medianQuoteCents ?? Infinity) ||
            a.businessName.localeCompare(b.businessName),
        );
    },

    async sendQuoteRequests(agencyId: number, jobId: number, tradieIds: number[]) {
      const { job, ticket, property } = jobPlace(tickets.jobInAgency(agencyId, jobId).id);
      if (job.status !== 'quoting') invalid('Quote Requests can only be sent while the Job is getting Quotes');
      if (!tradieIds.length) invalid('Choose at least one Tradie');
      const already = new Set(quoteRequestsOf(jobId).map((r) => r.tradie_id));
      const tradies = [...new Set(tradieIds)].map((id) => profiles.personInAgency(agencyId, id, 'tradie'));
      for (const tradie of tradies) {
        if (!tradie.trades.includes(job.trade)) invalid(`${tradie.businessName ?? tradie.name} doesn't do ${job.trade} work`);
        if (already.has(tradie.id)) invalid(`${tradie.businessName ?? tradie.name} has already been asked to quote`);
      }
      const issue = tickets.issue(ticket.issueId);
      const photoFileIds = tickets.photos(issue.id).map((p) => p.fileId);
      const requestIds = transaction(db, () =>
        tradies.map((tradie) =>
          run(
            db,
            `INSERT INTO quote_requests (agency_id, job_id, ticket_id, tradie_id, status, sent_at) VALUES (?, ?, ?, ?, 'sent', ?)`,
            agencyId,
            jobId,
            ticket.id,
            tradie.id,
            iso(clock.now()),
          ),
        ),
      );
      tickets.recordEvent(ticket.id, 'quote_requests_sent', { jobId, tradies: tradies.map((t) => t.businessName ?? t.name) });
      for (const [i, tradie] of tradies.entries()) {
        const byEmail = notifications.channelFor(tradie.id) === 'email';
        await notifications.send(
          tradie.id,
          'tradie.quote_request',
          { trade: job.trade, urgency: ticket.urgency, description: withoutContactDetails(issue.description), suburb: property.suburb },
          { issueId: issue.id, attachmentFileIds: byEmail ? photoFileIds : [] },
        );
        worker.schedule('quotes.reminder', { quoteRequestId: requestIds[i] }, addMs(clock.now(), QUOTE_REMINDER_MS));
      }
    },

    /** A Tradie's reply to a Quote Request: an unconfirmed Quote read from the text and any PDF, or a decline. */
    async recordTradieReply(quoteRequestId: number, reply: { kind: 'quote' | 'decline'; text: string; pdfFileId: number | null }) {
      const request = one<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE id = ?', quoteRequestId)!;
      if (!WAITING.includes(request.status)) return;
      const { job } = jobPlace(request.job_id);
      if (reply.kind === 'decline') {
        run(db, `UPDATE quote_requests SET status = 'declined' WHERE id = ?`, request.id);
        tickets.recordEvent(request.ticket_id, 'tradie_declined', { jobId: job.id, tradie: businessName(request.tradie_id) });
        return;
      }
      const read = await ports.quoteReader.read({
        text: reply.text,
        ...(reply.pdfFileId !== null ? { pdf: files.get(reply.pdfFileId).content } : {}),
      });
      transaction(db, () => {
        run(
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
        run(db, `UPDATE quote_requests SET status = 'quoted' WHERE id = ?`, request.id);
        tickets.recordEvent(request.ticket_id, 'quote_received', { jobId: job.id, tradie: businessName(request.tradie_id) });
      });
    },

    /** Confirms a Quote as read, or with the Property Manager's corrections. Only confirmed Quotes count. */
    confirmQuote(agencyId: number, quoteId: number, edits: { priceCents?: number; proposedTime?: string | null } = {}) {
      const quote = quoteInAgency(agencyId, quoteId);
      if (quote.status !== 'open') invalid('This Quote can no longer be changed');
      const price = edits.priceCents ?? quote.price_cents;
      if (price === null || !Number.isInteger(price) || price <= 0) invalid('Enter the price before confirming the Quote');
      const time = edits.proposedTime === undefined ? quote.proposed_time : edits.proposedTime;
      if (time !== null && Number.isNaN(Date.parse(time))) invalid(`${time} is not a time`);
      run(
        db,
        'UPDATE quotes SET price_cents = ?, proposed_time = ?, confirmed = 1 WHERE id = ?',
        price,
        time === null ? null : iso(new Date(time)),
        quoteId,
      );
    },

    /** Chooses a Quote, then approves it or asks the Property Owner if it takes the Repair Cost over the Max Repair Cost. */
    async chooseQuote(agencyId: number, quoteId: number, reason?: string) {
      const quote = quoteInAgency(agencyId, quoteId);
      if (!quote.confirmed) invalid('Confirm the Quote before choosing it');
      if (quote.status !== 'open') invalid('This Quote can no longer be chosen');
      const { job, ticket, property } = jobPlace(quote.job_id);
      if (job.status !== 'quoting') invalid('This Job is not choosing a Quote');
      const why = reason?.trim() || null;
      const onlyOne = confirmedCount(job.id) < MIN_QUOTES;
      if (onlyOne && !why) {
        invalid('Choose a Quote once the Job has at least two confirmed Quotes, or record why you are going ahead with one');
      }
      const repairCostCents = repairCost(ticket.id) + quote.price_cents!;
      run(db, 'UPDATE quotes SET single_quote_reason = ? WHERE id = ?', onlyOne ? why : null, quote.id);
      tickets.recordEvent(ticket.id, 'quote_chosen', {
        jobId: job.id,
        tradie: businessName(quote.tradie_id),
        priceCents: quote.price_cents,
        ...(onlyOne ? { reason: why } : {}),
      });
      if (repairCostCents <= property.maxRepairCostCents) return approve(quote);

      const approvalId = transaction(db, () => {
        run(db, `UPDATE quotes SET status = 'awaiting_owner' WHERE id = ?`, quote.id);
        tickets.setJobStatus(job.id, 'awaiting_owner');
        tickets.recordEvent(ticket.id, 'approval_requested', { jobId: job.id, repairCostCents });
        return run(
          db,
          `INSERT INTO approvals (agency_id, quote_id, job_id, ticket_id, owner_id, status, requested_at) VALUES (?, ?, ?, ?, ?, 'requested', ?)`,
          agencyId,
          quote.id,
          job.id,
          ticket.id,
          property.ownerId,
          iso(clock.now()),
        );
      });
      await notifications.send(
        property.ownerId,
        'owner.approval_request',
        {
          propertyAddress: property.address,
          trade: job.trade,
          tradieBusinessName: businessName(quote.tradie_id),
          quotePriceCents: quote.price_cents!,
          repairCostCents,
          maxRepairCostCents: property.maxRepairCostCents,
        },
        { issueId: ticket.issueId },
      );
      worker.schedule('quotes.owner_reminder', { approvalId }, addMs(clock.now(), OWNER_REMINDER_MS));
    },

    /** YES approves the Quote. NO declines it, and the Property Manager can choose another. */
    async recordOwnerAnswer(approvalId: number, answer: 'yes' | 'no') {
      const approval = one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE id = ?', approvalId)!;
      if (!OPEN_APPROVAL.includes(approval.status)) return;
      const quote = one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = ?', approval.quote_id)!;
      run(db, 'UPDATE approvals SET status = ?, answered_at = ? WHERE id = ?', answer === 'yes' ? 'approved' : 'declined', iso(clock.now()), approval.id);
      if (answer === 'yes') return approve(quote);
      transaction(db, () => {
        run(db, `UPDATE quotes SET status = 'declined_by_owner' WHERE id = ?`, quote.id);
        tickets.setJobStatus(approval.job_id, 'quoting');
        tickets.recordEvent(approval.ticket_id, 'owner_declined', { jobId: approval.job_id, priceCents: quote.price_cents });
      });
    },

    hasQuoteRequests(jobId: number) {
      return quoteRequestsOf(jobId).length > 0;
    },

    /** A cancelled Job stops waiting for Quotes and approval. */
    jobCancelled(jobId: number) {
      run(db, `UPDATE quote_requests SET status = 'closed' WHERE job_id = ? AND status IN ('sent', 'reminded', 'quoted')`, jobId);
      run(db, `UPDATE quotes SET status = 'not_chosen' WHERE job_id = ? AND status IN ('open', 'awaiting_owner')`, jobId);
      run(db, `UPDATE approvals SET status = 'cancelled' WHERE job_id = ? AND status IN ('requested', 'reminded')`, jobId);
    },

    itemsWaitingOn(tradieId: number): OpenItem[] {
      return all<QuoteRequestRow>(
        db,
        `SELECT * FROM quote_requests WHERE tradie_id = ? AND status IN ('sent', 'reminded') ORDER BY id DESC`,
        tradieId,
      ).map((r) => {
        const { job, property } = jobPlace(r.job_id);
        return { ref: `quote_request:${r.id}`, summary: `Quote Request: ${job.trade} job in ${property.suburb}` };
      });
    },

    approvalsWaitingOn(ownerId: number): OpenItem[] {
      return all<ApprovalRow>(
        db,
        `SELECT * FROM approvals WHERE owner_id = ? AND status IN ('requested', 'reminded') ORDER BY id DESC`,
        ownerId,
      ).map((a) => {
        const { job, property } = jobPlace(a.job_id);
        return { ref: `approval:${a.id}`, summary: `Approval request: ${job.trade} job at ${property.address}` };
      });
    },

    quoteRequest(id: number) {
      const row = one<QuoteRequestRow>(db, 'SELECT * FROM quote_requests WHERE id = ?', id);
      return row ? { ticketId: row.ticket_id } : null;
    },

    approval(id: number) {
      const row = one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE id = ?', id);
      return row ? { ticketId: row.ticket_id } : null;
    },

    /** The Job's approved Quote: who does the work, and when they proposed. */
    approvedQuote(jobId: number) {
      const row = one<QuoteRow>(db, `SELECT * FROM quotes WHERE job_id = ? AND status = 'approved'`, jobId);
      return row ? { tradieId: row.tradie_id, priceCents: row.price_cents!, proposedTime: row.proposed_time } : null;
    },

    repairCost,
    previousQuotes,

    /** Quote Requests, the side-by-side Quotes, and approval status for one Job. */
    jobView(agencyId: number, jobId: number) {
      const job = tickets.job(jobId);
      const approval = one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE job_id = ? ORDER BY id DESC LIMIT 1', jobId);
      return {
        recommendations: job.status === 'quoting' ? this.recommend(agencyId, jobId) : [],
        quoteRequests: quoteRequestsOf(jobId).map((r) => ({
          quoteRequestId: r.id,
          tradieId: r.tradie_id,
          businessName: businessName(r.tradie_id),
          status: r.status,
          sentAt: r.sent_at,
        })),
        quotes: quotesOf(jobId).map((q) => ({
          quoteId: q.id,
          tradieId: q.tradie_id,
          businessName: businessName(q.tradie_id),
          priceCents: q.price_cents,
          proposedTime: q.proposed_time,
          confirmed: !!q.confirmed,
          status: q.status,
          hasPdf: q.pdf_file_id !== null,
          reason: q.single_quote_reason,
        })),
        approval: approval
          ? { approvalId: approval.id, quoteId: approval.quote_id, status: approval.status, requestedAt: approval.requested_at }
          : null,
      };
    },

    /** Jobs short of Quotes 72 hours after the first Quote Requests, and Property Owners silent for 48 hours. */
    alerts(agencyId: number, propertyIds: number[] | null) {
      const now = clock.now();
      const mine = (ticketId: number) => propertyIds === null || propertyIds.includes(tickets.ticket(ticketId).propertyId);
      const firstRequests = all<{ job_id: number; ticket_id: number; first_sent: string }>(
        db,
        'SELECT job_id, ticket_id, min(sent_at) AS first_sent FROM quote_requests WHERE agency_id = ? GROUP BY job_id, ticket_id',
        agencyId,
      );
      const quotePrompts = firstRequests
        .filter((r) => mine(r.ticket_id) && tickets.job(r.job_id).status === 'quoting')
        .filter((r) => addMs(r.first_sent, MORE_QUOTES_PROMPT_MS) <= now && confirmedCount(r.job_id) < MIN_QUOTES)
        .map((r) => ({
          kind: 'invite_more_tradies' as const,
          ticketId: r.ticket_id,
          jobId: r.job_id,
          propertyAddress: jobPlace(r.job_id).property.address,
          confirmedQuotes: confirmedCount(r.job_id),
        }));
      const silentOwners = all<ApprovalRow>(
        db,
        `SELECT * FROM approvals WHERE agency_id = ? AND status IN ('requested', 'reminded') ORDER BY requested_at`,
        agencyId,
      )
        .filter((a) => mine(a.ticket_id) && addMs(a.requested_at, OWNER_ALERT_MS) <= now)
        .map((a) => {
          const owner = profiles.person(a.owner_id);
          return {
            kind: 'owner_no_reply' as const,
            ticketId: a.ticket_id,
            jobId: a.job_id,
            propertyAddress: jobPlace(a.job_id).property.address,
            ownerName: owner.name,
            ownerPhone: owner.mobile,
            requestedAt: a.requested_at,
          };
        });
      return [...quotePrompts, ...silentOwners];
    },
  };
}

export type Quotes = ReturnType<typeof createQuotes>;
