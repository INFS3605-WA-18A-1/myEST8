import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { ActionError, addMs, HOUR_MS, invalid, iso, newToken, notFound, withoutContactDetails, type Availability } from './shared.ts';
import type { OpenItem } from './tickets.ts';
import { dayOf, formatVisit, startOfDay, wallClock, zonedInstant } from './zoned-time.ts';

const DEFAULT_SLOT_MINUTES = 120;
const INSPECTION_MINUTES = 60;
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

/** A repair visit, or a Tradie's Site Inspection before their Firm Quote. */
export type WorkOrderKind = 'repair' | 'inspection';

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
export function createScheduling({ db, clock, settings, worker, modules }: Context) {

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

  /** Free one-hour slots over the next 14 days inside the Tenant's availability. */
  async function slotsFor(agencyId: number, tradieId: number, tenantId: number, limit: number) {
    const tenant = await profiles.person(tenantId);
    return findSlots({
      agencyId,
      tradieId,
      durationMs: INSPECTION_MINUTES * MINUTE_MS,
      windows: AVAILABILITY_WINDOWS[tenant.availability ?? 'any_time'],
      from: clock.now(),
      days: SUGGESTION_DAYS,
      limit,
    });
  }

  /**
   * Books one Tradie's Site Inspection (an hour unless `durationMinutes` says otherwise), once
   * they have given an Estimate. It is a Work Order with kind `inspection`, so it blocks the
   * Tradie's slot; the Tradie and the Tenant are told. The Job stays `quoting`.
   */
  async function bookInspection(agencyId: number, quoteRequestId: number, options: { start: string; durationMinutes?: number }) {
    const request = await modules.quotes.inspectionBookable(agencyId, quoteRequestId);
    const tradie = await profiles.person(request.tradieId);
    const name = tradie.businessName ?? tradie.name;
    const minutes = options.durationMinutes ?? INSPECTION_MINUTES;
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) invalid('The visit must be between 1 minute and 24 hours long');
    const start = new Date(options.start);
    if (Number.isNaN(start.getTime())) invalid(`${options.start} is not a time`);
    if (start < clock.now()) invalid('Pick a start time in the future');
    const end = addMs(start, minutes * MINUTE_MS);
    const id = await transaction(db, async () => {
      // Checked again inside, so two bookings at once can't both pass.
      await modules.quotes.inspectionBookable(agencyId, quoteRequestId);
      if (!(await isFree(agencyId, tradie.id, start, end))) throw new ActionError('conflict', `${name} is already booked then`);
      const id = await run(
        db,
        `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, "end", status, kind, quote_request_id)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 'inspection', ?) RETURNING id`,
        agencyId,
        request.jobId,
        request.ticketId,
        tradie.id,
        iso(start),
        iso(end),
        quoteRequestId,
      );
      await modules.quotes.inspectionBooked(quoteRequestId);
      await tickets.recordEvent(request.ticketId, 'inspection_booked', { jobId: request.jobId, tradie: name, visitStart: iso(start), visitEnd: iso(end) });
      return id;
    });

    const row = (await workOrderRow(id))!;
    const { job, ticket, property } = await place(row);
    const issue = await tickets.issue(ticket.issueId);
    const photoFileIds = (await tickets.photos(issue.id)).map((x) => x.fileId);
    const byEmail = (await notifications.channelFor(tradie.id)) === 'email';
    await notifications.send(
      tradie.id,
      'tradie.inspection',
      {
        propertyAddress: property.address,
        trade: job.trade,
        summary: withoutContactDetails(issue.summary ?? issue.description),
        visitStart: row.start,
        visitEnd: row.end,
      },
      { issueId: issue.id, attachmentFileIds: byEmail ? photoFileIds : [] },
    );
    await notifications.send(ticket.tenantId, 'tenant.inspection', { tradieBusinessName: name, trade: job.trade, visitStart: row.start }, { issueId: issue.id });
    await modules.intake.expectAnswer(ticket.tenantId, { kind: 'visit', workOrderId: id });
    return id;
  }

  /** For each Tradie on the Job who needs a Site Inspection not booked yet, up to three free one-hour slots to prefill booking it. */
  async function inspectionSlots(agencyId: number, jobId: number) {
    const job = await tickets.jobInAgency(agencyId, jobId);
    const ticket = await tickets.ticket(job.ticketId);
    const out = [];
    for (const { quoteRequestId, tradieId } of await modules.quotes.needingInspection(jobId)) {
      const tradie = await profiles.person(tradieId);
      out.push({ quoteRequestId, tradieId, businessName: tradie.businessName ?? tradie.name, slots: await slotsFor(agencyId, tradieId, ticket.tenantId, SUGGESTION_COUNT) });
    }
    return out;
  }

  /** Whether a visit's start time has come, by the injected clock: a visit is never done before it starts. */
  const started = (row: WorkOrderRow) => clock.now() >= new Date(row.start);

  /**
   * A Site Inspection is over (the Tradie replied DONE, or the Property Manager marked it):
   * the Tradie is asked for their Firm Quote. Ignored before the visit's start time.
   */
  async function markInspected(workOrderId: number) {
    const done = await transaction(db, async () => {
      const row = await workOrderRow(workOrderId);
      if (row?.status !== 'active' || row.kind !== 'inspection' || !started(row)) return null;
      const { tradieBusinessName } = await place(row);
      await run(db, `UPDATE work_orders SET status = 'done' WHERE id = ?`, row.id);
      await tickets.recordEvent(row.ticket_id, 'inspected', { jobId: row.job_id, tradie: tradieBusinessName });
      return row;
    });
    if (done?.quote_request_id) await modules.quotes.inspected(done.quote_request_id);
  }

  type VisitOfferRow = {
    id: number;
    agency_id: number;
    job_id: number;
    ticket_id: number;
    tradie_id: number;
    round: number;
    starts: unknown;
    duration_minutes: number;
    status: 'offered' | 'picked' | 'none_fit' | 'superseded';
    picked_start: string | null;
    tenant_note: string | null;
    token: string;
    created_at: string;
    answered_at: string | null;
  };

  const startsOf = (value: unknown): string[] => {
    const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    return Array.isArray(parsed) ? parsed.filter((start): start is string => typeof start === 'string') : [];
  };

  /** The open offer of visit times for a Job, or null when the Tenant is not choosing. */
  async function offeredVisit(jobId: number) {
    const row = await one<VisitOfferRow>(db, `SELECT * FROM visit_offers WHERE job_id = ? AND status = 'offered' ORDER BY round DESC LIMIT 1`, jobId);
    return row ? { starts: startsOf(row.starts), durationMinutes: row.duration_minutes, token: row.token } : null;
  }

  /** The Tradie offers 2 or 3 starts. Each must be free. The Tenant is asked to pick one. */
  async function offerVisitTimes(token: string, starts: string[]) {
    const request = await one<{ id: number; agency_id: number; job_id: number; ticket_id: number; tradie_id: number }>(
      db,
      'SELECT id, agency_id, job_id, ticket_id, tradie_id FROM quote_requests WHERE token = ?',
      token,
    );
    if (!request) notFound('Quote Request');
    const quote = await modules.quotes.approvedQuote(request.job_id);
    if (!quote || quote.tradieId !== request.tradie_id) invalid('Offer times once your quote is approved');
    if ((await tickets.job(request.job_id)).status !== 'approved') invalid('This visit is already booked');
    if (await offeredVisit(request.job_id)) invalid('You have already offered times');
    if (starts.length < 2 || starts.length > 3) invalid('Offer 2 or 3 times', 'starts');
    const when = starts.map((start) => {
      const at = new Date(start);
      if (Number.isNaN(at.getTime())) invalid('Enter a date and time', 'starts');
      if (at < clock.now()) invalid('Pick a time in the future', 'starts');
      return at;
    });
    if (new Set(when.map((at) => at.toISOString())).size !== when.length) invalid('Offer different times', 'starts');

    const approved = await one<{ stage: string; duration_days: number | null }>(
      db,
      `SELECT stage, duration_days FROM quotes WHERE job_id = ? AND status = 'approved'`,
      request.job_id,
    );
    const durationMinutes = approved?.stage === 'firm' && approved.duration_days ? approved.duration_days * 24 * 60 : DEFAULT_SLOT_MINUTES;
    const { timeZone } = await profiles.agency(request.agency_id);
    const tradie = await profiles.person(request.tradie_id);
    const name = tradie.businessName ?? tradie.name;
    for (const at of when) {
      const end = addMs(at, durationMinutes * MINUTE_MS);
      if (!(await isFree(request.agency_id, request.tradie_id, at, end))) invalid(`You're already booked at ${formatVisit(at, timeZone)}`, 'starts');
    }

    const offerToken = newToken();
    const round = ((await one<{ round: number }>(db, 'SELECT round FROM visit_offers WHERE job_id = ? ORDER BY round DESC LIMIT 1', request.job_id))?.round ?? 0) + 1;
    await run(
      db,
      `INSERT INTO visit_offers (agency_id, job_id, ticket_id, tradie_id, round, starts, duration_minutes, status, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'offered', ?, ?)`,
      request.agency_id,
      request.job_id,
      request.ticket_id,
      request.tradie_id,
      round,
      JSON.stringify(when.map((at) => at.toISOString())),
      durationMinutes,
      offerToken,
      iso(clock.now()),
    );

    const ticket = await tickets.ticket(request.ticket_id);
    const job = await tickets.job(request.job_id);
    const base = `${settings.baseUrl}/v/${offerToken}`;
    const choices = [
      ...when.map((at, i) => ({ label: formatVisit(at, timeZone), url: `${base}?pick=${i + 1}` })),
      { label: 'None of these work', url: `${base}?pick=none` },
    ];
    await notifications.send(
      ticket.tenantId,
      'tenant.choose_visit_time',
      { tradieBusinessName: name, trade: job.trade, choices },
      { issueId: ticket.issueId },
    );
  }

  /**
   * The Quote is approved, so the chosen Tradie is asked to offer visit times on their
   * quote page. Nothing is booked: the Tenant picks a time, or the Property Manager still can.
   */
  async function askForVisitTimes(jobId: number) {
    const job = await tickets.job(jobId);
    if (job.status !== 'approved') return;
    const quote = await modules.quotes.approvedQuote(jobId);
    if (!quote) return;
    const request = await one<{ token: string }>(db, 'SELECT token FROM quote_requests WHERE job_id = ? AND tradie_id = ?', jobId, quote.tradieId);
    if (!request) return;
    const ticket = await tickets.ticket(job.ticketId);
    const property = await profiles.property(ticket.propertyId);
    await notifications.send(
      quote.tradieId,
      'tradie.offer_times',
      { trade: job.trade, propertyAddress: property.address, quoteLink: `${settings.baseUrl}/q/${request.token}` },
      { issueId: ticket.issueId },
    );
  }

  return {
    isFree,
    askForVisitTimes,
    offeredVisit,
    offerVisitTimes,

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
        {
          propertyAddress: property.address,
          description: withoutContactDetails(issue.description),
          trade: job.trade,
          visitStart: row.start,
          visitEnd: row.end,
          approvedCents: quote.priceCents,
          stage: quote.stage,
        },
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
        await tickets.recordEvent(row.ticket_id, 'reschedule_requested', { jobId: row.job_id, by, ...(row.kind === 'inspection' ? { inspection: true } : {}) });
      });
    },

    async recordVisitConfirmation(workOrderId: number) {
      return transaction(db, async () => {
        const row = await workOrderRow(workOrderId);
        if (row?.status !== 'active') return;
        await run(db, 'UPDATE work_orders SET visit_confirmed = 1 WHERE id = ?', workOrderId);
        await tickets.recordEvent(row.ticket_id, 'visit_confirmed', { jobId: row.job_id, ...(row.kind === 'inspection' ? { inspection: true } : {}) });
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
        await tickets.recordEvent(row.ticket_id, 'visit_moved', { jobId: row.job_id, visitStart: iso(start), visitEnd: iso(end), ...(row.kind === 'inspection' ? { inspection: true } : {}) });
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
     * fixed properly; on a Site Inspection only the visit is done, and the Tradie is asked for their Firm Quote.
     * Ignored before the visit's start time (intake answers the Tradie then; see `hasStarted`).
     */
    async markDone(workOrderId: number) {
      if ((await workOrderRow(workOrderId))?.kind === 'inspection') return markInspected(workOrderId);
      const done = await transaction(db, async () => {
        const row = await workOrderRow(workOrderId);
        if (row?.status !== 'active' || row.kind !== 'repair' || !started(row)) return null;
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

    /** When a Tradie's visits still to be done start, soonest first: those from the start of today in the Agency's time zone, so one earlier today that isn't marked done counts. */
    async visitStartsFromToday(agencyId: number, tradieId: number) {
      const { timeZone } = await profiles.agency(agencyId);
      return (await all<{ start: string }>(
        db,
        `SELECT start FROM work_orders WHERE agency_id = ? AND tradie_id = ? AND status = 'active' AND start >= ? ORDER BY start, id`,
        agencyId,
        tradieId,
        iso(startOfDay(dayOf(clock.now(), timeZone), timeZone)),
      )).map((v) => v.start);
    },

    /** Done Jobs the Property Manager hasn't rated yet. */
    async alerts(agencyId: number, propertyIds: number[] | null) {
      // Only done repairs the Property Manager hasn't rated: the rated history isn't read.
      const unrated = await all<WorkOrderRow>(
        db,
        `SELECT * FROM work_orders w WHERE agency_id = ? AND kind = 'repair' AND status = 'done'
           AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.job_id = w.job_id AND r.source = 'property_manager')
         ORDER BY start, id`,
        agencyId,
      );
      const due = await Promise.all(
        unrated.map(async (row) => {
          const { propertyId } = await tickets.ticket(row.ticket_id);
          if (propertyIds !== null && !propertyIds.includes(propertyId)) return null;
          const view = await toView(row);
          return {
            kind: 'rating_due' as const,
            ticketId: row.ticket_id,
            jobId: row.job_id,
            propertyAddress: view.propertyAddress,
            businessName: view.businessName,
          };
        }),
      );
      return due.filter((d) => d !== null);
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
            summary: row.kind === 'inspection' ? `Site Inspection: ${job.trade} at ${property.address}, ${when}` : `Work Order: ${job.trade} at ${property.address}, ${when}`,
          };
        }),
      );
    },

    async workOrder(id: number) {
      const row = await workOrderRow(id);
      return row ? { id: row.id, jobId: row.job_id, ticketId: row.ticket_id, kind: row.kind, quoteRequestId: row.quote_request_id, start: row.start } : null;
    },

    /**
     * Whether an active visit's start time has come. When it hasn't, a DONE reply about it is
     * answered with `tradie.done_too_early` and left for the Property Manager.
     */
    async hasStarted(workOrderId: number) {
      const row = await workOrderRow(workOrderId);
      return row?.status !== 'active' || started(row);
    },

    /** Tells the Tradie their visit can't be done yet: it starts later. */
    async tellDoneTooEarly(workOrderId: number) {
      const row = (await workOrderRow(workOrderId))!;
      const { ticket, property } = await place(row);
      await notifications.send(
        row.tradie_id,
        'tradie.done_too_early',
        { propertyAddress: property.address, visitStart: row.start, inspection: row.kind === 'inspection' },
        { issueId: ticket.issueId },
      );
    },

    /** The Job's active visit the Tenant or Tradie is talking about: the repair, else a Site Inspection. */
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

    /** The Job's Site Inspections that haven't been cancelled, earliest first. */
    async inspectionVisits(jobId: number) {
      return Promise.all(
        (await all<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'inspection' AND status != 'cancelled' ORDER BY start, id`, jobId)).map(toView),
      );
    },

    /** A Quote Request's latest Site Inspection that hasn't been cancelled, or null. */
    async inspectionFor(quoteRequestId: number) {
      const row = await one<WorkOrderRow>(
        db,
        `SELECT * FROM work_orders WHERE quote_request_id = ? AND kind = 'inspection' AND status != 'cancelled' ORDER BY id DESC LIMIT 1`,
        quoteRequestId,
      );
      if (!row) return null;
      return { workOrderId: row.id, start: row.start, end: row.end, status: row.status, visit: visitOf(row), visitConfirmed: !!row.visit_confirmed, rescheduleRequestedBy: row.reschedule_requested_by };
    },

    /** The Property Manager marks a Site Inspection done (the Tradie may not reply), once its start time has come. */
    async markInspectedForAgency(agencyId: number, workOrderId: number) {
      const row = await activeWorkOrder(agencyId, workOrderId);
      if (row.kind !== 'inspection') invalid('This is not a Site Inspection');
      if (!started(row)) {
        const { timeZone } = await profiles.agency(agencyId);
        invalid(`Mark the Site Inspection done once it has started. It is booked for ${formatVisit(row.start, timeZone)}.`);
      }
      await markInspected(workOrderId);
    },

    bookInspection,
    inspectionSlots,
    markInspected,

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
