import type { Context } from './context.ts';
import { MIN_QUOTES } from './quotes.ts';
import { addMs, HOUR_MS, iso, URGENCIES } from './shared.ts';
import type { Issue, Job, JobStatus, Ticket } from './tickets.ts';

/** What the Property Manager's screens show, composed from each module's queries. */
/** How far ahead the dashboard's calendar looks. */
const CALENDAR_DAYS = 14;

/** A lane of the dashboard's board: the Job status that puts a Ticket in it. */
export type Stage = Exclude<JobStatus, 'cancelled'>;

/** The lanes in workflow order. */
export const STAGES: Stage[] = ['quoting', 'awaiting_owner', 'approved', 'scheduled', 'done'];

/** Across a Ticket's Jobs being quoted: Quote Requests not declined, Quotes in, and Quotes the Property Manager confirmed. */
export type Quoting = { asked: number; received: number; confirmed: number };

/**
 * What a Ticket being quoted needs from the Property Manager: Quotes in but not yet
 * confirmed are to check; once a Job has MIN_QUOTES confirmed Quotes one can be chosen.
 */
export type QuotingDecision = 'check_quotes' | 'choose_quote';

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
export function quotingDecision(q: Quoting): QuotingDecision | null {
  if (q.received > q.confirmed) return 'check_quotes';
  if (q.confirmed >= MIN_QUOTES) return 'choose_quote';
  return null;
}

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
    tenantName: (await profiles.person(issue.tenantId)).name,
  });

  const ticketSummary = async (ticket: Ticket) => ({
    ticketId: ticket.id,
    ...(await propertyLabel(ticket.propertyId)),
    tenantName: (await profiles.person(ticket.tenantId)).name,
    description: (await tickets.issue(ticket.issueId)).description,
    urgency: ticket.urgency,
    checkUrgency: ticket.checkUrgency,
    reportedAt: ticket.reportedAt,
    jobs: (await tickets.jobsOf(ticket.id)).map((j) => ({ jobId: j.id, trade: j.trade, status: j.status })),
    unreadMessages: await tickets.unreadCount(ticket.issueId),
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
    const quoting = await modules.quotes.quotingOf(jobs.filter((j) => j.status === 'quoting').map((j) => j.id));
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
          stage === 'quoting'
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
          decision: counts ? quotingDecision(counts) : null,
        };
      }),
    );
  };

  /** The Properties a list is limited to: the Property Manager's own, or all of the Agency's. */
  const scope = (propertyManagerId: number, filter: 'mine' | 'all') => (filter === 'mine' ? profiles.propertyIdsOf(propertyManagerId) : Promise.resolve(null));

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

    /** The Maintenance Requests waiting for a Property Manager to confirm, oldest first. */
    async requests(agencyId: number, propertyManagerId: number, filter: 'mine' | 'all') {
      return maintenanceRequestViews(agencyId, await scope(propertyManagerId, filter));
    },

    /** One Maintenance Request waiting for review anywhere in the Agency, or null when there is none with that number. */
    async request(agencyId: number, issueId: number) {
      const issue = (await tickets.maintenanceRequests(agencyId, null)).find((i) => i.id === issueId);
      return issue ? maintenanceRequestView(issue) : null;
    },

    /**
     * The rail's counts for a Property Manager's own Properties: Requests is the
     * Maintenance Requests to confirm plus the Agency's inbox; Approvals is the Jobs
     * ready for a Work Order plus the alerts (Quotes short, Property Owner silent, rating due).
     */
    async navCounts(agencyId: number, propertyManagerId: number) {
      const propertyIds = await profiles.propertyIdsOf(propertyManagerId);
      const [requests, inbox, waitingOnOwner] = await Promise.all([
        tickets.maintenanceRequests(agencyId, propertyIds),
        intake.inbox(agencyId),
        modules.quotes.waitingOnOwner(agencyId, propertyIds),
      ]);
      return { requests: requests.length + inbox.length, approvals: waitingOnOwner.length };
    },

    /**
     * Tickets of one status, Urgent before High before Routine and then oldest first,
     * optionally of one Urgency. `counts` are for the same Properties: open and closed
     * Tickets, and the open or closed ones (whichever `status` is) by Urgency.
     */
    async tickets(
      agencyId: number,
      propertyManagerId: number,
      o: { filter: 'mine' | 'all'; status: 'open' | 'closed'; urgency: Ticket['urgency'] | null },
    ) {
      const every = await tickets.list(agencyId, await scope(propertyManagerId, o.filter));
      const inStatus = every.filter((t) => t.status === o.status);
      const countOf = (urgency: Ticket['urgency']) => inStatus.filter((t) => t.urgency === urgency).length;
      return {
        counts: {
          open: every.filter((t) => t.status === 'open').length,
          closed: every.filter((t) => t.status === 'closed').length,
          urgent: countOf('urgent'),
          high: countOf('high'),
          routine: countOf('routine'),
        },
        tickets: await Promise.all(
          inStatus.filter((t) => o.urgency === null || t.urgency === o.urgency).map(async (t) => ({ ...(await ticketSummary(t)), status: t.status })),
        ),
      };
    },

    /** What is waiting on someone outside the Agency: Quotes on a Property Owner, and Urgent Repairs on a Tenant's receipt. */
    async approvals(agencyId: number, propertyManagerId: number, filter: 'mine' | 'all') {
      const propertyIds = await scope(propertyManagerId, filter);
      return {
        waitingOnOwner: await modules.quotes.waitingOnOwner(agencyId, propertyIds),
        waitingOnReceipt: await Promise.all(
          (await tickets.urgentRepairs(agencyId, propertyIds))
            .filter((u) => u.status === 'reminder_sent')
            .map(async (u) => {
              const property = await profiles.property(u.propertyId);
              return {
                urgentRepairId: u.id,
                propertyAddress: property.address,
                ownerName: (await profiles.person(property.ownerId)).name,
                tenantName: (await profiles.person(u.tenantId)).name,
                description: (await tickets.issue(u.issueId)).description,
                reportedAt: u.createdAt,
              };
            }),
        ),
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
          tenants: tenants.filter((t) => t.propertyId === p.id).map((t) => t.name),
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

    async ticket(agencyId: number, ticketId: number) {
      const ticket = await tickets.ticketInAgency(agencyId, ticketId);
      const issue = await tickets.issue(ticket.issueId);
      const property = await profiles.property(ticket.propertyId);
      return {
        ...(await ticketSummary(ticket)),
        ...(await issueDetails(issue)),
        status: ticket.status,
        propertyId: property.id,
        maxRepairCostCents: property.maxRepairCostCents,
        frequentIssues: await profiles.frequentIssues(property.id),
        repairCostCents: await modules.quotes.repairCost(ticket.id),
        jobs: await Promise.all(
          (await tickets.jobsOf(ticket.id)).map(async (job) => ({
            jobId: job.id,
            trade: job.trade,
            checkTrade: job.checkTrade,
            status: job.status,
            ...(await modules.quotes.jobView(agencyId, job.id)),
            workOrder: await modules.scheduling.workOrderForJob(job.id),
          })),
        ),
        timeline: await tickets.timeline(ticket.id),
        messages: await tickets.messages(ticket.issueId),
      };
    },
  };
}
