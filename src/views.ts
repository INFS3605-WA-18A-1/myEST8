import type { Context } from './context.ts';
import { all } from './db.ts';
import { commonAreaIssues, tenantProfileRead, tradieProfileRead } from './profile-glance.ts';
import { buildingManagerRead, ownerRead, tenantHasConcern, type RequestJudgment, type TenantRequest } from './profile-reads.ts';
import { URGENT_REPAIR_LIMIT_CENTS } from './intake.ts';
import { MIN_QUOTE_REQUESTS, MIN_QUOTES } from './quotes.ts';
import { addMs, HOUR_MS, iso, TRADES, URGENCIES, type Trade, type Urgency } from './shared.ts';
import { dayOf, startOfDay } from './zoned-time.ts';
import type { Issue, Job, JobStatus, Ticket, UrgentRepairStatus } from './tickets.ts';

/** Reimbursement Requests in the order Approvals lists them: the ones to check first, then those waiting on the Tenant, then on the Property Owner. */
const REIMBURSEMENT_ORDER: UrgentRepairStatus[] = ['receipt_received', 'reminder_sent', 'receipt_forwarded', 'reimbursed'];

/** What the Property Manager's screens show, composed from each module's queries. */
/** How far ahead the dashboard's calendar looks, from the start of today. */
const CALENDAR_DAYS = 14;

/**
 * The window the dashboard's Next 7 days reads. The strip shows seven days; the
 * query runs further so a visit that starts this week and runs past it still counts.
 * Mine and All do not narrow this list: the dashboard returns every booking in the window.
 */
export function dashboardCalendarRange(now: Date, timeZone: string): { from: string; to: string } {
  return {
    from: iso(startOfDay(dayOf(now, timeZone), timeZone)),
    to: iso(addMs(now, CALENDAR_DAYS * 24 * HOUR_MS)),
  };
}

/** A lane of the dashboard's board: the Job status that puts a Ticket in it. */
export type Stage = Exclude<JobStatus, 'cancelled'>;

/** The lanes in workflow order. */
export const STAGES: Stage[] = ['quoting', 'awaiting_owner', 'approved', 'scheduled', 'done'];

/**
 * Across a Ticket's Jobs being quoted: Quote Requests not declined (`asked`), Estimates in
 * (`received`) and confirmed (`confirmed`), Quotes of either stage still to check
 * (`toCheck`), Firm Quotes ready to choose from (`firm`), and Tradies who need a Site
 * Inspection that isn't booked yet (`toInspect`).
 */
export type Quoting = { asked: number; received: number; confirmed: number; toCheck: number; firm: number; toInspect: number };

/**
 * What a Ticket being quoted needs from the Property Manager: Quotes read from a reply but
 * not yet confirmed are to check; then Site Inspections a Tradie asked for are to book; once
 * a Job has MIN_QUOTES Firm Quotes one can be chosen. Estimates never make a Job ready to
 * choose: the Property Manager may still proceed on one for a routine Job.
 */
export type QuotingDecision = 'check_quotes' | 'book_inspection' | 'choose_quote';

const NO_QUOTING: Quoting = { asked: 0, received: 0, confirmed: 0, toCheck: 0, firm: 0, toInspect: 0 };

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

