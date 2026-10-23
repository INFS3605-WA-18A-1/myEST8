import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { confirmedQuotes, jobView, KING_ST, TOM, tomsTapTicket, visitStarted } from '../support/world.ts';

describe('Tradies', () => {
  test('the directory is sorted by myEST8 rating, shows both ratings and Previous Quotes, and filters by Trade', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const all = await (await w.get('/tradies', cookie)).text();
    expect(visible(all)).toContain('Previous Quotes');
    expect(visible(all)).toContain('Not on Google');
    // Dana (5.0) is ahead of Pete (4.0), and Finn (3.0) is last of the plumbers.
    expect(all.indexOf(`/tradies/${w.ids.dana}"`)).toBeLessThan(all.indexOf(`/tradies/${w.ids.pete}"`));
    expect(all.indexOf(`/tradies/${w.ids.pete}"`)).toBeLessThan(all.indexOf(`/tradies/${w.ids.finn}"`));

    const electricians = await (await w.get('/tradies?trade=electrical', cookie)).text();
    expect(electricians).toContain(`href="/tradies/${w.ids.sam}"`);
    expect(electricians).not.toContain(`href="/tradies/${w.ids.pete}"`);
  });

  test('the Trades are links with how many Tradies do each, so filtering is one click and works without JavaScript', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const all = await (await w.get('/tradies', cookie)).text();
    const filter = all.slice(all.indexOf('aria-label="Filter by Trade"'), all.indexOf('</nav>', all.indexOf('aria-label="Filter by Trade"')));
    expect(filter).toMatch(/<a href="\/tradies" class="trade-filter-item" aria-current="page">All Trades <span class="trade-filter-count num">6<\/span><\/a>/);
    expect(filter).toMatch(/<a href="\/tradies\?trade=plumbing" class="trade-filter-item">Plumbing <span class="trade-filter-count num">5<\/span><\/a>/);
    expect(visible(filter)).toContain('Electrical 1');
    // A Trade nobody does isn't offered.
    expect(visible(filter)).not.toContain('Roofing');

    const electricians = await (await w.get('/tradies?trade=electrical', cookie)).text();
    expect(electricians).toContain('<a href="/tradies?trade=electrical" class="trade-filter-item" aria-current="page">');
    expect(electricians).toContain('<a href="/tradies" class="trade-filter-item">All Trades');
  });

  test("on phones each rating says whose it is, as the directory's header is hidden", async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get('/tradies', cookie)).text();
    const start = page.indexOf(`href="/tradies/${w.ids.pete}"`);
    const row = page.slice(start, page.indexOf('</tr>', start));
    expect(page).toContain('table-frame is-stacked is-labelled');
    expect(row).toContain('data-label="myEST8 rating"');
    expect(visible(row)).toContain('4.0 (1) from 1 rating');
    expect(row).toContain('data-label="Google rating"');
    expect(visible(row)).toContain('4.8 (120) from 120 reviews');
    expect(row).toMatch(/data-label="Previous Quotes">0</);
  });

  test('the add form and spreadsheet import stay on the page', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const page = await (await w.get('/tradies?manual=1', cookie)).text();
    expect(page).toContain('action="/setup/tradies?manual=1"');
    expect(page).toContain('id="import-tradies"');
  });

  test('a profile splits the ratings by source and lists bookings and Quotes by Ticket', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const cookie = await w.signIn();

    const page = await (await w.get(`/tradies/${w.ids.pete}`, cookie)).text();
    const text = visible(page);
    for (const heading of ['From Property Managers', 'From Tenants', 'Previous Quotes', 'Upcoming bookings', 'Business address']) expect(text).toContain(heading);
    expect(page).toContain('Back to Tradies');
  });

  test('a profile leads with the ratings split by who gave them, then previous Quotes, with the business address last', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, new Date('2026-10-13T09:00:00+11:00')]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const { workOrder } = await jobView(w, job);
    w.h.classifier.when('All done', { replyType: 'done', relatedItem: `work_order:${workOrder!.workOrderId}` });
    visitStarted(w, workOrder!.start);
    await w.h.receive(w.tradies.pete.address, 'All done');
    await w.alice.rateTradie(job.jobId, 3);
    await w.h.answer(TOM, '5', '5');
    const cookie = await w.signIn();

    const page = await (await w.get(`/tradies/${w.ids.pete}`, cookie)).text();
    const text = visible(page);
    // The starting rating (4), the Property Manager's 3 and the Tenant's 5 make the myEST8 rating; each source is also shown on its own.
    expect(text).toContain('myEST8 rating 4.0 From 3 ratings, including the starting rating');
    expect(text).toContain('From Property Managers 3.0 1 rating');
    expect(text).toContain('From Tenants 5.0 1 rating');
    expect(text).toContain('Google rating 4.8 120 reviews');
    const at = (heading: string) => page.indexOf(`<h2 class="section-title">${heading}</h2>`);
    expect(at('Previous Quotes')).toBeGreaterThan(-1);
    expect(at('Previous Quotes')).toBeLessThan(at('Upcoming bookings'));
    expect(at('Upcoming bookings')).toBeLessThan(at('Ratings'));
    expect(at('Ratings')).toBeLessThan(at('Business address'));
  });

  test('a Tradie nobody has rated yet says so for each source', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const text = visible(await (await w.get(`/tradies/${w.ids.dana}`, cookie)).text());
    expect(text).toContain('From Property Managers No ratings yet');
    expect(text).toContain('From Tenants No ratings yet');
    expect(text).toContain('Google rating Not on Google');
  });

  test('saving a business address puts the Tradie on the map', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.geocoder.locations.set('4 Illawarra Rd, Marrickville NSW 2204', { lat: -33.906, lng: 151.158 });

    const res = await w.post(`/tradies/${w.ids.pete}/address`, { businessAddress: '4 Illawarra Rd, Marrickville NSW 2204' }, cookie);
    expect(res.status).toBe(303);
    const page = await (await w.get(res.headers.get('location')!, cookie)).text();
    expect(visible(page)).toContain('Business address saved');
    expect(page).toContain('4 Illawarra Rd, Marrickville NSW 2204');
    expect(visible(page)).toContain('On the Dispatch map.');
  });

  test('an unknown Tradie is a 404', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    expect((await w.get('/tradies/99999', cookie)).status).toBe(404);
  });
});

