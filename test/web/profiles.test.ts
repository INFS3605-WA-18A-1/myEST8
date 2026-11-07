// The Profiles page: households, Tradies in their own box, search, Mine and All,
// people with no Property, the Add profile menu, and the side menu.

import { describe, expect, test } from 'vitest';
import { one, run } from '../../src/db.ts';
import { HOUR } from '../support/harness.ts';
import { visible, webWorld } from '../support/web.ts';
import { BELLA, confirmedQuotes, KING_ST, OCEAN_AVE, tomsTapTicket } from '../support/world.ts';

const ADD = ['/properties/new', '/tenants/new', '/owners/new', '/building-managers/new', '/tradies/new'];

describe('Profiles', () => {
  test('groups Tenants under their Property with the Owner and Building Manager', async () => {
    const w = await webWorld();
    const tap = await tomsTapTicket(w);
    w.h.classifier.when('The ceiling has a slow leak', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'high', trade: 'plumbing' });
    await w.h.receive(BELLA, 'The ceiling has a slow leak');
    await w.h.answerAll(BELLA, { location: 'The lounge', started: 'Last week', worsening: 'yes', availability: 'any_time' });
    await w.h.advance(49 * HOUR);
    const waiting = (await w.bob.dashboard()).maintenanceRequests;
    await w.bob.confirmMaintenanceRequest(waiting[0]!.issueId);
    const [quote] = await confirmedQuotes(w, tap, [
      [w.tradies.dana, 650_00],
      [w.tradies.pete, 700_00],
    ]);
    await w.alice.chooseQuote(quote!.quoteId);
    const cookie = await w.signIn();

    const page = await (await w.get('/profiles?filter=all', cookie)).text();
    expect(page).toContain('>2 Properties</a>, <a href="/tenants?filter=all">3 Tenants</a>, <a href="/owners">2 Property Owners</a>, <a href="/building-managers">1 Building Manager</a> and <a href="/tradies">6 Tradies</a>');
    const cards = page.split('<article class="household">').slice(1);
    const king = cards.find((card) => card.includes(KING_ST)) ?? '';
    const ocean = cards.find((card) => card.includes(OCEAN_AVE)) ?? '';
    expect(king).toContain(`href="/properties/${w.ids.kingSt}"`);
    expect(king).toContain(`href="/owners/${w.ids.olivia}"`);
    expect(king).toContain('1 approval waiting');
    expect(king).toContain('href="/approvals"');
    expect(king).toContain('household-waiting');
    expect(king).toContain('1 open Ticket');
    // The household lists its open Tickets, each a row to the Ticket with its Urgency.
    expect(king).toContain(`class="household-ticket" href="/tickets/${tap.ticketId}"`);
    expect(king).toContain('urgency-badge');
    expect(ocean).not.toContain('No open Tickets');
    expect(king).toContain(`href="/tenants/${w.ids.tom}"`);
    expect(king).toContain(`href="/tenants/${w.ids.hana}"`);
    expect(king.indexOf(`href="/tenants/${w.ids.hana}"`)).toBeLessThan(king.indexOf(`href="/tenants/${w.ids.tom}"`));
    expect(king).not.toContain('Building Manager');
    expect(ocean).toContain(`href="/owners/${w.ids.oscar}"`);
    expect(ocean).toContain(`href="/tenants/${w.ids.bella}"`);
    expect(ocean).toContain('household-manager');
    expect(ocean).toContain('Building Manager');
    expect(ocean).toContain(`href="/building-managers/${w.ids.barry}"`);
    expect(ocean).not.toContain('is-manager');
    // High at Ocean Ave sorts ahead of the routine Ticket at King St.
    expect(page.indexOf(OCEAN_AVE)).toBeLessThan(page.indexOf(KING_ST));
  });

  test('puts Tradies in their own box, in order of their first Trade, each with their Trades and rating', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get('/profiles', cookie)).text();
    const tradies = page.slice(page.indexOf('id="profiles-tradies"'));
    const text = visible(tradies);
    expect(tradies).toContain('>Tradies <span');
    // Plumbers come before electricians, by their first Trade.
    expect(text.indexOf("Pete's Plumbing")).toBeLessThan(text.indexOf('Sparky Sam'));
    expect(tradies).toContain('href="/tradies"');
    expect(tradies).toContain('aria-hidden="true">PP</span>');
    expect(tradies).toContain('href="/tradies/new"');
    expect(text).toContain('Not on the map');
    const start = tradies.indexOf(`href="/tradies/${w.ids.pete}"`);
    const pete = tradies.slice(start, tradies.indexOf('</li>', start));
    expect(pete).toContain('title="Pete&#39;s Plumbing"');
    expect(pete).not.toContain('Google');
    expect(visible(pete)).toContain('Plumbing');
    expect(visible(pete)).toContain('myEST8');
    expect(visible(pete)).toContain("Pete's Plumbing");
  });

  test('search filters households and Tradies', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const searched = await (await w.get('/profiles?filter=all&q=Bondi', cookie)).text();
    const subtitle = searched.slice(searched.indexOf('page-subtitle'), searched.indexOf('</p>', searched.indexOf('page-subtitle')));
    expect(subtitle).not.toContain('<a ');
    expect(subtitle).toContain('Matching “Bondi”');
    expect(visible(await (await w.get('/profiles?q=zzzz', cookie)).text())).toContain('Nothing matches “zzzz”');
    const byAddress = visible(searched);
    expect(byAddress).toContain(OCEAN_AVE);
    expect(byAddress).not.toContain(KING_ST);
    expect(byAddress).not.toContain("Pete's Plumbing");

    const byName = visible(await (await w.get('/profiles?q=Olivia', cookie)).text());
    expect(byName).toContain(KING_ST);
    expect(byName).not.toContain(OCEAN_AVE);

    const byTrade = visible(await (await w.get('/profiles?q=electrical', cookie)).text());
    expect(byTrade).toContain('Sparky Sam');
    expect(byTrade).not.toContain("Pete's Plumbing");
    expect(byTrade).not.toContain(KING_ST);
  });

  test('Mine is this Property Manager’s Properties and All is the Agency', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const mine = await (await w.get('/profiles', cookie)).text();
    expect(mine).toContain(KING_ST);
    expect(mine).not.toContain(OCEAN_AVE);
    expect(visible(mine)).toContain("Pete's Plumbing");
    expect(mine).toContain('>1 Property</a>, <a href="/tenants">2 Tenants</a>, <a href="/owners">1 Property Owner</a> and <a href="/tradies">6 Tradies</a>');
    expect(mine).toContain('href="/properties"');
    expect(mine).toContain('href="/tenants"');
    expect(mine).not.toContain('href="/tenants?filter=all"');
    expect(mine).not.toContain('See all Properties');
    expect(mine).not.toContain('See all Tenants');
    expect(visible(mine)).toContain('See all Tradies');

    const all = await (await w.get('/profiles?filter=all', cookie)).text();
    expect(all).toContain(OCEAN_AVE);
    expect(all).toContain('Bella Bui');
    expect(all).toContain('>2 Properties</a>, <a href="/tenants?filter=all">3 Tenants</a>, <a href="/owners">2 Property Owners</a>, <a href="/building-managers">1 Building Manager</a> and <a href="/tradies">6 Tradies</a>');
    expect(all).toContain('href="/tenants?filter=all"');
    // The chips keep All, so every list opens on All too (Tradies, the Agency's either way, carry it on).
    expect(all).toContain('href="/properties?filter=all"');
    expect(all).toContain('href="/owners?filter=all"');
    expect(all).toContain('href="/building-managers?filter=all"');
    expect(all).toContain('href="/tradies?filter=all"');
  });

  test('lists former Tenants and people with no Property', async () => {
    const w = await webWorld();
    await w.alice.removeTenant(w.ids.hana);
    await w.alice.addOwner({ name: 'Una Owner', email: 'una.owner@example.com' });
    await w.alice.addBuildingManager({ name: 'Una Manager', email: 'una.manager@example.com' });
    const cookie = await w.signIn();

    const page = await (await w.get('/profiles', cookie)).text();
    const unlinked = page.slice(page.indexOf('Not linked to a Property'));
    expect(unlinked).toContain('Former Tenants');
    expect(unlinked).toContain(`href="/tenants/${w.ids.hana}"`);
    expect(unlinked).toContain('Una Owner');
    expect(unlinked).toContain('Una Manager');
    expect(page.indexOf(`href="/tenants/${w.ids.tom}"`)).toBeLessThan(page.indexOf('Not linked to a Property'));
  });

  test('shows a concern chip only when a stored judgment supports one', async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    const ticket = await one<{ issue_id: number }>(w.h.db, 'SELECT issue_id FROM tickets WHERE id = ?', ticketId);
    const cookie = await w.signIn();

    expect(await (await w.get('/profiles', cookie)).text()).not.toContain('>Concern<');
    await run(w.h.db, 'INSERT INTO issue_judgments (issue_id, minor, tenant_caused, model) VALUES (?, ?, ?, ?)', ticket!.issue_id, 0.9, 0.9, 'test');
    const page = await (await w.get('/profiles', cookie)).text();
    const tom = page.slice(page.indexOf(`href="/tenants/${w.ids.tom}"`), page.indexOf('</li>', page.indexOf(`href="/tenants/${w.ids.tom}"`)));
    expect(tom).toContain('Concern');
    expect(tom).toContain('badge-warning');
    const hana = page.slice(page.indexOf(`href="/tenants/${w.ids.hana}"`), page.indexOf('</li>', page.indexOf(`href="/tenants/${w.ids.hana}"`)));
    expect(hana).not.toContain('Concern');
  });

  test('the Add profile menu links to each profile type', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get('/profiles', cookie)).text();
    const menu = page.slice(page.indexOf('class="add-menu"'), page.indexOf('</details>', page.indexOf('class="add-menu"')));
    expect(menu).toContain('data-menu');
    expect(menu).toContain('add-menu-button');
    expect(menu).toContain('add-menu-label');
    expect(menu).toContain('add-menu-caret');
    expect(menu).not.toContain('role="button"');
    expect(menu).toContain('Add profile');
    for (const href of ADD) expect(menu).toContain(`href="${href}"`);
  });

  test('a household card shows the Property photo, and none when there is no photo', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const upload = new FormData();
    upload.append('photo', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'front.png', { type: 'image/png' }));
    const posted = await w.web.request(`/properties/${w.ids.kingSt}/photo`, { method: 'POST', body: upload, headers: { cookie } });
    expect(posted.status).toBe(303);

    const page = await (await w.get('/profiles?filter=all', cookie)).text();
    const cards = page.split('<article class="household">').slice(1);
    const king = cards.find((card) => card.includes(KING_ST)) ?? '';
    const ocean = cards.find((card) => card.includes(OCEAN_AVE)) ?? '';
    const src = /src="(\/properties\/\d+\/photo\?v=\d+)"/.exec(king)?.[1];
    expect(src).toMatch(new RegExp(`^/properties/${w.ids.kingSt}/photo\\?v=\\d+$`));
    expect(king).toContain(`class="household-photo" src="${src}" alt="" width="640" height="400" loading="lazy" decoding="async"`);
    // No photo: a dashed link to where one is added, and no picture.
    expect(ocean).not.toContain('<img');
    expect(ocean).not.toContain('class="household-photo"');
    expect(ocean).toContain(`<a class="household-photo-slot is-empty" href="/properties/${w.ids.oceanAve}#photo">`);
    expect(visible(ocean)).toContain('Add a photo');
  });

  test('a household shows its open Tickets and worst Urgency in tiles, and the Tickets behind a toggle', async () => {
    const w = await webWorld();
    const tap = await tomsTapTicket(w);
    const cookie = await w.signIn();

    const page = await (await w.get('/profiles', cookie)).text();
    const king = page.split('<article class="household">').slice(1).find((card) => card.includes(KING_ST)) ?? '';
    const tiles = visible(king.slice(king.indexOf('class="household-status"'), king.indexOf('household-history-panel')));
    expect(tiles).toContain('1 Open Ticket');
    expect(tiles).toContain('Urgency');
    expect(tiles).not.toContain('Worst');
    expect(king).toContain('data-history-toggle');
    expect(visible(king)).toContain('Ticket history');
    const toggle = king.slice(king.indexOf('household-history-panel'));
    expect(visible(toggle)).toContain('Open all in Tickets');
    expect(visible(toggle)).not.toContain('Open all 1');
    expect(visible(toggle)).toContain(`#${tap.ticketId}`);
    expect(toggle).toContain(`class="household-ticket" href="/tickets/${tap.ticketId}"`);
    expect(toggle).toContain('href="/tickets"');
    // Nothing open: Clear, no toggle.
    const calm = page.split('<article class="household">').slice(1).find((card) => !card.includes('household-history')) ?? '';
    if (calm) expect(visible(calm)).toContain('Nothing to fix');
    // The header counts them.
    expect(visible(page)).toContain('1 open Ticket');
  });

  test('the chips beside the title open each kind of profile, and All is this page', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get('/profiles', cookie)).text();
    const chips = page.slice(page.indexOf('<nav class="profiles-chips"'), page.indexOf('</nav>', page.indexOf('<nav class="profiles-chips"')));
    expect(chips).toContain('profiles-chip is-active" href="/profiles"');
    for (const href of ['/properties', '/tenants', '/owners', '/tradies', '/building-managers']) expect(chips).toContain(`href="${href}"`);
    expect(visible(chips)).toContain('Properties 1');
    expect(visible(chips)).toContain('Tradies 6');
  });

  test('the side menu has one Profiles item, current on a profile page', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    for (const path of ['/profiles', `/tenants/${w.ids.tom}`, `/properties/${w.ids.kingSt}`, '/owners/new', '/tradies/new', '/properties/new']) {
      const page = await (await w.get(path, cookie)).text();
      const rail = [...page.matchAll(/<a href="([^"]+)" class="rail-link"/g)].map((match) => match[1]);
      expect(rail, path).toContain('/profiles');
      expect(rail, path).not.toContain('/properties');
      expect(rail, path).not.toContain('/tenants');
      expect(page, path).toMatch(/<a href="\/profiles" class="rail-link" aria-current="page">/);
    }
  });
});

describe('Add a Property', () => {
  test('the form is on its own page, and a refused save comes back there', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const list = await (await w.get('/properties', cookie)).text();
    expect(list).toContain('href="/properties/new"');
    expect(list).not.toContain('id="add-property"');

    const fresh = await w.get('/properties/new', cookie);
    expect(fresh.status).toBe(200);
    const form = await fresh.text();
    expect(form).toContain('action="/setup/properties"');
    expect(form).toContain('Add a Property');
    expect(form).toMatch(/<a href="\/profiles" class="rail-link" aria-current="page">/);

    const refused = await w.post(
      '/setup/properties',
      { address: '', suburb: 'Glebe', ownerId: w.ids.olivia, propertyManagerId: w.ids.aliceId, maxRepairCost: '500' },
      cookie,
    );
    expect(refused.status).toBe(400);
    const again = await refused.text();
    expect(again).toContain('Enter the address and suburb');
    expect(again).toContain('value="Glebe"');
    expect(again).toContain('<title>Add a Property - myEST8</title>');
  });
});
