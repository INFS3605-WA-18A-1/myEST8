import { describe, expect, test } from 'vitest';
import { one } from '../../src/db.ts';
import { visible, webWorld } from '../support/web.ts';
import { confirmedEstimates, firmQuote, jobView, KING_ST, OLIVIA, quoteToken, TOM, tomsTapTicket } from '../support/world.ts';

const TUE_27_9AM = new Date('2026-10-27T09:00:00+11:00');

/** Pete's Firm Quote is chosen: 1 day, able to start 27 or 28 October, proposing Tuesday 9:00 am. */
async function petesOfferPage() {
  const w = await webWorld();
  const job = await tomsTapTicket(w);
  await confirmedEstimates(w, job, [
    [w.tradies.pete, 150_00],
    [w.tradies.dana, 160_00],
  ]);
  const firm = await firmQuote(w, job, w.tradies.pete, {
    priceCents: 150_00,
    proposedTime: TUE_27_9AM,
    durationDays: 1,
    availableDates: ['2026-10-27', '2026-10-28'],
  });
  await w.alice.chooseQuote(firm.quoteId, 'Usual plumber');
  const path = `/q/${await quoteToken(w, job, w.tradies.pete)}`;
  return { w, job, path };
}

describe("the Tradie's offer visit times form", () => {
  test('pre-fills the Firm Quote times and length, and shows when the Tenant is usually home', async () => {
    const { w, path } = await petesOfferPage();
    const html = await (await w.get(path)).text();
    const text = visible(html);
    expect(text).toContain('Offer visit times');
    expect(text).toContain('The visit takes 1 day.');
    expect(text).toContain('usually home weekday mornings');
    expect(text).toContain(KING_ST);
    expect(text).not.toContain('Tom');
    expect(html).toContain('value="2026-10-27T09:00"');
    expect(html).toContain('value="2026-10-28T09:00"');
  });

  test('an approved Estimate offers a 2 hour visit, prefilled from its proposed time', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [pete] = await confirmedEstimates(w, job, [
      [w.tradies.pete, 120_00, TUE_27_9AM],
      [w.tradies.dana, 140_00],
    ]);
    await w.alice.proceedOnEstimate(pete!.quoteId, { capCents: 180_00 });
    const html = await (await w.get(`/q/${await quoteToken(w, job, w.tradies.pete)}`)).text();
    expect(visible(html)).toContain('The visit takes 2 hours.');
    expect(html).toContain('value="2026-10-27T09:00"');
  });

  test('offering times emails the Tenant one line per time, plus none of these work', async () => {
    const { w, path } = await petesOfferPage();
    const body = new FormData();
    body.append('starts', '2026-10-27T09:00');
    body.append('starts', '2026-10-28T13:00');
    body.append('starts', '');
    const res = await w.web.request(`${path}/times`, { method: 'POST', body });
    await w.h.drain();

    expect(res.status).toBe(303);
    const sent = w.h.messenger.last(TOM)!;
    const token = sent.text.match(/https:\/\/myest8\.test\/v\/([^?\s]+)\?pick=1/)?.[1];
    expect(sent).toMatchObject({ template: 'tenant.choose_visit_time' });
    expect(sent.text).toContain(`Tue 27 Oct, 9:00 am: https://myest8.test/v/${token}?pick=1`);
    expect(sent.text).toContain(`Wed 28 Oct, 1:00 pm: https://myest8.test/v/${token}?pick=2`);
    expect(sent.text).toContain(`None of these work: https://myest8.test/v/${token}?pick=none`);
    const after = visible(await (await w.get(path)).text());
    expect(after).toContain('Tue 27 Oct, 9:00 am');
    expect(after).toContain('Wed 28 Oct, 1:00 pm');
    expect(after).not.toContain('Visit time 1');
  });
});

/** Offers Tuesday 9:00 am and Wednesday 1:00 pm, and returns the offer's token. */
async function offeredTimes() {
  const { w, job, path } = await petesOfferPage();
  const body = new FormData();
  body.append('starts', '2026-10-27T09:00');
  body.append('starts', '2026-10-28T13:00');
  await w.web.request(`${path}/times`, { method: 'POST', body });
  await w.h.drain();
  const token = w.h.messenger.last(TOM)!.text.match(/\/v\/([^?\s]+)\?pick=1/)![1]!;
  return { w, job, token };
}

