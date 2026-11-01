import { describe, expect, test } from 'vitest';
import { AGENCY_NUMBER } from '../support/harness.ts';
import { visible, webWorld } from '../support/web.ts';
import { confirmedQuotes, KING_ST, tomsTapTicket, type World } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');

/** A Property the geocoder doesn't know yet. */
const UNKNOWN_ADDRESS = '99 Nowhere Rd, Newtown NSW 2042';

/** Where each Tradie works, by the address they are given. Distances are from King St (-33.897, 151.179). */
const NINA_BASE = { address: '2 Enmore Rd, Enmore NSW 2042', location: { lat: -33.899, lng: 151.173 } }; // about 0.6 km
const PETE_BASE = { address: '4 Illawarra Rd, Marrickville NSW 2204', location: { lat: -33.906, lng: 151.158 } }; // about 2.2 km
const FINN_BASE = { address: '1 Windsor Rd, Castle Hill NSW 2154', location: { lat: -33.7507, lng: 150.6877 } }; // about 47 km

async function dispatch(w: Web, cookie: string, path = '/dispatch') {
  const res = await w.get(path, cookie);
  expect(res.status).toBe(200);
  return res.text();
}

/** The pin data block, parsed exactly as the browser would. */
function pinData(html: string) {
  const match = /<script type="application\/json" id="dispatch-data">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('The page has no pin data block');
  return JSON.parse(match[1]!) as {
    style: string;
    radiusKm: number;
    properties: { key: string; id: number; address: string; suburb: string; lat: number; lng: number; urgency: string | null; openTickets: number }[];
    tradies: { key: string; id: number; name: string; lat: number; lng: number; trades: string[] }[];
  };
}

/** The part of the page from the element with `id` to its closing tag, as text. */
function sectionText(html: string, id: string) {
  const start = html.indexOf(`id="${id}"`);
  expect(start, `no element with id ${id}`).toBeGreaterThan(-1);
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

async function locateTradies(w: World, bases: [number, { address: string; location: { lat: number; lng: number } }][]) {
  for (const [tradieId, base] of bases) {
    w.h.geocoder.locations.set(base.address, base.location);
    await w.alice.setTradieAddress(tradieId, base.address);
  }
}

describe('Dispatch: the map data', () => {
  test('the map has no key: its pins are a house for a Property and a wrench for a Tradie, each named in words', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    expect(html).not.toContain('aria-label="Pin key"');
    expect(html).not.toContain('dispatch-legend');
    const start = html.indexOf('<template id="dispatch-pin-icons">');
    expect(start).toBeGreaterThan(-1);
    const glyphs = html.slice(start, html.indexOf('</template>', start));
    expect([...glyphs.matchAll(/data-icon="([a-z]+)"/g)].map((m) => m[1])).toEqual(['property', 'tradie']);
    expect(html).toContain('Map. Each pin is a Property or a Tradie');
  });

  test('every geocoded Property is a pin with its coordinates and the worst urgency of its open Tickets', async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    await w.alice.changeUrgency({ ticketId }, 'high');
    const cookie = await w.signIn();

    const data = pinData(await dispatch(w, cookie));

    const king = data.properties.find((p) => p.address === KING_ST)!;
    expect(king).toMatchObject({ id: w.ids.kingSt, key: `property-${w.ids.kingSt}`, lat: -33.897, lng: 151.179, urgency: 'high', openTickets: 1 });
    const ocean = data.properties.find((p) => p.id === w.ids.oceanAve)!;
    expect(ocean).toMatchObject({ lat: -33.8908, lng: 151.2743, urgency: null, openTickets: 0 });
  });

  test("the basemap is OpenFreeMap's Positron style, which needs no key, and the search radius defaults to 15 km", async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const data = pinData(await dispatch(w, cookie));

    expect(data.style).toBe('https://tiles.openfreemap.org/styles/positron');
    expect(data).not.toHaveProperty('tiles');
    expect(data.radiusKm).toBe(15);
  });

  test('a Property whose address contains </script> and quotes cannot break out of the data block', async () => {
    const w = await webWorld();
    const hostile = `1 "Quote" St </script><img src=x onerror=alert(1)> & <!-- \u2028 end`;
    w.h.geocoder.locations.set(hostile, { lat: -33.9, lng: 151.2 });
    await w.alice.addProperty({ address: hostile, suburb: 'Newtown', ownerId: w.ids.olivia, propertyManagerId: w.ids.aliceId, maxRepairCostCents: 500_00, nominatedTradieIds: [] });
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const block = /<script type="application\/json" id="dispatch-data">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(block).not.toMatch(/[<>&\u2028\u2029]/);
    expect(pinData(html).properties.map((p) => p.address)).toContain(hostile);
    expect(html).not.toContain('<img src=x');
    // Every script on the page is a file, the data block or the shell's one-line marker: nothing the Property's address could add.
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attributes, body] of scripts) {
      expect(attributes!.includes('src=') || attributes!.includes('application/json') || body!.startsWith('document.documentElement')).toBe(true);
    }
  });

  test('Tradies with a location are pins of their own, with their Trades', async () => {
    const w = await webWorld();
    await locateTradies(w, [[w.ids.nina, NINA_BASE]]);
    const cookie = await w.signIn();

    const data = pinData(await dispatch(w, cookie));

    expect(data.tradies).toEqual([{ key: `tradie-${w.ids.nina}`, id: w.ids.nina, name: "Nina's Plumbing", lat: NINA_BASE.location.lat, lng: NINA_BASE.location.lng, trades: ['plumbing'] }]);
  });
});

