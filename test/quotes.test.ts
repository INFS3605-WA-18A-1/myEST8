import { format } from 'node:util';
import { describe, expect, test, vi } from 'vitest';
import { ProviderRefusedError, UndeliverableError } from '../src/ports.ts';
import { AGENCY_NUMBER, HOUR, type Harness } from './support/harness.ts';
import { upload } from './support/photos.ts';
import { confirmedEstimates, confirmedQuotes, firmQuote, jobView, KING_ST, quoteRequestFor, quoteToken, TOM, tomsTapTicket, tradieQuotes, world } from './support/world.ts';

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

describe('recommending Tradies', () => {
  test('only Tradies with the Trade are recommended, by myEST8 rating, then Google rating, then median Firm Quote, with both ratings shown', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await tomsTapTicket(w);

    // Nina and Quick Pipes tie on both ratings, so their Quotes decide.
    await alice.sendQuoteRequests(job.jobId, [tradies.nina.id, tradies.quick.id]);
    await tradieQuotes(w, job, tradies.nina, '$180 Tuesday', { priceCents: 180_00 });
    await tradieQuotes(w, job, tradies.quick, '$260 Wednesday', { priceCents: 260_00 });
    for (const quote of (await jobView(w, job)).quotes) await alice.confirmQuote(quote.quoteId);
    // Only Firm Quotes make the median: an Estimate is never compared with one.
    expect((await jobView(w, job)).recommendations.find((r) => r.businessName === 'Quick Pipes')).toMatchObject({ medianQuoteCents: null });
    await firmQuote(w, job, tradies.nina, { priceCents: 180_00 });
    await firmQuote(w, job, tradies.quick, { priceCents: 260_00 });

    const { recommendations } = await jobView(w, job);
    // The Property's Nominated Tradie (Nina) leads, then myEST8 rating, Google rating, median Firm Quote; four at most.
    expect(recommendations.map((r) => r.businessName)).toEqual(["Nina's Plumbing", 'Drip Doctors', "Pete's Plumbing", 'Quick Pipes']);
    expect(recommendations).toMatchObject([
      { nominated: true, requested: true, preselected: false, googleRating: { rating: 4.2 }, previousQuotes: [{ priceCents: 180_00 }], medianQuoteCents: 180_00 },
      { nominated: false, myEst8Rating: { average: 5, count: 1 }, googleRating: null, medianQuoteCents: null, requested: false, preselected: true },
      { myEst8Rating: { average: 4, count: 1 }, googleRating: { rating: 4.8, reviewCount: 120 }, medianQuoteCents: null, preselected: true },
      { googleRating: { rating: 4.2 }, previousQuotes: [{ priceCents: 260_00 }], medianQuoteCents: 260_00, requested: true },
    ]);
  });
});

describe('at least two Tradies', () => {
  test('recommend returns four at most, Nominated first, with the first three preselected', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const { recommendations } = await jobView(w, job);
    expect(recommendations).toHaveLength(4);
    expect(recommendations[0]).toMatchObject({ businessName: "Nina's Plumbing", nominated: true, preselected: true });
    expect(recommendations.map((r) => r.preselected)).toEqual([true, true, true, false]);
    expect(recommendations.slice(1).every((r) => !r.nominated)).toBe(true);
  });

  test('one Tradie is refused while two are available, with the reason in words', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await tomsTapTicket(w);
    expect((await jobView(w, job)).requestRule).toMatchObject({ minimum: 2, singleReason: null });
    await expect(alice.sendQuoteRequests(job.jobId, [tradies.pete.id])).rejects.toThrow('Send Quote Requests to at least two Tradies');
    expect(await w.alice.ticket(job.ticketId).then((t) => t.jobs[0]!.quoteRequests)).toEqual([]);
  });

  test('a second round may add a single Tradie, since Requests already sent count', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.dana.id]);
    expect((await jobView(w, job)).requestRule).toMatchObject({ minimum: 1 });
    await alice.sendQuoteRequests(job.jobId, [tradies.finn.id]);
    expect((await jobView(w, job)).quoteRequests).toHaveLength(3);
  });

  test('one Tradie is allowed when the Agency has only one for the Trade', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const ticket = await tomsTapTicket(w);
    const sparky = await alice.addJob(ticket.ticketId, 'electrical');
    const view = (await alice.ticket(ticket.ticketId)).jobs.find((j) => j.jobId === sparky)!;
    expect(view.requestRule).toMatchObject({ minimum: 1, singleReason: expect.stringContaining('only one electrical Tradie') });

    await alice.sendQuoteRequests(sparky, [tradies.sam.id]);

    expect((await alice.ticket(ticket.ticketId)).jobs.find((j) => j.jobId === sparky)!.quoteRequests).toHaveLength(1);
  });
});

