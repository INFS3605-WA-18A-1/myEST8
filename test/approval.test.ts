import { describe, expect, test } from 'vitest';
import { HOUR } from './support/harness.ts';
import { confirmedQuotes, jobView, KING_ST, OLIVIA, OLIVIA_EMAIL, tomsTapTicket, world, type JobRef, type World } from './support/world.ts';

/** Olivia, the Property Owner, replies to the approval request waiting on her. */
async function oliviaReplies(w: World, job: JobRef, text: string, answer: 'yes' | 'no') {
  const { approval } = await jobView(w, job);
  w.h.classifier.when(text, { replyType: 'approval_answer', answer, relatedItem: `approval:${approval!.approvalId}` });
  await w.h.receive(OLIVIA, text);
}

describe('Property Owner approval', () => {
  test('a Quote that keeps the Repair Cost within the Max Repair Cost is approved straight away', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.finn, 300_00],
      [tradies.pete, 420_00],
    ]);

    await alice.chooseQuote(quote!.quoteId);

    expect(await jobView(w, job)).toMatchObject({ status: 'approved', approval: null });
    expect(h.messenger.to(OLIVIA)).toEqual([]);
    expect((await alice.ticket(job.ticketId)).repairCostCents).toBe(300_00);
  });

  test('a Quote over the Max Repair Cost needs the Property Owner, who approves by replying YES', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);

    await alice.chooseQuote(quote!.quoteId);

    expect(h.messenger.to(OLIVIA)).toMatchObject([
      {
        channel: 'sms',
        template: 'owner.approval_request',
        data: {
          propertyAddress: KING_ST,
          trade: 'plumbing',
          tradieBusinessName: 'Drip Doctors',
          quotePriceCents: 650_00,
          repairCostCents: 650_00,
          maxRepairCostCents: 500_00,
        },
      },
    ]);
    expect(await jobView(w, job)).toMatchObject({ status: 'awaiting_owner', approval: { status: 'requested' } });
    expect(h.messenger.templatesTo(tradies.pete.address)).toEqual(['tradie.quote_request']);

    await oliviaReplies(w, job, 'YES go ahead', 'yes');

    expect(await jobView(w, job)).toMatchObject({ status: 'approved', approval: { status: 'approved' } });
    expect(h.messenger.last(tradies.pete.address)!.template).toBe('tradie.not_chosen');
    expect((await alice.ticket(job.ticketId)).repairCostCents).toBe(650_00);
  });

  test('when the Property Owner replies NO, the Property Manager can choose another Quote', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [expensive, cheaper] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 480_00],
    ]);
    await alice.chooseQuote(expensive!.quoteId);

    await oliviaReplies(w, job, 'No, too much', 'no');

    expect(await jobView(w, job)).toMatchObject({
      status: 'quoting',
      approval: { status: 'declined' },
      quotes: [{ status: 'declined_by_owner' }, { status: 'open' }],
    });
    await expect(alice.chooseQuote(expensive!.quoteId)).rejects.toThrow(/no longer/);

    await alice.chooseQuote(cheaper!.quoteId);

    expect(await jobView(w, job)).toMatchObject({ status: 'approved', quotes: [{ status: 'declined_by_owner' }, { status: 'approved' }] });
    expect(h.messenger.templatesTo(OLIVIA)).toEqual(['owner.approval_request']);
    expect(h.messenger.last(tradies.dana.address)!.template).toBe('tradie.not_chosen');
  });

  test('the Property Owner is reminded after 24 hours and the Property Manager alerted after 48', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.chooseQuote(quote!.quoteId);

    await h.advance(24 * HOUR);
    expect(h.messenger.templatesTo(OLIVIA)).toEqual(['owner.approval_request', 'owner.approval_reminder']);
    expect((await alice.dashboard()).alerts).toEqual([]);

    await h.advance(24 * HOUR);
    expect(h.messenger.templatesTo(OLIVIA)).toEqual(['owner.approval_request', 'owner.approval_reminder']);
    expect((await alice.dashboard()).alerts).toMatchObject([
      { kind: 'owner_no_reply', ticketId: job.ticketId, jobId: job.jobId, ownerName: 'Olivia Owens', ownerPhone: OLIVIA },
    ]);

    await oliviaReplies(w, job, 'Yes sorry for the delay', 'yes');
    expect((await alice.dashboard()).alerts).toEqual([]);
  });

  test('Quotes already approved stay approved when a later Quote on the Ticket needs the Property Owner', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const plumbing = await tomsTapTicket(w);
    const [plumber] = await confirmedQuotes(w, plumbing, [
      [tradies.finn, 300_00],
      [tradies.pete, 420_00],
    ]);
    await alice.chooseQuote(plumber!.quoteId);

    const electrical = { ticketId: plumbing.ticketId, jobId: await alice.addJob(plumbing.ticketId, 'electrical') };
    const [electrician] = await confirmedQuotes(w, electrical, [[tradies.sam, 400_00]]);
    await alice.chooseQuote(electrician!.quoteId, 'Only electrician who services Newtown');

    expect(h.messenger.last(OLIVIA)).toMatchObject({
      template: 'owner.approval_request',
      data: { quotePriceCents: 400_00, repairCostCents: 700_00, maxRepairCostCents: 500_00 },
    });

    await oliviaReplies(w, electrical, 'NO', 'no');

    const ticket = await alice.ticket(plumbing.ticketId);
    expect(ticket.jobs.map((j) => [j.trade, j.status])).toEqual([
      ['plumbing', 'approved'],
      ['electrical', 'quoting'],
    ]);
    expect(ticket.repairCostCents).toBe(300_00);
    expect(h.messenger.to(OLIVIA_EMAIL)).toEqual([]);
  });
});
