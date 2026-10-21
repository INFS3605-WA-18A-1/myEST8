import { describe, expect, test, vi } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { HANA, HANA_EMAIL, KING_ST, OCEAN_AVE, tomsTapTicket } from '../support/world.ts';

describe('Properties', () => {
  test('the list links each address to its profile and counts open Tickets', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const cookie = await w.signIn();

    const res = await w.get('/properties', cookie);
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain('2 Properties managed by the Agency.');
    expect(page).toContain(`href="/properties/${w.ids.kingSt}"`);
    expect(visible(page)).toContain('Open Tickets');
    expect(visible(page)).toContain(OCEAN_AVE);
    // The add form still posts to Setup.
    expect(page).toContain('action="/setup/properties"');
  });

  test('each row leads with the address and its open Tickets, and labels its values for phones', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const cookie = await w.signIn();

    const page = await (await w.get('/properties', cookie)).text();
    const headers = [...page.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(headers.slice(0, 3)).toEqual(['Property', 'Open Tickets', 'Max Repair Cost']);
    // The phone layout hides the header, so each value carries its column's name.
    const start = page.indexOf(`href="/properties/${w.ids.kingSt}"`);
    const row = page.slice(start, page.indexOf('</tr>', start));
    expect(page).toContain('table-frame is-stacked is-labelled');
    expect(row).toMatch(/data-label="Open Tickets"><span class="property-open">1<\/span>/);
    expect(row).toMatch(/data-label="Max Repair Cost">\$500\.00/);
    expect(row).toMatch(/data-label="Property Owner">Olivia Owens/);
  });

  test("a profile shows the open Ticket, the facts, Tenants and Nominated Tradies, with a way back", async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    const cookie = await w.signIn();

    const res = await w.get(`/properties/${w.ids.kingSt}`, cookie);
    expect(res.status).toBe(200);
    const page = await res.text();
    const text = visible(page);
    expect(text).toContain(KING_ST);
    expect(page).toContain(`href="/tickets/${ticketId}"`);
    for (const heading of ['Open Tickets', 'Max Repair Cost', 'Property Owner', 'Tenants', 'Nominated Tradies', 'Closed Tickets']) expect(text).toContain(heading);
    expect(text).toContain('Olivia Owens');
    expect(page).toContain('href="/properties"');
    expect(page).toContain('Back to Properties');
  });

  test('on a profile, Tenants and Nominated Tradies stack on phones with their values labelled', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get(`/properties/${w.ids.kingSt}`, cookie)).text();
    const tenants = page.slice(page.indexOf('aria-label="Tenants"'), page.indexOf('aria-label="Nominated Tradies"'));
    expect(tenants).toContain('table-frame is-stacked is-labelled');
    expect(tenants).toContain(`data-label="Mobile"><a class="contact-link num" href="tel:${HANA}">`);
    expect(tenants).toContain(`data-label="Email"><a class="contact-link is-email" href="mailto:${HANA_EMAIL}">`);
    const nominated = page.slice(page.indexOf('aria-label="Nominated Tradies"'), page.indexOf('aria-label="Frequent issues"'));
    expect(nominated).toContain('table-frame is-stacked is-labelled');
    expect(visible(nominated)).toMatch(/Sparky Sam Electrical/);
  });

  test('an unknown Property is a 404 in the design, not a blank page', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const res = await w.get('/properties/99999', cookie);
    expect(res.status).toBe(404);
    expect(visible(await res.text())).toContain('There is no such Property in your Agency.');
  });

  test('address suggestions come back from the suggester for a signed-in Property Manager', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.addressSuggester.suggestions = [
      {
        label: '12 King Street, Ashbury NSW 2193',
        address: '12 King Street',
        suburb: 'Ashbury',
        postcode: '2193',
        state: 'New South Wales',
        location: { lat: -33.8983619, lng: 151.1205914 },
      },
    ];

    const res = await w.get('/properties/address-suggestions?q=King%20Street', cookie);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(w.h.addressSuggester.suggestions);
    expect(w.h.addressSuggester.queries).toEqual(['King Street']);
  });

  test('address suggestions need a sign-in', async () => {
    const w = await webWorld();
    const res = await w.get('/properties/address-suggestions?q=King');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login');
  });

  test('address suggestions are an empty list when the suggester throws', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    w.h.addressSuggester.suggestions = new Error('Photon returned 500: down');

    const res = await w.get('/properties/address-suggestions?q=King', cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  test('a Property posted with a pin inside Australia keeps that pin instead of geocoding', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.geocoder.locations.set('9 Test St', { lat: -33.87, lng: 151.2 });

    const res = await w.post(
      '/setup/properties',
      {
        address: '9 Test St',
        suburb: 'Glebe',
        ownerId: w.ids.olivia,
        propertyManagerId: w.ids.aliceId,
        maxRepairCost: '500',
        lat: '-33.8983619',
        lng: '151.1205914',
      },
      cookie,
    );
    expect(res.status).toBe(303);

    const property = (await w.alice.properties()).find((p) => p.address === '9 Test St');
    expect(property?.location).toEqual({ lat: -33.8983619, lng: 151.1205914 });
  });

  test('a Property posted with a pin outside Australia is geocoded instead', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.geocoder.locations.set('9 Test St', { lat: -33.87, lng: 151.2 });

    await w.post(
      '/setup/properties',
      {
        address: '9 Test St',
        suburb: 'Glebe',
        ownerId: w.ids.olivia,
        propertyManagerId: w.ids.aliceId,
        maxRepairCost: '500',
        lat: '51.5074',
        lng: '-0.1278',
      },
      cookie,
    );

    const property = (await w.alice.properties()).find((p) => p.address === '9 Test St');
    expect(property?.location).toEqual({ lat: -33.87, lng: 151.2 });
  });

  test.each([
    ['no pin is posted', {}],
    ['only a latitude is posted', { lat: '-33.8983619' }],
    ['the pin is not a number', { lat: 'north', lng: '151.12' }],
  ])('a Property is geocoded when %s', async (_name, pin) => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.geocoder.locations.set('9 Test St', { lat: -33.87, lng: 151.2 });

    await w.post(
      '/setup/properties',
      {
        address: '9 Test St',
        suburb: 'Glebe',
        ownerId: w.ids.olivia,
        propertyManagerId: w.ids.aliceId,
        maxRepairCost: '500',
        ...pin,
      },
      cookie,
    );

    const property = (await w.alice.properties()).find((p) => p.address === '9 Test St');
    expect(property?.location).toEqual({ lat: -33.87, lng: 151.2 });
  });

  test('the Property forms keep Address and Suburb, and a hidden pin for a suggestion to fill', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    for (const path of ['/properties', '/setup', '/welcome/property?another']) {
      const page = await (await w.get(path, cookie)).text();
      expect(page, path).toContain('data-address-suggest');
      expect(page, path).toContain('name="address"');
      expect(page, path).toContain('name="suburb"');
      expect(page, path).toContain('name="lat"');
      expect(page, path).toContain('name="lng"');
    }
  });
});
