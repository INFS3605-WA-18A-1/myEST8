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

/**
 * How a booked visit stands: done, waiting on new times, or booked and either
 * confirmed by the Tenant or not yet. A cancelled Work Order is never a booking.
 */
export type VisitStatus = 'done' | 'reschedule_requested' | 'not_confirmed' | 'confirmed';

function visitOf(row: WorkOrderRow): VisitStatus {
  if (row.status === 'done') return 'done';
  if (row.reschedule_requested_by) return 'reschedule_requested';
  return row.visit_confirmed ? 'confirmed' : 'not_confirmed';
}

/** The shared calendar, Work Orders, reschedule suggestions and Job completion. */
export function createScheduling({ db, clock, modules }: Context) {

  const { profiles, tickets, notifications } = modules;

  async function workOrderRow(id: number) {
    return await one<WorkOrderRow>(db, 'SELECT * FROM work_orders WHERE id = ?', id);
  }

  async function activeWorkOrder(agencyId: number, id: number) {
    const row = await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE id = ? AND agency_id = ? AND status = 'active'`, id, agencyId);
    if (!row) notFound('Work Order');
    return row;
  }

  /** A Tradie is free when none of their Work Orders in the Agency overlap the slot. */
  async function isFree(agencyId: number, tradieId: number, start: Date, end: Date, ignoreWorkOrderId = 0) {
    return !(await one(
      db,
      `SELECT 1 FROM work_orders WHERE agency_id = ? AND tradie_id = ? AND status != 'cancelled' AND id != ?
       AND start < ? AND "end" > ?`,
      agencyId,
      tradieId,
      ignoreWorkOrderId,
      iso(end),
      iso(start),
    ));
  }

  /** Free slots that start on the hour and fit inside one of the windows. */
  async function findSlots(input: {
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
    const { timeZone } = await profiles.agency(input.agencyId);
    const now = wallClock(input.from, timeZone);
    let start = zonedInstant(timeZone, now.year, now.month, now.day, now.hour + 1);
    const until = addMs(input.from, input.days * 24 * HOUR_MS);
    // The Tradie's bookings over the whole span, read once; each slot is checked against them as isFree would.
    const booked = await all<{ start: string; end: string }>(
      db,
      `SELECT start, "end" FROM work_orders WHERE agency_id = ? AND tradie_id = ? AND status != 'cancelled' AND id != ?
       AND start < ? AND "end" > ?`,
      input.agencyId,
      input.tradieId,
      input.ignoreWorkOrderId ?? 0,
      iso(addMs(until, input.durationMs)),
      iso(start),
    );
    const free = (from: string, to: string) => !booked.some((b) => b.start < to && b.end > from);
    const slots: { start: string; end: string }[] = [];
    for (; start < until && slots.length < input.limit; start = addMs(start, HOUR_MS)) {
      const end = addMs(start, input.durationMs);
      if (iso(start) === input.skipStart) continue;
      if (!fitsWindow(start, end, input.windows, timeZone)) continue;
      if (!free(iso(start), iso(end))) continue;
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

  async function place(row: WorkOrderRow) {
    const job = await tickets.job(row.job_id);
    const ticket = await tickets.ticket(row.ticket_id);
    const property = await profiles.property(ticket.propertyId);
    const tradie = await profiles.person(row.tradie_id);
    return { job, ticket, property, tradieBusinessName: tradie.businessName ?? tradie.name };
  }

  /**
   * A booking as the calendar, Dispatch and the dashboard show it: what the visit is
   * for (the Ticket's issue and the Job's Trade), who, where, when, and `visit`, the
   * one word on how the visit stands, so no page works it out again.
   */
  async function toView(row: WorkOrderRow) {
    const { job, ticket, property, tradieBusinessName } = await place(row);
    return {
      workOrderId: row.id,
      jobId: row.job_id,
      ticketId: row.ticket_id,
      tradieId: row.tradie_id,
      businessName: tradieBusinessName,
      trade: job.trade,
      issue: (await tickets.issue(ticket.issueId)).description,
      start: row.start,
      end: row.end,
      status: row.status,
      visit: visitOf(row),
      visitConfirmed: !!row.visit_confirmed,
      rescheduleRequestedBy: row.reschedule_requested_by,
      propertyId: property.id,
      propertyAddress: property.address,
      suburb: property.suburb,
      propertyManagerId: property.propertyManagerId,
      propertyManager: (await profiles.propertyManager(property.propertyManagerId)).name,
    };
  }

  async function tellTenantVisitTime(row: WorkOrderRow, moved: boolean) {
    const { job, ticket, tradieBusinessName } = await place(row);
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
    await modules.intake.expectAnswer(ticket.tenantId, { kind: 'visit', workOrderId: row.id });
  }

  return {
    isFree,

    /** A Tradie's free slots over the coming days, on the hour, inside working hours. */
    async freeSlots(agencyId: number, tradieId: number, options: { days?: number; durationMinutes?: number } = {}) {
      await profiles.personInAgency(agencyId, tradieId, 'tradie');
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
      const job = await tickets.jobInAgency(agencyId, jobId);
      if (job.status !== 'approved') invalid('Send a Work Order once the Job has an approved Quote');
      const quote = (await modules.quotes.approvedQuote(jobId))!;
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
      const ticket = await tickets.ticket(job.ticketId);
      const tradie = await profiles.person(quote.tradieId);
      const name = tradie.businessName ?? tradie.name;

      const id = await transaction(db, async () => {
        // Checked again inside: a Work Order sent for this Job a moment ago has moved it on.
        if ((await tickets.job(jobId)).status !== 'approved') invalid('Send a Work Order once the Job has an approved Quote');
        if (!(await isFree(agencyId, tradie.id, start, end))) {
          throw new ActionError(
            'conflict',
            options.start ? `${name} is already booked then` : `${name} is booked at the proposed time. Pick another start time.`,
          );
        }
        const id = await run(
          db,
          `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, "end", status) VALUES (?, ?, ?, ?, ?, ?, 'active') RETURNING id`,
          agencyId,
          jobId,
          ticket.id,
          tradie.id,
          iso(start),
          iso(end),
        );
        await tickets.setJobStatus(jobId, 'scheduled');
        await tickets.recordEvent(ticket.id, 'work_order_sent', { jobId, tradie: name, visitStart: iso(start), visitEnd: iso(end) });
        return id;
      });

      const row = (await workOrderRow(id))!;
      const { property } = await place(row);
      const issue = await tickets.issue(ticket.issueId);
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
      return transaction(db, async () => {
        const row = await workOrderRow(workOrderId);
        if (row?.status !== 'active') return;
        await run(db, 'UPDATE work_orders SET reschedule_requested_by = ?, visit_confirmed = 0 WHERE id = ?', by, workOrderId);
        await tickets.recordEvent(row.ticket_id, 'reschedule_requested', { jobId: row.job_id, by });
      });
    },

    async recordVisitConfirmation(workOrderId: number) {
      return transaction(db, async () => {
        const row = await workOrderRow(workOrderId);
        if (row?.status !== 'active') return;
        await run(db, 'UPDATE work_orders SET visit_confirmed = 1 WHERE id = ?', workOrderId);
        await tickets.recordEvent(row.ticket_id, 'visit_confirmed', { jobId: row.job_id });
      });
    },

    /** Up to three slots in the next 14 days, as long as the current one, free for the Tradie and inside the Tenant's availability. */
    async suggestTimes(agencyId: number, workOrderId: number) {
      const row = await activeWorkOrder(agencyId, workOrderId);
      const tenant = await profiles.person((await tickets.ticket(row.ticket_id)).tenantId);
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
      const row = await activeWorkOrder(agencyId, workOrderId);
      const start = new Date(startAt);
      if (Number.isNaN(start.getTime())) invalid(`${startAt} is not a time`);
      if (start < clock.now()) invalid('Pick a start time in the future');
      const end = addMs(start, Date.parse(row.end) - Date.parse(row.start));
      const { property, tradieBusinessName, ticket } = await place(row);
      await transaction(db, async () => {
        await activeWorkOrder(agencyId, workOrderId);
        if (!(await isFree(agencyId, row.tradie_id, start, end, row.id))) throw new ActionError('conflict', `${tradieBusinessName} is already booked then`);
        await run(
          db,
          'UPDATE work_orders SET start = ?, "end" = ?, reschedule_requested_by = NULL, visit_confirmed = 0 WHERE id = ?',
          iso(start),
          iso(end),
          row.id,
        );
        await tickets.recordEvent(row.ticket_id, 'visit_moved', { jobId: row.job_id, visitStart: iso(start), visitEnd: iso(end) });
      });
      const moved = (await workOrderRow(row.id))!;
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
      const done = await transaction(db, async () => {
        const row = await workOrderRow(workOrderId);
        if (row?.status !== 'active') return null;
        const { job, ticket, tradieBusinessName } = await place(row);
        await run(db, `UPDATE work_orders SET status = 'done' WHERE id = ?`, row.id);
        await tickets.setJobStatus(job.id, 'done');
        await tickets.recordEvent(ticket.id, 'job_done', { jobId: job.id, tradie: tradieBusinessName });
        return { job, ticket, tradieBusinessName };
      });
      if (!done) return;
      const { job, ticket, tradieBusinessName } = done;
      await notifications.send(ticket.tenantId, 'tenant.fixed_properly', { trade: job.trade, tradieBusinessName }, { issueId: ticket.issueId });
      await modules.intake.expectAnswer(ticket.tenantId, { kind: 'fix_rating', jobId: job.id });
    },

    async recordTenantRating(jobId: number, score: number) {
      return transaction(db, async () => {
        if (!Number.isInteger(score) || score < 1 || score > 5 || (await profiles.hasRating(jobId, 'tenant'))) return;
        const row = await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND status = 'done'`, jobId);
        if (!row) return;
        await profiles.recordRating(row.tradie_id, 'tenant', score, jobId);
        await tickets.recordEvent(row.ticket_id, 'tenant_rated', { jobId, score });
      });
    },

    async rateTradie(agencyId: number, jobId: number, score: number) {
      return transaction(db, async () => {
        const job = await tickets.jobInAgency(agencyId, jobId);
        if (job.status !== 'done') invalid('Rate the Tradie once the Job is done');
        if (!Number.isInteger(score) || score < 1 || score > 5) invalid('Rate from 1 to 5');
        if (await profiles.hasRating(jobId, 'property_manager')) invalid('This Job is already rated');
        const row = (await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND status = 'done'`, jobId))!;
        await profiles.recordRating(row.tradie_id, 'property_manager', score, jobId);
        await tickets.recordEvent(job.ticketId, 'tradie_rated', { jobId, score });
      });
    },

    /** Every booking in the Agency that overlaps the range. */
    async calendar(agencyId: number, range: { from: string; to: string }) {
      return Promise.all((await all<WorkOrderRow>(
        db,
        `SELECT * FROM work_orders WHERE agency_id = ? AND status != 'cancelled' AND start < ? AND "end" > ? ORDER BY start, id`,
        agencyId,
        iso(new Date(range.to)),
        iso(new Date(range.from)),
      )).map(toView));
    },

    /** A Tradie's upcoming bookings, shown next to recommendations. */
    async bookings(agencyId: number, tradieId: number) {
      return Promise.all((await all<WorkOrderRow>(
        db,
        `SELECT * FROM work_orders WHERE agency_id = ? AND tradie_id = ? AND status = 'active' AND "end" > ? ORDER BY start, id`,
        agencyId,
        tradieId,
        iso(clock.now()),
      )).map(async (row) => {
        const { start, end, propertyAddress, propertyManager } = await toView(row);
        return { start, end, propertyAddress, propertyManager };
      }));
    },

    /** Done Jobs the Property Manager hasn't rated yet. */
    async alerts(agencyId: number, propertyIds: number[] | null) {
      const due = [];
      for (const row of await all<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE agency_id = ? AND status = 'done' ORDER BY start, id`, agencyId)) {
        if (await profiles.hasRating(row.job_id, 'property_manager')) continue;
        const { propertyId } = await tickets.ticket(row.ticket_id);
        if (propertyIds !== null && !propertyIds.includes(propertyId)) continue;
        const view = await toView(row);
        due.push({
          kind: 'rating_due' as const,
          ticketId: row.ticket_id,
          jobId: row.job_id,
          propertyAddress: view.propertyAddress,
          businessName: view.businessName,
        });
      }
      return due;
    },

    async itemsWaitingOn(tradieId: number): Promise<OpenItem[]> {
      const rows = await all<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE tradie_id = ? AND status = 'active' ORDER BY start, id`, tradieId);
      return Promise.all(
        rows.map(async (row) => {
          const { job, property } = await place(row);
          const { timeZone } = await profiles.agency(row.agency_id);
          return { ref: `work_order:${row.id}`, summary: `Work Order: ${job.trade} at ${property.address}, ${formatVisit(row.start, timeZone)}` };
        }),
      );
    },

    async workOrder(id: number) {
      const row = await workOrderRow(id);
      return row ? { id: row.id, jobId: row.job_id, ticketId: row.ticket_id } : null;
    },

    async activeWorkOrderForJob(jobId: number) {
      return await one<{ id: number }>(db, `SELECT id FROM work_orders WHERE job_id = ? AND status = 'active'`, jobId);
    },

    async activeWorkOrdersForTicket(ticketId: number) {
      return await all<{ id: number }>(db, `SELECT id FROM work_orders WHERE ticket_id = ? AND status = 'active' ORDER BY id`, ticketId);
    },

    /** The Job's current Work Order, for the Ticket view. */
    async workOrderForJob(jobId: number) {
      const row = await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 1`, jobId);
      return row ? toView(row) : null;
    },

    /** When each Job of many Tickets is booked, from its current Work Order, in one query. Jobs never booked are left out. */
    async visitsOfTickets(ticketIds: number[]) {
      if (!ticketIds.length) return new Map<number, string>();
      const rows = await all<{ job_id: number; start: string }>(
        db,
        `SELECT DISTINCT ON (job_id) job_id, start FROM work_orders
         WHERE ticket_id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value)) AND status != 'cancelled'
         ORDER BY job_id, id DESC`,
        JSON.stringify(ticketIds),
      );
      return new Map(rows.map((r) => [r.job_id, r.start]));
    },

    /** A cancelled Job frees the Tradie's slot. */
    async jobCancelled(jobId: number) {
      await run(db, `UPDATE work_orders SET status = 'cancelled' WHERE job_id = ? AND status = 'active'`, jobId);
    },
  };
}

export type Scheduling = ReturnType<typeof createScheduling>;
