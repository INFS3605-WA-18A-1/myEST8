import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { dateAhead, KING_ST, quoteRequestFor, quoteToken, TOM, tomsTapTicket } from '../support/world.ts';

// The Tradie's no-login quote page at /q/:token: Estimate, Site Inspection, Firm Quote.

const TUE_10AM = new Date('2026-10-13T10:00:00+11:00');

/** Tom's tap with Quote Requests to Pete and Dana, and Pete's quote page. */
async function petesPage() {
  const w = await webWorld();
  const job = await tomsTapTicket(w);
  await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
  const path = `/q/${await quoteToken(w, job, w.tradies.pete)}`;
  async function open() {
    const res = await w.get(path);
    return { status: res.status, html: await res.text() };
  }
  async function post(step: 'estimate' | 'firm', fields: Record<string, string | string[]>) {
    const body = new FormData();
    for (const [name, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) body.append(name, v);
    const res = await w.web.request(`${path}/${step}`, { method: 'POST', body });
    await w.h.drain();
    return { status: res.status, location: res.headers.get('location'), html: res.status === 303 ? '' : await res.text() };
  }
  return { w, job, path, open, post };
}

describe('the quote page', () => {
  test('an unknown link is not found, for a look or a post', async () => {
    const { w } = await petesPage();
    const page = await w.get('/q/not-a-real-token');
    expect(page.status).toBe(404);
    expect(visible(await page.text())).toContain("This link isn't right");
    const posted = await w.web.request('/q/not-a-real-token/estimate', { method: 'POST', body: new URLSearchParams({ price: '100' }) });
    expect(posted.status).toBe(404);
  });

  test('shows the Job by Trade and suburb, never the Tenant or the address, and asks for the Estimate', async () => {
    const { open } = await petesPage();
    const { status, html } = await open();
    const text = visible(html);
    expect(status).toBe(200);
    expect(text).toContain('Harbour Realty');
    expect(text).toContain('Give your Estimate');
    expect(text).toContain('Plumbing job in Newtown');
    expect(text).toContain('The kitchen tap is dripping');
    expect(text).toContain('I need to inspect the site before I can give a firm price');
    expect(text).toContain('Call-out Fee');
    expect(text).not.toContain('King St');
    expect(text).not.toContain('Tom');
    expect(html).not.toContain(TOM);
  });

  test('a refused Estimate shows why by its field and keeps what was typed', async () => {
    const { w, job, post } = await petesPage();
    const refused = await post('estimate', { price: 'about two hundred', proposedTime: '' });
    expect(refused.status).toBe(400);
    expect(visible(refused.html)).toContain('Enter your Estimate in dollars');
    expect(refused.html).toContain('value="about two hundred"');
    expect(refused.html).toContain('aria-invalid="true"');
    expect((await post('estimate', { price: '150', proposedTime: '2020-01-01T09:00' })).status).toBe(400);
    expect((await quoteRequestFor(w, job, w.tradies.pete)).status).toBe('sent');
  });

  test('an Estimate needing no inspection moves straight to the Firm Quote, which ends read only', async () => {
    const { w, job, open, post } = await petesPage();
    const sent = await post('estimate', { price: '$1,150.50', proposedTime: '2026-10-13T09:00' });
    expect(sent).toMatchObject({ status: 303, location: expect.stringContaining('?sent=estimate') });
    expect((await quoteRequestFor(w, job, w.tradies.pete)).estimate).toMatchObject({ priceCents: 1150_50, needsInspection: false, confirmed: true });

    const firmStep = visible((await open()).html);
    expect(firmStep).toContain('Give your Firm Quote');
    expect(firmStep).toContain('Your Estimate Estimate $1,150.50');
    expect(firmStep).toContain('Scope of work');
    expect(firmStep).toContain('Dates you can start');

    const refused = await post('firm', { price: '1200', scopeOfWork: '', durationDays: '0', availableTimes: ['2020-01-01'] });
    expect(refused.status).toBe(400);
    expect(visible(refused.html)).toContain('Describe the scope of work');
    const badDates = await post('firm', { price: '1200', scopeOfWork: 'New tap', durationDays: '2', availableTimes: ['2020-01-01'] });
    expect(visible(badDates.html)).toContain('Pick start dates from today on');
    expect(badDates.html).toContain('value="2020-01-01"');

    const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'quote.pdf', { type: 'application/pdf' });
    const body = new FormData();
    for (const [k, v] of Object.entries({ price: '1200', scopeOfWork: 'Replace the mixer tap and both isolation valves', durationDays: '2', proposedTime: '' })) body.set(k, v);
    body.append('availableDates', dateAhead(w, 3));
    body.append('availableDates', '');
    body.append('availableDates', dateAhead(w, 4));
    body.set('pdf', pdf);
    const firm = await w.web.request(`/q/${await quoteToken(w, job, w.tradies.pete)}/firm`, { method: 'POST', body });
    expect(firm.status).toBe(303);

    const done = visible((await open()).html);
    expect(done).toContain('Your Firm Quote');
    expect(done).toContain('Replace the mixer tap and both isolation valves');
    expect(done).toContain('2 days');
    expect(done).toContain('PDF Attached');
    expect(done).toContain('Your Estimate (superseded by your Firm Quote)');
    expect(done).not.toContain('Send Firm Quote');
    expect((await quoteRequestFor(w, job, w.tradies.pete)).firmQuote).toMatchObject({ priceCents: 1200_00, availableTimes: [dateAhead(w, 3), dateAhead(w, 4)], hasPdf: true });
  });

  test('a Tradie who needs to inspect waits for the booking, then sees its time and the address', async () => {
    const { w, job, open, post } = await petesPage();
    expect((await post('estimate', { price: '400', needsInspection: 'yes', calloutFee: '90' })).status).toBe(303);
    expect((await quoteRequestFor(w, job, w.tradies.pete)).estimate).toMatchObject({ needsInspection: true, calloutFeeCents: 90_00 });

    const waiting = visible((await open()).html);
    expect(waiting).toContain('Waiting for Harbour Realty to book your Site Inspection');
    expect(waiting).toContain('Needed, Call-out Fee $90.00');
    expect(waiting).not.toContain('Send Firm Quote');

    await w.alice.bookInspection((await quoteRequestFor(w, job, w.tradies.pete)).quoteRequestId, { start: TUE_10AM.toISOString() });
    const booked = visible((await open()).html);
    expect(booked).toContain('Your Site Inspection is booked for');
    expect(booked).toContain(KING_ST);
    expect((await post('firm', { price: '420', scopeOfWork: 'x', durationDays: '1', availableTimes: [dateAhead(w, 6)] })).status).toBe(400);
  });

  test('an Estimate post over 64 KB is refused on the page', async () => {
    const { w, job, post } = await petesPage();
    const refused = await post('estimate', { price: '150', proposedTime: '', filler: 'x'.repeat(70 * 1024) });
    expect(refused.status).toBe(413);
    expect(visible(refused.html)).toContain('That is too much to send');
    expect((await quoteRequestFor(w, job, w.tradies.pete)).status).toBe('sent');
  });

  test('while the Property Owner decides, says whose quote is with them and that the others are still open', async () => {
    const { w, job, open } = await petesPage();
    await w.h.app.submitEstimate(await quoteToken(w, job, w.tradies.pete), { priceCents: 600_00, needsInspection: false });
    await w.h.app.submitEstimate(await quoteToken(w, job, w.tradies.dana), { priceCents: 700_00, needsInspection: false });
    await w.h.app.submitFirmQuote(await quoteToken(w, job, w.tradies.pete), { priceCents: 650_00, scopeOfWork: 'New tap', durationDays: 1, availableTimes: [dateAhead(w, 3)] });
    const pete = (await quoteRequestFor(w, job, w.tradies.pete)).firmQuote!;
    await w.alice.chooseQuote(pete.quoteId, 'Dana is a week away');

    const mine = visible((await open()).html);
    expect(mine).toContain('Harbour Realty would like to go with your quote and has asked the Property Owner to approve it');
    expect(mine).not.toContain('has closed');
    const other = visible(await (await w.get(`/q/${await quoteToken(w, job, w.tradies.dana)}`)).text());
    expect(other).toContain('Still open: Harbour Realty is waiting on the Property Owner about another quote');
    expect(other).not.toContain('has closed');
  });

  test('says so when the request has closed, been declined, or another Quote was chosen', async () => {
    const { w, job, open } = await petesPage();
    await w.alice.cancelJob(job.jobId);
    expect(visible((await open()).html)).toContain('This Quote Request has closed');
    expect(visible((await open()).html)).not.toContain('Send Estimate');

    const other = await petesPage();
    const dana = await quoteRequestFor(other.w, other.job, other.w.tradies.pete);
    other.w.h.classifier.when('No thanks', { replyType: 'decline', relatedItem: `quote_request:${dana.quoteRequestId}` });
    await other.w.h.receive(other.w.tradies.pete.address, 'No thanks');
    expect(visible((await other.open()).html)).toContain('You declined this Quote Request');
  });
});
