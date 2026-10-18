import type { Context } from './context.ts';
import { URGENT_REPAIR_LIMIT_CENTS } from './intake.ts';
import { MIN_QUOTES } from './quotes.ts';
import { addMs, HOUR_MS, iso, URGENCIES, type Trade, type Urgency } from './shared.ts';
import type { Issue, Job, JobStatus, Ticket, UrgentRepairStatus } from './tickets.ts';

/** Reimbursement Requests in the order Approvals lists them: the ones to check first, then those waiting on the Tenant, then on the Property Owner. */
const REIMBURSEMENT_ORDER: UrgentRepairStatus[] = ['receipt_received', 'reminder_sent', 'receipt_forwarded', 'reimbursed'];

/** What the Property Manager's screens show, composed from each module's queries. */
/** How far ahead the dashboard's calendar looks. */
const CALENDAR_DAYS = 14;

/** A lane of the dashboard's board: the Job status that puts a Ticket in it. */
export type Stage = Exclude<JobStatus, 'cancelled'>;

/** The lanes in workflow order. */
export const STAGES: Stage[] = ['quoting', 'site_quoting', 'awaiting_owner', 'approved', 'scheduled', 'done'];

/** Across a Ticket's Jobs being quoted: Quote Requests not declined, Quotes in, and Quotes the Property Manager confirmed. */
export type Quoting = { asked: number; received: number; confirmed: number };

/**
 * What a Ticket being quoted needs from the Property Manager: Quotes in but not yet
 * confirmed are to check; once a Job has MIN_QUOTES confirmed Quotes one can be chosen.
 */
export type QuotingDecision = 'check_quotes' | 'choose_quote' | 'book_site_quotes';

/** Where a Ticket's Site Quotes stand: whether they were booked or skipped, and visits still to happen. */
export type SiteQuoteState = { booked: boolean; skipped: boolean; open: number };

/** What `quotingDecision` needs beyond the Quote counts: the Job's lane, the Ticket's Urgency and its Site Quotes. */
export type QuotingContext = { status?: 'quoting' | 'site_quoting'; urgency?: Ticket['urgency']; siteQuotes?: SiteQuoteState };

/**
 * The lane of a Ticket: its least advanced open Job (quoting < awaiting_owner <
 * approved < scheduled < done). Cancelled Jobs are ignored, and a Ticket whose Jobs
 * are all done or cancelled is Done.
 */
export function stageOf(jobs: { status: JobStatus }[]): Stage {
  const open = jobs.map((j) => STAGES.indexOf(j.status as Stage)).filter((i) => i >= 0 && STAGES[i] !== 'done');
  if (open.length) return STAGES[Math.min(...open)]!;
  return jobs.length ? 'done' : 'quoting';
}

/** Unconfirmed Quotes come first: they are what stands between the Property Manager and choosing. */
export function quotingDecision(q: Quoting, context: QuotingContext = {}): QuotingDecision | null {
  if (q.received > q.confirmed) return 'check_quotes';
  if (q.confirmed < MIN_QUOTES) return null;
  const site = context.siteQuotes ?? { booked: false, skipped: false, open: 0 };
  // Getting Site Quotes: choose once every booked visit is done.
  if (context.status === 'site_quoting') return site.open > 0 ? null : 'choose_quote';
  // A High Ticket with two confirmed Quotes leads with Site Quotes; choosing without them stays allowed.
  if (context.urgency === 'high' && !site.booked && !site.skipped) return 'book_site_quotes';
  return 'choose_quote';
}

/**
 * What a list of Maintenance Requests or Tickets is narrowed to: Mine or All, then
 * optionally one Urgency, one Trade and one Property. A Property outside Mine shows nothing.
 */
export type ListOptions = { filter: 'mine' | 'all'; urgency?: Urgency; trade?: Trade; propertyId?: number };

/** Caches an async lookup for one read, so Tickets on the same Property share it. */
function cached<K, V>(lookup: (key: K) => Promise<V>) {
  const seen = new Map<K, Promise<V>>();
  return (key: K) => {
    if (!seen.has(key)) seen.set(key, lookup(key));
    return seen.get(key)!;
  };
}