describe('Quote Requests', () => {
  test('describe the issue and suburb, and never give the address or the Tenant', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);

    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id, tradies.dana.id]);

    expect(h.messenger.to(tradies.pete.address)).toMatchObject([
      {
        channel: 'sms',
        template: 'tradie.quote_request',
        // The Summary stands in for the description once the summariser has run.
        data: { trade: 'plumbing', urgency: 'routine', description: expect.stringContaining('The kitchen tap is dripping'), suburb: 'Newtown' },
      },
    ]);
    expect(h.messenger.to(tradies.quick.address)).toMatchObject([{ channel: 'email', template: 'tradie.quote_request' }]);
    for (const sent of h.messenger.sent.filter((m) => m.template === 'tradie.quote_request')) {
      expect(sent.text).not.toContain('King St');
      expect(sent.text).not.toContain(TOM);
      expect(sent.text).not.toContain('Tom');
    }
    expect((await alice.ticket(job.ticketId)).timeline.map((e) => e.kind)).toContain('quote_requests_sent');
    await expect(alice.sendQuoteRequests(job.jobId, [tradies.sam.id])).rejects.toThrow(/plumbing/);
    await expect(alice.sendQuoteRequests(job.jobId, [tradies.pete.id])).rejects.toThrow(/already/);
  });

  test('with no SMS channel connected, go to the Tradies with email, and the ones that cannot be reached are named', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.disconnectServerSms(AGENCY_NUMBER);

    const result = await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id]);

    expect(result).toEqual({
      sent: 1,
      unreached: [{ tradie: "Pete's Plumbing", reason: 'no SMS channel is connected and they have no email address' }],
    });
    expect(h.messenger.to(tradies.quick.address)).toMatchObject([{ channel: 'email', template: 'tradie.quote_request' }]);
    expect(h.messenger.to(tradies.pete.address)).toEqual([]);
    expect((await jobView(w, job)).quoteRequests.map((r) => r.tradieId)).toEqual([tradies.quick.id]);
  });

  test('with no SMS channel connected, are refused when no Tradie can be reached, and nothing is recorded', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.disconnectServerSms(AGENCY_NUMBER);
    const asked = h.messenger.sent.length;

    await expect(alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.dana.id])).rejects.toThrow(
      "No Quote Requests were sent. Couldn't reach Pete's Plumbing: no SMS channel is connected and they have no email address; Drip Doctors: no SMS channel is connected and they have no email address",
    );

    expect((await jobView(w, job)).quoteRequests).toEqual([]);
    expect(h.messenger.sent).toHaveLength(asked);
  });

  test('a Tradie whose message the provider refuses has no Quote Request, and the others are still sent theirs', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    failSendsTo(h, tradies.pete.address, new ProviderRefusedError('Twilio 21608: trial account', 'a Twilio trial account can only text verified numbers'));

    const result = await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id]);

    expect(result).toEqual({
      sent: 1,
      unreached: [{ tradie: "Pete's Plumbing", reason: 'a Twilio trial account can only text verified numbers' }],
    });
    expect((await jobView(w, job)).quoteRequests.map((r) => r.tradieId)).toEqual([tradies.quick.id]);
    expect(h.messenger.to(tradies.quick.address)).toMatchObject([{ channel: 'email', template: 'tradie.quote_request' }]);
    expect(h.messenger.to(tradies.pete.address)).toEqual([]);
    // The Ticket's timeline says only who was really asked.
    expect((await alice.ticket(job.ticketId)).timeline).toContainEqual(expect.objectContaining({ kind: 'quote_requests_sent', tradies: ['Quick Pipes'] }));
  });

  test('are refused when every message fails, and nothing is recorded', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    failSendsTo(h, tradies.pete.address, new UndeliverableError('sms', tradies.pete.address, 'Twilio 21614: not a mobile'));
    failSendsTo(h, tradies.quick.address, new ProviderRefusedError('Resend 429', 'the email provider is limiting how many emails go out'));

    await expect(alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id])).rejects.toThrow(
      "No Quote Requests were sent. Couldn't reach Pete's Plumbing: that number couldn't be used; Quick Pipes: the email provider is limiting how many emails go out",
    );

    expect((await jobView(w, job)).quoteRequests).toEqual([]);
    expect((await alice.ticket(job.ticketId)).timeline.map((e) => e.kind)).not.toContain('quote_requests_sent');
  });

  test('an unexpected error is logged with its stack and the Tradie is reported, not a failure of the page', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const error = new Error('socket hang up');
    failSendsTo(h, tradies.pete.address, error);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id]);
    const output = logged.mock.calls.map((call) => format(...call));
    logged.mockRestore();

    expect(result).toEqual({ sent: 1, unreached: [{ tradie: "Pete's Plumbing", reason: "the message couldn't be sent" }] });
    expect(output).toHaveLength(1);
    expect(output[0]).toContain(error.stack);
  });

  test('a Tradie whose message failed can be asked again, without being "already asked"', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const pete = failSendsTo(h, tradies.pete.address, new UndeliverableError('sms', tradies.pete.address, 'Twilio 21614: not a mobile'));
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id]);

    pete.on = false;
    const again = await alice.sendQuoteRequests(job.jobId, [tradies.pete.id]);

    expect(again).toEqual({ sent: 1, unreached: [] });
    expect((await jobView(w, job)).quoteRequests.map((r) => r.tradieId)).toEqual([tradies.quick.id, tradies.pete.id]);
    expect(h.messenger.templatesTo(tradies.pete.address)).toEqual(['tradie.quote_request']);
  });

  test('photos are attached to Quote Requests sent by email only', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping');
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
    await h.upload(h.messenger.last(TOM)!.data.uploadLink as string, [upload('tap-1.jpg'), upload('tap-2.jpg')]);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    const ticketId = await alice.confirmMaintenanceRequest(request!.issueId);
    const [job] = (await alice.ticket(ticketId)).jobs;

    await alice.sendQuoteRequests(job!.jobId, [tradies.pete.id, tradies.quick.id]);

    expect(h.messenger.last(tradies.quick.address)!.attachments).toEqual(['tap-1.jpg', 'tap-2.jpg']);
    expect(h.messenger.last(tradies.pete.address)!.attachments).toEqual([]);
  });

  test('a Tradie who has not answered after 48 hours is reminded once, and Tradies who declined or quoted are not', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.dana.id, tradies.finn.id]);

    const dana = await quoteRequestFor(w, job, tradies.dana);
    h.classifier.when('Sorry, too busy this month', { replyType: 'decline', relatedItem: `quote_request:${dana.quoteRequestId}` });
    await h.receive(tradies.dana.address, 'Sorry, too busy this month');
    await tradieQuotes(w, job, tradies.finn, '$200, Monday 10am', { priceCents: 200_00 });
    expect((await quoteRequestFor(w, job, tradies.dana)).status).toBe('declined');

    await h.advance(47 * HOUR);
    expect(h.messenger.templatesTo(tradies.pete.address)).toEqual(['tradie.quote_request']);

    await h.advance(1 * HOUR);
    expect(h.messenger.templatesTo(tradies.pete.address)).toEqual(['tradie.quote_request', 'tradie.quote_reminder']);
    expect(h.messenger.templatesTo(tradies.dana.address)).toEqual(['tradie.quote_request']);
    expect(h.messenger.templatesTo(tradies.finn.address)).toEqual(['tradie.quote_request']);

    await h.advance(48 * HOUR);
    expect(h.messenger.templatesTo(tradies.pete.address)).toEqual(['tradie.quote_request', 'tradie.quote_reminder']);
  });

  test('the Property Manager is prompted to invite more Tradies when a Job has fewer than two confirmed Quotes after 72 hours', async () => {
    const w = await world();
    const { h, alice, bob, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.finn.id, tradies.nina.id]);
    await tradieQuotes(w, job, tradies.finn, '$200, Monday 10am', { priceCents: 200_00 });
    for (const quote of (await jobView(w, job)).quotes) await alice.confirmQuote(quote.quoteId);

    await h.advance(71 * HOUR);
    expect((await alice.dashboard()).alerts).toEqual([]);

    await h.advance(1 * HOUR);
    expect((await alice.dashboard()).alerts).toMatchObject([
      { kind: 'invite_more_tradies', ticketId: job.ticketId, jobId: job.jobId, propertyAddress: KING_ST, confirmedQuotes: 1 },
    ]);
    expect((await bob.dashboard()).alerts).toEqual([]);

    await alice.sendQuoteRequests(job.jobId, [tradies.dana.id]);
    await tradieQuotes(w, job, tradies.dana, '$240 Thursday', { priceCents: 240_00 });
    const unconfirmed = (await jobView(w, job)).quotes.find((q) => !q.confirmed)!;
    await alice.confirmQuote(unconfirmed.quoteId);
    expect((await alice.dashboard()).alerts).toEqual([]);
  });
});