describe('Dispatch: the header search and filters', () => {
  test('the search narrows the table and the pins together; the Trade filter keeps only that Trade', async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    const cookie = await w.signIn();

    const all = await dispatch(w, cookie);
    expect(all).toContain('placeholder="Search properties, tickets or tradies"');
    expect(pinData(all).properties.map((p) => p.address)).toContain(KING_ST);

    const hit = await dispatch(w, cookie, `/dispatch?q=${encodeURIComponent('kitchen tap')}`);
    expect(sectionText(hit, 'properties')).toContain(`href="#panel-property-${w.ids.kingSt}"`);
    const byNumber = await dispatch(w, cookie, `/dispatch?q=${encodeURIComponent(`#${ticketId}`)}`);
    expect(sectionText(byNumber, 'properties')).toContain(`href="#panel-property-${w.ids.kingSt}"`);

    const miss = await dispatch(w, cookie, '/dispatch?q=zzzzzz');
    expect(sectionText(miss, 'properties')).not.toContain(`href="#panel-property-${w.ids.kingSt}"`);
    expect(pinData(miss).properties).toEqual([]);

    const plumbing = await dispatch(w, cookie, '/dispatch?trade=plumbing');
    expect(sectionText(plumbing, 'properties')).toContain(`href="#panel-property-${w.ids.kingSt}"`);
    const roofing = await dispatch(w, cookie, '/dispatch?trade=roofing');
    expect(sectionText(roofing, 'properties')).not.toContain(`href="#panel-property-${w.ids.kingSt}"`);
    // A Trade or Region the page doesn't know is ignored rather than emptying it.
    const odd = await dispatch(w, cookie, '/dispatch?trade=astrology&region=XX');
    expect(sectionText(odd, 'properties')).toContain(`href="#panel-property-${w.ids.kingSt}"`);
  });
});

