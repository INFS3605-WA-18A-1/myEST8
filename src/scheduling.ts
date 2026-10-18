import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { ActionError, addMs, HOUR_MS, invalid, iso, notFound, withoutContactDetails, type Availability } from './shared.ts';
import type { OpenItem } from './tickets.ts';
import { formatVisit, wallClock, zonedInstant } from './zoned-time.ts';

const DEFAULT_SLOT_MINUTES = 120;
const SITE_QUOTE_MINUTES = 60;
const SITE_QUOTE_REMINDER_MS = 48 * HOUR_MS;
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
  kind: WorkOrderKind;
  quote_request_id: number | null;
};

/** A repair visit, or a Tradie's visit to look at the job and revise their Quote. */
export type WorkOrderKind = 'repair' | 'site_quote';

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
export function createScheduling({ db, clock, worker, modules }: Context) {

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
      kind: row.kind,
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

  async function siteQuotesOpen(jobId: number) {
    return (await one<{ n: number }>(db, `SELECT count(*) AS n FROM work_orders WHERE job_id = ? AND kind = 'site_quote' AND status = 'active'`, jobId))!.n;
  }

  /** Free one-hour slots over the next 14 days inside the Tenant's availability. */
  async function slotsFor(agencyId: number, tradieId: number, tenantId: number, limit: number) {
    const tenant = await profiles.person(tenantId);
    return findSlots({
      agencyId,
      tradieId,
      durationMs: SITE_QUOTE_MINUTES * MINUTE_MS,
      windows: AVAILABILITY_WINDOWS[tenant.availability ?? 'any_time'],
      from: clock.now(),
      days: SUGGESTION_DAYS,
      limit,
    });
  }

  /**
   * Books Site Quote visits: one per Tradie with a confirmed Quote on the Job (default an hour each).
   * The Job moves to `site_quoting`; the Tradies and the Tenant are told.
   */
  async function bookSiteQuotes(
    agencyId: number,
    jobId: number,
    visits: { tradieId: number; start: string; durationMinutes?: number }[],
  ) {
    const job = await tickets.jobInAgency(agencyId, jobId);
    if (!visits.length) invalid('Pick a time for at least one Tradie');
    if (new Set(visits.map((v) => v.tradieId)).size !== visits.length) invalid('Book each Tradie once');
    const planned: { tradie: Awaited<ReturnType<typeof profiles.personInAgency>>; name: string; start: Date; end: Date }[] = [];
    for (const v of visits) {
      const tradie = await profiles.personInAgency(agencyId, v.tradieId, 'tradie');
      const name = tradie.businessName ?? tradie.name;
      const minutes = v.durationMinutes ?? SITE_QUOTE_MINUTES;
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) invalid('The visit must be between 1 minute and 24 hours long');
      const start = new Date(v.start);
      if (Number.isNaN(start.getTime())) invalid(`${v.start} is not a time`);
      if (start < clock.now()) invalid('Pick a start time in the future');
      planned.push({ tradie, name, start, end: addMs(start, minutes * MINUTE_MS) });
    }
    const ticket = await tickets.ticket(job.ticketId);
    const ids = await transaction(db, async () => {
      // Checked again inside, so two bookings at once can't both pass.
      const current = await tickets.job(jobId);
      if (current.status !== 'quoting' && current.status !== 'site_quoting') invalid('Site Quotes can only be booked while the Job is getting Quotes');
      const out: { id: number; tradieId: number }[] = [];
      for (const p of planned) {
        const quote = await modules.quotes.confirmedQuoteFor(jobId, p.tradie.id);
        if (!quote) invalid(`${p.name} has no confirmed Quote on this Job`);
        if (await one(db, `SELECT 1 FROM work_orders WHERE job_id = ? AND tradie_id = ? AND kind = 'site_quote' AND status = 'active'`, jobId, p.tradie.id)) {
          invalid(`${p.name} already has a Site Quote visit booked`);
        }
        if (!(await isFree(agencyId, p.tradie.id, p.start, p.end))) throw new ActionError('conflict', `${p.name} is already booked then`);
        const id = await run(
          db,
          `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, "end", status, kind, quote_request_id)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 'site_quote', ?) RETURNING id`,
          agencyId,
          jobId,
          ticket.id,
          p.tradie.id,
          iso(p.start),
          iso(p.end),
          quote.quoteRequestId,
        );
        out.push({ id, tradieId: p.tradie.id });
      }
      await tickets.setJobStatus(jobId, 'site_quoting');
      await tickets.recordEvent(ticket.id, 'site_quotes_booked', {
        jobId,
        visits: planned.map((p) => ({ tradie: p.name, visitStart: iso(p.start) })),
      });
      return out;
    });

    const property = await profiles.property(ticket.propertyId);
    const issue = await tickets.issue(ticket.issueId);
    const photoFileIds = (await tickets.photos(issue.id)).map((x) => x.fileId);
    for (const p of planned) {
      const byEmail = (await notifications.channelFor(p.tradie.id)) === 'email';
      await notifications.send(
        p.tradie.id,
        'tradie.site_quote',
        {
          propertyAddress: property.address,
          trade: job.trade,
          summary: withoutContactDetails(issue.summary ?? issue.description),
          visitStart: iso(p.start),
          visitEnd: iso(p.end),
        },
        { issueId: issue.id, attachmentFileIds: byEmail ? photoFileIds : [] },
      );
    }
    await notifications.send(
      ticket.tenantId,
      'tenant.site_quotes',
      { visits: planned.map((p) => ({ tradieBusinessName: p.name, visitStart: iso(p.start) })) },
      { issueId: issue.id },
    );
    await modules.intake.expectAnswer(ticket.tenantId, { kind: 'visit', workOrderId: ids.at(-1)!.id });
  }

  /** For each Tradie with a confirmed Quote on the Job, up to three free one-hour slots to prefill the booking form. */
  async function siteQuoteSlots(agencyId: number, jobId: number) {
    const job = await tickets.jobInAgency(agencyId, jobId);
    const ticket = await tickets.ticket(job.ticketId);
    const out = [];
    for (const tradieId of await modules.quotes.confirmedQuoteTradies(jobId)) {
      const tradie = await profiles.person(tradieId);
      const booked = !!(await one(db, `SELECT 1 FROM work_orders WHERE job_id = ? AND tradie_id = ? AND kind = 'site_quote' AND status = 'active'`, jobId, tradieId));
      out.push({
        tradieId,
        businessName: tradie.businessName ?? tradie.name,
        booked,
        slots: booked ? [] : await slotsFor(agencyId, tradieId, ticket.tenantId, SUGGESTION_COUNT),
      });
    }
    return out;
  }

  /** The Property Manager goes without Site Quotes for this Job. It stays `quoting`. */
  async function skipSiteQuotes(agencyId: number, jobId: number) {
    const job = await tickets.jobInAgency(agencyId, jobId);
    if (job.status !== 'quoting') invalid('Site Quotes can only be skipped while the Job is getting Quotes');
    const state = await siteQuoteDecisionOf(jobId);
    if (state.skipped || state.booked) invalid('Site Quotes have already been decided for this Job');
    await tickets.recordEvent(job.ticketId, 'site_quotes_skipped', { jobId });
  }

  async function siteQuoteDecisionOf(jobId: number) {
    const kinds = await all<{ kind: string }>(
      db,
      `SELECT DISTINCT kind FROM timeline WHERE kind IN ('site_quotes_booked', 'site_quotes_skipped') AND (data::jsonb->>'jobId')::bigint = ?`,
      jobId,
    );
    return { booked: kinds.some((k) => k.kind === 'site_quotes_booked'), skipped: kinds.some((k) => k.kind === 'site_quotes_skipped') };
  }

  /** A Site Quote visit is over (the Tradie replied DONE, or the Property Manager marked it). */
  async function markSiteQuoteDone(workOrderId: number) {
    const done = await transaction(db, async () => {
      const row = await workOrderRow(workOrderId);
      if (row?.status !== 'active' || row.kind !== 'site_quote') return null;
      const { tradieBusinessName } = await place(row);
      await run(db, `UPDATE work_orders SET status = 'done' WHERE id = ?`, row.id);
      await tickets.recordEvent(row.ticket_id, 'site_quote_done', { jobId: row.job_id, tradie: tradieBusinessName });
      return row;
    });
    if (!done) return;
    await worker.schedule('scheduling.site_quote_reminder', { workOrderId }, addMs(clock.now(), SITE_QUOTE_REMINDER_MS));
  }

  /** The Property Manager says the visits are over: remaining visits are cancelled and the Job goes back to choosing a Quote. */
  async function markQuotesFinal(agencyId: number, jobId: number) {
    const job = await tickets.jobInAgency(agencyId, jobId);
    const cancelled = await transaction(db, async () => {
      if ((await tickets.job(jobId)).status !== 'site_quoting') invalid('The Job is not getting Site Quotes');
      const rows = await all<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'site_quote' AND status = 'active' ORDER BY id`, jobId);
      await run(db, `UPDATE work_orders SET status = 'cancelled' WHERE job_id = ? AND kind = 'site_quote' AND status = 'active'`, jobId);
      await tickets.setJobStatus(jobId, 'quoting');
      await tickets.recordEvent(job.ticketId, 'quotes_final', { jobId });
      return rows;
    });
    const ticket = await tickets.ticket(job.ticketId);
    const property = await profiles.property(ticket.propertyId);
    for (const row of cancelled) {
      await notifications.send(row.tradie_id, 'tradie.site_quote_cancelled', { propertyAddress: property.address, trade: job.trade }, { issueId: ticket.issueId });
    }
  }

  worker.on<{ workOrderId: number }>('scheduling.site_quote_reminder', async ({ workOrderId }) => {
    const row = await workOrderRow(workOrderId);
    if (!row || row.kind !== 'site_quote' || !row.quote_request_id) return;
    if ((await tickets.job(row.job_id)).status !== 'site_quoting') return;
    if (await modules.quotes.hasRevisedQuote(row.quote_request_id)) return;
    const { job, ticket, property } = await place(row);
    await notifications.send(row.tradie_id, 'tradie.site_quote_reminder', { propertyAddress: property.address, trade: job.trade }, { issueId: ticket.issueId });
  });

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
        // One YES from the Tenant confirms every Site Quote visit listed in the same message.
        if (row.kind === 'site_quote') {
          await run(db, `UPDATE work_orders SET visit_confirmed = 1 WHERE job_id = ? AND kind = 'site_quote' AND status = 'active' AND reschedule_requested_by IS NULL`, row.job_id);
        }
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
        await tickets.recordEvent(row.ticket_id, 'visit_moved', { jobId: row.job_id, visitStart: iso(start), visitEnd: iso(end), ...(row.kind === 'site_quote' ? { siteQuote: true } : {}) });
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

    /**
     * The Tradie replied "done". On a repair the Job is done and the Tenant is asked if it was
     * fixed properly; on a Site Quote visit only the visit is done.
     */
    async markDone(workOrderId: number) {
      if ((await workOrderRow(workOrderId))?.kind === 'site_quote') return markSiteQuoteDone(workOrderId);
      const done = await transaction(db, async () => {
        const row = await workOrderRow(workOrderId);
        if (row?.status !== 'active' || row.kind !== 'repair') return null;
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
        const row = await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'repair' AND status = 'done'`, jobId);
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
        const row = (await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'repair' AND status = 'done'`, jobId))!;
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
      for (const row of await all<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE agency_id = ? AND kind = 'repair' AND status = 'done' ORDER BY start, id`, agencyId)) {
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
          const when = formatVisit(row.start, timeZone);
          return {
            ref: `work_order:${row.id}`,
            summary: row.kind === 'site_quote' ? `Site quote: ${job.trade} at ${property.address}, ${when}` : `Work Order: ${job.trade} at ${property.address}, ${when}`,
          };
        }),
      );
    },

    async workOrder(id: number) {
      const row = await workOrderRow(id);
      return row ? { id: row.id, jobId: row.job_id, ticketId: row.ticket_id, kind: row.kind, quoteRequestId: row.quote_request_id } : null;
    },

    /** The Job's active visit the Tenant or Tradie is talking about: the repair, else a Site Quote visit. */
    async activeWorkOrderForJob(jobId: number) {
      return await one<{ id: number }>(
        db,
        `SELECT id FROM work_orders WHERE job_id = ? AND status = 'active' ORDER BY (kind = 'repair') DESC, id LIMIT 1`,
        jobId,
      );
    },

    /** The Ticket's active visits, the repair last (so `.at(-1)` is the repair when there is one). */
    async activeWorkOrdersForTicket(ticketId: number) {
      return await all<{ id: number }>(db, `SELECT id FROM work_orders WHERE ticket_id = ? AND status = 'active' ORDER BY (kind = 'repair'), id`, ticketId);
    },

    /** The Job's current repair Work Order, for the Ticket view. */
    async workOrderForJob(jobId: number) {
      const row = await one<WorkOrderRow>(
        db,
        `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'repair' AND status != 'cancelled' ORDER BY id DESC LIMIT 1`,
        jobId,
      );
      return row ? toView(row) : null;
    },

    /** The Job's Site Quote visits that haven't been cancelled, earliest first. */
    async siteQuoteVisits(jobId: number) {
      return Promise.all(
        (await all<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'site_quote' AND status != 'cancelled' ORDER BY start, id`, jobId)).map(toView),
      );
    },

    /** Site Quote visits still to happen on the Job. */
    siteQuotesOpen,

    /**
     * For many Jobs in two queries, by Job id: whether Site Quotes were `booked` or `skipped`,
     * and how many visits are still `open`. A Job with none of these is left out.
     */
    async siteQuotesOf(jobIds: number[]) {
      const states = new Map<number, { booked: boolean; skipped: boolean; open: number }>();
      if (!jobIds.length) return states;
      const ids = JSON.stringify(jobIds);
      const of = (jobId: number) => states.get(jobId) ?? states.set(jobId, { booked: false, skipped: false, open: 0 }).get(jobId)!;
      for (const e of await all<{ job_id: number; kind: string }>(
        db,
        `SELECT DISTINCT (data::jsonb->>'jobId')::bigint AS job_id, kind FROM timeline
         WHERE kind IN ('site_quotes_booked', 'site_quotes_skipped')
         AND (data::jsonb->>'jobId')::bigint IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value))`,
        ids,
      )) {
        if (e.kind === 'site_quotes_booked') of(e.job_id).booked = true;
        else of(e.job_id).skipped = true;
      }
      for (const r of await all<{ job_id: number; open: number }>(
        db,
        `SELECT job_id, count(*) AS open FROM work_orders WHERE kind = 'site_quote' AND status = 'active'
         AND job_id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value)) GROUP BY job_id`,
        ids,
      )) {
        of(r.job_id).open = r.open;
      }
      return states;
    },

    /** The Property Manager marks a Site Quote visit done (the Tradie may not reply). */
    async markSiteQuoteDoneForAgency(agencyId: number, workOrderId: number) {
      const row = await activeWorkOrder(agencyId, workOrderId);
      if (row.kind !== 'site_quote') invalid('This is not a Site Quote visit');
      await markSiteQuoteDone(workOrderId);
    },

    bookSiteQuotes,
    siteQuoteSlots,
    skipSiteQuotes,
    markSiteQuoteDone,
    markQuotesFinal,

    /** When each Job of many Tickets is booked, from its current Work Order, in one query. Jobs never booked are left out. */
    async visitsOfTickets(ticketIds: number[]) {
      if (!ticketIds.length) return new Map<number, string>();
      const rows = await all<{ job_id: number; start: string }>(
        db,
        `SELECT DISTINCT ON (job_id) job_id, start FROM work_orders
         WHERE ticket_id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value)) AND kind = 'repair' AND status != 'cancelled'
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