describe('resending a Quote Request', () => {
  test('sends the same message with the same link again, logs it, and leaves the status as it is', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id]);
    const token = await quoteToken(w, job, tradies.pete);
    const pete = await quoteRequestFor(w, job, tradies.pete);

    await alice.resendQuoteRequest(pete.quoteRequestId);

    const [first, again] = h.messenger.to(tradies.pete.address);
    expect(again).toMatchObject({ channel: 'sms', template: 'tradie.quote_request', text: first!.text, data: first!.data });
    expect(again!.data.quoteLink).toMatch(new RegExp(`/q/${token}$`));
    expect(h.messenger.templatesTo(tradies.quick.address)).toEqual(['tradie.quote_request']);
    expect((await quoteRequestFor(w, job, tradies.pete)).status).toBe('sent');
    const logged = (await alice.ticket(job.ticketId)).messages.filter((m) => m.address === tradies.pete.address);
    expect(logged.map((m) => m.template)).toEqual(['tradie.quote_request', 'tradie.quote_request']);
  });

  test('works after the reminder too, and does not send the reminder again', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id]);
    await h.advance(48 * HOUR);
    const pete = await quoteRequestFor(w, job, tradies.pete);
    expect(pete.status).toBe('reminded');

    await alice.resendQuoteRequest(pete.quoteRequestId);

    expect(h.messenger.templatesTo(tradies.pete.address)).toEqual(['tradie.quote_request', 'tradie.quote_reminder', 'tradie.quote_request']);
    expect((await quoteRequestFor(w, job, tradies.pete)).status).toBe('reminded');
  });

  test('attaches the photos again to a Tradie reached by email', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping');
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
    await h.upload(h.messenger.last(TOM)!.data.uploadLink as string, [upload('tap-1.jpg'), upload('tap-2.jpg')]);
    const [issue] = (await alice.dashboard()).maintenanceRequests;
    const ticketId = await alice.confirmMaintenanceRequest(issue!.issueId);
    const job = { ticketId, jobId: (await alice.ticket(ticketId)).jobs[0]!.jobId };
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id]);

    await alice.resendQuoteRequest((await quoteRequestFor(w, job, tradies.quick)).quoteRequestId);

    expect(h.messenger.to(tradies.quick.address).map((m) => m.attachments)).toEqual([['tap-1.jpg', 'tap-2.jpg'], ['tap-1.jpg', 'tap-2.jpg']]);
  });

  test('is refused once the Tradie has replied, and sends nothing', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.sendQuoteRequests(job.jobId, [tradies.nina.id, tradies.pete.id]);
    await tradieQuotes(w, job, tradies.nina, '$190 Tuesday', { priceCents: 190_00 });
    const nina = await quoteRequestFor(w, job, tradies.nina);
    const asked = h.messenger.sent.length;

    await expect(alice.resendQuoteRequest(nina.quoteRequestId)).rejects.toThrow("Nina's Plumbing has already replied");

    expect(h.messenger.sent).toHaveLength(asked);
  });

  test("is not found for another Agency's Quote Request", async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.quick.id]);
    const pete = await quoteRequestFor(w, job, tradies.pete);
    const other = await h.app.setup.createAgency({ name: 'Other Realty', timeZone: 'Australia/Sydney' });
    const olga = h.as(await h.app.setup.addPropertyManager(other, { name: 'Olga Other', email: 'olga@other.example', password: 'other-password' }));
    const asked = h.messenger.sent.length;

    await expect(olga.resendQuoteRequest(pete.quoteRequestId)).rejects.toThrow(/not found/);

    expect(h.messenger.sent).toHaveLength(asked);
  });
});