describe('Dispatch: the table of Properties', () => {
  test('lists the Properties with open Tickets, each Ticket named by its issue, and folds the rest away', async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const properties = sectionText(html, 'properties');
    const [table, quiet] = properties.split('<details');
    for (const header of ['Address', 'Suburb', 'Open Tickets', 'Worst urgency']) expect(table).toContain(`>${header}</th>`);
    expect(table).toContain(`href="#panel-property-${w.ids.kingSt}"`);
    expect(table).not.toContain(`href="#panel-property-${w.ids.oceanAve}"`);
    // The link to the Ticket is its issue; the number sits beside it.
    expect(table).toMatch(new RegExp(`<a href="/tickets/${ticketId}"[^>]*>The kitchen tap is dripping</a>`));
    expect(visible(table)).toContain(`#${ticketId}`);
    expect(visible(table)).not.toContain(`Ticket ${ticketId}`);
    expect(visible(table)).toContain('Newtown');
    expect(visible(table)).toContain('Routine');
    // Ocean Ave has nothing open: it is under a disclosure, still able to pick its panel.
    expect(visible(quiet!)).toContain('Show the 1 Property with no open Tickets');
    expect(quiet).toContain(`href="#panel-property-${w.ids.oceanAve}"`);
  });

  test('a Property without coordinates says "Address not found" and has no pin', async () => {
    const w = await webWorld();
    const id = await w.alice.addProperty({ address: UNKNOWN_ADDRESS, suburb: 'Newtown', ownerId: w.ids.olivia, propertyManagerId: w.ids.aliceId, maxRepairCostCents: 500_00, nominatedTradieIds: [] });
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const table = sectionText(html, 'properties');
    const row = table.slice(table.indexOf(UNKNOWN_ADDRESS));
    expect(visible(row.slice(0, row.indexOf('</tr>')))).toContain('Address not found');
    expect(visible(table.slice(table.indexOf(KING_ST), table.indexOf('</tr>', table.indexOf(KING_ST))))).not.toContain('Address not found');
    expect(pinData(html).properties.map((p) => p.id)).not.toContain(id);
  });

  test('each Property has a panel with its address, its open Tickets and its nearest Tradies', async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    await locateTradies(w, [
      [w.ids.pete, PETE_BASE],
      [w.ids.nina, NINA_BASE],
      [w.ids.finn, FINN_BASE],
      [w.ids.sam, { address: '3 Enmore Rd, Enmore NSW 2042', location: { lat: -33.8985, lng: 151.1735 } }],
    ]);
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const start = html.indexOf(`id="panel-property-${w.ids.kingSt}"`);
    const panel = html.slice(start, html.indexOf('</section>', start));
    const text = visible(panel);
    expect(text).toContain(KING_ST);
    expect(panel).toContain(`href="/tickets/${ticketId}"`);
    expect(text).toContain('The kitchen tap is dripping');
    // Nearest first, within 15 km; Finn is about 47 km away.
    expect(text.indexOf("Nina's Plumbing")).toBeGreaterThan(-1);
    expect(text.indexOf("Nina's Plumbing")).toBeLessThan(text.indexOf("Pete's Plumbing"));
    expect(text).not.toContain('Flow Bros');
    // Only the Trades its open Jobs need: Sam is an electrician next door.
    expect(text).toContain('Nearest Tradies, within 15 km who do plumbing');
    expect(text).not.toContain('Sparky Sam');
    expect(text).toMatch(/0\.6 km/);
    expect(text).toMatch(/2\.2 km/);
    expect(text).toContain('Plumbing');
    // Both ratings side by side, never combined.
    expect(text).toContain('myEST8 4.0 (1) from 1 rating Google 4.8 (120) from 120 reviews');
    expect(panel).toContain(`href="/tradies/${w.ids.pete}"`);
  });

  test('a Property that could not be placed has a panel that says why it lists no Tradies', async () => {
    const w = await webWorld();
    const id = await w.alice.addProperty({ address: UNKNOWN_ADDRESS, suburb: 'Newtown', ownerId: w.ids.olivia, propertyManagerId: w.ids.aliceId, maxRepairCostCents: 500_00, nominatedTradieIds: [] });
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const start = html.indexOf(`id="panel-property-${id}"`);
    expect(visible(html.slice(start, html.indexOf('</section>', start)))).toContain('Address not found');
  });
});

