import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { ActionError, addMs, HOUR_MS, invalid, iso, notFound, withoutContactDetails, type Availability } from './shared.ts';
import type { OpenItem } from './tickets.ts';
import { formatVisit, wallClock, zonedInstant } from './zoned-time.ts';

const DEFAULT_SLOT_MINUTES = 120;
const SUGGESTION_COUNT = 3;
const SUGGESTION_DAYS = 14;
const MINUTE_MS = 60_000;

type Window = { weekdays: number[]; fromHour: number; toHour: number };
const WEEKDAYS = [1, 2, 3, 4, 5];

/** When a Tenant is usually home, in the Agency's local time. */
const AVAILABILITY_WINDOWS: Record<Availability, Window[]> = {
  weekday_mornings: [{ weekdays: WEEKDAYS, fromHour: 8, toHour: 12 }],
  weekday_afternoons: [{ weekdays: WEEKDAYS, fromHour: 12, toHour: 17 }],
  saturdays: [{ weekdays: [6], fromHour: 8, toHour: 17 }],
  any_time: [
    { weekdays: WEEKDAYS, fromHour: 8, toHour: 17 },
    { weekdays: [6], fromHour: 8, toHour: 17 },
  ],
};

type WorkOrderRow = {
  id: number;
  agency_id: number;
  job_id: number;
  ticket_id: number;
  tradie_id: number;
  start: string;
  end: string;
  status: 'active' | 'done' | 'cancelled';
  visit_confirmed: number;
  reschedule_requested_by: 'tenant' | 'tradie' | null;
};

