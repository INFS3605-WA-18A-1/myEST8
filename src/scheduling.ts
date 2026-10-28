import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { ActionError, addMs, AVAILABILITY, HOUR_MS, invalid, iso, newToken, notFound, withoutContactDetails, type Availability } from './shared.ts';
import type { OpenItem } from './tickets.ts';
import { quotedLengthLabel, visitLengthLabel, type DoneJob } from './templates.ts';
import { dayOf, formatVisit, startOfDay, wallClock, zonedInstant } from './zoned-time.ts';

const DEFAULT_SLOT_MINUTES = 120;
const INSPECTION_MINUTES = 60;
const SUGGESTION_COUNT = 3;
const SUGGESTION_DAYS = 14;
const OFFER_REMINDER_MS = 24 * HOUR_MS;
const OFFER_ALERT_MS = 48 * HOUR_MS;
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
  /** No-login link for confirming the visit or asking for another time. Null until one is needed: older code inserts a Work Order without one. */
  token: string | null;
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

  /** Confirm, and ask for another time. The same links a reminder or a resend uses. */
  function visitActionLinks(token: string) {
    const base = `${settings.baseUrl}/v/confirm/${token}`;
    return { confirmLink: base, anotherTimeLink: `${base}?another=1` };
  }

  /**
   * The visit's no-login token. A Work Order inserted without one (the column is
   * nullable, so older code still can) gets a token here, the first time a link
   * needs it, and keeps that token after.
   */
  async function ensureToken(row: WorkOrderRow): Promise<string> {
    if (row.token) return row.token;
    const token = newToken();
    const saved = await one<{ token: string | null }>(db, 'UPDATE work_orders SET token = ? WHERE id = ? AND token IS NULL RETURNING token', token, row.id);
    const kept = saved?.token ?? (await one<{ token: string }>(db, 'SELECT token FROM work_orders WHERE id = ?', row.id))!.token;
    row.token = kept;
    return kept;
  }

  const contactOf = (person: { mobile: string | null; email: string | null }) => person.mobile ?? person.email ?? 'Not given';

  /** The Quote Request's page for this Job and Tradie, or '' when there isn't one. */
  async function quotePageLink(jobId: number, tradieId: number) {
    const request = await one<{ token: string }>(db, 'SELECT token FROM quote_requests WHERE job_id = ? AND tradie_id = ? ORDER BY id DESC LIMIT 1', jobId, tradieId);
    return request ? `${settings.baseUrl}/q/${request.token}` : '';
  }

  /** How long the approved visit is: the Firm Quote's days, or 2 hours on an Estimate. */
  async function approvedVisitLength(jobId: number) {
    const quote = await modules.quotes.approvedQuote(jobId);
    if (!quote || quote.stage !== 'firm') return quotedLengthLabel(null);
    const row = await one<{ duration_days: number | null }>(db, `SELECT duration_days FROM quotes WHERE job_id = ? AND status = 'approved'`, jobId);
    return quotedLengthLabel(row?.duration_days ?? null);
  }

  /**
   * A done Job as the completion messages tell it: its Trade, the Tradie, the day of the done
   * visit, what was done (the Firm Quote's scope of work, or the issue as the Tradie was asked
   * to estimate it), and apart from that story the amount approved, which only the Property
   * Owner hears. Null when the Job has no approved Quote.
   */
  async function doneJob(jobId: number): Promise<{ story: DoneJob; approvedCents: number } | null> {
    const quote = await modules.quotes.approvedQuote(jobId);
    if (!quote) return null;
    const job = await tickets.job(jobId);
    const issue = await tickets.issue((await tickets.ticket(job.ticketId)).issueId);
    const tradie = await profiles.person(quote.tradieId);
    const visit = await one<{ start: string }>(
      db,
      `SELECT start FROM work_orders WHERE job_id = ? AND kind = 'repair' AND status = 'done' ORDER BY id DESC LIMIT 1`,
      jobId,
    );
    return {
      story: {
        trade: job.trade,
        tradieBusinessName: tradie.businessName ?? tradie.name,
        doneOn: visit?.start ?? null,
        work: quote.scopeOfWork ?? withoutContactDetails(issue.summary ?? issue.description),
      },
      approvedCents: quote.priceCents,
    };
  }

  /** The Tradie's Work Order for this visit, at its current time. */
  async function tellTradieWorkOrder(row: WorkOrderRow) {
    const quote = await modules.quotes.approvedQuote(row.job_id);
    if (!quote) return;
    const { job, property, ticket } = await place(row);
    const issue = await tickets.issue(ticket.issueId);
    const tenant = await profiles.person(ticket.tenantId);
    await notifications.send(
      row.tradie_id,
      'tradie.work_order',
      {
        propertyAddress: property.address,
        description: withoutContactDetails(issue.description),
        trade: job.trade,
        visitStart: row.start,
        visitEnd: row.end,
        approvedCents: quote.priceCents,
        stage: quote.stage,
        tenantName: tenant.name,
        tenantContact: contactOf(tenant),
        quoteLink: await quotePageLink(row.job_id, row.tradie_id),
      },
      { issueId: issue.id },
    );
  }

  /** The Tradie's Site Inspection email, at its current time, with the issue's photos when it goes by email. */
  async function tellTradieInspection(row: WorkOrderRow) {
    const { job, property, ticket } = await place(row);
    const issue = await tickets.issue(ticket.issueId);
    const tenant = await profiles.person(ticket.tenantId);
    const photoFileIds = (await tickets.photos(issue.id)).map((x) => x.fileId);
    const byEmail = (await notifications.channelFor(row.tradie_id)) === 'email';
    await notifications.send(
      row.tradie_id,
      'tradie.inspection',
      {
        propertyAddress: property.address,
        trade: job.trade,
        summary: withoutContactDetails(issue.summary ?? issue.description),
        visitStart: row.start,
        visitEnd: row.end,
        tenantContact: contactOf(tenant),
        quoteLink: await quotePageLink(row.job_id, row.tradie_id),
      },
      { issueId: issue.id, attachmentFileIds: byEmail ? photoFileIds : [] },
    );
  }

  /** A visit_moved event for this Work Order, not one for the other kind of visit on the same Job. */
  async function visitWasMoved(row: WorkOrderRow) {
    const events = await tickets.timeline(row.ticket_id);
    return events.some((event) => {
      if (event.kind !== 'visit_moved') return false;
      const data = event as { jobId?: number; inspection?: boolean };
      return data.jobId === row.job_id && !!data.inspection === (row.kind === 'inspection');
    });
  }

  /** Tells the Tenant the visit time, with a button to confirm it and one to ask for another. A confirmed visit is not waiting on YES. */
  async function tellTenantVisitTime(row: WorkOrderRow, moved: boolean) {
    const { job, ticket, tradieBusinessName } = await place(row);
    const links = visitActionLinks(await ensureToken(row));
    if (moved) {
      await notifications.send(ticket.tenantId, 'tenant.visit_moved', { visitStart: row.start, tradieBusinessName, ...links }, { issueId: ticket.issueId });
    } else if (row.kind === 'inspection') {
      await notifications.send(
        ticket.tenantId,
        'tenant.inspection',
        { tradieBusinessName, trade: job.trade, visitStart: row.start, ...links },
        { issueId: ticket.issueId },
      );
    } else {
      await notifications.send(
        ticket.tenantId,
        'tenant.visit_time',
        { visitStart: row.start, trade: job.trade, tradieBusinessName, ...links },
        { issueId: ticket.issueId },
      );
    }
    if (!row.visit_confirmed) await modules.intake.expectAnswer(ticket.tenantId, { kind: 'visit', workOrderId: row.id });
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
        `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, "end", status, kind, quote_request_id, token)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 'inspection', ?, ?) RETURNING id`,
        agencyId,
        request.jobId,
        request.ticketId,
        tradie.id,
        iso(start),
        iso(end),
        quoteRequestId,
        newToken(),
      );
      await modules.quotes.inspectionBooked(quoteRequestId);
      await tickets.recordEvent(request.ticketId, 'inspection_booked', { jobId: request.jobId, tradie: name, visitStart: iso(start), visitEnd: iso(end) });
      return id;
    });

    const row = (await workOrderRow(id))!;
    await tellTradieInspection(row);
    await tellTenantVisitTime(row, false);
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

  /** The Quote Request behind a Tradie's email link, and the visit that link is about (the latest of its kind). */
  async function visitForQuoteToken(token: string, kind: 'repair' | 'inspection') {
    const request = await one<{ id: number; job_id: number; tradie_id: number; agency_id: number; ticket_id: number }>(
      db,
      'SELECT id, job_id, tradie_id, agency_id, ticket_id FROM quote_requests WHERE token = ?',
      token,
    );
    if (!request) return null;
    const row =
      kind === 'inspection'
        ? await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE quote_request_id = ? AND kind = 'inspection' ORDER BY id DESC LIMIT 1`, request.id)
        : await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND tradie_id = ? AND kind = 'repair' ORDER BY id DESC LIMIT 1`, request.job_id, request.tradie_id);
    return { request, row };
  }

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

  /**
   * The Tradie offers a preferred time and up to two more. The first of `starts` is the
   * preferred time. Each must be free. The Tenant is asked to pick one.
   */
  async function offerVisitTimes(token: string, starts: string[]) {
    const request = await one<{ id: number; agency_id: number; job_id: number; ticket_id: number; tradie_id: number }>(
      db,
      'SELECT id, agency_id, job_id, ticket_id, tradie_id FROM quote_requests WHERE token = ?',
      token,
    );
    if (!request) notFound('Quote Request');
    const quote = await modules.quotes.approvedQuote(request.job_id);
    if (!quote || quote.tradieId !== request.tradie_id) invalid('Offer times once your quote is approved');
    const jobStatus = (await tickets.job(request.job_id)).status;
    const repair = await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'repair' AND status = 'active' ORDER BY id DESC LIMIT 1`, request.job_id);
    const rescheduling = jobStatus === 'scheduled' && !!repair?.reschedule_requested_by;
    if (jobStatus !== 'approved' && !rescheduling) invalid('This visit is already booked');
    if (await offeredVisit(request.job_id)) invalid('You have already offered times');
    if (starts.length < 1 || starts.length > 3) invalid('Offer a preferred time, and up to 2 more', 'starts');
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
    const durationMinutes = repair
      ? Math.round((Date.parse(repair.end) - Date.parse(repair.start)) / MINUTE_MS)
      : approved?.stage === 'firm' && approved.duration_days
        ? approved.duration_days * 24 * 60
        : DEFAULT_SLOT_MINUTES;
    const { timeZone } = await profiles.agency(request.agency_id);
    const tradie = await profiles.person(request.tradie_id);
    const name = tradie.businessName ?? tradie.name;
    for (const at of when) {
      const end = addMs(at, durationMinutes * MINUTE_MS);
      if (!(await isFree(request.agency_id, request.tradie_id, at, end))) invalid(`You're already booked at ${formatVisit(at, timeZone)}`, 'starts');
    }

    const offerToken = newToken();
    const round = ((await one<{ round: number }>(db, 'SELECT round FROM visit_offers WHERE job_id = ? ORDER BY round DESC LIMIT 1', request.job_id))?.round ?? 0) + 1;
    const offerId = await run(
      db,
      `INSERT INTO visit_offers (agency_id, job_id, ticket_id, tradie_id, round, starts, duration_minutes, status, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'offered', ?, ?) RETURNING id`,
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
    const choices = choiceLinksFor(when, timeZone, offerToken);
    await notifications.send(
      ticket.tenantId,
      'tenant.choose_visit_time',
      { tradieBusinessName: name, trade: job.trade, choices },
      { issueId: ticket.issueId },
    );
    await modules.intake.expectAnswer(ticket.tenantId, { kind: 'visit_offer', offerId, options: choiceOptions(when, timeZone) });
    await worker.schedule('scheduling.remind_tenant_pick', { offerId }, addMs(clock.now(), OFFER_REMINDER_MS));
  }

  /**
   * The choices on the Tenant's message. The first time is the Tradie's preferred one,
   * marked so the plain text (and SMS) says "(preferred)". A reminder reads the same.
   */
  function choiceLinksFor(starts: (Date | string)[], timeZone: string, token: string) {
    const base = `${settings.baseUrl}/v/${token}`;
    return [
      ...starts.map((start, i) => ({
        label: `${formatVisit(start, timeZone)}${i === 0 ? ' (preferred)' : ''}`,
        url: `${base}?pick=${i + 1}`,
      })),
      { label: 'None of these work', url: `${base}?pick=none` },
    ];
  }

  async function choiceLinks(row: VisitOfferRow) {
    const { timeZone } = await profiles.agency(row.agency_id);
    return choiceLinksFor(startsOf(row.starts), timeZone, row.token);
  }

  /** Notes that the Tradie was asked, and reminds them in 24 hours if they still haven't offered. */
  async function rememberOfferAsked(jobId: number, ticketId: number) {
    await tickets.recordEvent(ticketId, 'visit_times_asked', { jobId });
    await worker.schedule('scheduling.remind_tradie_offer', { jobId }, addMs(clock.now(), OFFER_REMINDER_MS));
  }

  /**
   * When the Tradie was asked and has not offered since. Null once they have, or the visit
   * is no longer waiting on them. `askedAt` is that ask.
   */
  async function tradieStillToOffer(jobId: number) {
    const job = await tickets.job(jobId);
    if (job.status !== 'approved' && job.status !== 'scheduled') return null;
    if (await offeredVisit(jobId)) return null;
    const asked = (await tickets.timeline(job.ticketId)).findLast((e) => e.kind === 'visit_times_asked' && (e as { jobId?: number }).jobId === jobId);
    if (!asked) return null;
    const latest = await one<{ created_at: string }>(db, 'SELECT created_at FROM visit_offers WHERE job_id = ? ORDER BY round DESC LIMIT 1', jobId);
    if (latest && latest.created_at >= asked.at) return null;
    if (job.status === 'scheduled') {
      const repair = await one<{ reschedule_requested_by: string | null }>(
        db,
        `SELECT reschedule_requested_by FROM work_orders WHERE job_id = ? AND kind = 'repair' AND status = 'active' ORDER BY id DESC LIMIT 1`,
        jobId,
      );
      if (!repair?.reschedule_requested_by) return null;
    }
    return { askedAt: asked.at, ticketId: job.ticketId };
  }

  /** "1", each weekday that names only one time, and "none". A shared weekday is left out. */
  function choiceOptions(starts: Date[], timeZone: string) {
    const days = starts.map((at) => longWeekday(at, timeZone));
    const unique = days.filter((day) => days.filter((other) => other === day).length === 1);
    return [...starts.map((_, i) => String(i + 1)), ...unique, 'none'];
  }

  function longWeekday(at: Date | string, timeZone: string) {
    return new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'long' }).format(new Date(at));
  }

  /** Everything after a leading "none" (or "none of these work"): the Tenant's note, or nothing. */
  function noteFromNoneReply(text: string) {
    return text.replace(/^\s*none(?:\s+of\s+these(?:\s+work)?)?\b[\s,.:;!-]*/i, '').trim();
  }

  /** Which offered time a reply names: "1" or a weekday. -1 when it names none, or more than one. */
  function choiceIndex(starts: string[], answer: string, timeZone: string) {
    if (/^\d+$/.test(answer)) {
      const index = Number(answer) - 1;
      return index >= 0 && index < starts.length ? index : -1;
    }
    const days = starts.map((start) => longWeekday(start, timeZone));
    return days.filter((day) => day === answer).length === 1 ? days.indexOf(answer) : -1;
  }

  async function visitOfferIssue(offerId: number) {
    const row = await one<{ ticket_id: number }>(db, 'SELECT ticket_id FROM visit_offers WHERE id = ?', offerId);
    return row ? (await tickets.ticket(row.ticket_id)).issueId : null;
  }

  async function offerByToken(token: string) {
    return one<VisitOfferRow>(db, 'SELECT * FROM visit_offers WHERE token = ?', token);
  }

  async function workOrderByToken(token: string) {
    return one<WorkOrderRow>(db, 'SELECT * FROM work_orders WHERE token = ?', token);
  }

  /**
   * The Tenant's confirm page. `pick` names a time ("1") or "none"; it is only shown.
   * An unknown token or an unknown number is null. Booking is pickVisitTime.
   */
  async function visitOffer(token: string, pick?: string) {
    const row = await offerByToken(token);
    if (!row) return null;
    const starts = startsOf(row.starts);
    const index = pick && pick !== 'none' ? Number(pick) - 1 : -1;
    if (pick && pick !== 'none' && (!Number.isInteger(index) || index < 0 || index >= starts.length)) return null;
    const { timeZone, name } = await profiles.agency(row.agency_id);
    const ticket = await tickets.ticket(row.ticket_id);
    const property = await profiles.property(ticket.propertyId);
    const tradie = await profiles.person(row.tradie_id);
    const tenant = await profiles.person(ticket.tenantId);
    const repair = await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'repair' ORDER BY id DESC LIMIT 1`, row.job_id);
    return {
      agencyName: name,
      timeZone,
      address: property.address,
      tradieBusinessName: tradie.businessName ?? tradie.name,
      availability: tenant.availability,
      status: row.status,
      pick: pick ?? null,
      /** Every time this offer named, the Tradie's preferred first. */
      starts,
      start: index >= 0 ? starts[index]! : null,
      pickedStart: row.picked_start,
      /** The first offered time is the one the Tradie prefers. */
      preferred: index === 0,
      bookable: row.status === 'offered' && index >= 0,
      /** The Job's repair visit, once one is booked: whether it can still be asked to move. */
      visit: repair ? { start: repair.start, status: repair.status, rescheduleRequestedBy: repair.reschedule_requested_by } : null,
    };
  }

  /**
   * The Tenant's page for a visit the Property Manager booked or moved. Reading it
   * never confirms and never starts a new round. An unknown token is null.
   */
  async function visitConfirmation(token: string) {
    const row = await workOrderByToken(token);
    if (!row) return null;
    const { property, tradieBusinessName } = await place(row);
    const { timeZone, name } = await profiles.agency(row.agency_id);
    return {
      agencyName: name,
      timeZone,
      address: property.address,
      tradieBusinessName,
      start: row.start,
      status: row.status,
      visitConfirmed: !!row.visit_confirmed,
      rescheduleRequestedBy: row.reschedule_requested_by,
      kind: row.kind,
    };
  }

  /** The note from the latest round the Tenant turned down, for the Tradie's next offer. */
  async function declinedNote(jobId: number) {
    const row = await one<{ tenant_note: string | null }>(
      db,
      `SELECT tenant_note FROM visit_offers WHERE job_id = ? AND status = 'none_fit' ORDER BY round DESC LIMIT 1`,
      jobId,
    );
    return row?.tenant_note ?? null;
  }

  /** The booked repair needs a new time. The Tradie offers some; the visit stays where it is until the Tenant picks. */
  async function askForNewTimes(row: WorkOrderRow) {
    const job = await tickets.job(row.job_id);
    const quote = await modules.quotes.approvedQuote(row.job_id);
    if (!quote) return;
    const request = await one<{ token: string }>(db, 'SELECT token FROM quote_requests WHERE job_id = ? AND tradie_id = ?', row.job_id, quote.tradieId);
    if (!request) return;
    const ticket = await tickets.ticket(row.ticket_id);
    const property = await profiles.property(ticket.propertyId);
    const tenant = await profiles.person(ticket.tenantId);
    await notifications.send(
      quote.tradieId,
      'tradie.offer_new_times',
      {
        trade: job.trade,
        propertyAddress: property.address,
        quoteLink: `${settings.baseUrl}/q/${request.token}`,
        length: visitLengthLabel(row.start, row.end),
        availability: tenant.availability ?? 'any_time',
      },
      { issueId: ticket.issueId },
    );
    await rememberOfferAsked(row.job_id, ticket.id);
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
    const tenant = await profiles.person(ticket.tenantId);
    await notifications.send(
      quote.tradieId,
      'tradie.offer_times',
      {
        trade: job.trade,
        propertyAddress: property.address,
        quoteLink: `${settings.baseUrl}/q/${request.token}`,
        length: await approvedVisitLength(jobId),
        availability: tenant.availability ?? 'any_time',
      },
      { issueId: ticket.issueId },
    );
    await rememberOfferAsked(jobId, ticket.id);
  }

  worker.on<{ jobId: number }>('scheduling.remind_tradie_offer', async ({ jobId }) => {
    if (!(await tradieStillToOffer(jobId))) return;
    const job = await tickets.job(jobId);
    const quote = await modules.quotes.approvedQuote(jobId);
    if (!quote) return;
    const request = await one<{ token: string }>(db, 'SELECT token FROM quote_requests WHERE job_id = ? AND tradie_id = ?', jobId, quote.tradieId);
    if (!request) return;
    const ticket = await tickets.ticket(job.ticketId);
    const property = await profiles.property(ticket.propertyId);
    const tenant = await profiles.person(ticket.tenantId);
    await notifications.send(
      quote.tradieId,
      'tradie.offer_times_reminder',
      {
        trade: job.trade,
        propertyAddress: property.address,
        quoteLink: `${settings.baseUrl}/q/${request.token}`,
        length: await approvedVisitLength(jobId),
        availability: tenant.availability ?? 'any_time',
      },
      { issueId: ticket.issueId },
    );
  });

  /**
   * Sends the visit's current email again. Queued as a task so it can run without a
   * Property Manager session. A cancelled or completed visit is left alone.
   */
  worker.on<{ workOrderId: number; to: 'tenant' | 'tradie' }>('scheduling.resend_visit_emails', async ({ workOrderId, to }) => {
    const row = await workOrderRow(workOrderId);
    if (!row || row.status !== 'active') return;
    if (to === 'tenant') {
      await tellTenantVisitTime(row, await visitWasMoved(row));
      return;
    }
    if (to !== 'tradie') return;
    if (row.kind === 'inspection') await tellTradieInspection(row);
    else await tellTradieWorkOrder(row);
  });

  worker.on<{ offerId: number }>('scheduling.remind_tenant_pick', async ({ offerId }) => {
    const row = await one<VisitOfferRow>(db, 'SELECT * FROM visit_offers WHERE id = ?', offerId);
    if (row?.status !== 'offered') return;
    const ticket = await tickets.ticket(row.ticket_id);
    await notifications.send(ticket.tenantId, 'tenant.pick_visit_time_reminder', { choices: await choiceLinks(row) }, { issueId: ticket.issueId });
  });

  return {
    isFree,
    doneJob,
    askForVisitTimes,
    offeredVisit,
    declinedNote,
    offerVisitTimes,
    visitOffer,
    visitConfirmation,
    visitOfferIssue,

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
    async sendWorkOrder(
      agencyId: number,
      jobId: number,
      options: { start?: string; durationMinutes?: number; visitConfirmed?: boolean; anotherTimeLink?: string; keepOffer?: boolean } = {},
    ) {
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
          `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, "end", status, visit_confirmed, token) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?) RETURNING id`,
          agencyId,
          jobId,
          ticket.id,
          tradie.id,
          iso(start),
          iso(end),
          options.visitConfirmed ? 1 : 0,
          newToken(),
        );
        await tickets.setJobStatus(jobId, 'scheduled');
        await tickets.recordEvent(ticket.id, 'work_order_sent', { jobId, tradie: name, visitStart: iso(start), visitEnd: iso(end) });
        if (!options.keepOffer) {
          await run(db, `UPDATE visit_offers SET status = 'superseded', answered_at = ? WHERE job_id = ? AND status = 'offered'`, iso(clock.now()), jobId);
          // The booked visit's own page, so "Need another time?" has a link even when no offer was picked.
          const round = ((await one<{ round: number }>(db, 'SELECT round FROM visit_offers WHERE job_id = ? ORDER BY round DESC LIMIT 1', jobId))?.round ?? 0) + 1;
          await run(
            db,
            `INSERT INTO visit_offers (agency_id, job_id, ticket_id, tradie_id, round, starts, duration_minutes, status, picked_start, token, created_at, answered_at)
             VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'picked', ?, ?, ?, ?)`,
            agencyId,
            jobId,
            ticket.id,
            tradie.id,
            round,
            JSON.stringify([iso(start)]),
            durationMinutes,
            iso(start),
            newToken(),
            iso(clock.now()),
            iso(clock.now()),
          );
        }
        return id;
      });
      if (!options.keepOffer) await modules.intake.stopWaitingOnVisitOffer(ticket.tenantId);

      const row = (await workOrderRow(id))!;
      const { property } = await place(row);
      const issue = await tickets.issue(ticket.issueId);
      await tellTradieWorkOrder(row);
      if (options.visitConfirmed) {
        // The Tenant chose this time, so the visit is already confirmed: no YES to reply.
        await notifications.send(
          ticket.tenantId,
          'tenant.visit_booked',
          { visitStart: row.start, anotherTimeLink: options.anotherTimeLink ?? `${settings.baseUrl}/v/` },
          { issueId: issue.id },
        );
        await tickets.recordEvent(ticket.id, 'visit_confirmed', { jobId });
      } else {
        await tellTenantVisitTime(row, false);
      }
      await notifications.send(
        property.ownerId,
        'owner.work_booked',
        { propertyAddress: property.address, trade: job.trade, visitStart: row.start },
        { issueId: issue.id },
      );
    },

    /**
     * None of the offered times work. Saves when the Tenant is usually home and an optional
     * note, closes this offer, and asks the Tradie to offer another round. Nothing is booked.
     */
    async declineVisitTimes(token: string, input: { availability: string; note: string }) {
      const row = await offerByToken(token);
      if (!row) notFound('Visit time');
      if (row.status !== 'offered' && row.status !== 'none_fit') invalid('These times are no longer on offer');
      const availability = AVAILABILITY.find((option) => option === input.availability);
      if (!availability) invalid('Choose when you are usually home', 'availability');
      const written = input.note.trim();
      const note = written || (row.status === 'none_fit' ? (row.tenant_note ?? '') : '');
      const firstTime = row.status === 'offered';

      const ticket = await tickets.ticket(row.ticket_id);
      await modules.profiles.setAvailability(ticket.tenantId, availability);
      await run(
        db,
        `UPDATE visit_offers SET status = 'none_fit', tenant_note = ?, answered_at = ? WHERE id = ? AND status IN ('offered', 'none_fit')`,
        note || null,
        iso(clock.now()),
        row.id,
      );
      if (firstTime) await tickets.recordEvent(row.ticket_id, 'other_times_requested', { jobId: row.job_id, ...(note ? { note } : {}) });

      const job = await tickets.job(row.job_id);
      const property = await profiles.property(ticket.propertyId);
      const request = await one<{ token: string }>(db, 'SELECT token FROM quote_requests WHERE job_id = ? AND tradie_id = ?', row.job_id, row.tradie_id);
      if (!request) notFound('Quote Request');
      await notifications.send(
        row.tradie_id,
        'tradie.offer_times_again',
        {
          trade: job.trade,
          propertyAddress: property.address,
          quoteLink: `${settings.baseUrl}/q/${request.token}`,
          length: await approvedVisitLength(row.job_id),
          availability,
          note: note || null,
        },
        { issueId: ticket.issueId },
      );
    },

    /** The Tenant picks one offered time. The link only named it; this books it, or moves the visit, already confirmed. */
    async pickVisitTime(token: string, pick: string) {
      const row = await offerByToken(token);
      if (!row) notFound('Visit time');
      if (row.status !== 'offered') invalid('These times are no longer on offer');
      const starts = startsOf(row.starts);
      const index = Number(pick) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= starts.length) notFound('Visit time');
      const start = starts[index]!;
      const anotherTimeLink = `${settings.baseUrl}/v/${row.token}`;
      const repair = await one<WorkOrderRow>(db, `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'repair' AND status = 'active' ORDER BY id DESC LIMIT 1`, row.job_id);
      if (repair) {
        await this.acceptTime(row.agency_id, repair.id, start, { visitConfirmed: true, anotherTimeLink });
      } else {
        await this.sendWorkOrder(row.agency_id, row.job_id, {
          start,
          durationMinutes: row.duration_minutes,
          visitConfirmed: true,
          anotherTimeLink,
          keepOffer: true,
        });
      }
      await run(
        db,
        `UPDATE visit_offers SET status = 'picked', picked_start = ?, answered_at = ? WHERE id = ? AND status = 'offered'`,
        start,
        iso(clock.now()),
        row.id,
      );
    },

    /**
   * A reply of "1", a weekday, or "none". "none" does what the page does: the rest of the
   * reply is the Tenant's note, the Tradie is asked to offer again, and the Tenant is sent
   * the page in case they want to say when they are home. Nothing is booked.
   */
    async answerVisitOffer(offerId: number, answer: string, text: string) {
      const row = await one<VisitOfferRow>(db, 'SELECT * FROM visit_offers WHERE id = ?', offerId);
      if (!row || row.status !== 'offered') return;
      if (answer === 'none') {
        const ticket = await tickets.ticket(row.ticket_id);
        const tenant = await profiles.person(ticket.tenantId);
        await this.declineVisitTimes(row.token, { availability: tenant.availability ?? 'any_time', note: noteFromNoneReply(text) });
        await notifications.send(
          ticket.tenantId,
          'tenant.say_when_home',
          { whenHomeLink: `${settings.baseUrl}/v/${row.token}?home=1` },
          { issueId: ticket.issueId },
        );
        return;
      }
      const starts = startsOf(row.starts);
      const { timeZone } = await profiles.agency(row.agency_id);
      const index = choiceIndex(starts, answer, timeZone);
      if (index < 0) return;
      await this.pickVisitTime(row.token, String(index + 1));
    },

    /** The Property Manager asks the Tradie to offer times: a first round, or a new one for a booked visit. */
    async askTradieToOfferTimes(agencyId: number, jobId: number) {
      const job = await tickets.jobInAgency(agencyId, jobId);
      if (job.status === 'approved') {
        await askForVisitTimes(jobId);
        return;
      }
      if (job.status !== 'scheduled') invalid('Ask for visit times once a Quote is approved');
      const repair = await one<WorkOrderRow>(
        db,
        `SELECT * FROM work_orders WHERE job_id = ? AND kind = 'repair' AND status = 'active' ORDER BY id DESC LIMIT 1`,
        jobId,
      );
      if (!repair) invalid('This visit is not booked');
      // A booked visit stays booked. Flagging the reschedule is what asks the Tradie to offer new times.
      if (!repair.reschedule_requested_by) {
        await this.recordRescheduleRequest(repair.id, 'property_manager');
        return;
      }
      await askForNewTimes(repair);
    },

    async recordRescheduleRequest(workOrderId: number, by: 'tenant' | 'tradie' | 'property_manager') {
      const row = await transaction(db, async () => {
        const row = await workOrderRow(workOrderId);
        if (row?.status !== 'active') return null;
        await run(db, 'UPDATE work_orders SET reschedule_requested_by = ?, visit_confirmed = 0 WHERE id = ?', by, workOrderId);
        await tickets.recordEvent(row.ticket_id, 'reschedule_requested', { jobId: row.job_id, by, ...(row.kind === 'inspection' ? { inspection: true } : {}) });
        return row;
      });
      // A repair visit stays booked. The Tradie offers new times; a Site Inspection stays with the Property Manager.
      if (row?.kind === 'repair') await askForNewTimes(row);
    },

    async recordVisitConfirmation(workOrderId: number) {
      const row = await transaction(db, async () => {
        const row = await workOrderRow(workOrderId);
        if (row?.status !== 'active' || row.visit_confirmed) return null;
        await run(db, 'UPDATE work_orders SET visit_confirmed = 1 WHERE id = ?', workOrderId);
        await tickets.recordEvent(row.ticket_id, 'visit_confirmed', { jobId: row.job_id, ...(row.kind === 'inspection' ? { inspection: true } : {}) });
        return row;
      });
      if (!row) return;
      await modules.intake.stopWaitingOnVisit((await tickets.ticket(row.ticket_id)).tenantId, workOrderId);
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

    /** Queues the current visit email again. The worker sends it; this only schedules the task. */
    async queueVisitEmailResend(agencyId: number, workOrderId: number, to: 'tenant' | 'tradie') {
      if (to !== 'tenant' && to !== 'tradie') invalid('Choose who to resend to');
      const row = await one<WorkOrderRow>(db, 'SELECT * FROM work_orders WHERE id = ? AND agency_id = ?', workOrderId, agencyId);
      if (!row) notFound('Work Order');
      await worker.schedule('scheduling.resend_visit_emails', { workOrderId: row.id, to });
      if (to === 'tradie') {
        const tradie = await profiles.person(row.tradie_id);
        return tradie.businessName ?? tradie.name;
      }
      return (await profiles.person((await tickets.ticket(row.ticket_id)).tenantId)).name;
    },

    /** The Tenant confirms a visit from its link. Already confirmed, or no longer booked, stays as it is. */
    async confirmBookedVisit(token: string) {
      const row = await workOrderByToken(token);
      if (!row) notFound('Visit');
      await this.recordVisitConfirmation(row.id);
    },

    /**
     * The Tenant asks for another time from the visit's link. A repair starts a new
     * round of offers; a Site Inspection is the existing reschedule. The visit stays booked.
     */
    async askToMoveVisit(token: string) {
      const row = await workOrderByToken(token);
      if (!row) notFound('Visit');
      if (row.status !== 'active') invalid('This visit is no longer booked');
      await this.recordRescheduleRequest(row.id, 'tenant');
      await modules.intake.stopWaitingOnVisit((await tickets.ticket(row.ticket_id)).tenantId, row.id);
    },

    /** The Tenant, from the booked visit's page, asks for another time. The visit stays booked until they pick a new one. */
    async requestAnotherTime(token: string) {
      const row = await offerByToken(token);
      if (!row) notFound('Visit time');
      const repair = await one<{ id: number }>(db, `SELECT id FROM work_orders WHERE job_id = ? AND kind = 'repair' AND status = 'active' ORDER BY id DESC LIMIT 1`, row.job_id);
      if (!repair) invalid('This visit is not booked yet');
      await this.recordRescheduleRequest(repair.id, 'tenant');
    },

    /** Moves a visit to a suggested time or any other free slot, and tells the Tradie, the Tenant and the Property Owner. */
    async acceptTime(agencyId: number, workOrderId: number, startAt: string, options: { visitConfirmed?: boolean; anotherTimeLink?: string } = {}) {
      const row = await activeWorkOrder(agencyId, workOrderId);
      const start = new Date(startAt);
      if (Number.isNaN(start.getTime())) invalid(`${startAt} is not a time`);
      if (start < clock.now()) invalid('Pick a start time in the future');
      const end = addMs(start, Date.parse(row.end) - Date.parse(row.start));
      const { job, property, tradieBusinessName, ticket } = await place(row);
      await transaction(db, async () => {
        await activeWorkOrder(agencyId, workOrderId);
        if (!(await isFree(agencyId, row.tradie_id, start, end, row.id))) throw new ActionError('conflict', `${tradieBusinessName} is already booked then`);
        await run(
          db,
          'UPDATE work_orders SET start = ?, "end" = ?, reschedule_requested_by = NULL, visit_confirmed = ? WHERE id = ?',
          iso(start),
          iso(end),
          options.visitConfirmed ? 1 : 0,
          row.id,
        );
        await tickets.recordEvent(row.ticket_id, 'visit_moved', { jobId: row.job_id, visitStart: iso(start), visitEnd: iso(end), ...(row.kind === 'inspection' ? { inspection: true } : {}) });
      });
      const moved = (await workOrderRow(row.id))!;
      await notifications.send(
        row.tradie_id,
        'tradie.visit_moved',
        { propertyAddress: property.address, visitStart: moved.start, wasStart: row.start, quoteLink: await quotePageLink(row.job_id, row.tradie_id) },
        { issueId: ticket.issueId },
      );
      if (options.visitConfirmed) {
        await notifications.send(ticket.tenantId, 'tenant.visit_booked', { visitStart: moved.start, anotherTimeLink: options.anotherTimeLink ?? `${settings.baseUrl}/v/` }, { issueId: ticket.issueId });
      } else {
        await tellTenantVisitTime(moved, true);
      }
      if (row.kind === 'repair') {
        await notifications.send(
          property.ownerId,
          'owner.work_moved',
          { propertyAddress: property.address, trade: job.trade, visitStart: moved.start },
          { issueId: ticket.issueId },
        );
      }
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
      const { job, ticket } = done;
      // A repair visit is only ever booked on an approved Quote. The Tenant hears who did what and when, never what it cost.
      const { story } = (await doneJob(job.id))!;
      await notifications.send(ticket.tenantId, 'tenant.fixed_properly', story, { issueId: ticket.issueId });
      await modules.intake.expectAnswer(ticket.tenantId, { kind: 'fix_rating', jobId: job.id });
    },

    /**
     * The visit a Tradie's email link is about, for the confirm page. Reading it changes
     * nothing. Null for an unknown Quote Request token. `visit` is null until one is booked.
     */
    async tradieVisit(token: string, kind: 'repair' | 'inspection') {
      const found = await visitForQuoteToken(token, kind);
      if (!found) return null;
      const agency = await profiles.agency(found.request.agency_id);
      const ticket = await tickets.ticket(found.request.ticket_id);
      const property = await profiles.property(ticket.propertyId);
      const row = found.row;
      // When it was marked done: the timeline's entry for it, since the Work Order keeps no time of its own.
      const doneKind = kind === 'inspection' ? 'inspected' : 'job_done';
      const doneAt =
        row?.status === 'done'
          ? ((await tickets.timeline(row.ticket_id)).findLast((e) => e.kind === doneKind && (e as { jobId?: number }).jobId === row.job_id)?.at ?? null)
          : null;
      return {
        agencyName: agency.name,
        timeZone: agency.timeZone,
        address: property.address,
        visit: row
          ? { start: row.start, status: row.status, started: started(row), rescheduleRequestedBy: row.reschedule_requested_by, doneAt }
          : null,
      };
    },

    /** The Mark done button. Before the visit starts this is the same answer as a DONE reply; after it, the same as marking the visit done. */
    async markTradieVisitDone(token: string, kind: 'repair' | 'inspection') {
      const found = await visitForQuoteToken(token, kind);
      if (!found?.row) notFound(kind === 'inspection' ? 'Site Inspection' : 'Visit');
      const row = found.row;
      if (row.status !== 'active') return;
      if (!started(row)) {
        await this.tellDoneTooEarly(row.id);
        return;
      }
      await this.markDone(row.id);
    },

    /** Need another time. A repair starts a new offer round; a Site Inspection is the existing reschedule. Asking twice does not send another email. */
    async tradieNeedsAnotherTime(token: string, kind: 'repair' | 'inspection') {
      const found = await visitForQuoteToken(token, kind);
      if (!found?.row) notFound(kind === 'inspection' ? 'Site Inspection' : 'Visit');
      const row = found.row;
      if (row.status !== 'active') invalid('This visit is no longer booked');
      if (row.reschedule_requested_by) return;
      await this.recordRescheduleRequest(row.id, 'tradie');
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
      const quiet = due.filter((d) => d !== null);
      const now = clock.now();
      const jobs = await all<{ id: number }>(db, `SELECT id FROM jobs WHERE agency_id = ? AND status IN ('approved', 'scheduled') ORDER BY id`, agencyId);
      const tradieWaits = await Promise.all(
        jobs.map(async ({ id }) => {
          const waiting = await tradieStillToOffer(id);
          if (!waiting || addMs(waiting.askedAt, OFFER_ALERT_MS) > now) return null;
          const ticket = await tickets.ticket(waiting.ticketId);
          if (propertyIds !== null && !propertyIds.includes(ticket.propertyId)) return null;
          const quote = await modules.quotes.approvedQuote(id);
          if (!quote) return null;
          const tradie = await profiles.person(quote.tradieId);
          return {
            kind: 'tradie_no_visit_times' as const,
            ticketId: waiting.ticketId,
            jobId: id,
            propertyAddress: (await profiles.property(ticket.propertyId)).address,
            businessName: tradie.businessName ?? tradie.name,
          };
        }),
      );
      const openOffers = await all<VisitOfferRow>(db, `SELECT * FROM visit_offers WHERE agency_id = ? AND status = 'offered' ORDER BY created_at, id`, agencyId);
      const tenantWaits = await Promise.all(
        openOffers.map(async (row) => {
          if (addMs(row.created_at, OFFER_ALERT_MS) > now) return null;
          const ticket = await tickets.ticket(row.ticket_id);
          if (propertyIds !== null && !propertyIds.includes(ticket.propertyId)) return null;
          return {
            kind: 'tenant_no_visit_pick' as const,
            ticketId: row.ticket_id,
            jobId: row.job_id,
            propertyAddress: (await profiles.property(ticket.propertyId)).address,
          };
        }),
      );
      return [...quiet, ...tradieWaits.filter((d) => d !== null), ...tenantWaits.filter((d) => d !== null)];
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