export function createViews({ clock, modules }: Context) {
  const { profiles, tickets, intake } = modules;

  const propertyLabel = async (propertyId: number) => {
    const property = await profiles.property(propertyId);
    return { propertyAddress: property.address, propertyManager: (await profiles.propertyManager(property.propertyManagerId)).name };
  };

  const issueDetails = async (issue: Issue) => ({
    description: issue.description,
    answers: issue.answers,
    photos: (await tickets.photos(issue.id)).map(({ photoId, fileId, metadata, reasons }) => ({ photoId, fileId, metadata, reasons })),
    imageMatch: issue.imageMatch,
    noPhotos: issue.noPhotos,
    tenantId: issue.tenantId,
    tenantName: (await profiles.person(issue.tenantId)).name,
  });

  const ticketSummary = async (ticket: Ticket) => ({
    ticketId: ticket.id,
    propertyId: ticket.propertyId,
    ...(await propertyLabel(ticket.propertyId)),
    tenantName: (await profiles.person(ticket.tenantId)).name,
    description: (await tickets.issue(ticket.issueId)).description,
    urgency: ticket.urgency,
    checkUrgency: ticket.checkUrgency,
    reportedAt: ticket.reportedAt,
    jobs: (await tickets.jobsOf(ticket.id)).map((j) => ({ jobId: j.id, trade: j.trade, status: j.status })),
    unreadMessages: await tickets.unreadCount(ticket.issueId),
    // The issue's photos, for a list's thumbnail (the first) and anything that counts them.
    photos: (await tickets.photos(ticket.issueId)).map(({ photoId, fileId }) => ({ photoId, fileId })),
  });

  const maintenanceRequestView = async (issue: Issue) => ({
    issueId: issue.id,
    propertyId: issue.propertyId,
    ...(await propertyLabel(issue.propertyId)),
    ...(await issueDetails(issue)),
    urgency: issue.urgency,
    checkUrgency: issue.checkUrgency,
    trade: issue.trade,
    checkTrade: issue.checkTrade,
    reportedAt: issue.reportedAt,
    summary: issue.summary,
    summaryBy: issue.summaryBy,
    photosOnArrival: issue.photosOnArrival,
    unreadMessages: await tickets.unreadCount(issue.id),
  });

  const maintenanceRequestViews = async (agencyId: number, propertyIds: number[] | null) =>
    Promise.all((await tickets.maintenanceRequests(agencyId, propertyIds)).map(maintenanceRequestView));

  /**
   * The open Tickets as the dashboard's board shows them: each Ticket's summary, its
   * lane, its Trades, for the Quoting lane its Quote counts and what the Property
   * Manager decides next, and for the Booked lane its next visit. Jobs, issues, Quote
   * counts and visits are read in one query each for every Ticket at once.
   */
  const board = async (open: Ticket[]) => {
    const ids = open.map((t) => t.id);
    const [jobs, issues, visits] = await Promise.all([
      tickets.jobsOfTickets(ids),
      tickets.issuesWithUnread(open.map((t) => t.issueId)),
      modules.scheduling.visitsOfTickets(ids),
    ]);
    const quotingJobIds = jobs.filter((j) => j.status === 'quoting' || j.status === 'site_quoting').map((j) => j.id);
    const [quoting, siteQuotes] = await Promise.all([modules.quotes.quotingOf(quotingJobIds), modules.scheduling.siteQuotesOf(quotingJobIds)]);
    const label = cached(propertyLabel);
    const person = cached(profiles.person);
    const jobsOf = new Map<number, Job[]>();
    for (const j of jobs) jobsOf.set(j.ticketId, [...(jobsOf.get(j.ticketId) ?? []), j]);
    return Promise.all(
      open.map(async (ticket) => {
        const ticketJobs = jobsOf.get(ticket.id) ?? [];
        const issue = issues.get(ticket.issueId)!;
        const stage = stageOf(ticketJobs);
        const inStage = ticketJobs.filter((j) => j.status === stage);
        const counts =
          stage === 'quoting' || stage === 'site_quoting'
            ? inStage.reduce<Quoting>((sum, j) => {
                const c = quoting.get(j.id);
                return c ? { asked: sum.asked + c.asked, received: sum.received + c.received, confirmed: sum.confirmed + c.confirmed } : sum;
              }, { asked: 0, received: 0, confirmed: 0 })
            : null;
        return {
          ticketId: ticket.id,
          ...(await label(ticket.propertyId)),
          tenantName: (await person(ticket.tenantId)).name,
          description: issue.description,
          urgency: ticket.urgency,
          checkUrgency: ticket.checkUrgency,
          reportedAt: ticket.reportedAt,
          jobs: ticketJobs.map((j) => ({ jobId: j.id, trade: j.trade, status: j.status })),
          unreadMessages: issue.unreadMessages,
          stage,
          trades: [...new Set(ticketJobs.filter((j) => j.status !== 'cancelled').map((j) => j.trade))],
          quoting: counts,
          nextVisit: stage === 'scheduled' ? (inStage.map((j) => visits.get(j.id)).filter((v) => v !== undefined).sort()[0] ?? null) : null,
          decision: counts
            ? quotingDecision(counts, {
                status: stage as 'quoting' | 'site_quoting',
                urgency: ticket.urgency,
                siteQuotes: inStage.reduce<SiteQuoteState>(
                  (sum, j) => {
                    const state = siteQuotes.get(j.id);
                    return state ? { booked: sum.booked || state.booked, skipped: sum.skipped || state.skipped, open: sum.open + state.open } : sum;
                  },
                  { booked: false, skipped: false, open: 0 },
                ),
              })
            : null,
        };
      }),
    );
  };

  /** The Properties a list is limited to: the Property Manager's own, or all of the Agency's. */
  const scope = (propertyManagerId: number, filter: 'mine' | 'all') => (filter === 'mine' ? profiles.propertyIdsOf(propertyManagerId) : Promise.resolve(null));

  /** `scope`, narrowed to the one Property a list is filtered to: none at all when it is not among them. */
  const listScope = async (propertyManagerId: number, o: ListOptions) => {
    const ids = await scope(propertyManagerId, o.filter);
    if (o.propertyId === undefined) return ids;
    return ids === null || ids.includes(o.propertyId) ? [o.propertyId] : [];
  };

  return {
    async dashboard(agencyId: number, propertyManagerId: number, filter: 'mine' | 'all') {
      const now = clock.now();
      const propertyIds = filter === 'mine' ? await profiles.propertyIdsOf(propertyManagerId) : null;
      const [maintenanceRequests, openTickets, urgentRepairs, inbox, quoteAlerts, schedulingAlerts, calendar] = await Promise.all([
        maintenanceRequestViews(agencyId, propertyIds),
        tickets.openTickets(agencyId, propertyIds),
        tickets.urgentRepairs(agencyId, propertyIds),
        intake.inbox(agencyId),
        modules.quotes.alerts(agencyId, propertyIds),
        modules.scheduling.alerts(agencyId, propertyIds),
        modules.scheduling.calendar(agencyId, { from: iso(now), to: iso(addMs(now, CALENDAR_DAYS * 24 * HOUR_MS)) }),
      ]);
      const [boardTickets, repairs] = await Promise.all([
        board(openTickets),
        Promise.all(
          urgentRepairs.map(async (u) => ({
            urgentRepairId: u.id,
            ...(await propertyLabel(u.propertyId)),
            tenantName: (await profiles.person(u.tenantId)).name,
            description: (await tickets.issue(u.issueId)).description,
            status: u.status,
            receipts: u.receiptFileIds.length,
            reportedAt: u.createdAt,
          })),
        ),
      ]);
      return { maintenanceRequests, tickets: boardTickets, urgentRepairs: repairs, inbox, alerts: [...quoteAlerts, ...schedulingAlerts], calendar };
    },

    /**
     * The Maintenance Requests waiting for a Property Manager to confirm, narrowed by `o`
     * (Trade is the Trade it was classified as): Urgent, High, then Routine, oldest first within each.
     */
    async requests(agencyId: number, propertyManagerId: number, o: ListOptions) {
      const rank = (u: string) => ['urgent', 'high', 'routine'].indexOf(u);
      const waiting = (await tickets.maintenanceRequests(agencyId, await listScope(propertyManagerId, o))).filter(
        (i) => (!o.urgency || i.urgency === o.urgency) && (!o.trade || i.trade === o.trade),
      );
      const views = await Promise.all(waiting.map(maintenanceRequestView));
      return views.sort((a, b) => rank(a.urgency) - rank(b.urgency) || a.reportedAt.localeCompare(b.reportedAt));
    },

    /** One Maintenance Request waiting for review anywhere in the Agency, or null when there is none with that number. */
    async request(agencyId: number, issueId: number) {
      const issue = (await tickets.maintenanceRequests(agencyId, null)).find((i) => i.id === issueId);
      return issue ? maintenanceRequestView(issue) : null;
    },

    /**
     * The rail's counts for a Property Manager's own Properties: Tickets is the new
     * Maintenance Requests to confirm; Approvals is the Quotes waiting on a Property
     * Owner and the Reimbursement Requests waiting for the Property Manager to check.
     */
    async navCounts(agencyId: number, propertyManagerId: number) {
      const propertyIds = await profiles.propertyIdsOf(propertyManagerId);
      // Tickets counts the new Maintenance Requests /tickets lists; inbox messages wait on the dashboard instead.
      const [requests, waitingOnOwner, urgentRepairs] = await Promise.all([
        tickets.maintenanceRequests(agencyId, propertyIds),
        modules.quotes.waitingOnOwner(agencyId, propertyIds),
        tickets.urgentRepairs(agencyId, propertyIds),
      ]);
      const toReview = urgentRepairs.filter((u) => u.status === 'receipt_received').length;
      return { tickets: requests.length, approvals: waitingOnOwner.length + toReview };
    },

    /**
     * Tickets of one status, narrowed by `o` (a Ticket has a Trade when any of its Jobs
     * does). Open ones come Urgent before High before Routine and then oldest first; closed
     * ones (the Archive) the most recently closed first.
     */
    async tickets(agencyId: number, propertyManagerId: number, o: ListOptions & { status: 'open' | 'closed' }) {
      const inStatus = (await tickets.list(agencyId, await listScope(propertyManagerId, o))).filter(
        (t) => t.status === o.status && (!o.urgency || t.urgency === o.urgency),
      );
      const withTrade = o.trade ? new Set((await tickets.jobsOfTickets(inStatus.map((t) => t.id))).filter((j) => j.trade === o.trade).map((j) => j.ticketId)) : null;
      const shown = withTrade ? inStatus.filter((t) => withTrade.has(t.id)) : inStatus;
      if (o.status === 'closed') shown.sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '') || b.id - a.id);
      return Promise.all(shown.map(async (t) => ({ ...(await ticketSummary(t)), status: t.status, closedAt: t.closedAt })));
    },

    /**
     * What is waiting on a Property Owner, or on a Tenant's Reimbursement Request:
     * Quotes over the Max Repair Cost, and every Reimbursement Request not yet
     * reimbursed, the ones for the Property Manager to check first, then oldest first.
     */
    async approvals(agencyId: number, propertyManagerId: number, filter: 'mine' | 'all') {
      const propertyIds = await scope(propertyManagerId, filter);
      const open = (await tickets.urgentRepairs(agencyId, propertyIds))
        .filter((u) => u.status !== 'reimbursed')
        .sort((a, b) => REIMBURSEMENT_ORDER.indexOf(a.status) - REIMBURSEMENT_ORDER.indexOf(b.status) || a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
      return {
        waitingOnOwner: await modules.quotes.waitingOnOwner(agencyId, propertyIds),
        reimbursements: await Promise.all(
          open.map(async (u) => {
            const property = await profiles.property(u.propertyId);
            const issue = await tickets.issue(u.issueId);
            return {
              urgentRepairId: u.id,
              propertyId: property.id,
              propertyAddress: property.address,
              ownerName: (await profiles.person(property.ownerId)).name,
              tenantName: (await profiles.person(u.tenantId)).name,
              description: issue.summary ?? issue.description,
              status: u.status,
              amountCents: u.amountCents,
              limitCents: URGENT_REPAIR_LIMIT_CENTS,
              receipts: u.receiptFileIds.length,
              reportedAt: u.createdAt,
              forwardedAt: u.forwardedAt,
            };
          }),
        ),
      };
    },

    /**
     * One Reimbursement Request, for its page: the issue and who is involved, the
     * amount against the limit, the receipts, when each step happened, its timeline
     * (from the Tenant's report) and the messages on its issue.
     */
    async reimbursement(agencyId: number, urgentRepairId: number) {
      const u = await tickets.urgentRepairInAgency(agencyId, urgentRepairId);
      const issue = await tickets.issue(u.issueId);
      const property = await profiles.property(u.propertyId);
      const [tenant, owner] = await Promise.all([profiles.person(u.tenantId), profiles.person(property.ownerId)]);
      const events = await tickets.urgentRepairTimeline(u.id);
      const contact = (p: typeof tenant) => ({ personId: p.id, name: p.name, mobile: p.mobile, email: p.email });
      return {
        urgentRepairId: u.id,
        issueId: issue.id,
        status: u.status,
        description: issue.description,
        summary: issue.summary,
        propertyId: property.id,
        propertyAddress: property.address,
        propertyManager: (await profiles.propertyManager(property.propertyManagerId)).name,
        tenant: contact(tenant),
        owner: contact(owner),
        amountCents: u.amountCents,
        limitCents: URGENT_REPAIR_LIMIT_CENTS,
        overLimit: u.amountCents !== null && u.amountCents > URGENT_REPAIR_LIMIT_CENTS,
        receipts: await tickets.urgentRepairReceipts(u.id),
        reportedAt: issue.reportedAt,
        createdAt: u.createdAt,
        /** When the latest receipt came; null before any did. */
        receivedAt: events.findLast((e) => e.kind === 'receipt_received')?.at ?? (u.receiptFileIds.length ? u.createdAt : null),
        forwardedAt: u.forwardedAt,
        reimbursedAt: u.reimbursedAt,
        timeline: [{ kind: 'reported', at: issue.reportedAt } as (typeof events)[number], ...events],
        messages: await tickets.messages(issue.id),
      };
    },

    /** Every Property with its Property Owner, Tenants and the number of open Tickets. */
    async propertyOverviews(agencyId: number) {
      const tenants = await profiles.people(agencyId, 'tenant');
      const openTickets = (await tickets.list(agencyId, null)).filter((t) => t.status === 'open');
      return Promise.all(
        (await profiles.properties(agencyId)).map(async (p) => ({
          propertyId: p.id,
          address: p.address,
          maxRepairCostCents: p.maxRepairCostCents,
          ownerName: (await profiles.person(p.ownerId)).name,
          propertyManager: (await profiles.propertyManager(p.propertyManagerId)).name,
          tenants: tenants.filter((t) => t.propertyId === p.id).map((t) => ({ personId: t.id, name: t.name })),
          openTickets: openTickets.filter((t) => t.propertyId === p.id).length,
        })),
      );
    },

    /** A Property's profile: Owner, Tenants, nominated Tradies, frequent issues and its open Tickets. */
    async property(agencyId: number, propertyId: number) {
      const property = await profiles.propertyInAgency(agencyId, propertyId);
      const owner = await profiles.person(property.ownerId);
      const buildingManager = property.buildingManagerId ? await profiles.person(property.buildingManagerId) : null;
      return {
        propertyId: property.id,
        address: property.address,
        maxRepairCostCents: property.maxRepairCostCents,
        propertyManager: (await profiles.propertyManager(property.propertyManagerId)).name,
        owner: { personId: owner.id, name: owner.name, mobile: owner.mobile, email: owner.email },
        buildingManager: buildingManager ? { name: buildingManager.name, mobile: buildingManager.mobile, email: buildingManager.email } : null,
        tenants: (await profiles.people(agencyId, 'tenant'))
          .filter((t) => t.propertyId === property.id)
          .map((t) => ({ personId: t.id, name: t.name, mobile: t.mobile, email: t.email, tenancyStart: t.tenancyStart })),
        nominatedTradies: await Promise.all(
          property.nominatedTradieIds.map(async (id) => {
            const t = await profiles.person(id);
            return { tradieId: t.id, name: t.name, businessName: t.businessName, trades: t.trades };
          }),
        ),
        frequentIssues: await profiles.frequentIssues(property.id),
        openTickets: await Promise.all(
          (await tickets.list(agencyId, [property.id])).filter((t) => t.status === 'open').map(ticketSummary),
        ),
        /** The Property's history: its closed Tickets, most recently closed first. */
        closedTickets: await Promise.all(
          (await tickets.list(agencyId, [property.id]))
            .filter((t) => t.status === 'closed')
            .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '') || b.id - a.id)
            .map(async (t) => ({ ...(await ticketSummary(t)), closedAt: t.closedAt })),
        ),
      };
    },

    /** The Agency's Tradies, best myEST8 rating first, with both ratings and how many Quotes each has given. */
    async tradies(agencyId: number) {
      const directory = await Promise.all(
        (await profiles.people(agencyId, 'tradie')).map(async (t) => ({
          tradieId: t.id,
          name: t.name,
          businessName: t.businessName,
          trades: t.trades,
          myEst8Rating: await profiles.myEst8Rating(t.id),
          googleRating: t.googlePlaceId ? { rating: t.googleRating, reviewCount: t.googleReviewCount } : null,
          quotes: await modules.quotes.quoteCount(t.id),
        })),
      );
      return directory.sort((a, b) => b.myEst8Rating.average - a.myEst8Rating.average || (a.businessName ?? a.name).localeCompare(b.businessName ?? b.name));
    },

    /**
     * What the Dispatch map shows: every Property of the Agency with where it is and its
     * open Tickets (the worst Urgency among them, or null), and every Tradie with where
     * they work from, their Trades and both ratings. Not limited to one Property Manager's
     * Properties: Tradies are shared, and dispatch looks across the Agency.
     */
    async dispatch(agencyId: number) {
      const open = await Promise.all(
        (await tickets.openTickets(agencyId, null)).map(async (ticket) => ({
          ticketId: ticket.id,
          propertyId: ticket.propertyId,
          description: (await tickets.issue(ticket.issueId)).description,
          urgency: ticket.urgency,
          reportedAt: ticket.reportedAt,
        })),
      );
      return {
        properties: (await profiles.properties(agencyId)).map((property) => {
          const openTickets = open.filter((t) => t.propertyId === property.id);
          const worstUrgency = URGENCIES.find((u) => openTickets.some((t) => t.urgency === u)) ?? null;
          return {
            propertyId: property.id,
            address: property.address,
            suburb: property.suburb,
            location: property.location,
            openTickets: openTickets.map(({ ticketId, description, urgency, reportedAt }) => ({ ticketId, description, urgency, reportedAt })),
            worstUrgency,
          };
        }),
        tradies: await Promise.all(
          (await profiles.people(agencyId, 'tradie')).map(async (tradie) => ({
            tradieId: tradie.id,
            name: tradie.name,
            businessName: tradie.businessName ?? tradie.name,
            trades: tradie.trades,
            location: tradie.location,
            myEst8Rating: await profiles.myEst8Rating(tradie.id),
            googleRating: tradie.googlePlaceId ? { rating: tradie.googleRating, reviewCount: tradie.googleReviewCount } : null,
          })),
        ),
      };
    },

    /** A Tradie's profile: both ratings, every rating given, previous Quotes and bookings. */
    async tradie(agencyId: number, tradieId: number) {
      const tradie = await profiles.personInAgency(agencyId, tradieId, 'tradie');
      return {
        tradieId: tradie.id,
        name: tradie.name,
        businessName: tradie.businessName,
        trades: tradie.trades,
        mobile: tradie.mobile,
        email: tradie.email,
        businessAddress: tradie.businessAddress,
        located: tradie.location !== null,
        myEst8Rating: await profiles.myEst8Rating(tradie.id),
        googleRating: tradie.googlePlaceId ? { rating: tradie.googleRating, reviewCount: tradie.googleReviewCount } : null,
        ratings: await profiles.ratings(tradie.id),
        // Each Quote with the Ticket it was for, and whether it was chosen: `chosen` when it
        // is the Job's approved Quote, `not_chosen` when another was or the Job was
        // cancelled, `waiting` while the Job has no approved Quote yet.
        previousQuotes: await Promise.all(
          (
            await Promise.all(tradie.trades.map(async (trade) => (await modules.quotes.previousQuotes(tradie.id, trade)).map((q) => ({ trade, ...q }))))
          )
            .flat()
            .map(async (q) => {
              const job = await tickets.job(q.jobId);
              const ticket = await tickets.ticket(job.ticketId);
              const approved = await modules.quotes.approvedQuote(q.jobId);
              const outcome: 'chosen' | 'not_chosen' | 'waiting' = approved
                ? approved.tradieId === tradie.id
                  ? 'chosen'
                  : 'not_chosen'
                : job.status === 'cancelled'
                  ? 'not_chosen'
                  : 'waiting';
              return {
                ...q,
                ticketId: ticket.id,
                propertyAddress: (await profiles.property(ticket.propertyId)).address,
                description: (await tickets.issue(ticket.issueId)).description,
                outcome,
              };
            }),
        ),
        // Upcoming visits from the same Work Orders as `scheduling.bookings`, with the
        // Ticket each is for. Five years ahead stands in for "every future booking".
        bookings: await Promise.all(
          (await modules.scheduling.calendar(agencyId, { from: iso(clock.now()), to: iso(addMs(clock.now(), 5 * 365 * 24 * HOUR_MS)) }))
            .filter((b) => b.tradieId === tradie.id && b.status === 'active')
            .map(async (b) => ({
              start: b.start,
              end: b.end,
              propertyAddress: b.propertyAddress,
              propertyManager: b.propertyManager,
              ticketId: b.ticketId,
              description: (await tickets.issue((await tickets.ticket(b.ticketId)).issueId)).description,
            })),
        ),
      };
    },

    /**
     * The Tenants, by name: each with their Property and its Property Manager, when the
     * tenancy started, how to reach them and their open Tickets. Mine is the Tenants of
     * the Property Manager's own Properties.
     */
    async tenants(agencyId: number, propertyManagerId: number, filter: 'mine' | 'all') {
      const [people, properties, propertyManagers, every] = await Promise.all([
        profiles.people(agencyId, 'tenant'),
        profiles.properties(agencyId),
        profiles.propertyManagers(agencyId),
        tickets.list(agencyId, null),
      ]);
      const propertyOf = new Map(properties.map((p) => [p.id, p]));
      const managerName = new Map(propertyManagers.map((m) => [m.id, m.name]));
      const open = every.filter((t) => t.status === 'open');
      return people
        .map((t) => {
          const property = t.propertyId === null ? undefined : propertyOf.get(t.propertyId);
          return {
            tenantId: t.id,
            name: t.name,
            property: property ? { propertyId: property.id, address: property.address } : null,
            propertyManagerId: property?.propertyManagerId ?? null,
            propertyManager: property ? (managerName.get(property.propertyManagerId) ?? null) : null,
            tenancyStart: t.tenancyStart,
            mobile: t.mobile,
            email: t.email,
            openTickets: open.filter((x) => x.tenantId === t.id).length,
          };
        })
        .filter((t) => filter === 'all' || t.propertyManagerId === propertyManagerId)
        .sort((a, b) => a.name.localeCompare(b.name) || a.tenantId - b.tenantId)
        .map(({ propertyManagerId: _, ...t }) => t);
    },

    /**
     * A Tenant's profile: their Property, contact details and when they are usually home,
     * the Tickets they raised (open first, then the most recently closed), their
     * Maintenance Requests still waiting and their Reimbursement Requests. Refuses
     * (not_found) anyone who isn't a Tenant of the Agency.
     */
    async tenant(agencyId: number, tenantId: number) {
      const tenant = await profiles.personInAgency(agencyId, tenantId, 'tenant');
      const property = tenant.propertyId === null ? null : await profiles.property(tenant.propertyId);
      const [every, waiting, repairs] = await Promise.all([
        tickets.list(agencyId, null),
        tickets.maintenanceRequests(agencyId, null),
        tickets.urgentRepairs(agencyId, null),
      ]);
      const address = cached(async (propertyId: number) => (await profiles.property(propertyId)).address);
      const raised = every.filter((t) => t.tenantId === tenant.id);
      const closed = raised.filter((t) => t.status === 'closed').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '') || b.id - a.id);
      return {
        tenantId: tenant.id,
        name: tenant.name,
        property: property ? { propertyId: property.id, address: property.address } : null,
        propertyManager: property ? (await profiles.propertyManager(property.propertyManagerId)).name : null,
        tenancyStart: tenant.tenancyStart,
        mobile: tenant.mobile,
        email: tenant.email,
        availability: tenant.availability,
        tickets: await Promise.all(
          [...raised.filter((t) => t.status === 'open'), ...closed].map(async (t) => ({
            ticketId: t.id,
            propertyId: t.propertyId,
            propertyAddress: await address(t.propertyId),
            description: (await tickets.issue(t.issueId)).description,
            urgency: t.urgency,
            status: t.status,
            reportedAt: t.reportedAt,
            closedAt: t.closedAt,
          })),
        ),
        maintenanceRequests: await Promise.all(
          waiting
            .filter((i) => i.tenantId === tenant.id)
            .map(async (i) => ({
              issueId: i.id,
              propertyAddress: await address(i.propertyId),
              description: i.description,
              summary: i.summary,
              urgency: i.urgency,
              reportedAt: i.reportedAt,
            })),
        ),
        reimbursementRequests: await Promise.all(
          repairs
            .filter((u) => u.tenantId === tenant.id)
            .map(async (u) => ({
              urgentRepairId: u.id,
              propertyAddress: await address(u.propertyId),
              description: (await tickets.issue(u.issueId)).description,
              status: u.status,
              receipts: u.receiptFileIds.length,
              reportedAt: u.createdAt,
            })),
        ),
      };
    },

    async ticket(agencyId: number, ticketId: number) {
      const ticket = await tickets.ticketInAgency(agencyId, ticketId);
      const issue = await tickets.issue(ticket.issueId);
      const property = await profiles.property(ticket.propertyId);
      return {
        ...(await ticketSummary(ticket)),
        ...(await issueDetails(issue)),
        status: ticket.status,
        summary: issue.summary,
        summaryBy: issue.summaryBy,
        propertyId: property.id,
        maxRepairCostCents: property.maxRepairCostCents,
        frequentIssues: await profiles.frequentIssues(property.id),
        repairCostCents: await modules.quotes.repairCost(ticket.id),
        jobs: await Promise.all(
          (await tickets.jobsOf(ticket.id)).map(async (job) => {
            const quotesView = await modules.quotes.jobView(agencyId, job.id);
            const siteState = (await modules.scheduling.siteQuotesOf([job.id])).get(job.id) ?? { booked: false, skipped: false, open: 0 };
            const gettingQuotes = job.status === 'quoting' || job.status === 'site_quoting';
            const counts: Quoting = {
              asked: quotesView.quoteRequests.filter((r) => r.status !== 'declined').length,
              received: quotesView.quotes.length,
              confirmed: quotesView.quotes.filter((q) => q.confirmed).length,
            };
            return {
              jobId: job.id,
              trade: job.trade,
              checkTrade: job.checkTrade,
              status: job.status,
              ...quotesView,
              /** Each Quote with its Tradie's ratings, whether or not they are among the recommended Tradies. */
              quotes: await Promise.all(
                quotesView.quotes.map(async (q) => {
                  const tradie = await profiles.personInAgency(agencyId, q.tradieId, 'tradie');
                  return {
                    ...q,
                    myEst8Rating: await profiles.myEst8Rating(q.tradieId),
                    googleRating: tradie.googlePlaceId ? { rating: tradie.googleRating, reviewCount: tradie.googleReviewCount } : null,
                  };
                }),
              ),
              /** What the Property Manager decides next while the Job is getting Quotes; null otherwise. */
              decision: gettingQuotes ? quotingDecision(counts, { status: job.status as 'quoting' | 'site_quoting', urgency: ticket.urgency, siteQuotes: siteState }) : null,
              workOrder: await modules.scheduling.workOrderForJob(job.id),
              /** Site Quote visits (not cancelled), the state of Site Quotes, and free slots to prefill booking them. */
              siteQuotes: {
                booked: siteState.booked,
                skipped: siteState.skipped,
                openVisits: siteState.open,
                visits: await modules.scheduling.siteQuoteVisits(job.id),
                canBook: gettingQuotes && quotesView.quotes.some((q) => q.confirmed && q.status === 'open'),
                slots: gettingQuotes && quotesView.quotes.some((q) => q.confirmed && q.status === 'open') ? await modules.scheduling.siteQuoteSlots(agencyId, job.id) : [],
              },
            };
          }),
        ),
        timeline: await tickets.timeline(ticket.id),
        messages: await tickets.messages(ticket.issueId),
      };
    },
  };
}
