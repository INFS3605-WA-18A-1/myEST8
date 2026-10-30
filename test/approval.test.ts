import { format } from 'node:util';
import { describe, expect, test, vi } from 'vitest';
import { all, one } from '../src/db.ts';
import { ProviderRefusedError } from '../src/ports.ts';
import { AGENCY_NUMBER, HOUR, type Harness } from './support/harness.ts';
import { confirmedEstimates, confirmedQuotes, jobView, KING_ST, OLIVIA, OLIVIA_EMAIL, tomsTapTicket, world, type JobRef, type World } from './support/world.ts';

/** Makes every message to `address` throw `error` until `failing.on` is set to false. */
function failSendsTo(h: Harness, address: string, error: Error) {
  const failing = { on: true };
  const send = h.messenger.send.bind(h.messenger);
  h.messenger.send = async (message) => {
    if (failing.on && message.to === address) throw error;
    return send(message);
  };
  return failing;
}

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
      quotes: [{ stage: 'estimate', status: 'superseded' }, { stage: 'estimate', status: 'superseded' }, { status: 'declined_by_owner' }, { status: 'open' }],
    });
    await expect(alice.chooseQuote(expensive!.quoteId)).rejects.toThrow(/no longer/);

    await alice.chooseQuote(cheaper!.quoteId);

    expect(await jobView(w, job)).toMatchObject({ status: 'approved', quotes: [{}, {}, { status: 'declined_by_owner' }, { status: 'approved' }] });
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

  test('an Owner who cannot be reached is refused, and the Quote, the Job and the approval are left unsaved', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.disconnectServerSms(AGENCY_NUMBER);
    await alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: OLIVIA });
    const asked = h.messenger.sent.length;

    await expect(alice.chooseQuote(quote!.quoteId)).rejects.toThrow(
      "Olivia Owens can't be reached: no SMS channel is connected and they have no email address.",
    );

    expect(await jobView(w, job)).toMatchObject({
      status: 'quoting',
      approval: null,
      quotes: expect.arrayContaining([expect.objectContaining({ quoteId: quote!.quoteId, status: 'open' })]),
    });
    expect(await all(h.db, 'SELECT id FROM approvals')).toEqual([]);
    expect(h.messenger.sent).toHaveLength(asked);
    expect((await alice.ticket(job.ticketId)).timeline.map((e) => e.kind)).not.toContain('approval_requested');
  });

  test('a refused email keeps the approval, schedules the reminder, and warns the Property Manager', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.disconnectServerSms(AGENCY_NUMBER);
    failSendsTo(h, OLIVIA_EMAIL, new ProviderRefusedError('Resend 429', 'the email provider is limiting how many emails go out'));

    const warning = await alice.chooseQuote(quote!.quoteId);

    expect(warning).toBe(
      "Sent to the Property Owner for approval, but the email to Olivia Owens didn't go: the email provider is limiting how many emails go out. Use Resend approval request.",
    );
    const view = await jobView(w, job);
    expect(view).toMatchObject({ status: 'awaiting_owner', approval: { status: 'requested' } });
    expect(h.messenger.to(OLIVIA_EMAIL)).toEqual([]);
    expect(await one<{ status: string; payload: string }>(h.db, `SELECT status, payload FROM tasks WHERE kind = 'quotes.owner_reminder'`)).toEqual({
      status: 'pending',
      payload: JSON.stringify({ approvalId: view.approval!.approvalId }),
    });
  });

  test('an outage sending the approval request is logged, and the approval and its reminder still stand', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.disconnectServerSms(AGENCY_NUMBER);
    const error = new Error('socket hang up');
    failSendsTo(h, OLIVIA_EMAIL, error);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const warning = await alice.chooseQuote(quote!.quoteId);
    const output = logged.mock.calls.map((call) => format(...call));
    logged.mockRestore();

    expect(warning).toBe(
      "Sent to the Property Owner for approval, but the email to Olivia Owens didn't go: the message couldn't be sent. Use Resend approval request.",
    );
    expect(await jobView(w, job)).toMatchObject({ status: 'awaiting_owner', approval: { status: 'requested' } });
    expect(output).toHaveLength(1);
    expect(output[0]).toContain(error.stack);
    expect(await one<{ status: string }>(h.db, `SELECT status FROM tasks WHERE kind = 'quotes.owner_reminder'`)).toEqual({ status: 'pending' });
  });

  test('resending sends the same approval request again, logs it, and leaves the status', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.chooseQuote(quote!.quoteId);
    const approval = (await jobView(w, job)).approval!;
    const pending = await all<{ id: number }>(h.db, `SELECT id FROM tasks WHERE kind = 'quotes.owner_reminder' AND status = 'pending'`);

    await alice.resendApprovalRequest(approval.approvalId);

    const [first, again] = h.messenger.to(OLIVIA);
    expect(again).toMatchObject({
      channel: 'sms',
      template: 'owner.approval_request',
      text: first!.text,
      data: {
        propertyAddress: KING_ST,
        trade: 'plumbing',
        tradieBusinessName: 'Drip Doctors',
        quotePriceCents: 650_00,
        repairCostCents: 650_00,
        maxRepairCostCents: 500_00,
      },
    });
    expect(await jobView(w, job)).toMatchObject({ status: 'awaiting_owner', approval: { status: 'requested' } });
    expect((await alice.ticket(job.ticketId)).messages.filter((m) => m.address === OLIVIA).map((m) => m.template)).toEqual([
      'owner.approval_request',
      'owner.approval_request',
    ]);
    expect(await all<{ id: number }>(h.db, `SELECT id FROM tasks WHERE kind = 'quotes.owner_reminder' AND status = 'pending'`)).toEqual(pending);
  });

  test('resending after the reminder schedules another, and the reminded status stays', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.chooseQuote(quote!.quoteId);
    await h.advance(24 * HOUR);
    const approval = (await jobView(w, job)).approval!;
    expect(approval.status).toBe('reminded');
    expect(await all(h.db, `SELECT id FROM tasks WHERE kind = 'quotes.owner_reminder' AND status = 'pending'`)).toEqual([]);

    await alice.resendApprovalRequest(approval.approvalId);

    expect(await jobView(w, job)).toMatchObject({ approval: { status: 'reminded' } });
    expect(h.messenger.templatesTo(OLIVIA)).toEqual(['owner.approval_request', 'owner.approval_reminder', 'owner.approval_request']);
    const scheduled = await one<{ payload: string }>(h.db, `SELECT payload FROM tasks WHERE kind = 'quotes.owner_reminder' AND status = 'pending'`);
    expect(scheduled).toEqual({ payload: JSON.stringify({ approvalId: approval.approvalId }) });
  });

  test('resending is refused once the Property Owner has answered, and sends nothing', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.chooseQuote(quote!.quoteId);
    await oliviaReplies(w, job, 'YES go ahead', 'yes');
    const approvalId = (await jobView(w, job)).approval!.approvalId;
    const asked = h.messenger.sent.length;

    await expect(alice.resendApprovalRequest(approvalId)).rejects.toThrow('This approval has already been answered');

    expect(h.messenger.sent).toHaveLength(asked);
    expect(await jobView(w, job)).toMatchObject({ approval: { status: 'approved' } });
  });

  test("resending is not found for another Agency's approval", async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [tradies.dana, 650_00],
      [tradies.pete, 700_00],
    ]);
    await alice.chooseQuote(quote!.quoteId);
    const approvalId = (await jobView(w, job)).approval!.approvalId;
    const other = await h.app.setup.createAgency({ name: 'Other Realty', timeZone: 'Australia/Sydney' });
    const olga = h.as(await h.app.setup.addPropertyManager(other, { name: 'Olga Other', email: 'olga@other.example', password: 'other-password' }));
    const asked = h.messenger.sent.length;

    await expect(olga.resendApprovalRequest(approvalId)).rejects.toThrow(/not found/);

    expect(h.messenger.sent).toHaveLength(asked);
  });
});
