import { describe, expect, test } from 'vitest';
import { webWorld } from '../support/web.ts';
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

    for (const text of ['id="channels"', 'id="tenants"', '/webhooks/twilio', 'WhatsApp sandbox', 'Inbound Parse', '/webhooks/sendgrid']) expect(setup).toContain(text);
    for (const text of ['Olivia Owens', 'Barry Strata', 'Flow Bros', 'Not on Google', KING_ST, '$500.00', 'Tom Tran']) expect(setup).toContain(text);
    expect(setup).toContain(`href="/tradies/${w.tradies.finn.id}"`);
  });

  test('connects a channel and sends a test message on it', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const connected = await submit(w, '/setup/channels', { type: 'sms', address: '+61 2 9000 1111' }, cookie);
    expect(connected.location).toMatch(/^\/setup\?form=channels&ok=/);
    expect(connected.page).toContain('SMS connected to +61 2 9000 1111');

    const tested = await submit(w, '/setup/channels/test', { type: 'sms', to: '0412 345 678' }, cookie);
    expect(tested.page).toContain('Test message sent to 0412 345 678 by SMS');

    const unknown = await submit(w, '/setup/channels', { type: 'fax', address: '123' }, cookie);
    expect(unknown.page).toContain('Choose SMS, WhatsApp or email');
  });

  test('adds a Tenant to a Property and lists them with it', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const added = await submit(
      w,
      '/setup/tenants',
      { name: 'Tina Test', mobile: '0412 000 111', propertyId: w.ids.kingSt, tenancyStart: '2026-09-01' },
      cookie,
    );

    expect(added.page).toContain('Tina Test added as a Tenant');
    expect(added.page).toContain('2026-09-01');
    expect(added.page).toContain('Hana Ho, Tina Test, Tom Tran');
  });

  test('a Tenant with no mobile or email is refused, with the reason next to the form', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const refused = await submit(w, '/setup/tenants', { name: 'Tina Test', propertyId: w.ids.kingSt, tenancyStart: '2026-09-01' }, cookie);

    expect(refused.location).toMatch(/^\/setup\?form=tenant&error=/);
    expect(refused.page).toContain('Enter a mobile number or email address');
    expect(refused.page).not.toContain('Tina Test');
  });

  test('adds a Property Owner, then a Property of theirs with a Nominated Tradie', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const owner = await submit(w, '/setup/owners', { name: 'Priya Patel', email: 'priya@example.com' }, cookie);
    expect(owner.page).toContain('Priya Patel added as a Property Owner');
    const ownerId = /<option value="(\d+)"[^>]*>Priya Patel<\/option>/.exec(owner.page)?.[1];
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
    expect(refused.location).toMatch(/^\/setup\?form=tradie&google=lucky&error=/);
    expect(refused.page).toContain('Link the Tradie to their Google listing, or mark them as not on Google');
    expect(refused.page).toContain('value="place-lucky"');
    expect(refused.page).toContain('Lucky Locks, Surry Hills');

    const added = await submit(w, '/setup/tradies?google=lucky', { ...tradie, placeId: 'place-lucky' }, cookie);
    expect(added.page).toContain('Lucky Locks added as a Tradie');
    expect(added.page).toContain('4.6 (22 reviews)');
    const tradieId = /href="\/tradies\/(\d+)">Lucky Locks</.exec(added.page)?.[1];
    expect(await page(w, `/tradies/${tradieId}`, cookie)).toContain('Lou Lucky');
  });
});
