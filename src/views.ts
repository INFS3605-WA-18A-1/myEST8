import type { Context } from './context.ts';
import { addMs, HOUR_MS, iso } from './shared.ts';
import type { Issue, Ticket } from './tickets.ts';

/** What the Property Manager's screens show, composed from each module's queries. */
/** How far ahead the dashboard's calendar looks. */
const CALENDAR_DAYS = 14;

export function createViews({ clock, modules }: Context) {
  const { profiles, tickets, intake } = modules;

  const propertyLabel = (propertyId: number) => {
    const property = profiles.property(propertyId);
    return { propertyAddress: property.address, propertyManager: profiles.propertyManager(property.propertyManagerId).name };
  };

  const issueDetails = (issue: Issue) => ({
    description: issue.description,
    answers: issue.answers,
    photos: tickets.photos(issue.id).map(({ photoId, fileId, metadata, reasons }) => ({ photoId, fileId, metadata, reasons })),
    imageMatch: issue.imageMatch,
    noPhotos: issue.noPhotos,
    tenantName: profiles.person(issue.tenantId).name,
  });

  const ticketSummary = (ticket: Ticket) => ({
    ticketId: ticket.id,
    ...propertyLabel(ticket.propertyId),
    tenantName: profiles.person(ticket.tenantId).name,
    description: tickets.issue(ticket.issueId).description,
    urgency: ticket.urgency,
    checkUrgency: ticket.checkUrgency,
    reportedAt: ticket.reportedAt,
    jobs: tickets.jobsOf(ticket.id).map((j) => ({ jobId: j.id, trade: j.trade, status: j.status })),
    unreadMessages: tickets.unreadCount(ticket.issueId),
  });

  return {
    dashboard(agencyId: number, propertyManagerId: number, filter: 'mine' | 'all') {
      const now = clock.now();
      const propertyIds = filter === 'mine' ? profiles.propertyIdsOf(propertyManagerId) : null;
      return {
        maintenanceRequests: tickets.maintenanceRequests(agencyId, propertyIds).map((issue) => ({
          issueId: issue.id,
          ...propertyLabel(issue.propertyId),
          ...issueDetails(issue),
          urgency: issue.urgency,
          checkUrgency: issue.checkUrgency,
          trade: issue.trade,
          checkTrade: issue.checkTrade,
          reportedAt: issue.reportedAt,
          unreadMessages: tickets.unreadCount(issue.id),
        })),
        tickets: tickets.openTickets(agencyId, propertyIds).map(ticketSummary),
        urgentRepairs: tickets.urgentRepairs(agencyId, propertyIds).map((u) => ({
          urgentRepairId: u.id,
          ...propertyLabel(u.propertyId),
          tenantName: profiles.person(u.tenantId).name,
          description: tickets.issue(u.issueId).description,
          status: u.status,
          receipts: u.receiptFileIds.length,
          reportedAt: u.createdAt,
        })),
        inbox: intake.inbox(agencyId),
        alerts: [...modules.quotes.alerts(agencyId, propertyIds), ...modules.scheduling.alerts(agencyId, propertyIds)],
        calendar: modules.scheduling.calendar(agencyId, { from: iso(now), to: iso(addMs(now, CALENDAR_DAYS * 24 * HOUR_MS)) }),
      };
    },

    /** A Tradie's profile: both ratings, every rating given, previous Quotes and bookings. */
    tradie(agencyId: number, tradieId: number) {
      const tradie = profiles.personInAgency(agencyId, tradieId, 'tradie');
      return {
        tradieId: tradie.id,
        name: tradie.name,
        businessName: tradie.businessName,
        trades: tradie.trades,
        mobile: tradie.mobile,
        email: tradie.email,
        myEst8Rating: profiles.myEst8Rating(tradie.id),
        googleRating: tradie.googlePlaceId ? { rating: tradie.googleRating, reviewCount: tradie.googleReviewCount } : null,
        ratings: profiles.ratings(tradie.id),
        previousQuotes: tradie.trades.flatMap((trade) => modules.quotes.previousQuotes(tradie.id, trade).map((q) => ({ trade, ...q }))),
        bookings: modules.scheduling.bookings(agencyId, tradie.id),
      };
    },

    ticket(agencyId: number, ticketId: number) {
      const ticket = tickets.ticketInAgency(agencyId, ticketId);
      const issue = tickets.issue(ticket.issueId);
      const property = profiles.property(ticket.propertyId);
      return {
        ...ticketSummary(ticket),
        ...issueDetails(issue),
        status: ticket.status,
        maxRepairCostCents: property.maxRepairCostCents,
        frequentIssues: profiles.frequentIssues(property.id),
        repairCostCents: modules.quotes.repairCost(ticket.id),
        jobs: tickets.jobsOf(ticket.id).map((job) => ({
          jobId: job.id,
          trade: job.trade,
          checkTrade: job.checkTrade,
          status: job.status,
          ...modules.quotes.jobView(agencyId, job.id),
          workOrder: modules.scheduling.workOrderForJob(job.id),
        })),
        timeline: tickets.timeline(ticket.id),
        messages: tickets.messages(ticket.issueId),
      };
    },
  };
}
