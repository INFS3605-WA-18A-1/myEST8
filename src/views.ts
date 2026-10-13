import type { Context } from './context.ts';
import { addMs, HOUR_MS, iso } from './shared.ts';
import type { Issue, Ticket } from './tickets.ts';

/** What the Property Manager's screens show, composed from each module's queries. */
/** How far ahead the dashboard's calendar looks. */
const CALENDAR_DAYS = 14;

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

  return {
    async dashboard(agencyId: number, propertyManagerId: number, filter: 'mine' | 'all') {
      const now = clock.now();
      const propertyIds = filter === 'mine' ? await profiles.propertyIdsOf(propertyManagerId) : null;
      return {
        maintenanceRequests: await Promise.all(
          (await tickets.maintenanceRequests(agencyId, propertyIds)).map(async (issue) => ({
            issueId: issue.id,
            ...(await propertyLabel(issue.propertyId)),
            ...(await issueDetails(issue)),
            urgency: issue.urgency,
            checkUrgency: issue.checkUrgency,
            trade: issue.trade,
            checkTrade: issue.checkTrade,
            reportedAt: issue.reportedAt,
            unreadMessages: await tickets.unreadCount(issue.id),
          })),
        ),
        tickets: await Promise.all((await tickets.openTickets(agencyId, propertyIds)).map(ticketSummary)),
        urgentRepairs: await Promise.all(
          (await tickets.urgentRepairs(agencyId, propertyIds)).map(async (u) => ({
            urgentRepairId: u.id,
            ...(await propertyLabel(u.propertyId)),
            tenantName: (await profiles.person(u.tenantId)).name,
            description: (await tickets.issue(u.issueId)).description,
            status: u.status,
            receipts: u.receiptFileIds.length,
            reportedAt: u.createdAt,
          })),
        ),
        inbox: await intake.inbox(agencyId),
        alerts: [...(await modules.quotes.alerts(agencyId, propertyIds)), ...(await modules.scheduling.alerts(agencyId, propertyIds))],
        calendar: await modules.scheduling.calendar(agencyId, { from: iso(now), to: iso(addMs(now, CALENDAR_DAYS * 24 * HOUR_MS)) }),
      };
    },

    /**
     * The rail's counts for a Property Manager's own Properties: Requests is the
     * Maintenance Requests to confirm plus the Agency's inbox; Approvals is the Jobs
     * ready for a Work Order plus the alerts (Quotes short, Property Owner silent, rating due).
     */
    async navCounts(agencyId: number, propertyManagerId: number) {
      const propertyIds = await profiles.propertyIdsOf(propertyManagerId);
      const open = await tickets.openTickets(agencyId, propertyIds);
      const readyToBook = (await Promise.all(open.map((t) => tickets.jobsOf(t.id)))).flat().filter((j) => j.status === 'approved').length;
      const alerts = [...(await modules.quotes.alerts(agencyId, propertyIds)), ...(await modules.scheduling.alerts(agencyId, propertyIds))];
      return {
        requests: (await tickets.maintenanceRequests(agencyId, propertyIds)).length + (await intake.inbox(agencyId)).length,
        approvals: readyToBook + alerts.length,
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
        myEst8Rating: await profiles.myEst8Rating(tradie.id),
        googleRating: tradie.googlePlaceId ? { rating: tradie.googleRating, reviewCount: tradie.googleReviewCount } : null,
        ratings: await profiles.ratings(tradie.id),
        previousQuotes: (
          await Promise.all(tradie.trades.map(async (trade) => (await modules.quotes.previousQuotes(tradie.id, trade)).map((q) => ({ trade, ...q }))))
        ).flat(),
        bookings: await modules.scheduling.bookings(agencyId, tradie.id),
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
