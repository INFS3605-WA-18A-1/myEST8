import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { confirmedEstimates, firmQuote, KING_ST, quoteToken, TOM, tomsTapTicket } from '../support/world.ts';

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
