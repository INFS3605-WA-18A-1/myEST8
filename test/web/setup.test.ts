import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { KING_ST } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

async function page(w: Web, path: string, cookie: string) {
  const res = await w.get(path, cookie);
  expect(res.status).toBe(200);
  return res.text();
}

/** Posts a setup form and returns where it redirects to and the page shown there. */
async function submit(w: Web, path: string, fields: Record<string, string | number | (string | number)[]>, cookie: string) {
  const res = await w.post(path, fields, cookie);
  expect(res.status).toBe(303);
  const location = res.headers.get('location')!;
  return { location, page: await page(w, location, cookie) };
}

describe('the onboarding guide', () => {
  test('walks through every step and shows what the Agency already has', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const setup = await page(w, '/setup', cookie);

    for (const text of ['id="channels"', 'id="people"', 'id="tradies"', 'id="properties"', 'id="tenants"', 'Forward', 'Resend']) expect(setup).toContain(text);
    for (const text of ['Set up myEST8', 'aria-label="Setup areas"', 'href="#tradies"', 'href="#properties"', 'Use the step-by-step guide']) expect(setup).toContain(text);
    expect(setup).not.toContain('WhatsApp sandbox');
    expect(setup).not.toContain('/webhooks/twilio');
    expect(setup).not.toContain('/webhooks/sendgrid');
    for (const text of ['Olivia Owens', 'Barry Strata', KING_ST, 'Tom Tran', 'Flow Bros', 'Add a Tradie', 'Add a Property', '$500.00']) expect(setup).toContain(text);
    expect(setup).toContain('action="/setup/tradies?from=setup"');
    expect(setup).toContain('action="/setup/properties?from=setup"');

    const properties = await page(w, '/properties', cookie);
    for (const text of [KING_ST, '$500.00', 'Tom Tran', 'Olivia Owens']) expect(properties).toContain(text);

    const tradies = await page(w, '/tradies', cookie);
    for (const text of ['Flow Bros', 'Not on Google']) expect(tradies).toContain(text);
    expect(tradies).toContain(`href="/tradies/${w.tradies.finn.id}"`);
  });

  test('opens with the areas in order, each a link to its section saying what it has so far', async () => {
    const w = await webWorld();

    const nav = (html: string) => {
      const found = html.match(/<nav aria-label="Setup areas"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
      return { html: found, text: visible(found).replace(/\s+/g, ' ') };
    };
    const harbour = nav(await page(w, '/setup', await w.signIn()));
    for (const id of ['channels', 'people', 'tradies', 'properties', 'tenants']) expect(harbour.html).toMatch(new RegExp(`<a href="#${id}"`));
    expect(harbour.html).not.toMatch(/class="link[ "]/);
    expect(harbour.text).toMatch(/Tradies \d+ Tradies/);
    expect(harbour.text).toMatch(/Properties \d+ Properties/);

    const sunrise = nav(await page(w, '/setup', await w.signUp()));
    expect(sunrise.text).toContain('Tradies None yet');
    expect(sunrise.text).toContain('Tenants None yet');
  });

  test('verifies a typed SMS number with a code, and does not store a typed email address', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const started = await submit(w, '/setup/channels', { type: 'sms', address: '+61 2 9000 1111' }, cookie);
    expect(started.location).toMatch(/^\/setup\?form=channels&ok=/);
    expect(started.page).toContain('We sent a 6-digit code to +61290001111');
    expect(started.page).not.toContain('SMS connected to +61 2 9000 1111');
    const code = String(w.h.messenger.last('+61290001111')?.data.code);
    const verified = await submit(w, '/setup/channels/confirm', { type: 'sms', address: '+61 2 9000 1111', code }, cookie);
    expect(verified.page).toContain('Verified');

    const typed = await submit(w, '/setup/channels', { type: 'email', address: 'someone@example.com' }, cookie);
    expect(typed.page).not.toContain('someone@example.com');

    const unknown = await submit(w, '/setup/channels', { type: 'fax', address: '123' }, cookie);
    expect(unknown.page).toContain('Choose SMS or email');
  });

  test('adds a Tenant to a Property and lists them with it', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const added = await submit(
      w,
      '/setup/tenants?from=setup',
      { name: 'Tina Test', mobile: '0412 000 111', propertyId: w.ids.kingSt, tenancyStart: '2026-09-01' },
      cookie,
    );

    expect(added.page).toContain('Tina Test added as a Tenant');
    expect(visible(added.page)).toContain('1 Sep 2026');
    // Each Tenant's name links to their profile.
    expect(visible(await page(w, '/properties', cookie))).toMatch(/Hana Ho\s+Tina Test\s+Tom Tran/);
  });

  test('a Tenant with no mobile or email is refused, with the reason next to the form', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const refused = await submit(w, '/setup/tenants?from=setup', { name: 'Tina Test', propertyId: w.ids.kingSt, tenancyStart: '2026-09-01' }, cookie);

    expect(refused.location).toMatch(/^\/setup\?form=tenant&error=/);
    expect(refused.page).toContain('Enter a mobile number or email address');
    expect(refused.page).not.toContain('Tina Test');
  });

  test('adds a Property Owner, then a Property of theirs with a Nominated Tradie', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const owner = await submit(w, '/setup/owners', { name: 'Priya Patel', email: 'priya@example.com' }, cookie);
    expect(owner.page).toContain('Priya Patel added as a Property Owner');
    const ownerId = /<option value="(\d+)"[^>]*>Priya Patel<\/option>/.exec(await page(w, '/properties', cookie))?.[1];
    expect(ownerId).toBeDefined();

    const property = await submit(
      w,
      '/setup/properties',
      {
        address: '3 Wattle Rd, Glebe NSW 2037',
        suburb: 'Glebe',
        ownerId: ownerId!,
        propertyManagerId: w.ids.aliceId,
        maxRepairCost: '650',
        nominatedTradieIds: [w.ids.sam],
      },
      cookie,
    );

    expect(property.page).toContain('3 Wattle Rd, Glebe NSW 2037 added');
    expect(property.page).toContain('$650.00');
    expect(property.page).toContain('Sparky Sam');
  });

  test('a Tradie needs their Google listing or "Not on Google", and the search offers listings to choose from', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.places.listings.set('place-lucky', { name: 'Lucky Locks', address: 'Surry Hills', rating: 4.6, reviewCount: 22 });
    const tradie = { businessName: 'Lucky Locks', name: 'Lou Lucky', mobile: '0412 999 000', trades: ['locksmith'], startingRating: 4 };

    const refused = await submit(w, '/setup/tradies?google=lucky', tradie, cookie);
    expect(refused.location).toMatch(/^\/tradies\?form=tradie&google=lucky&error=/);
    expect(refused.page).toContain('Link the Tradie to their Google listing, or mark them as not on Google');
    expect(refused.page).toContain('value="place-lucky"');
    expect(refused.page).toContain('Lucky Locks, Surry Hills');

    const added = await submit(w, '/setup/tradies?google=lucky', { ...tradie, placeId: 'place-lucky' }, cookie);
    expect(added.page).toContain('Lucky Locks added as a Tradie');
    expect(added.page).toContain('22 reviews');
    const tradieId = /href="\/tradies\/(\d+)">Lucky Locks</.exec(added.page)?.[1];
    expect(await page(w, `/tradies/${tradieId}`, cookie)).toContain('Lou Lucky');
  });

  test('the Tradies and Properties sections on Setup come back to Setup, and keep the search and what went wrong', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.places.listings.set('place-lucky', { name: 'Lucky Locks', address: 'Surry Hills', rating: 4.6, reviewCount: 22 });
    const tradie = { businessName: 'Lucky Locks', name: 'Lou Lucky', mobile: '0412 999 000', trades: ['locksmith'], startingRating: 4 };

    const refused = await submit(w, '/setup/tradies?from=setup&google=lucky', tradie, cookie);
    expect(refused.location).toMatch(/^\/setup\?form=tradie&google=lucky&error=/);
    expect(refused.page).toContain('Link the Tradie to their Google listing, or mark them as not on Google');
    expect(refused.page).toContain('value="place-lucky"');
    expect(refused.page).toMatch(/<details class="mt-4" open>\s*<summary[^>]*>Add a Tradie/);

    const added = await submit(w, '/setup/tradies?from=setup&google=lucky', { ...tradie, placeId: 'place-lucky' }, cookie);
    expect(added.location).toMatch(/^\/setup\?ok=/);
    expect(added.page).toContain('Lucky Locks added as a Tradie');

    const noCost = await submit(w, '/setup/properties?from=setup', { address: '1 A St', suburb: 'A', ownerId: '1', propertyManagerId: w.ids.aliceId }, cookie);
    expect(noCost.location).toMatch(/^\/setup\?form=property&error=/);
    expect(noCost.page).toContain('Enter the Max Repair Cost');
  });
});