/** The shared calendar, Work Orders, reschedule suggestions and Job completion. */
export function createScheduling({ db, clock, modules }: Context) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY,
      agency_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      tradie_id INTEGER NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      status TEXT NOT NULL,
      visit_confirmed INTEGER NOT NULL DEFAULT 0,
      reschedule_requested_by TEXT
    );
    CREATE INDEX IF NOT EXISTS work_orders_by_tradie ON work_orders (agency_id, tradie_id, start);
  `);

  const { profiles, tickets, notifications } = modules;

  function workOrderRow(id: number) {
    return one<WorkOrderRow>(db, 'SELECT * FROM work_orders WHERE id = ?', id);
  }

  function activeWorkOrder(agencyId: number, id: number) {
    const row = one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE id = ? AND agency_id = ? AND status = 'active'`, id, agencyId);
    if (!row) notFound('Work Order');
    return row;
  }

  /** A Tradie is free when none of their Work Orders in the Agency overlap the slot. */
  function isFree(agencyId: number, tradieId: number, start: Date, end: Date, ignoreWorkOrderId = 0) {
    return !one(
      db,
      `SELECT 1 FROM work_orders WHERE agency_id = ? AND tradie_id = ? AND status != 'cancelled' AND id != ?
       AND start < ? AND end > ?`,
      agencyId,
      tradieId,
      ignoreWorkOrderId,
      iso(end),
      iso(start),
    );
  }

  /** Free slots that start on the hour and fit inside one of the windows. */
  function findSlots(input: {
    agencyId: number;
    tradieId: number;
    durationMs: number;
    windows: Window[];
    from: Date;
    days: number;
    limit: number;
    ignoreWorkOrderId?: number;
    skipStart?: string;
  }) {
    const { timeZone } = profiles.agency(input.agencyId);
    const now = wallClock(input.from, timeZone);
    let start = zonedInstant(timeZone, now.year, now.month, now.day, now.hour + 1);
    const until = addMs(input.from, input.days * 24 * HOUR_MS);
    const slots: { start: string; end: string }[] = [];
    for (; start < until && slots.length < input.limit; start = addMs(start, HOUR_MS)) {
      const end = addMs(start, input.durationMs);
      if (iso(start) === input.skipStart) continue;
      if (!fitsWindow(start, end, input.windows, timeZone)) continue;
      if (!isFree(input.agencyId, input.tradieId, start, end, input.ignoreWorkOrderId)) continue;
      slots.push({ start: iso(start), end: iso(end) });
    }
    return slots;
  }

  function fitsWindow(start: Date, end: Date, windows: Window[], timeZone: string) {
    const s = wallClock(start, timeZone);
    const e = wallClock(end, timeZone);
    if (s.day !== e.day) return false;
    return windows.some(
      (w) => w.weekdays.includes(s.weekday) && s.hour >= w.fromHour && e.hour * 60 + e.minute <= w.toHour * 60,
    );
  }

  function place(row: WorkOrderRow) {
    const job = tickets.job(row.job_id);
    const ticket = tickets.ticket(row.ticket_id);
    const property = profiles.property(ticket.propertyId);
    const tradie = profiles.person(row.tradie_id);
    return { job, ticket, property, tradieBusinessName: tradie.businessName ?? tradie.name };
  }

  function toView(row: WorkOrderRow) {
    const { property, tradieBusinessName } = place(row);
    return {
      workOrderId: row.id,
      jobId: row.job_id,
      ticketId: row.ticket_id,
      tradieId: row.tradie_id,
      businessName: tradieBusinessName,
      start: row.start,
      end: row.end,
      status: row.status,
      visitConfirmed: !!row.visit_confirmed,
      rescheduleRequestedBy: row.reschedule_requested_by,
      propertyAddress: property.address,
      propertyManager: profiles.propertyManager(property.propertyManagerId).name,
    };
  }

  async function tellTenantVisitTime(row: WorkOrderRow, moved: boolean) {
    const { job, ticket, tradieBusinessName } = place(row);
    if (moved) {
      await notifications.send(ticket.tenantId, 'tenant.visit_moved', { visitStart: row.start, tradieBusinessName }, { issueId: ticket.issueId });
    } else {
      await notifications.send(
        ticket.tenantId,
        'tenant.visit_time',
        { visitStart: row.start, trade: job.trade, tradieBusinessName },
        { issueId: ticket.issueId },
      );
    }
    modules.intake.expectAnswer(ticket.tenantId, { kind: 'visit', workOrderId: row.id });
  }

  return {
    isFree,

    /** A Tradie's free slots over the coming days, on the hour, inside working hours. */
    freeSlots(agencyId: number, tradieId: number, options: { days?: number; durationMinutes?: number } = {}) {
      profiles.personInAgency(agencyId, tradieId, 'tradie');
      return findSlots({
        agencyId,
        tradieId,
        durationMs: (options.durationMinutes ?? DEFAULT_SLOT_MINUTES) * MINUTE_MS,
        windows: AVAILABILITY_WINDOWS.any_time,
        from: clock.now(),
        days: options.days ?? 7,
        limit: Infinity,
      });
    },

    /** Books the Job's chosen Tradie, at the Quote's proposed time unless the Property Manager picks one. */
    async sendWorkOrder(agencyId: number, jobId: number, options: { start?: string; durationMinutes?: number } = {}) {
      const job = tickets.jobInAgency(agencyId, jobId);
      if (job.status !== 'approved') invalid('Send a Work Order once the Job has an approved Quote');
      const quote = modules.quotes.approvedQuote(jobId)!;
      const durationMinutes = options.durationMinutes ?? DEFAULT_SLOT_MINUTES;
      if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 24 * 60) {
        invalid('The slot must be between 1 minute and 24 hours long');
      }
      const startAt = options.start ?? quote.proposedTime;
      if (!startAt) invalid('The Quote has no proposed time. Pick a start time.');
      const start = new Date(startAt);
      if (Number.isNaN(start.getTime())) invalid(`${startAt} is not a time`);
      if (start < clock.now()) invalid('Pick a start time in the future');
      const end = addMs(start, durationMinutes * MINUTE_MS);
      const ticket = tickets.ticket(job.ticketId);
      const tradie = profiles.person(quote.tradieId);
      const name = tradie.businessName ?? tradie.name;

      const id = transaction(db, () => {
        if (!isFree(agencyId, tradie.id, start, end)) {
          throw new ActionError(
            'conflict',
            options.start ? `${name} is already booked then` : `${name} is booked at the proposed time. Pick another start time.`,
          );
        }
        const id = run(
          db,
          `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, end, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
          agencyId,
          jobId,
          ticket.id,
          tradie.id,
          iso(start),
          iso(end),
        );
        tickets.setJobStatus(jobId, 'scheduled');
        tickets.recordEvent(ticket.id, 'work_order_sent', { jobId, tradie: name, visitStart: iso(start), visitEnd: iso(end) });
        return id;
      });

      const row = workOrderRow(id)!;
      const { property } = place(row);
      const issue = tickets.issue(ticket.issueId);
      await notifications.send(
        tradie.id,
        'tradie.work_order',
        { propertyAddress: property.address, description: withoutContactDetails(issue.description), trade: job.trade, visitStart: row.start, visitEnd: row.end },
        { issueId: issue.id },
      );
      await tellTenantVisitTime(row, false);
      await notifications.send(
        property.ownerId,
        'owner.work_booked',
        { propertyAddress: property.address, trade: job.trade, visitStart: row.start },
        { issueId: issue.id },
      );
    },

    async recordRescheduleRequest(workOrderId: number, by: 'tenant' | 'tradie') {
      const row = workOrderRow(workOrderId);
      if (row?.status !== 'active') return;
      run(db, 'UPDATE work_orders SET reschedule_requested_by = ?, visit_confirmed = 0 WHERE id = ?', by, workOrderId);
      tickets.recordEvent(row.ticket_id, 'reschedule_requested', { jobId: row.job_id, by });
    },

    async recordVisitConfirmation(workOrderId: number) {
      const row = workOrderRow(workOrderId);
      if (row?.status !== 'active') return;
      run(db, 'UPDATE work_orders SET visit_confirmed = 1 WHERE id = ?', workOrderId);
      tickets.recordEvent(row.ticket_id, 'visit_confirmed', { jobId: row.job_id });
    },

    /** Up to three slots in the next 14 days, as long as the current one, free for the Tradie and inside the Tenant's availability. */
    suggestTimes(agencyId: number, workOrderId: number) {
      const row = activeWorkOrder(agencyId, workOrderId);
      const tenant = profiles.person(tickets.ticket(row.ticket_id).tenantId);
      return findSlots({
        agencyId,
        tradieId: row.tradie_id,
        durationMs: Date.parse(row.end) - Date.parse(row.start),
        windows: AVAILABILITY_WINDOWS[tenant.availability ?? 'any_time'],
        from: clock.now(),
        days: SUGGESTION_DAYS,
        limit: SUGGESTION_COUNT,
        ignoreWorkOrderId: row.id,
        skipStart: row.start,
      });
    },

    /** Moves a visit to a suggested time or any other free slot, and tells the Tradie and the Tenant. */
    async acceptTime(agencyId: number, workOrderId: number, startAt: string) {
      const row = activeWorkOrder(agencyId, workOrderId);
      const start = new Date(startAt);
      if (Number.isNaN(start.getTime())) invalid(`${startAt} is not a time`);
      if (start < clock.now()) invalid('Pick a start time in the future');
      const end = addMs(start, Date.parse(row.end) - Date.parse(row.start));
      const { property, tradieBusinessName, ticket } = place(row);
      transaction(db, () => {
        if (!isFree(agencyId, row.tradie_id, start, end, row.id)) throw new ActionError('conflict', `${tradieBusinessName} is already booked then`);
        run(
          db,
          'UPDATE work_orders SET start = ?, end = ?, reschedule_requested_by = NULL, visit_confirmed = 0 WHERE id = ?',
          iso(start),
          iso(end),
          row.id,
        );
        tickets.recordEvent(row.ticket_id, 'visit_moved', { jobId: row.job_id, visitStart: iso(start), visitEnd: iso(end) });
      });
      const moved = workOrderRow(row.id)!;
      await notifications.send(
        row.tradie_id,
        'tradie.visit_moved',
        { propertyAddress: property.address, visitStart: moved.start },
        { issueId: ticket.issueId },
      );
      await tellTenantVisitTime(moved, true);
    },

    /** The Tradie replied "done": the Job is done, and the Tenant is asked if it was fixed properly. */
    async markDone(workOrderId: number) {
      const row = workOrderRow(workOrderId);
      if (row?.status !== 'active') return;
      const { job, ticket, tradieBusinessName } = place(row);
      transaction(db, () => {
        run(db, `UPDATE work_orders SET status = 'done' WHERE id = ?`, row.id);
        tickets.setJobStatus(job.id, 'done');
        tickets.recordEvent(ticket.id, 'job_done', { jobId: job.id, tradie: tradieBusinessName });
      });
      await notifications.send(ticket.tenantId, 'tenant.fixed_properly', { trade: job.trade, tradieBusinessName }, { issueId: ticket.issueId });
      modules.intake.expectAnswer(ticket.tenantId, { kind: 'fix_rating', jobId: job.id });
    },

    async recordTenantRating(jobId: number, score: number) {
      if (!Number.isInteger(score) || score < 1 || score > 5 || profiles.hasRating(jobId, 'tenant')) return;
      const row = one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND status = 'done'`, jobId);
      if (!row) return;
      profiles.recordRating(row.tradie_id, 'tenant', score, jobId);
      tickets.recordEvent(row.ticket_id, 'tenant_rated', { jobId, score });
    },

    rateTradie(agencyId: number, jobId: number, score: number) {
      const job = tickets.jobInAgency(agencyId, jobId);
      if (job.status !== 'done') invalid('Rate the Tradie once the Job is done');
      if (!Number.isInteger(score) || score < 1 || score > 5) invalid('Rate from 1 to 5');
      if (profiles.hasRating(jobId, 'property_manager')) invalid('This Job is already rated');
      const row = one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND status = 'done'`, jobId)!;
      profiles.recordRating(row.tradie_id, 'property_manager', score, jobId);
      tickets.recordEvent(job.ticketId, 'tradie_rated', { jobId, score });
    },

    /** Every booking in the Agency that overlaps the range. */
    calendar(agencyId: number, range: { from: string; to: string }) {
      return all<WorkOrderRow>(
        db,
        `SELECT * FROM work_orders WHERE agency_id = ? AND status != 'cancelled' AND start < ? AND end > ? ORDER BY start, id`,
        agencyId,
        iso(new Date(range.to)),
        iso(new Date(range.from)),
      ).map(toView);
    },

    /** A Tradie's upcoming bookings, shown next to recommendations. */
    bookings(agencyId: number, tradieId: number) {
      return all<WorkOrderRow>(
        db,
        `SELECT * FROM work_orders WHERE agency_id = ? AND tradie_id = ? AND status = 'active' AND end > ? ORDER BY start`,
        agencyId,
        tradieId,
        iso(clock.now()),
      ).map((row) => {
        const { start, end, propertyAddress, propertyManager } = toView(row);
        return { start, end, propertyAddress, propertyManager };
      });
    },

    /** Done Jobs the Property Manager hasn't rated yet. */
    alerts(agencyId: number, propertyIds: number[] | null) {
      return all<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE agency_id = ? AND status = 'done' ORDER BY start`, agencyId)
        .filter((row) => !profiles.hasRating(row.job_id, 'property_manager'))
        .map((row) => ({ row, view: toView(row), propertyId: tickets.ticket(row.ticket_id).propertyId }))
        .filter(({ propertyId }) => propertyIds === null || propertyIds.includes(propertyId))
        .map(({ row, view }) => ({
          kind: 'rating_due' as const,
          ticketId: row.ticket_id,
          jobId: row.job_id,
          propertyAddress: view.propertyAddress,
          businessName: view.businessName,
        }));
    },

    itemsWaitingOn(tradieId: number): OpenItem[] {
      return all<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE tradie_id = ? AND status = 'active' ORDER BY start`, tradieId).map((row) => {
        const { job, property } = place(row);
        const { timeZone } = profiles.agency(row.agency_id);
        return { ref: `work_order:${row.id}`, summary: `Work Order: ${job.trade} at ${property.address}, ${formatVisit(row.start, timeZone)}` };
      });
    },

    workOrder(id: number) {
      const row = workOrderRow(id);
      return row ? { id: row.id, jobId: row.job_id, ticketId: row.ticket_id } : null;
    },

    activeWorkOrderForJob(jobId: number) {
      return one<{ id: number }>(db, `SELECT id FROM work_orders WHERE job_id = ? AND status = 'active'`, jobId);
    },

    activeWorkOrdersForTicket(ticketId: number) {
      return all<{ id: number }>(db, `SELECT id FROM work_orders WHERE ticket_id = ? AND status = 'active' ORDER BY id`, ticketId);
    },

    /** The Job's current Work Order, for the Ticket view. */
    workOrderForJob(jobId: number) {
      const row = one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 1`, jobId);
      return row ? toView(row) : null;
    },

    /** A cancelled Job frees the Tradie's slot. */
    jobCancelled(jobId: number) {
      run(db, `UPDATE work_orders SET status = 'cancelled' WHERE job_id = ? AND status = 'active'`, jobId);
    },
  };
}

export type Scheduling = ReturnType<typeof createScheduling>;