describe('confirming a visit time', () => {
  test('opening the link does not book it, and pressing Book does, with no YES needed', async () => {
    const { w, job, token } = await offeredTimes();
    const opened = await w.get(`/v/${token}?pick=1`);
    expect(opened.status).toBe(200);
    expect(visible(await opened.text())).toContain('Book Tuesday 27 Oct, 9:00 am');
    expect(await jobView(w, job)).toMatchObject({ status: 'approved', workOrder: null });

    const posted = await w.web.request(`/v/${token}`, { method: 'POST', body: new URLSearchParams({ pick: '1' }) });
    await w.h.drain();
    expect(posted.status).toBe(303);

    expect(await jobView(w, job)).toMatchObject({
      status: 'scheduled',
      workOrder: {
        start: TUE_27_9AM.toISOString(),
        end: new Date('2026-10-28T09:00:00+11:00').toISOString(),
        visitConfirmed: true,
      },
    });
    expect(w.h.messenger.last(w.tradies.pete.address)!.template).toBe('tradie.work_order');
    expect(w.h.messenger.last(OLIVIA)!.template).toBe('owner.work_booked');
    const booked = w.h.messenger.to(TOM).findLast((m) => m.template === 'tenant.visit_booked')!;
    expect(booked.text).toContain('Booked for Tue 27 Oct, 9:00 am');
    expect(booked.text).not.toMatch(/\bYES\b/);
    expect(booked.text).toContain('Need another time?:');

    const cookie = await w.signIn();
    const ticket = visible(await (await w.get(`/tickets/${job.ticketId}`, cookie)).text());
    expect(ticket).toContain('Tue 27 Oct, 9:00 am');
    expect(ticket).toContain('Tenant confirmed');
  });

  test('opening none of these work asks when the Tenant is home, and changes nothing', async () => {
    const { w, job, token } = await offeredTimes();
    const opened = await w.get(`/v/${token}?pick=none`);
    expect(opened.status).toBe(200);
    const text = visible(await opened.text());
    expect(text).toContain('When are you usually home?');
    expect(text).toContain('Weekday mornings');
    expect(text).toContain('Weekday afternoons');
    expect(text).toContain('Saturdays');
    expect(text).toContain('Any time');
    expect(text).not.toContain('weekday mornings');
    expect(text).toContain('A time that works');
    expect(await jobView(w, job)).toMatchObject({ status: 'approved', workOrder: null });
    expect((await one<{ availability: string }>(w.h.db, 'SELECT availability FROM people WHERE mobile = ?', TOM))?.availability).toBe('weekday_mornings');
    expect((await one<{ status: string }>(w.h.db, 'SELECT status FROM visit_offers WHERE token = ?', token))?.status).toBe('offered');
  });

  test('saying when they are home asks the Tradie again, and the Ticket says the Tenant asked for other times', async () => {
    const { w, job, token } = await offeredTimes();
    const posted = await w.web.request(`/v/${token}`, {
      method: 'POST',
      body: new URLSearchParams({ pick: 'none', availability: 'saturdays', note: 'Sunday 10 am works' }),
    });
    expect(posted.status).toBe(303);
    await w.h.drain();

    const thanks = visible(await (await w.get(`/v/${token}?pick=none`)).text());
    expect(thanks).toContain("We'll ask Pete's Plumbing for other times.");
    expect(thanks).not.toContain('When are you usually home?');

    const quote = visible(await (await w.get(`/q/${await quoteToken(w, job, w.tradies.pete)}`)).text());
    expect(quote).toContain('usually home Saturdays');
    expect(quote).toContain('Sunday 10 am works');
    expect(quote).toContain('Offer visit times');

    const cookie = await w.signIn();
    const ticket = visible(await (await w.get(`/tickets/${job.ticketId}`, cookie)).text());
    expect(ticket).toContain('The Tenant asked for other times');
  });

  test('leaving when they are home blank keeps the times on offer', async () => {
    const { w, token } = await offeredTimes();
    const posted = await w.web.request(`/v/${token}`, {
      method: 'POST',
      body: new URLSearchParams({ pick: 'none', note: 'Sunday 10 am works' }),
    });
    expect(posted.status).toBe(400);
    expect(visible(await posted.text())).toContain('Choose when you are usually home');
    expect((await one<{ status: string }>(w.h.db, 'SELECT status FROM visit_offers WHERE token = ?', token))?.status).toBe('offered');
  });
});
