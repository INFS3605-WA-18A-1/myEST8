// The Tradie's confirm pages linked from their emails. Opening one changes nothing.

import { describe, expect, test } from 'vitest';
import { buttonsOn, confirmedBlock, visible, webWorld } from '../support/web.ts';
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

    const again = await (await w.get(path)).text();
    expect(confirmedBlock(again)).toBe('✓ You declined this Quote Request.');
    expect(buttonsOn(again)).toEqual([{ label: 'Decline this job', disabled: true }]);
    // The email's other button, Give your quote, opens the quote page: it shows the same.
    expect(confirmedBlock(await (await w.get(`/q/${token}`)).text())).toBe('✓ You declined this Quote Request, so it no longer takes a quote.');
    expect((await quoteRequestFor(w, job, w.tradies.pete)).status).toBe('declined');
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
    for (const link of ['done', 'another']) {
      const after = await (await w.get(`/q/${token}/${link}`)).text();
      expect(confirmedBlock(after), link).toBe('✓ Marked done on Tue 13 Oct');
      expect(buttonsOn(after), link).toEqual([
        { label: 'Mark job done', disabled: true },
        { label: 'Need another time?', disabled: true },
      ]);
    }
  });

  test('after Need another time, both links from the Work Order say so in green, and Mark job done waits for the visit', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const token = await quoteToken(w, job, w.tradies.pete);
    expect(confirmedBlock(await (await w.get(`/q/${token}/another`)).text())).toBeNull();
    await w.post(`/q/${token}/another`, {});

    for (const link of ['done', 'another']) {
      const page = await (await w.get(`/q/${token}/${link}`)).text();
      expect(confirmedBlock(page), link).toBe('✓ Asked for another time');
      expect(visible(page), link).toContain('This visit stays booked for Tue 13 Oct, 9:00 am until the Tenant picks a new one.');
      expect(buttonsOn(page), link).toEqual([
        { label: 'Mark job done', disabled: true },
        { label: 'Need another time?', disabled: true },
      ]);
    }

    // Once the visit starts, it can still be marked done.
    visitStarted(w, TUE_9AM);
    expect(buttonsOn(await (await w.get(`/q/${token}/done`)).text())).toEqual([
      { label: 'Mark job done', disabled: false },
      { label: 'Need another time?', disabled: true },
    ]);
    expect(await jobView(w, job)).toMatchObject({ workOrder: { status: 'active', rescheduleRequestedBy: 'tradie' } });
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

    // Marked done the next day: the green block names that day, not the visit's.
    visitStarted(w, sydney('2026-10-14T08:00:00'));
    const posted = await w.post(`/q/${token}/inspection-done`, {});
    expect(posted.status).toBe(303);
    expect(await quoteRequestFor(w, job, w.tradies.dana)).toMatchObject({ status: 'inspected', inspection: { status: 'done' } });
    for (const link of ['inspection-done', 'inspection-another']) {
      const page = await (await w.get(`/q/${token}/${link}`)).text();
      expect(confirmedBlock(page), link).toBe('✓ Marked done on Wed 14 Oct');
      expect(buttonsOn(page), link).toEqual([
        { label: 'Mark inspection done', disabled: true },
        { label: 'Need another time?', disabled: true },
      ]);
    }
  });
});