describe('reading Estimates and choosing Firm Quotes', () => {
  test('an Estimate read from a reply counts only once confirmed, a wrongly read price can be corrected, and a PDF is kept', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.finn.id]);
    const monday = new Date('2026-10-12T10:00:00+11:00');
    await tradieQuotes(w, job, tradies.finn, '$200 Monday 10am', { priceCents: 200_00, proposedTime: monday });
    const pete = await quoteRequestFor(w, job, tradies.pete);
    h.classifier.when('Quote attached', { replyType: 'quote', relatedItem: `quote_request:${pete.quoteRequestId}` });
    h.quoteReader.when('Quote attached', { priceCents: 3_50 });
    await h.receive(tradies.pete.address, 'Quote attached', {
      attachments: [{ filename: 'quote.pdf', contentType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]) }],
    });

    const { quotes, quoteRequests } = await jobView(w, job);
    expect(quotes).toMatchObject([
      { stage: 'estimate', businessName: 'Flow Bros', priceCents: 200_00, proposedTime: monday.toISOString(), confirmed: false, hasPdf: false, needsInspection: false },
      { stage: 'estimate', businessName: "Pete's Plumbing", priceCents: 3_50, proposedTime: null, confirmed: false, hasPdf: true },
    ]);
    expect(quoteRequests.map((r) => r.status)).toEqual(['estimated', 'estimated']);
    await expect(alice.proceedOnEstimate(quotes[0]!.quoteId, { capCents: 250_00, reason: 'x' })).rejects.toThrow(/Confirm/);

    await alice.confirmQuote(quotes[0]!.quoteId);
    await alice.confirmQuote(quotes[1]!.quoteId, { priceCents: 350_00 });
    expect((await jobView(w, job)).quotes).toMatchObject([
      { priceCents: 200_00, confirmed: true },
      { priceCents: 350_00, confirmed: true },
    ]);
  });

  test('an Estimate is never chosen as if it were a Firm Quote', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [finn, pete] = await confirmedEstimates(w, job, [
      [tradies.finn, 200_00],
      [tradies.pete, 220_00],
    ]);

    await expect(alice.chooseQuote(finn!.quoteId)).rejects.toThrow(/An Estimate is not a Firm Quote/);
    await expect(alice.chooseQuote(pete!.quoteId, 'Usual plumber')).rejects.toThrow(/An Estimate is not a Firm Quote/);
    expect(await jobView(w, job)).toMatchObject({ status: 'quoting', decision: null });
  });

  test('a Property Manager can go ahead with a single Firm Quote by recording a reason', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[tradies.finn, 200_00]]);

    await expect(alice.chooseQuote(quote!.quoteId, '   ')).rejects.toThrow(/at least two/);
    await alice.chooseQuote(quote!.quoteId, 'Only licensed plumber free this week');

    expect(await jobView(w, job)).toMatchObject({
      status: 'approved',
      quotes: [{ stage: 'estimate', status: 'superseded' }, { stage: 'firm', status: 'approved', reason: 'Only licensed plumber free this week' }],
    });
  });

  test('once a Quote is approved, Tradies who were not chosen are told, but not those who declined', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    await alice.sendQuoteRequests(job.jobId, [tradies.pete.id, tradies.finn.id, tradies.nina.id, tradies.dana.id]);
    const dana = await quoteRequestFor(w, job, tradies.dana);
    h.classifier.when('No thanks', { replyType: 'decline', relatedItem: `quote_request:${dana.quoteRequestId}` });
    await h.receive(tradies.dana.address, 'No thanks');
    await tradieQuotes(w, job, tradies.finn, '$200 Monday', { priceCents: 200_00 });
    await tradieQuotes(w, job, tradies.nina, '$190 Tuesday', { priceCents: 190_00 });
    await firmQuote(w, job, tradies.finn, { priceCents: 210_00 });
    const nina = await firmQuote(w, job, tradies.nina, { priceCents: 195_00 });

    await alice.chooseQuote(nina.quoteId);

    expect(h.messenger.last(tradies.finn.address)).toMatchObject({ template: 'tradie.not_chosen', data: { trade: 'plumbing', suburb: 'Newtown' } });
    expect(h.messenger.last(tradies.pete.address)!.template).toBe('tradie.not_chosen');
    expect(h.messenger.templatesTo(tradies.dana.address)).toEqual(['tradie.quote_request']);
    expect(h.messenger.templatesTo(tradies.nina.address)).toEqual(['tradie.quote_request']);
    expect((await quoteRequestFor(w, job, tradies.pete)).status).toBe('closed');
    expect((await quoteRequestFor(w, job, tradies.nina)).status).toBe('firm_quoted');
    expect((await alice.ticket(job.ticketId)).repairCostCents).toBe(195_00);
  });
});

describe("the Tenant's contact details", () => {
  test('are taken out of the issue description before it goes to Tradies', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const report = 'Tap dripping, call me on 0400 000 001 or tom@example.com';
    h.classifier.when(report, { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, report);
    await h.answerAll(TOM, { location: 'Kitchen', started: 'Monday', worsening: 'no', availability: 'weekday_mornings' });
    await h.advance(48 * HOUR);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    const ticketId = await alice.confirmMaintenanceRequest(request!.issueId);
    const [job] = (await alice.ticket(ticketId)).jobs;

    await alice.sendQuoteRequests(job!.jobId, [tradies.pete.id, tradies.dana.id]);

    const sent = h.messenger.last(tradies.pete.address)!;
    expect(sent.data.description).toContain('Tap dripping, call me on [contact removed] or [contact removed]');
    expect(sent.text).not.toMatch(/0400|tom@example/);
  });
});
