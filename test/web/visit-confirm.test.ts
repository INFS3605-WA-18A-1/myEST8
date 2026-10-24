import { describe, expect, test } from 'vitest';
import { one } from '../../src/db.ts';
import { visible, webWorld } from '../support/web.ts';
import { confirmedEstimates, confirmedQuotes, jobView, quoteRequestFor, TOM, tomsTapTicket } from '../support/world.ts';

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');
const WED_2PM = new Date('2026-10-14T14:00:00+11:00');

/** Pete is booked for Tuesday 9:00 am by the Property Manager. The confirm link's token. */
async function bookedByManager() {
  const w = await webWorld();
  const job = await tomsTapTicket(w);
  const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
  await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
  await w.alice.sendWorkOrder(job.jobId);
  const token = w.h.messenger.last(TOM)!.text.match(/\/v\/confirm\/([^?\s]+)/)![1]!;
  return { w, job, token };
}

async function pendingVisit(w: Awaited<ReturnType<typeof webWorld>>) {
  const row = await one<{ awaiting: string }>(
    w.h.db,
    `SELECT awaiting FROM pending_answers WHERE person_id = (SELECT id FROM people WHERE mobile = ?) AND kind = 'visit'`,
    TOM,
  );
  return row ? (JSON.parse(row.awaiting) as { kind: string }) : null;
}

describe('resend buttons on the Ticket', () => {
  test('Resend to Tenant and Resend to Tradie queue the current visit email', async () => {
    const { w, job } = await bookedByManager();
    const workOrderId = (await jobView(w, job)).workOrder!.workOrderId;
    const cookie = await w.signIn();
    const page = visible(await (await w.get(`/tickets/${job.ticketId}`, cookie)).text());
    expect(page).toContain('Resend to Tenant');
    expect(page).toContain('Resend to Tradie');
    w.h.messenger.clear();

    const tenant = await w.post(`/tickets/${job.ticketId}/work-orders/${workOrderId}/resend`, { to: 'tenant' }, cookie);
    expect(tenant.status).toBe(303);
    expect(new URL(tenant.headers.get('location')!, 'https://myest8.test').searchParams.get('ok')).toBe('Visit email queued for Tom Tran');
    expect(w.h.messenger.last(TOM)!.text).toContain('Confirm this time:');
    const task = await one<{ payload: string; status: string }>(
      w.h.db,
      `SELECT payload, status FROM tasks WHERE kind = 'scheduling.resend_visit_emails' ORDER BY id DESC LIMIT 1`,
    );
    expect(JSON.parse(task!.payload)).toEqual({ workOrderId, to: 'tenant' });
    expect(task!.status).toBe('done');

    w.h.messenger.clear();
    const tradie = await w.post(`/tickets/${job.ticketId}/work-orders/${workOrderId}/resend`, { to: 'tradie' }, cookie);
    expect(new URL(tradie.headers.get('location')!, 'https://myest8.test').searchParams.get('ok')).toBe("Visit email queued for Pete's Plumbing");
    expect(w.h.messenger.last(w.tradies.pete.address)!.template).toBe('tradie.work_order');
  });

  test("a Site Inspection's resend buttons queue its emails", async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await confirmedEstimates(w, job, [
      [w.tradies.pete, 150_00],
      [w.tradies.dana, 160_00],
    ]);
    const request = await quoteRequestFor(w, job, w.tradies.dana);
    await w.alice.bookInspection(request.quoteRequestId, { start: TUE_9AM.toISOString() });
    const workOrderId = (await quoteRequestFor(w, job, w.tradies.dana)).inspection!.workOrderId;
    const cookie = await w.signIn();
    const page = visible(await (await w.get(`/tickets/${job.ticketId}`, cookie)).text());
    expect(page).toContain('Resend to Tenant');
    expect(page).toContain('Resend to Tradie');
    w.h.messenger.clear();

    const tenant = await w.post(`/tickets/${job.ticketId}/work-orders/${workOrderId}/resend`, { to: 'tenant' }, cookie);
    expect(new URL(tenant.headers.get('location')!, 'https://myest8.test').searchParams.get('ok')).toBe('Visit email queued for Tom Tran');
    expect(w.h.messenger.last(TOM)!.template).toBe('tenant.inspection');
    expect(w.h.messenger.last(TOM)!.text).toContain('Need another time?:');

    w.h.messenger.clear();
    const tradie = await w.post(`/tickets/${job.ticketId}/work-orders/${workOrderId}/resend`, { to: 'tradie' }, cookie);
    expect(new URL(tradie.headers.get('location')!, 'https://myest8.test').searchParams.get('ok')).toBe('Visit email queued for Drip Doctors');
    expect(w.h.messenger.last(w.tradies.dana.address)!.template).toBe('tradie.inspection');
  });
});

describe('the visit confirm page', () => {
  test('opening the link changes nothing, and pressing Confirm records it', async () => {
    const { w, job, token } = await bookedByManager();
    const opened = await w.get(`/v/confirm/${token}`);
    expect(opened.status).toBe(200);
    expect(visible(await opened.text())).toContain('Confirm Tuesday 13 Oct, 9:00 am');
    expect(await jobView(w, job)).toMatchObject({ workOrder: { visitConfirmed: false, start: TUE_9AM.toISOString() } });
    expect(await pendingVisit(w)).toMatchObject({ kind: 'visit' });

    const posted = await w.web.request(`/v/confirm/${token}`, { method: 'POST', body: new URLSearchParams({ action: 'confirm' }) });
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(`/v/confirm/${token}?confirmed=1`);

    const after = visible(await (await w.get(`/v/confirm/${token}`)).text());
    expect(after).toContain('Confirmed');
    expect(after).not.toContain('Confirm Tuesday 13 Oct, 9:00 am');
    expect(await jobView(w, job)).toMatchObject({ workOrder: { visitConfirmed: true } });
    expect(await pendingVisit(w)).toBeNull();
  });

  test('a moved visit and an already-confirmed visit show the current state', async () => {
    const { w, job, token } = await bookedByManager();
    const { workOrder } = await jobView(w, job);
    await w.alice.acceptTime(workOrder!.workOrderId, WED_2PM.toISOString());

    const moved = visible(await (await w.get(`/v/confirm/${token}`)).text());
    expect(moved).toContain('Confirm Wednesday 14 Oct, 2:00 pm');
    expect(moved).not.toContain('Tuesday 13 Oct');
    expect(await jobView(w, job)).toMatchObject({ workOrder: { visitConfirmed: false, start: WED_2PM.toISOString() } });

    await w.web.request(`/v/confirm/${token}`, { method: 'POST', body: new URLSearchParams({ action: 'confirm' }) });
    const confirmed = visible(await (await w.get(`/v/confirm/${token}`)).text());
    expect(confirmed).toContain('Confirmed');
    expect(confirmed).toContain('Wednesday 14 Oct, 2:00 pm');
    expect(confirmed).not.toContain('Confirm Wednesday 14 Oct, 2:00 pm');
  });
});
