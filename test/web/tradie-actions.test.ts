// The Tradie's confirm pages linked from their emails. Opening one changes nothing.

import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { jobView, quoteRequestFor, quoteToken, tomsTapTicket, visitStarted, confirmedQuotes } from '../support/world.ts';

const sydney = (local: string) => new Date(`${local}+11:00`);
const TUE_9AM = sydney('2026-10-13T09:00:00');
const TUE_10AM = sydney('2026-10-13T10:00:00');

describe('the Tradie confirm pages', () => {
  test('opening Decline this job changes nothing; posting declines the Quote Request', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    const token = await quoteToken(w, job, w.tradies.pete);
    const path = `/q/${token}/decline`;

    const opened = await w.get(path);
    expect(opened.status).toBe(200);
    expect(visible(await opened.text())).toContain('Decline this job');
    expect((await quoteRequestFor(w, job, w.tradies.pete)).status).toBe('sent');

    const posted = await w.post(path, {});
    expect(posted.status).toBe(303);
    expect((await quoteRequestFor(w, job, w.tradies.pete)).status).toBe('declined');

    const again = visible(await (await w.get(path)).text());
    expect(again).toContain('You declined this Quote Request.');
    expect(again).not.toContain('Decline this job');
  });

  test('Mark job done and Need another time change nothing until posted, and a finished job says so', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const token = await quoteToken(w, job, w.tradies.pete);

    const early = visible(await (await w.get(`/q/${token}/done`)).text());
    expect(early).toContain("so it can't be marked done yet");
    expect(await jobView(w, job)).toMatchObject({ status: 'scheduled', workOrder: { status: 'active' } });

    const asking = await w.get(`/q/${token}/another`);
    expect(asking.status).toBe(200);
    expect(visible(await asking.text())).toContain('Need another time?');
    expect((await jobView(w, job)).workOrder!.rescheduleRequestedBy).toBeNull();

    const asked = await w.post(`/q/${token}/another`, {});
    expect(asked.status).toBe(303);
    expect((await jobView(w, job)).workOrder).toMatchObject({ rescheduleRequestedBy: 'tradie', status: 'active' });
    expect(w.h.messenger.last(w.tradies.pete.address)!.template).toBe('tradie.offer_new_times');

    visitStarted(w, TUE_9AM);
    const ready = visible(await (await w.get(`/q/${token}/done`)).text());
    expect(ready).toContain('Mark job done');
    const done = await w.post(`/q/${token}/done`, {});
    expect(done.status).toBe(303);
    expect(await jobView(w, job)).toMatchObject({ status: 'done', workOrder: { status: 'done' } });
    const after = visible(await (await w.get(`/q/${token}/done`)).text());
    expect(after).toContain('Already marked done on Tue 13 Oct, 9:00 am.');
    expect(after).not.toContain('Mark job done');
  });

  test('Mark inspection done records the visit once it has started, and opening the page does not', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    await w.h.app.submitEstimate(await quoteToken(w, job, w.tradies.dana), { priceCents: 300_00, needsInspection: true });
    await w.alice.bookInspection((await quoteRequestFor(w, job, w.tradies.dana)).quoteRequestId, { start: TUE_10AM.toISOString() });
    const token = await quoteToken(w, job, w.tradies.dana);

    expect(visible(await (await w.get(`/q/${token}/inspection-done`)).text())).toContain("so it can't be marked done yet");
    expect((await quoteRequestFor(w, job, w.tradies.dana)).inspection).toMatchObject({ status: 'active' });

    visitStarted(w, TUE_10AM);
    const posted = await w.post(`/q/${token}/inspection-done`, {});
    expect(posted.status).toBe(303);
    expect(await quoteRequestFor(w, job, w.tradies.dana)).toMatchObject({ status: 'inspected', inspection: { status: 'done' } });
    expect(visible(await (await w.get(`/q/${token}/inspection-done`)).text())).toContain('Already marked done on Tue 13 Oct, 10:00 am.');
  });
});
