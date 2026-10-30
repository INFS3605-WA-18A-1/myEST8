import { beforeAll, describe, expect, test } from 'vitest';
import { createDemo, type Demo } from '../../src/demo/runtime.ts';
import { closeAfter, demoEnv } from '../support/db.ts';
import { DEMO_TIME_ZONE } from '../../src/demo/seed.ts';
import { wallClock } from '../../src/zoned-time.ts';

const TOM = '+61400000001';

/**
 * The demo as `npm run demo` starts it: the stories played over the last ten
 * days, ending now, so every dashboard section has something to show.
 */
describe('the demo stories', () => {
  let d: Demo;
  const errors: Error[] = [];

  beforeAll(async () => {
    d = await createDemo({ stories: true, env: demoEnv(), logError: (e) => errors.push(e) });
    closeAfter(d);
  }, 180_000);

  const alice = () => d.app.asPropertyManager(d.seed.ids.aliceId);
  const dashboard = async () => (await alice()).dashboard({ filter: 'all' });

  test('play without a task error and leave the clock at the real time', () => {
    expect(errors).toEqual([]);
    expect(Math.abs(d.clock.now().getTime() - Date.now())).toBeLessThan(5_000);
    expect(d.stories).toMatchObject({ maintenanceRequests: 4, openTickets: 10, closedTickets: 5, urgentRepairs: 3, inbox: 4, alerts: 5 });
  });

  test('leave Maintenance Requests with clean photos, flagged photos, no photos, and an Urgency to check', async () => {
    const requests = (await dashboard()).maintenanceRequests;
    expect(requests.length).toBeGreaterThanOrEqual(3);
    expect(requests.some((r) => r.photos.length > 0 && r.photos.every((p) => p.metadata === 'ok'))).toBe(true);
    expect(requests.some((r) => r.photos.some((p) => p.metadata === 'flagged'))).toBe(true);
    expect(requests.some((r) => r.noPhotos)).toBe(true);
    expect(requests.some((r) => r.checkUrgency && r.urgency === 'high')).toBe(true);
  });

  test("draft a follow-up with the demo's mock composer, as a draft written from the notes", async () => {
    const [request] = (await dashboard()).maintenanceRequests;
    const { text, byAI } = await (await alice()).draftFollowUp(request!.issueId, 'Is it still leaking?');

    expect(byAI).toBe(true);
    expect(text).toBe(`Hi ${request!.tenantName},\n\nIs it still leaking?\n\nHarbour Realty`);
  });

  test('give each Property Manager their own work', async () => {
    for (const pm of [d.seed.ids.aliceId, d.seed.ids.bobId]) {
      const mine = await (await d.app.asPropertyManager(pm)).dashboard({ filter: 'mine' });
      expect(mine.maintenanceRequests.length).toBeGreaterThanOrEqual(2);
      expect(mine.tickets.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('leave open Tickets at every stage of their Jobs', async () => {
    const tickets = await Promise.all((await dashboard()).tickets.map(async (t) => (await alice()).ticket(t.ticketId)));
    const jobs = tickets.flatMap((t) => t.jobs);
    const statuses = new Set(jobs.map((j) => j.status));
    for (const status of ['quoting', 'awaiting_owner', 'approved', 'scheduled', 'done']) expect(statuses).toContain(status);

    const quoting = jobs.filter((j) => j.status === 'quoting');
    expect(quoting.some((j) => j.quotes.length >= 2 && j.quotes.every((q) => !q.confirmed))).toBe(true);
    expect(quoting.some((j) => j.quotes.filter((q) => q.confirmed).length === 1)).toBe(true);
    expect(jobs.some((j) => j.workOrder?.rescheduleRequestedBy === 'tenant')).toBe(true);
    expect(tickets.some((t) => t.jobs.length === 2)).toBe(true);
    expect(tickets.some((t) => t.unreadMessages > 0)).toBe(true);
    expect(new Set(tickets.map((t) => t.urgency))).toEqual(new Set(['high', 'routine']));
  });

  test('leave each Tradie on their own quoting path: a Site Inspection booked beside a Firm Quote, one to book, and Jobs with a chosen Firm Quote', async () => {
    const board = (await dashboard()).tickets;
    const jobs = (await Promise.all(board.map(async (t) => (await alice()).ticket(t.ticketId)))).flatMap((t) => t.jobs);
    const inspecting = jobs.filter((j) => j.status === 'quoting' && j.quoteRequests.some((r) => r.status === 'inspection_booked'));
    expect(inspecting).toHaveLength(1);
    expect(inspecting[0]!.quoteRequests.map((r) => r.status).sort()).toEqual(['firm_quoted', 'inspection_booked']);
    expect(inspecting[0]!.quoteRequests.find((r) => r.status === 'inspection_booked')!.estimate).toMatchObject({ needsInspection: true, calloutFeeCents: 90_00 });
    expect(jobs.some((j) => j.decision === 'book_inspection')).toBe(true);
    expect(jobs.some((j) => j.decision === 'choose_quote')).toBe(true);
    expect(jobs.some((j) => j.quotes.some((q) => q.stage === 'firm' && q.status === 'approved'))).toBe(true);
    const calendar = (await dashboard()).calendar.filter((b) => b.kind === 'inspection' && b.status === 'active');
    expect(calendar).toHaveLength(1);
  });

  test('raise every kind of alert, Urgent Repairs at every open state, and every kind of inbox message', async () => {
    const { alerts, urgentRepairs, inbox } = await dashboard();
    expect(new Set(alerts.map((a) => a.kind))).toEqual(new Set(['invite_more_tradies', 'owner_no_reply', 'rating_due', 'tradie_no_visit_times']));
    expect(new Set(urgentRepairs.map((u) => u.status))).toEqual(new Set(['reminder_sent', 'receipt_received', 'receipt_forwarded']));
    // One receipt waits for Alice on Approvals, so forwarding to the Property Owner can be shown from there.
    expect((await (await alice()).approvals()).reimbursements.find((r) => r.tenantName === 'Maya Morris')).toMatchObject({ status: 'receipt_received', amountCents: 340_00 });
    expect(new Set(inbox.map((i) => i.reason))).toEqual(new Set(['unknown_sender', 'other', 'low_confidence', 'common_area_no_building_manager']));
    expect(inbox.find((i) => i.reason === 'low_confidence')?.bestGuess).toBeTruthy();
  });

  test('book visits on several days for both Property Managers', async () => {
    const upcoming = (await dashboard()).calendar.filter((b) => b.status === 'active');
    const day = (iso: string) => {
      const w = wallClock(new Date(iso), DEMO_TIME_ZONE);
      return `${w.year}-${w.month}-${w.day}`;
    };
    expect(new Set(upcoming.map((b) => day(b.start))).size).toBeGreaterThanOrEqual(3);
    expect(new Set(upcoming.map((b) => b.propertyManager))).toEqual(new Set(['Alice Archer', 'Bob Baker']));
  });

  test('close older Tickets with both ratings, so Tradies and Properties have a history', async () => {
    const pete = await (await alice()).tradie(d.seed.ids.pete);
    expect(new Set(pete.ratings.map((r) => r.source))).toEqual(new Set(['tenant', 'property_manager']));
    expect(pete.previousQuotes.length).toBeGreaterThanOrEqual(2);
    const glebe = (await dashboard()).tickets.find((t) => t.propertyAddress.startsWith('21 Glebe Point Rd'))!;
    expect((await (await alice()).ticket(glebe.ticketId)).frequentIssues).toContainEqual({ trade: 'plumbing', tickets: 2 });
  });

  test('upload real images, so photos and receipts show', async () => {
    const photo = (await dashboard()).maintenanceRequests.flatMap((r) => r.photos)[0]!;
    const file = (await (await alice()).file(photo.fileId))!;
    expect(file.contentType).toBe('image/jpeg');
    expect(file.content.byteLength).toBeGreaterThan(2_000);
  });

  test('leave Tom Tran free for the walkthrough, which still starts as docs/demo.md says', async () => {
    const { maintenanceRequests, tickets, urgentRepairs, inbox } = await dashboard();
    expect([...maintenanceRequests, ...tickets, ...urgentRepairs].filter((item) => item.tenantName === 'Tom Tran')).toEqual([]);
    expect(inbox.filter((i) => i.personName === 'Tom Tran')).toEqual([]);
    expect((await d.demo.outbox(d.seed.ids.aliceId)).filter((m) => m.to === TOM)).toEqual([]);

    await d.demo.sendAs(d.seed.ids.aliceId, TOM, 'sms', 'The kitchen tap is dripping');
    const toTom = (await d.demo.outbox(d.seed.ids.aliceId)).filter((m) => m.to === TOM);
    expect(toTom.map((m) => m.template)).toEqual(['tenant.acknowledgement', 'tenant.missing_details']);
    expect(errors).toEqual([]);
  });
});