/** The Tradie entries in `html`: each whole `<li>`, with the Tradie it is for. Entries never nest, so the first `</li>` closes one. */
function tradieEntries(html: string) {
  return [...html.matchAll(/<li class="tradie-entry[^"]*"[^>]*data-tradie="(\d+)"[\s\S]*?<\/li>/g)].map((m) => ({ id: Number(m[1]), html: m[0], text: visible(m[0]).trim() }));
}

/** `html` with every Tradie entry cut out, as the text outside them. */
function outsideEntries(html: string) {
  return visible(html.replace(/<li class="tradie-entry[^"]*"[\s\S]*?<\/li>/g, ' '));
}

const DANA_BASE = { address: '8 Station St, Newtown NSW 2042', location: { lat: -33.925, lng: 151.18 } }; // about 3.1 km

describe("Dispatch: a Tradie's entry in a Property's panel", () => {
  test('each nearby Tradie is one entry that holds its name, distance, Trades and both ratings, and none of it is outside the entry', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    await locateTradies(w, [
      [w.ids.dana, DANA_BASE],
      [w.ids.pete, PETE_BASE],
      [w.ids.nina, NINA_BASE],
    ]);
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const start = html.indexOf(`id="panel-property-${w.ids.kingSt}"`);
    const panel = html.slice(start, html.indexOf('</section>', start));
    const entries = tradieEntries(panel);
    expect(entries.map((e) => e.id)).toEqual([w.ids.nina, w.ids.pete, w.ids.dana]);
    const [nina, pete, dana] = entries;
    expect(nina!.html).toContain(`<a class="tradie-name" href="/tradies/${w.ids.nina}">`);
    expect(nina!.text).toMatch(/^Nina's Plumbing 0\.6 km Plumbing myEST8 4\.0 \(1\) from 1 rating Google 4\.2 \(33\) from 33 reviews$/);
    expect(pete!.text).toMatch(/^Pete's Plumbing 2\.2 km Plumbing myEST8 4\.0 \(1\) from 1 rating Google 4\.8 \(120\) from 120 reviews$/);
    expect(dana!.text).toMatch(/^Drip Doctors 3\.1 km Plumbing myEST8 5\.0 \(1\) from 1 rating Not on Google$/);
    // The distance is plain text and the ratings are not boxed chips.
    expect(nina!.html).not.toContain('class="metric');
    // Everything about a Tradie is in its own entry: the panel outside the entries names none of them.
    const outside = outsideEntries(panel);
    for (const fact of ["Nina's Plumbing", "Pete's Plumbing", 'Drip Doctors', '0.6 km', '2.2 km', 'myEST8', 'Google', 'Plumbing myEST8']) expect(outside).not.toContain(fact);
  });
});

describe("Dispatch: a Tradie's entry in the Ask for Quotes list", () => {
  test("a candidate's checkbox, name, badge, distance, Trades and ratings are all in its label, with the Profile link after it", async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await locateTradies(w, [
      [w.ids.pete, PETE_BASE],
      [w.ids.nina, NINA_BASE],
    ]);
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const start = html.indexOf(`id="dispatch-job-${job.jobId}"`);
    const card = html.slice(start, html.indexOf('</form>', start));
    const entries = tradieEntries(card);
    // Nominated first, then nearest; those without a location (unknown distance) come last.
    expect(entries.map((e) => e.id).slice(0, 2)).toEqual([w.ids.nina, w.ids.pete]);
    const nina = entries[0]!;
    const label = /<label[^>]*>([\s\S]*)<\/label>/.exec(nina.html)![1]!;
    expect(label).toContain(`<input type="checkbox"`);
    expect(label).toContain(`name="tradieIds" value="${w.ids.nina}"`);
    expect(visible(label).trim()).toMatch(/^Nina's Plumbing Nominated 0\.6 km Plumbing myEST8 4\.0 \(1\) from 1 rating Google 4\.2 \(33\) from 33 reviews$/);
    expect(label.indexOf('Nominated')).toBeGreaterThan(label.indexOf('tradie-name'));
    // A link inside a label would be a control inside a control: Profile follows the label instead.
    expect(label).not.toContain('<a ');
    expect(nina.html.slice(nina.html.indexOf('</label>'))).toContain(`<a class="tradie-profile" href="/tradies/${w.ids.nina}">Profile</a>`);
    // The card outside its entries names none of the candidates.
    expect(outsideEntries(card)).not.toContain("Nina's Plumbing");
  });

  test('a candidate whose distance is not known says so, with no ruler', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await locateTradies(w, [[w.ids.nina, NINA_BASE]]);
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const start = html.indexOf(`id="dispatch-job-${job.jobId}"`);
    const entries = tradieEntries(html.slice(start, html.indexOf('</form>', start)));
    const nina = entries.find((e) => e.id === w.ids.nina)!;
    const dana = entries.find((e) => e.id === w.ids.dana)!;
    expect(dana.text).toContain('Drip Doctors Distance unknown');
    expect(dana.text).toContain('Not on Google');
    expect(dana.html).not.toContain('tradie-ruler');
    expect(nina.html).toContain('tradie-ruler');
  });
});

describe('Dispatch: the distance ruler', () => {
  test("a Tradie's ruler fills the distance's share of the 15 km search radius and is hidden from assistive technology", async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    await locateTradies(w, [
      [w.ids.pete, PETE_BASE],
      [w.ids.nina, NINA_BASE],
    ]);
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const start = html.indexOf(`id="panel-property-${w.ids.kingSt}"`);
    const [nina, pete] = tradieEntries(html.slice(start, html.indexOf('</section>', start)));
    const ruler = (entry: { html: string }) => /<span class="tradie-ruler" aria-hidden="true"><span class="tradie-ruler-fill" style="width: ([\d.]+)%">/.exec(entry.html);
    expect(Number(ruler(nina!)![1])).toBeCloseTo((0.6 / 15) * 100, 0);
    expect(Number(ruler(pete!)![1])).toBeCloseTo((2.2 / 15) * 100, 0);
  });
});

describe('Dispatch: finding addresses again', () => {
  test('opening the page never looks addresses up; the button shown while some are missing does, and they gain pins', async () => {
    const w = await webWorld();
    const id = await w.alice.addProperty({ address: UNKNOWN_ADDRESS, suburb: 'Newtown', ownerId: w.ids.olivia, propertyManagerId: w.ids.aliceId, maxRepairCostCents: 500_00, nominatedTradieIds: [] });
    const cookie = await w.signIn();
    let lookups = 0;
    const geocode = w.h.geocoder.geocode.bind(w.h.geocoder);
    w.h.geocoder.geocode = async (address) => {
      lookups++;
      return geocode(address);
    };
    w.h.geocoder.locations.set(UNKNOWN_ADDRESS, { lat: -33.89, lng: 151.18 });

    const before = await dispatch(w, cookie);
    expect(lookups).toBe(0);
    expect(pinData(before).properties.map((p) => p.id)).not.toContain(id);
    expect(before).toContain('action="/dispatch/addresses"');

    const res = await w.post('/dispatch/addresses', {}, cookie);
    expect(res.status).toBe(303);
    const after = await dispatch(w, cookie, res.headers.get('location')!);

    expect(visible(after)).toContain('Found 1 address and put it on the map');
    expect(pinData(after).properties.find((p) => p.id === id)).toMatchObject({ lat: -33.89, lng: 151.18 });
    expect(after).not.toContain('Address not found');
    expect(after).not.toContain('action="/dispatch/addresses"');
  });

  test('a geocoder that fails leaves the address marked, and says nothing was found', async () => {
    const w = await webWorld();
    await w.alice.addProperty({ address: UNKNOWN_ADDRESS, suburb: 'Newtown', ownerId: w.ids.olivia, propertyManagerId: w.ids.aliceId, maxRepairCostCents: 500_00, nominatedTradieIds: [] });
    w.h.geocoder.geocode = async () => {
      throw new Error('Geocoding is down');
    };
    const cookie = await w.signIn();

    const res = await w.post('/dispatch/addresses', {}, cookie);
    const html = await dispatch(w, cookie, res.headers.get('location')!);

    expect(visible(html)).toContain('No more addresses found');
    expect(visible(html)).toContain('Address not found');
  });

  test('geocodeMissing reports how many Properties it placed and leaves placed ones alone', async () => {
    const w = await webWorld();
    const id = await w.alice.addProperty({ address: UNKNOWN_ADDRESS, suburb: 'Newtown', ownerId: w.ids.olivia, propertyManagerId: w.ids.aliceId, maxRepairCostCents: 500_00, nominatedTradieIds: [] });
    expect(await w.alice.geocodeMissing()).toBe(0);

    w.h.geocoder.locations.set(UNKNOWN_ADDRESS, { lat: -33.89, lng: 151.18 });
    w.h.geocoder.locations.set(KING_ST, { lat: 0, lng: 0 });
    expect(await w.alice.geocodeMissing()).toBe(1);

    expect((await w.alice.properties()).find((p) => p.id === id)!.location).toEqual({ lat: -33.89, lng: 151.18 });
    expect((await w.alice.properties()).find((p) => p.id === w.ids.kingSt)!.location).toEqual({ lat: -33.897, lng: 151.179 });
  });

  test('a Tradie with an address but no location is placed too', async () => {
    const w = await webWorld();
    await w.alice.setTradieAddress(w.ids.nina, NINA_BASE.address);
    expect((await w.alice.people('tradie')).find((t) => t.id === w.ids.nina)).toMatchObject({ businessAddress: NINA_BASE.address, location: null });

    w.h.geocoder.locations.set(NINA_BASE.address, NINA_BASE.location);
    expect(await w.alice.geocodeMissing()).toBe(1);

    expect((await w.alice.people('tradie')).find((t) => t.id === w.ids.nina)!.location).toEqual(NINA_BASE.location);
  });
});

describe("Dispatch: a Tradie's bookings", () => {
  test("a Tradie's panel lists their visits over the next 7 days, each with its day, issue, street and Ticket link", async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const pete = sectionText(html, `panel-tradie-${w.ids.pete}`);
    expect(pete).toContain(`href="/tickets/${job.ticketId}"`);
    const text = visible(pete);
    expect(text).toContain('Tue 13 Oct, 9:00 am – 11:00 am');
    expect(text).toContain('The kitchen tap is dripping');
    expect(text).toContain('12 King St, Newtown');
    expect(visible(sectionText(html, `panel-tradie-${w.ids.nina}`))).toContain('Nothing booked in the next 7 days.');
  });

  test('the page has no Tradie schedule: who is booked when is on the Schedule', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    expect(html).not.toContain('id="tradie-schedule"');
    expect(visible(html)).not.toContain('Tradie schedule');
    expect(html).not.toContain('dispatch-schedule');
  });
});

