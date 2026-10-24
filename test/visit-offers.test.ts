import { describe, expect, test } from 'vitest';
import { confirmedQuotes, jobView, KING_ST, OLIVIA, quoteToken, tomsTapTicket, world, type JobRef, type World } from './support/world.ts';

/** Olivia replies to the approval request waiting on her. */
async function oliviaReplies(w: World, job: JobRef, text: string, answer: 'yes' | 'no') {
  const { approval } = await jobView(w, job);
  w.h.classifier.when(text, { replyType: 'approval_answer', answer, relatedItem: `approval:${approval!.approvalId}` });
  await w.h.receive(OLIVIA, text);
}

describe('asking the Tradie to offer visit times', () => {
  test('approving a Quote asks the chosen Tradie to offer times on their quote page, and does not book a visit', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[tradies.pete, 150_00]]);
    h.messenger.clear();

    await alice.chooseQuote(quote!.quoteId, 'Usual plumber');

    const link = `https://myest8.test/q/${await quoteToken(w, job, tradies.pete)}`;
    const sent = h.messenger.last(tradies.pete.address);
    expect(sent).toMatchObject({
      template: 'tradie.offer_times',
      subject: 'Offer visit times',
      data: { trade: 'plumbing', propertyAddress: KING_ST, quoteLink: link },
    });
    expect(sent!.text).toContain(`Offer visit times: ${link}`);
    expect(await jobView(w, job)).toMatchObject({ status: 'approved', workOrder: null });
  });

  test("an Owner's YES asks the chosen Tradie to offer times", async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.chooseQuote(quote!.quoteId);
    h.messenger.clear();

    await oliviaReplies(w, job, 'YES go ahead', 'yes');

    expect(h.messenger.last(tradies.dana.address)).toMatchObject({
      template: 'tradie.offer_times',
      data: { propertyAddress: KING_ST, quoteLink: `https://myest8.test/q/${await quoteToken(w, job, tradies.dana)}` },
    });
    expect(h.messenger.last(tradies.pete.address)!.template).toBe('tradie.not_chosen');
    expect(await jobView(w, job)).toMatchObject({ status: 'approved', workOrder: null });
  });
});