describe('removing a Tradie', () => {
  /** The Tradie's profile with the apostrophes the page escapes put back. */
  const unescaped = (page: string) => page.replaceAll('&#39;', "'");

  test('a profile offers Remove Tradie as a red outlined button that asks first, saying what happens', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = unescaped(await (await w.get(`/tradies/${w.ids.nina}`, cookie)).text());
    const form = page.slice(page.indexOf(`action="/tradies/${w.ids.nina}/remove"`) - 30, page.indexOf('</form>', page.indexOf(`action="/tradies/${w.ids.nina}/remove"`)));
    expect(form).toContain("data-confirm=\"Nina's Plumbing won't be offered for new Jobs. Their past Quotes and ratings stay on the Tickets they belong to.\"");
    expect(form).toContain('btn-danger');
    expect(visible(form)).toContain('Remove Tradie');
    // The button sits in the page's actions, beside Back to Tradies.
    expect(page.indexOf('Remove Tradie')).toBeLessThan(page.indexOf('Back to Tradies'));
  });

  test('confirming goes to the list with the flash, and the Tradie is gone from the list, Dispatch and the Property pickers', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const everywhere = async () => ({
      list: await (await w.get('/tradies', cookie)).text(),
      dispatch: await (await w.get('/dispatch', cookie)).text(),
      properties: await (await w.get('/properties', cookie)).text(),
      property: await (await w.get(`/properties/${w.ids.kingSt}`, cookie)).text(),
    });
    const before = await everywhere();
    expect(before.list).toContain(`href="/tradies/${w.ids.nina}"`);
    expect(before.properties).toContain(`<option value="${w.ids.nina}"`);
    for (const page of Object.values(before)) expect(page).toContain('Nina');

    const res = await w.post(`/tradies/${w.ids.nina}/remove`, {}, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/tradies\?ok=/);
    const after = await everywhere();
    expect(visible(await (await w.get(res.headers.get('location')!, cookie)).text())).toContain("Nina's Plumbing removed");
    expect(after.list).not.toContain(`href="/tradies/${w.ids.nina}"`);
    expect(after.properties).not.toContain(`<option value="${w.ids.nina}"`);
    for (const page of Object.values(after)) expect(page).not.toContain('Nina');
  });

  test('a refusal shows its reason on the profile', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.ids.pete, w.ids.dana]);
    const cookie = await w.signIn();

    const res = await w.post(`/tradies/${w.ids.pete}/remove`, {}, cookie);
    expect(res.headers.get('location')).toMatch(new RegExp(`^/tradies/${w.ids.pete}\\?error=`));
    const page = await (await w.get(res.headers.get('location')!, cookie)).text();
    expect(visible(page)).toContain(`Pete's Plumbing has an open Quote Request for plumbing at ${KING_ST}. Choose a Quote or cancel the Job first.`);
    expect(page).toContain('role="alert"');
    expect(await (await w.get('/tradies', cookie)).text()).toContain(`href="/tradies/${w.ids.pete}"`);
  });

  test("another Agency's Tradie can't be removed", async () => {
    const w = await webWorld();
    const sunrise = await w.signUp();
    const res = await w.post(`/tradies/${w.ids.nina}/remove`, {}, sunrise);
    expect(res.headers.get('location')).toMatch(/error=/);
    expect(await (await w.get('/tradies', await w.signIn())).text()).toContain(`href="/tradies/${w.ids.nina}"`);
  });

  test('a removed Tradie\'s profile still opens from old links, says when they left, and offers no Remove', async () => {
    const w = await webWorld();
    await w.alice.removeTradie(w.ids.nina);
    const cookie = await w.signIn();

    const res = await w.get(`/tradies/${w.ids.nina}`, cookie);
    expect(res.status).toBe(200);
    const page = await res.text();
    const text = visible(page);
    expect(text).toContain("Nina's Plumbing");
    expect(text).toContain('Removed from the Agency on 8 October 2026');
    expect(page).not.toContain(`/tradies/${w.ids.nina}/remove`);
    expect(text).not.toContain('Remove Tradie');
    // Past Quotes and ratings are still there; the address form, for the Dispatch map, is not.
    for (const heading of ['Previous Quotes', 'Ratings']) expect(text).toContain(heading);
    expect(text).not.toContain('Save address');
    expect(page).toContain('Back to Tradies');
  });
});