/** Quotes to check come first: they are what stands between the Property Manager and the rest. */
export function quotingDecision(q: Quoting): QuotingDecision | null {
  if (q.toCheck > 0) return 'check_quotes';
  if (q.toInspect > 0) return 'book_inspection';
  if (q.firm >= MIN_QUOTES) return 'choose_quote';
  return null;
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

/** Where a signed-in Property Manager loads a Property's photo. `v` changes when the file does. */
function propertyPhotoUrl(propertyId: number, fileId: number | null): string | null {
  return fileId === null ? null : `/properties/${propertyId}/photo?v=${fileId}`;
}

export function createViews(ctx: Context) {
  const { clock, modules } = ctx;
  const { profiles, tickets, intake } = modules;

  const propertyLabel = async (propertyId: number) => {
    const property = await profiles.property(propertyId);
    return { propertyAddress: property.address, propertyManager: (await profiles.propertyManager(property.propertyManagerId)).name };
  };

  const issueDetails = async (issue: Issue) => {
    const tenant = await profiles.person(issue.tenantId);
    return {
      description: issue.description,
      answers: issue.answers,
      photos: (await tickets.photos(issue.id)).map(({ photoId, fileId, metadata, reasons }) => ({ photoId, fileId, metadata, reasons })),
      imageMatch: issue.imageMatch,
      noPhotos: issue.noPhotos,
      tenantId: issue.tenantId,
      tenantName: tenant.name,
      tenantMobile: tenant.mobile,
      tenantEmail: tenant.email,
    };
  };

  /**
   * Tickets as a list shows them, in the order given. Their jobs, issues (with unread
   * counts) and photos are read in one query each for the whole list.
   */
  const ticketSummaries = async (list: Ticket[]) => {
    const [jobs, issues, photos] = await Promise.all([
      tickets.jobsOfTickets(list.map((t) => t.id)),
      tickets.issuesWithUnread(list.map((t) => t.issueId)),
      tickets.photosOfIssues(list.map((t) => t.issueId)),
    ]);
    return Promise.all(
      list.map(async (ticket) => {
        const issue = issues.get(ticket.issueId)!;
        return {
          ticketId: ticket.id,
          propertyId: ticket.propertyId,
          ...(await propertyLabel(ticket.propertyId)),
          tenantId: ticket.tenantId,
          tenantName: (await profiles.person(ticket.tenantId)).name,
          description: issue.description,
          urgency: ticket.urgency,
          checkUrgency: ticket.checkUrgency,
          reportedAt: ticket.reportedAt,
          jobs: jobs.filter((j) => j.ticketId === ticket.id).map((j) => ({ jobId: j.id, trade: j.trade, status: j.status })),
          unreadMessages: issue.unreadMessages,
          // The issue's photos, for a list's thumbnail (the first) and anything that counts them.
          photos: photos.get(ticket.issueId) ?? [],
        };
      }),
    );
  };

  /** Maintenance Requests as a list shows them, in the order given, their unread counts read in one query. */
  const maintenanceRequestViews = async (list: Issue[]) => {
    const unread = await tickets.issuesWithUnread(list.map((i) => i.id));
    return Promise.all(
      list.map(async (issue) => ({
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
        unreadMessages: unread.get(issue.id)!.unreadMessages,
      })),
    );
  };

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
    const quotingJobIds = jobs.filter((j) => j.status === 'quoting').map((j) => j.id);
    const quoting = await modules.quotes.quotingOf(quotingJobIds);
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
                return c
                  ? {
                      asked: sum.asked + c.asked,
                      received: sum.received + c.received,
                      confirmed: sum.confirmed + c.confirmed,
                      toCheck: sum.toCheck + c.toCheck,
                      firm: sum.firm + c.firm,
                      toInspect: sum.toInspect + c.toInspect,
                    }
                  : sum;
              }, NO_QUOTING)
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

  /** `scope`, narrowed to the one Property a list is filtered to: none at all when it is not among them. */
  const listScope = async (propertyManagerId: number, o: ListOptions) => {
    const ids = await scope(propertyManagerId, o.filter);
    if (o.propertyId === undefined) return ids;
    return ids === null || ids.includes(o.propertyId) ? [o.propertyId] : [];
  };

  return {
    async dashboard(agencyId: number, propertyManagerId: number, filter: 'mine' | 'all') {
      const now = clock.now();
      // From the start of today, so a visit that has already ended still marks the day and is listed.
      const { timeZone } = await profiles.agency(agencyId);
      const propertyIds = filter === 'mine' ? await profiles.propertyIdsOf(propertyManagerId) : null;
      const [maintenanceRequests, openTickets, urgentRepairs, inbox, quoteAlerts, schedulingAlerts, safetyAlerts, calendar] = await Promise.all([
        tickets.maintenanceRequests(agencyId, propertyIds).then(maintenanceRequestViews),
        tickets.openTickets(agencyId, propertyIds),
        tickets.urgentRepairs(agencyId, propertyIds),
        intake.inbox(agencyId),
        modules.quotes.alerts(agencyId, propertyIds),
        modules.scheduling.alerts(agencyId, propertyIds),
        tickets.alerts(agencyId, propertyIds),
        modules.scheduling.calendar(agencyId, dashboardCalendarRange(now, timeZone)),
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
      return { maintenanceRequests, tickets: boardTickets, urgentRepairs: repairs, inbox, alerts: [...safetyAlerts, ...quoteAlerts, ...schedulingAlerts], calendar };
    },

    /**
     * The header search's suggestions: Properties whose address or suburb matches, and
     * Tickets whose number or Summary/description matches, capped at eight and mixing
     * the two kinds so neither crowds the other out. Only the Agency's own records:
     * this runs for a signed-in Property Manager and never leaves their Agency. With
     * `kind` 'property' (the Profiles search) it is the Properties alone, up to eight.
     */
    async searchSuggest(agencyId: number, rawQuery: string, kind?: 'property') {
      const query = rawQuery.trim().toLowerCase();
      if (query.length < 2) return [];
      if (kind === 'property') {
        const properties = await profiles.properties(agencyId);
        const rank = (property: (typeof properties)[number]) => {
          const address = property.address.toLowerCase();
          const suburb = property.suburb.toLowerCase();
          if (address.startsWith(query)) return 0;
          if (suburb.startsWith(query)) return 1;
          if (address.includes(query) || suburb.includes(query)) return 2;
          return -1;
        };
        return properties
          .map((property) => ({ property, rank: rank(property) }))
          .filter((hit) => hit.rank >= 0)
          .sort((a, b) => a.rank - b.rank || a.property.address.localeCompare(b.property.address))
          .slice(0, 8)
          .map(({ property }) => ({ type: 'property' as const, label: property.address, sub: property.suburb, href: `/properties/${property.id}` }));
      }
      const words = query.replace(/^#/, '');
      const number = /^\d+$/.test(words) ? Number(words) : null;
      const [properties, allTickets] = await Promise.all([profiles.properties(agencyId), tickets.list(agencyId, null)]);
      const issues = await tickets.issuesWithUnread(allTickets.map((ticket) => ticket.issueId));
      const propertyById = new Map(properties.map((property) => [property.id, property]));

      const haystack = (value: string) => value.toLowerCase();
      const propertyRank = (property: (typeof properties)[number]) => {
        const address = haystack(property.address);
        const suburb = haystack(property.suburb);
        if (address.startsWith(query)) return 0;
        if (suburb.startsWith(query)) return 1;
        if (address.includes(query) || suburb.includes(query)) return 2;
        return -1;
      };
      const ticketRank = (ticket: (typeof allTickets)[number]) => {
        if (number !== null && ticket.id === number) return 0;
        const title = haystack(issues.get(ticket.issueId)?.summary ?? issues.get(ticket.issueId)?.description ?? '');
        if (title.startsWith(query)) return 1;
        if (title.includes(query)) return 2;
        return -1;
      };

      const propertyHits = properties
        .map((property) => ({ property, rank: propertyRank(property) }))
        .filter((hit) => hit.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.property.address.localeCompare(b.property.address))
        .slice(0, 8);
      const ticketHits = allTickets
        .map((ticket) => ({ ticket, rank: ticketRank(ticket) }))
        .filter((hit) => hit.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.ticket.reportedAt.localeCompare(b.ticket.reportedAt) || a.ticket.id - b.ticket.id)
        .slice(0, 8);

      const stageWord: Record<Stage, string> = {
        quoting: 'Quoting',
        awaiting_owner: 'With Property Owner',
        approved: 'Ready to book',
        scheduled: 'Booked',
        done: 'Done',
      };
      const jobs = ticketHits.length ? await tickets.jobsOfTickets(ticketHits.map(({ ticket }) => ticket.id)) : [];
      const stageOfTicket = (ticketId: number) => stageWord[stageOf(jobs.filter((job) => job.ticketId === ticketId))];

      const suggestions = [
        ...propertyHits.map(({ property }) => ({ type: 'property' as const, label: property.address, sub: property.suburb, href: `/properties/${property.id}` })),
        ...ticketHits.map(({ ticket }) => {
          const issue = issues.get(ticket.issueId);
          const address = propertyById.get(ticket.propertyId)?.address ?? '';
          return {
            type: 'ticket' as const,
            label: `#${ticket.id} ${issue?.summary ?? issue?.description ?? 'Ticket'}`,
            sub: `${address} · ${stageOfTicket(ticket.id)}`,
            href: `/tickets/${ticket.id}`,
          };
        }),
      ];
      // Take one of each kind in turn, so a page of matching addresses still leaves room for Tickets.
      const mixed: typeof suggestions = [];
      const propertyCount = propertyHits.length;
      const ticketCount = ticketHits.length;
      for (let i = 0; i < Math.max(propertyCount, ticketCount) && mixed.length < 8; i++) {
        if (i < propertyCount) mixed.push(suggestions[i]!);
        if (mixed.length < 8 && i < ticketCount) mixed.push(suggestions[propertyCount + i]!);
      }
      return mixed;
    },

    /**
     * The open inbox as conversations, newest first: one per person (or one per unknown
     * sender's address), each with the messages exchanged with them oldest first. The
     * inbox items themselves ride along so the inbox modal can keep their triage actions.
     */
    async inboxThreads(agencyId: number) {
      const items = await intake.inbox(agencyId);
      const groups = new Map<string, typeof items>();
      for (const item of items) {
        const key = item.personId === null ? `address:${item.from}` : `person:${item.personId}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      const conversations = await Promise.all(
        [...groups].map(async ([key, group]) => {
          const latest = group[group.length - 1]!;
          return {
            key,
            personId: latest.personId,
            personName: latest.personName,
            address: latest.from,
            waiting: group.length,
            latestAt: latest.receivedAt,
            items: group,
            messages: await tickets.messagesOfContact(agencyId, { personId: latest.personId, address: latest.from }),
          };
        }),
      );
      return conversations.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
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
      const views = await maintenanceRequestViews(waiting);
      return views.sort((a, b) => rank(a.urgency) - rank(b.urgency) || a.reportedAt.localeCompare(b.reportedAt));
    },

    /** One Maintenance Request waiting for review anywhere in the Agency, or null when there is none with that number. */
    async request(agencyId: number, issueId: number) {
      const issue = (await tickets.maintenanceRequests(agencyId, null)).find((i) => i.id === issueId);
      return issue ? (await maintenanceRequestViews([issue]))[0]! : null;
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
      return (await ticketSummaries(shown)).map((summary, i) => ({ ...summary, status: shown[i]!.status, closedAt: shown[i]!.closedAt }));
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
          ownerId: p.ownerId,
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
      const every = await tickets.list(agencyId, [property.id]);
      const closed = every.filter((t) => t.status === 'closed').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '') || b.id - a.id);
      return {
        propertyId: property.id,
        address: property.address,
        /** The photo, or null. `v` is the file id, so a replaced photo is a new address. */
        photoUrl: propertyPhotoUrl(property.id, property.photoFileId),
        /** `fetched` is the online photo; `manager` is the Property Manager's own. Null when there is no photo. */
        photoSource: property.photoSource,
        maxRepairCostCents: property.maxRepairCostCents,
        propertyManager: (await profiles.propertyManager(property.propertyManagerId)).name,
        owner: { personId: owner.id, name: owner.name, mobile: owner.mobile, email: owner.email },
        buildingManager: buildingManager ? { personId: buildingManager.id, name: buildingManager.name, mobile: buildingManager.mobile, email: buildingManager.email } : null,
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
        openTickets: await ticketSummaries(every.filter((t) => t.status === 'open')),
        /** The Property's history: its closed Tickets, most recently closed first. */
        closedTickets: (await ticketSummaries(closed)).map((summary, i) => ({ ...summary, closedAt: closed[i]!.closedAt })),
      };
    },

    /** The Agency's Tradies, best myEST8 rating first, with both ratings and how many Quotes each has given. */
    async tradies(agencyId: number) {
      const tradies = await profiles.people(agencyId, 'tradie');
      const quoteCounts = await modules.quotes.quoteCounts(tradies.map((t) => t.id));
      const directory = await Promise.all(
        tradies.map(async (t) => ({
          tradieId: t.id,
          name: t.name,
          businessName: t.businessName,
          trades: t.trades,
          myEst8Rating: await profiles.myEst8Rating(t.id),
          googleRating: t.googlePlaceId ? { rating: t.googleRating, reviewCount: t.googleReviewCount } : null,
          quotes: quoteCounts.get(t.id) ?? 0,
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
      /**
       * What a Job needs from dispatch, if anything: Tradies to quote while it has fewer
       * than two Quote Requests (`candidates`, the Tradies of its Trade not asked yet,
       * ranked as the Ticket ranks them), or its Work Order once a Quote is approved
       * (`booking`: the chosen Tradie, the price and their next free slots).
       */
      async function dispatchJob(job: Job) {
        const base = { jobId: job.id, trade: job.trade, status: job.status };
        if (job.status === 'quoting') {
          const [rule, ranked] = await Promise.all([modules.quotes.quoteRequestRule(agencyId, job.id), modules.quotes.recommend(agencyId, job.id)]);
          const candidates = ranked
            .filter((r) => !r.requested)
            .map(({ tradieId, businessName, nominated, myEst8Rating, googleRating }) => ({ tradieId, businessName, nominated, myEst8Rating, googleRating }));
          const needs = rule.asked < MIN_QUOTE_REQUESTS && candidates.length > 0 ? ('tradies' as const) : null;
          return { ...base, needs, asked: rule.asked, minimum: rule.minimum, singleReason: rule.singleReason, candidates, booking: null };
        }
        if (job.status === 'approved') {
          const quote = (await modules.quotes.approvedQuote(job.id))!;
          const tradie = await profiles.person(quote.tradieId);
          const freeSlots = (await modules.scheduling.freeSlots(agencyId, tradie.id)).slice(0, 3);
          return {
            ...base,
            needs: 'booking' as const,
            asked: 0,
            minimum: 0,
            singleReason: null,
            candidates: [],
            booking: { tradieId: tradie.id, businessName: tradie.businessName ?? tradie.name, priceCents: quote.notToExceedCents ?? quote.priceCents, proposedTime: quote.proposedTime ?? quote.availableTimes?.[0] ?? null, freeSlots },
          };
        }
        return { ...base, needs: null, asked: 0, minimum: 0, singleReason: null, candidates: [], booking: null };
      }

      const openTickets = await tickets.openTickets(agencyId, null);
      const [issues, jobs] = await Promise.all([
        tickets.issuesWithUnread(openTickets.map((t) => t.issueId)),
        tickets.jobsOfTickets(openTickets.map((t) => t.id)),
      ]);
      const open = await Promise.all(
        openTickets.map(async (ticket) => ({
          ticketId: ticket.id,
          propertyId: ticket.propertyId,
          description: issues.get(ticket.issueId)!.description,
          urgency: ticket.urgency,
          reportedAt: ticket.reportedAt,
          jobs: await Promise.all(jobs.filter((j) => j.ticketId === ticket.id && j.status !== 'cancelled' && j.status !== 'done').map(dispatchJob)),
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
            photoUrl: propertyPhotoUrl(property.id, property.photoFileId),
            openTickets: openTickets.map(({ ticketId, description, urgency, reportedAt, jobs }) => ({ ticketId, description, urgency, reportedAt, jobs })),
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
        /** When they were removed from the Agency, or null. A removed Tradie's profile still opens. */
        removedAt: tradie.removedAt,
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
                propertyId: ticket.propertyId,
                propertyAddress: (await profiles.property(ticket.propertyId)).address,
                description: (await tickets.issue(ticket.issueId)).description,
                outcome,
              };
            }),
        ),
        read: await tradieProfileRead(ctx.db, tradie.id),
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
        read: await tenantProfileRead(ctx, agencyId, tenant.id),
      };
    },

    /**
     * A Property Owner or Building Manager's profile: how to reach them, the Properties
     * they own or look after, and (for an Owner) their approvals, newest first. Refuses
     * (not_found) anyone who isn't that role in the Agency. A removed person still opens.
     */
    async contactProfile(agencyId: number, personId: number, role: 'owner' | 'building_manager') {
      const person = await profiles.personInAgency(agencyId, personId, role);
      const properties = (await profiles.properties(agencyId)).filter((p) => (role === 'owner' ? p.ownerId === personId : p.buildingManagerId === personId));
      const approvals = role === 'owner' ? await modules.quotes.approvalsFor(personId) : [];
      return {
        personId: person.id,
        name: person.name,
        mobile: person.mobile,
        email: person.email,
        removedAt: person.removedAt,
        properties: properties.map((p) => ({ propertyId: p.id, address: p.address })),
        approvals,
        read:
          role === 'owner'
            ? ownerRead(approvals.map((approval) => ({ status: approval.status, requestedAt: approval.requestedAt, answeredAt: approval.answeredAt })))
            : buildingManagerRead({ commonAreaIssues: await commonAreaIssues(ctx.db, agencyId, personId) }),
      };
    },

    /**
     * The Profiles page. One household per Property: its address, open Tickets and worst
     * Urgency, its Property Owner and how many approvals are waiting, its Building Manager
     * and its current Tenants. Tradies sit apart, grouped by their first Trade. People with
     * no Property are listed on their own. Mine keeps the Properties of this Property Manager;
     * Tradies, and people linked to none, are the Agency's. A Tenant's concern is set only
     * when judgments already stored support one: this never calls Jev.
     */
    async profilesOverview(agencyId: number, propertyManagerId: number, filter: 'mine' | 'all') {
      const since = new Date(clock.now().getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const [properties, tenants, owners, buildingManagers, tradies, openTickets, ratings, jobs, waiting, issues, former] = await Promise.all([
        profiles.properties(agencyId),
        profiles.people(agencyId, 'tenant'),
        profiles.people(agencyId, 'owner'),
        profiles.people(agencyId, 'building_manager'),
        profiles.people(agencyId, 'tradie'),
        tickets.openTickets(agencyId, null),
        all<{ tradie_id: number; score: number }>(
          ctx.db,
          'SELECT r.tradie_id, r.score FROM ratings r JOIN people p ON p.id = r.tradie_id WHERE p.agency_id = ?',
          agencyId,
        ),
        all<{ tradie_id: number; open: number }>(
          ctx.db,
          `SELECT q.tradie_id, count(DISTINCT j.id) FILTER (WHERE j.status NOT IN ('done', 'cancelled')) AS open
           FROM quotes q JOIN jobs j ON j.id = q.job_id
           WHERE q.agency_id = ? AND q.status = 'approved' GROUP BY q.tradie_id`,
          agencyId,
        ),
        all<{ owner_id: number; n: number }>(
          ctx.db,
          `SELECT owner_id, count(*) AS n FROM approvals WHERE agency_id = ? AND status IN ('requested', 'reminded') GROUP BY owner_id`,
          agencyId,
        ),
        all<{
          id: number;
          tenant_id: number;
          property_id: number;
          trade: string;
          summary: string | null;
          description: string;
          urgency: string;
          status: string;
          minor: number | null;
          tenant_caused: number | null;
        }>(
          ctx.db,
          `SELECT i.id, i.tenant_id, i.property_id, i.trade, i.summary, i.description, i.urgency, i.status, j.minor, j.tenant_caused
           FROM issues i LEFT JOIN issue_judgments j ON j.issue_id = i.id
           WHERE i.agency_id = ? AND i.reported_at >= ? AND i.status IN ('maintenance_request', 'confirmed', 'rejected', 'urgent')`,
          agencyId,
          since,
        ),
        all<{ id: number; name: string }>(
          ctx.db,
          `SELECT id, name FROM people WHERE agency_id = ? AND role = 'tenant' AND property_id IS NULL AND removed_at IS NULL ORDER BY name, id`,
          agencyId,
        ),
      ]);

      const shown = filter === 'mine' ? properties.filter((property) => property.propertyManagerId === propertyManagerId) : properties;
      const ticketsByProperty = new Map<number, typeof openTickets>();
      const openByTenant = new Map<number, number>();
      for (const ticket of openTickets) {
        const list = ticketsByProperty.get(ticket.propertyId) ?? [];
        list.push(ticket);
        ticketsByProperty.set(ticket.propertyId, list);
        openByTenant.set(ticket.tenantId, (openByTenant.get(ticket.tenantId) ?? 0) + 1);
      }
      const history = new Map<number, { requests: TenantRequest[]; judgments: Map<number, RequestJudgment> }>();
      for (const row of issues) {
        const bucket = history.get(row.tenant_id) ?? { requests: [], judgments: new Map<number, RequestJudgment>() };
        bucket.requests.push({
          issueId: row.id,
          propertyId: row.property_id,
          trade: row.trade,
          summary: row.summary,
          description: row.description,
          urgency: row.urgency,
          status: row.status,
        });
        if (row.minor !== null && row.tenant_caused !== null) bucket.judgments.set(row.id, { minor: Number(row.minor), tenantCaused: Number(row.tenant_caused) });
        history.set(row.tenant_id, bucket);
      }
      const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
      const managerById = new Map(buildingManagers.map((manager) => [manager.id, manager]));
      const waitingByOwner = new Map(waiting.map((row) => [row.owner_id, Number(row.n)]));
      const urgencyRank = (urgency: Urgency | null) => (urgency === null ? URGENCIES.length : URGENCIES.indexOf(urgency));
      const shownIds = new Set(shown.map((property) => property.id));
      const openIssues = await tickets.issuesWithUnread(openTickets.filter((ticket) => shownIds.has(ticket.propertyId)).map((ticket) => ticket.issueId));

      const households = shown
        .map((property) => {
          const propertyTickets = ticketsByProperty.get(property.id) ?? [];
          const manager = property.buildingManagerId ? managerById.get(property.buildingManagerId) : undefined;
          return {
            propertyId: property.id,
            address: property.address,
            suburb: property.suburb,
            /** The Property's photo, or null. `v` is the file id, so a replaced photo is a new address. */
            photoUrl: propertyPhotoUrl(property.id, property.photoFileId),
            openTickets: propertyTickets.length,
            worstUrgency: URGENCIES.find((urgency) => propertyTickets.some((ticket) => ticket.urgency === urgency)) ?? null,
            // What the open Tickets are about, High first, so the household shows what is wrong there.
            tickets: propertyTickets.map((ticket) => {
              const issue = openIssues.get(ticket.issueId);
              return { id: ticket.id, title: issue ? (issue.summary ?? issue.description) : `Ticket #${ticket.id}`, urgency: ticket.urgency, reportedAt: ticket.reportedAt };
            }),
            owner: {
              id: property.ownerId,
              name: ownerById.get(property.ownerId)?.name ?? '',
              approvalsWaiting: waitingByOwner.get(property.ownerId) ?? 0,
            },
            buildingManager: manager ? { id: manager.id, name: manager.name } : null,
            tenants: tenants
              .filter((tenant) => tenant.propertyId === property.id)
              .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
              .map((tenant) => {
                const bucket = history.get(tenant.id);
                return {
                  id: tenant.id,
                  name: tenant.name,
                  openTickets: openByTenant.get(tenant.id) ?? 0,
                  concern: bucket ? tenantHasConcern(bucket.requests, bucket.judgments) : false,
                };
              }),
          };
        })
        .sort((a, b) => urgencyRank(a.worstUrgency) - urgencyRank(b.worstUrgency) || a.address.localeCompare(b.address) || a.propertyId - b.propertyId);

      const scores = new Map<number, number[]>();
      for (const rating of ratings) {
        const list = scores.get(rating.tradie_id) ?? [];
        list.push(rating.score);
        scores.set(rating.tradie_id, list);
      }
      const openByTradie = new Map(jobs.map((row) => [row.tradie_id, Number(row.open)]));
      const byTrade = new Map<Trade, { id: number; name: string; businessName: string; trades: Trade[]; myEst8Rating: { average: number; count: number }; googleRating: { rating: number | null; reviewCount: number | null } | null; openJobs: number; onMap: boolean }[]>();
      for (const tradie of tradies) {
        const trade = tradie.trades[0];
        if (!trade) continue;
        const given = scores.get(tradie.id) ?? [];
        const allScores = [tradie.startingRating ?? 0, ...given];
        const row = {
          id: tradie.id,
          name: tradie.name,
          businessName: tradie.businessName ?? tradie.name,
          trades: tradie.trades,
          myEst8Rating: { average: allScores.reduce((sum, score) => sum + score, 0) / allScores.length, count: allScores.length },
          googleRating: tradie.googlePlaceId ? { rating: tradie.googleRating, reviewCount: tradie.googleReviewCount } : null,
          openJobs: openByTradie.get(tradie.id) ?? 0,
          onMap: tradie.location !== null,
        };
        byTrade.set(trade, [...(byTrade.get(trade) ?? []), row]);
      }
      const tradieGroups = TRADES.filter((trade) => byTrade.has(trade)).map((trade) => ({
        trade,
        tradies: byTrade.get(trade)!.sort((a, b) => a.businessName.localeCompare(b.businessName) || a.id - b.id),
      }));

      const linkedOwners = new Set(properties.map((property) => property.ownerId));
      const linkedManagers = new Set(properties.flatMap((property) => (property.buildingManagerId === null ? [] : [property.buildingManagerId])));
      const byName = (a: { name: string; id: number }, b: { name: string; id: number }) => a.name.localeCompare(b.name) || a.id - b.id;
      const unlinked = {
        tenants: former.map((tenant) => ({ id: tenant.id, name: tenant.name })),
        owners: owners.filter((owner) => !linkedOwners.has(owner.id)).map((owner) => ({ id: owner.id, name: owner.name })).sort(byName),
        buildingManagers: buildingManagers
          .filter((manager) => !linkedManagers.has(manager.id))
          .map((manager) => ({ id: manager.id, name: manager.name }))
          .sort(byName),
      };
      const ownerIds = new Set([...households.map((household) => household.owner.id), ...unlinked.owners.map((owner) => owner.id)]);
      const managerIds = new Set([
        ...households.flatMap((household) => (household.buildingManager ? [household.buildingManager.id] : [])),
        ...unlinked.buildingManagers.map((manager) => manager.id),
      ]);
      return {
        households,
        tradies: tradieGroups,
        unlinked,
        counts: {
          properties: households.length,
          tenants: households.reduce((sum, household) => sum + household.tenants.length, 0) + unlinked.tenants.length,
          owners: ownerIds.size,
          buildingManagers: managerIds.size,
          tradies: tradies.length,
        },
      };
    },

    async ticket(agencyId: number, ticketId: number) {
      const ticket = await tickets.ticketInAgency(agencyId, ticketId);
      const issue = await tickets.issue(ticket.issueId);
      const property = await profiles.property(ticket.propertyId);
      const owner = await profiles.person(property.ownerId);
      const buildingManager = property.buildingManagerId ? await profiles.person(property.buildingManagerId) : null;
      return {
        ...(await ticketSummaries([ticket]))[0]!,
        ...(await issueDetails(issue)),
        status: ticket.status,
        summary: issue.summary,
        summaryBy: issue.summaryBy,
        propertyId: property.id,
        maxRepairCostCents: property.maxRepairCostCents,
        owner: { personId: owner.id, name: owner.name, mobile: owner.mobile, email: owner.email },
        buildingManager: buildingManager ? { personId: buildingManager.id, name: buildingManager.name } : null,
        frequentIssues: await profiles.frequentIssues(property.id),
        repairCostCents: await modules.quotes.repairCost(ticket.id),
        jobs: await Promise.all(
          (await tickets.jobsOf(ticket.id)).map(async (job) => {
            const quotesView = await modules.quotes.jobView(agencyId, job.id);
            const quoting = job.status === 'quoting';
            const counts = (await modules.quotes.quotingOf([job.id])).get(job.id) ?? NO_QUOTING;
            return {
              jobId: job.id,
              trade: job.trade,
              checkTrade: job.checkTrade,
              status: job.status,
              ...quotesView,
              /** Every Quote, Estimates and Firm Quotes alike, with its Tradie's ratings. */
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
              /** The Job's Quote counts, as the board reads them. */
              quoting: counts,
              /** What the Property Manager decides next while the Job is getting Quotes; null otherwise. */
              decision: quoting ? quotingDecision(counts) : null,
              workOrder: await modules.scheduling.workOrderForJob(job.id),
              /** Times the Tradie has offered that the Tenant has not picked yet. */
              offeredVisit: await modules.scheduling.offeredVisit(job.id),
              /** Site Inspections (not cancelled), and free slots to prefill booking the ones Tradies need. */
              inspections: {
                visits: await modules.scheduling.inspectionVisits(job.id),
                slots: quoting && counts.toInspect ? await modules.scheduling.inspectionSlots(agencyId, job.id) : [],
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
