import { describe, expect, test } from 'vitest';
import { MAP_TILES } from '../../src/web/map-config.ts';
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
    tiles: { url: string; subdomains: string; attribution: string; maxZoom: number };
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
    w.h.places.locations.set(base.address, base.location);
    await w.alice.setTradieAddress(tradieId, base.address);
  }
}

describe('Dispatch: the map data', () => {
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

  test('the tile source and its attribution are the one map setting, and the search radius defaults to 15 km', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const data = pinData(await dispatch(w, cookie));

    expect(data.tiles).toEqual(MAP_TILES);
    expect(data.radiusKm).toBe(15);
  });

  test('a Property whose address contains </script> and quotes cannot break out of the data block', async () => {
    const w = await webWorld();
    const hostile = `1 "Quote" St </script><img src=x onerror=alert(1)> & <!-- \u2028 end`;
    w.h.places.locations.set(hostile, { lat: -33.9, lng: 151.2 });
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
    expect(text).toMatch(/0\.6 km/);
    expect(text).toMatch(/2\.2 km/);
    expect(text).toContain('Plumbing');
    // Both ratings side by side, never combined.
    expect(text).toContain('myEST8 4.0 (1 rating) Google 4.8 (120 reviews)');
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

describe('Dispatch: finding addresses again', () => {
  test('opening the page never looks addresses up; the button shown while some are missing does, and they gain pins', async () => {
    const w = await webWorld();
    const id = await w.alice.addProperty({ address: UNKNOWN_ADDRESS, suburb: 'Newtown', ownerId: w.ids.olivia, propertyManagerId: w.ids.aliceId, maxRepairCostCents: 500_00, nominatedTradieIds: [] });
    const cookie = await w.signIn();
    let lookups = 0;
    const geocode = w.h.places.geocode.bind(w.h.places);
    w.h.places.geocode = async (address) => {
      lookups++;
      return geocode(address);
    };
    w.h.places.locations.set(UNKNOWN_ADDRESS, { lat: -33.89, lng: 151.18 });

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
    w.h.places.geocode = async () => {
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

    w.h.places.locations.set(UNKNOWN_ADDRESS, { lat: -33.89, lng: 151.18 });
    w.h.places.locations.set(KING_ST, { lat: 0, lng: 0 });
    expect(await w.alice.geocodeMissing()).toBe(1);

    expect((await w.alice.properties()).find((p) => p.id === id)!.location).toEqual({ lat: -33.89, lng: 151.18 });
    expect((await w.alice.properties()).find((p) => p.id === w.ids.kingSt)!.location).toEqual({ lat: -33.897, lng: 151.179 });
  });

  test('a Tradie with an address but no location is placed too', async () => {
    const w = await webWorld();
    await w.alice.setTradieAddress(w.ids.nina, NINA_BASE.address);
    expect((await w.alice.people('tradie')).find((t) => t.id === w.ids.nina)).toMatchObject({ businessAddress: NINA_BASE.address, location: null });

    w.h.places.locations.set(NINA_BASE.address, NINA_BASE.location);
    expect(await w.alice.geocodeMissing()).toBe(1);

    expect((await w.alice.people('tradie')).find((t) => t.id === w.ids.nina)!.location).toEqual(NINA_BASE.location);
  });
});

describe('Dispatch: the Tradie schedule', () => {
  test("shows the Tradies with a visit booked from today, each visit with its issue, street and Ticket link", async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    const schedule = sectionText(html, 'tradie-schedule');
    const [booked, all] = schedule.split('<details');
    expect(booked).toContain(`href="/tradies/${w.ids.pete}"`);
    expect(booked).toContain(`href="/tickets/${job.ticketId}"`);
    const text = visible(booked!);
    expect(text).toContain("Pete's Plumbing");
    expect(text).toContain('Tue 13 Oct');
    expect(text).toContain('The kitchen tap is dripping');
    expect(text).toContain('12 King St, Newtown');
    expect(text).toContain('Not confirmed yet');
    // A Tradie with nothing booked is only in the full table, behind the disclosure, and empty days are blank.
    expect(text).not.toContain("Nina's Plumbing");
    expect(booked).not.toContain('<span aria-hidden="true">–</span>');
    expect(visible(all!)).toContain(`Show all 6 Tradies`);
    expect(visible(all!)).toContain("Nina's Plumbing");
    expect(visible(all!)).toContain('Nothing booked');
  });

  test('with nothing booked it says so, and every Tradie is still a click away', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const text = visible(sectionText(await dispatch(w, cookie), 'tradie-schedule'));

    expect(text).toContain('No Tradie is booked in the next 7 days.');
    expect(text).toContain('Show all 6 Tradies');
  });
});

describe('Dispatch: what the page needs to run', () => {
  test('loads Leaflet, its pin grouping and the map script from /assets, in that order, and works as a table when they do not run', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const html = await dispatch(w, cookie);

    expect(html).toContain('href="/assets/leaflet.css"');
    expect(html).toContain('href="/assets/MarkerCluster.css"');
    const scripts = ['/assets/leaflet.js', '/assets/leaflet.markercluster.js', '/assets/dispatch-map.js'].map((src) => html.indexOf(`src="${src}"`));
    for (const at of scripts) expect(at).toBeGreaterThan(-1);
    expect(scripts).toEqual([...scripts].sort((a, b) => a - b));
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