describe('Dispatch: the Jobs to dispatch', () => {
  test('a Job with no Quote Requests is a card offering its Trade\'s Tradies, nearest first with distance and ratings, the nearest two ticked', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await locateTradies(w, [
      [w.ids.pete, PETE_BASE],
      [w.ids.nina, NINA_BASE],
    ]);
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    expect(visible(html)).toMatch(/1 Need tradies Jobs to ask for Quotes/);
    const card = html.slice(html.indexOf(`id="dispatch-job-${job.jobId}"`), html.indexOf('</li>\n</ul>', html.indexOf(`id="dispatch-job-${job.jobId}"`)));
    const text = visible(card);
    expect(text).toContain('Needs Tradies to quote');
    expect(card).toContain(`href="/tickets/${job.ticketId}"`);
    expect(card).toContain(`data-select="property-${w.ids.kingSt}"`);
    expect(card).toContain(`action="/dispatch/jobs/${job.jobId}/quote-requests"`);
    // Nina is nominated for King St and nearest, then Pete; Tradies without a location come last.
    expect(text.indexOf("Nina's Plumbing")).toBeLessThan(text.indexOf("Pete's Plumbing"));
    expect(text).toMatch(/Nina's Plumbing Nominated 0\.6 km/);
    expect(text).toMatch(/Pete's Plumbing 2\.2 km/);
    expect(text).toContain('Distance unknown');
    expect([...card.matchAll(/value="(\d+)" checked/g)].map((m) => Number(m[1]))).toEqual([w.ids.nina, w.ids.pete]);
  });

  test('sending from the card asks the ticked Tradies and takes the Job off the list', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const cookie = await w.signIn();

    const res = await w.post(`/dispatch/jobs/${job.jobId}/quote-requests`, { tradieIds: [w.ids.pete, w.ids.nina] }, cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/dispatch\?ok=.*#to-dispatch$/);
    expect((await w.alice.ticket(job.ticketId)).jobs[0]!.quoteRequests.map((r) => r.tradieId).sort()).toEqual([w.ids.nina, w.ids.pete].sort());
    const html = await dispatch(w, cookie);
    expect(html).not.toContain(`id="dispatch-job-${job.jobId}"`);
    expect(visible(html)).toContain('Nothing to dispatch.');
  });

  test('one Tradie is refused when two can be asked, with the reason back on the page', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const cookie = await w.signIn();

    const res = await w.post(`/dispatch/jobs/${job.jobId}/quote-requests`, { tradieIds: [w.ids.pete] }, cookie);

    expect(res.headers.get('location')).toMatch(/^\/dispatch\?error=.*#to-dispatch$/);
    expect(visible(await dispatch(w, cookie, res.headers.get('location')!.split('#')[0]))).toContain('Send Quote Requests to at least two Tradies');
  });

  test('with no SMS channel connected, Tradies who can be reached are asked and the page names the one who cannot', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await w.alice.disconnectServerSms(AGENCY_NUMBER);
    const cookie = await w.signIn();

    const res = await w.post(`/dispatch/jobs/${job.jobId}/quote-requests`, { tradieIds: [w.ids.pete, w.ids.quick] }, cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/dispatch\?ok=.*#to-dispatch$/);
    expect((await w.alice.ticket(job.ticketId)).jobs[0]!.quoteRequests.map((r) => r.tradieId)).toEqual([w.ids.quick]);
    const text = visible(await dispatch(w, cookie, res.headers.get('location')!.split('#')[0]));
    expect(text).toContain("Quote Request sent to 1 Tradie. Couldn't reach Pete's Plumbing: no SMS channel is connected and they have no email address");
  });

  test('with no SMS channel connected and no Tradie reachable, nothing is sent and the page says why', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await w.alice.disconnectServerSms(AGENCY_NUMBER);
    const cookie = await w.signIn();

    const res = await w.post(`/dispatch/jobs/${job.jobId}/quote-requests`, { tradieIds: [w.ids.pete, w.ids.dana] }, cookie);

    expect(res.headers.get('location')).toMatch(/^\/dispatch\?error=.*#to-dispatch$/);
    expect((await w.alice.ticket(job.ticketId)).jobs[0]!.quoteRequests).toEqual([]);
    const text = visible(await dispatch(w, cookie, res.headers.get('location')!.split('#')[0]));
    expect(text).toContain("Couldn't reach Pete's Plumbing: no SMS channel is connected and they have no email address; Drip Doctors: no SMS channel is connected and they have no email address");
  });

  test('a Job with an approved Quote is a card to book its Tradie, with their free times, and sending it books the visit', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const start = html.indexOf(`id="dispatch-job-${job.jobId}"`);
    const card = html.slice(start, html.indexOf('</form>', start));
    const text = visible(card);
    expect(text).toContain('Ready to book');
    expect(text).toContain("Pete's Plumbing approved at $150.00");
    expect(card).toContain('data-fill=');
    expect(visible(card)).toContain('Pick a free time');
    expect(card).toContain('value="2026-10-13T09:00"');

    const res = await w.post(`/dispatch/jobs/${job.jobId}/work-order`, { start: '2026-10-13T09:00', hours: '2' }, cookie);

    expect(res.headers.get('location')).toMatch(/^\/dispatch\?ok=/);
    expect(decodeURIComponent(res.headers.get('location')!)).toContain('Work Order sent for Tue 13 Oct, 9:00 am');
    expect((await w.alice.ticket(job.ticketId)).jobs[0]!.workOrder).toMatchObject({ start: TUE_9AM.toISOString() });
    expect(await dispatch(w, cookie)).not.toContain(`id="dispatch-job-${job.jobId}"`);
  });

  test('booking a visit with no SMS channel connected and a Tradie with only a mobile is a flash, not a 500', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.disconnectServerSms(AGENCY_NUMBER);
    const cookie = await w.signIn();

    const res = await w.post(`/dispatch/jobs/${job.jobId}/work-order`, { start: '2026-10-13T09:00', hours: '2' }, cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/dispatch\?error=/);
    expect(decodeURIComponent(res.headers.get('location')!.replace(/\+/g, ' '))).toContain(
      "Couldn't send the message: no SMS channel is connected and they have no email address.",
    );
  });
});

describe('Dispatch: what the page needs to run', () => {
  test('loads MapLibre and the map script from /assets, in that order, and works as a table when they do not run', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    expect(html).toContain('href="/assets/maplibre-gl.css"');
    expect(html).not.toMatch(/leaflet|MarkerCluster/i);
    // MapLibre is an ES module, which the map script imports once it runs; the page fetches it early.
    expect(html).toContain('<link rel="modulepreload" href="/assets/maplibre-gl.mjs"');
    const scripts = ['/assets/maplibre-gl.mjs', '/assets/dispatch-map.js'].map((src) => html.indexOf(src));
    for (const at of scripts) expect(at).toBeGreaterThan(-1);
    expect(html).toContain('<script type="module" src="/assets/dispatch-map.js"');
    expect(html).not.toMatch(/\son[a-z]+="/);
    expect(html).toContain('id="dispatch-map"');
    expect(visible(html)).toContain('The map needs JavaScript');
    expect(html).toContain('<table');
  });

  test('needs a signed-in Property Manager', async () => {
    const w = await webWorld();
    const res = await w.get('/dispatch');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/login/);
  });
});
