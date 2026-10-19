import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { HANA, HANA_EMAIL, KING_ST, OCEAN_AVE, TOM, tomsTapTicket } from '../support/world.ts';

describe('Tenants', () => {
  test("the list is the Property Manager's own Tenants, each linked to their profile with their Property, start and open Tickets", async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const cookie = await w.signIn();

    const res = await w.get('/tenants', cookie);
    expect(res.status).toBe(200);
    const page = await res.text();
    const text = visible(page);
    expect(page).toMatch(/<a href="\/tenants" class="[^"]*" aria-current="page"/);
    for (const heading of ['Tenant', 'Property', 'Since', 'Open Tickets', 'Contact']) expect(page).toContain(`>${heading}</th>`);
    expect(page).toContain(`href="/tenants/${w.ids.tom}"`);
    expect(page).toContain(`href="/tenants/${w.ids.hana}"`);
    expect(page).not.toContain(`href="/tenants/${w.ids.bella}"`);
    expect(page).toContain(`href="/properties/${w.ids.kingSt}"`);
    expect(page).toContain(`href="tel:${HANA}"`);
    expect(page).toContain(`href="mailto:${HANA_EMAIL}"`);
    expect(text).toContain('1 Jan 2025');
    const tomRow = page.slice(page.indexOf(`href="/tenants/${w.ids.tom}"`), page.indexOf('</tr>', page.indexOf(`href="/tenants/${w.ids.tom}"`)));
    expect(tomRow).toMatch(/data-label="Open Tickets"><span[^>]*>1<\/span>/);
    // Hana comes before Tom: the list is by name.
    expect(page.indexOf(`/tenants/${w.ids.hana}"`)).toBeLessThan(page.indexOf(`/tenants/${w.ids.tom}"`));
  });

  test('All lists every Tenant of the Agency with their Property Manager', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get('/tenants?filter=all', cookie)).text();
    expect(page).toContain(`href="/tenants/${w.ids.bella}"`);
    expect(visible(page)).toContain(OCEAN_AVE);
    expect(visible(page)).toContain('Bob Baker');
    expect(page).toMatch(/<a href="\/tenants\?filter=all" class="segmented-item" aria-current="page">All<\/a>/);
  });

  test('Mine with no Tenants offers all of them', async () => {
    const w = await webWorld();
    const cookie = await w.signUp();
    const text = visible(await (await w.get('/tenants', cookie)).text());
    expect(text).toContain('No Tenants on your Properties');
  });

  test("a profile has the Tenant's Property, contact details, and their Tickets, Maintenance Requests and Reimbursement Requests", async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    w.h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
    await w.h.receive(TOM, 'Water is pouring through the ceiling');
    const urgentRepairId = (await w.alice.dashboard()).urgentRepairs[0]!.urgentRepairId;
    const cookie = await w.signIn();

    const res = await w.get(`/tenants/${w.ids.tom}`, cookie);
    expect(res.status).toBe(200);
    const page = await res.text();
    const text = visible(page);
    expect(page).toContain('<h1');
    expect(text).toContain('Tom Tran');
    expect(page).toContain(`href="/properties/${w.ids.kingSt}"`);
    expect(text).toContain(KING_ST);
    expect(page).toContain(`href="tel:${TOM}"`);
    expect(text).toContain('Weekday mornings');
    expect(text).toContain('Alice Archer');
    for (const heading of ['Tickets', 'Maintenance Requests waiting', 'Reimbursement Requests']) expect(page).toContain(`aria-label="${heading}"`);
    expect(page).toContain(`href="/tickets/${ticketId}"`);
    expect(page).toContain(`href="/reimbursements/${urgentRepairId}"`);
    expect(text).toContain('Reminder sent');
    expect(text).toContain('No Maintenance Requests waiting.');
    expect(page).toContain('href="/tenants"');
    expect(page).toMatch(/<a href="\/tenants" class="[^"]*" aria-current="page"/);
  });

  test('a profile links each Maintenance Request still waiting', async () => {
    const w = await webWorld();
    w.h.classifier.when('The shower is leaking', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await w.h.receive(HANA, 'The shower is leaking');
    await w.h.answer(HANA, 'Bathroom');
    await w.h.answer(HANA, 'Yesterday');
    await w.h.answer(HANA, 'No', 'no');
    await w.h.answer(HANA, 'Saturdays', 'saturdays');
    await w.h.advance(48 * 3_600_000);
    const issueId = (await w.alice.requests())[0]!.issueId;
    const cookie = await w.signIn();

    const page = await (await w.get(`/tenants/${w.ids.hana}`, cookie)).text();
    expect(page).toContain(`href="/requests/${issueId}"`);
    const text = visible(page);
    expect(text).toContain('No Tickets yet.');
    expect(text).toContain('No Reimbursement Requests.');
  });

  test("a Tenant of another Agency, or someone who isn't a Tenant, is a 404", async () => {
    const w = await webWorld();
    const sunrise = await w.signUp();
    const res = await w.get(`/tenants/${w.ids.tom}`, sunrise);
    expect(res.status).toBe(404);
    expect(visible(await res.text())).toContain("There's no such Tenant in your Agency.");

    const alice = await w.signIn();
    expect((await w.get(`/tenants/${w.ids.olivia}`, alice)).status).toBe(404);
    expect((await w.get('/tenants/99999', alice)).status).toBe(404);
  });

  test('signed out, the Tenant pages send you to sign in', async () => {
    const w = await webWorld();
    for (const path of ['/tenants', `/tenants/${w.ids.tom}`]) {
      const res = await w.get(path);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent(path)}`);
    }
  });
});

describe('links to Tenant profiles', () => {
  test('the Properties list and a Property profile link each Tenant', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const list = await (await w.get('/properties', cookie)).text();
    expect(list).toMatch(new RegExp(`<a class="link" href="/tenants/${w.ids.tom}">Tom Tran</a>`));
    expect(list).toContain(`href="/tenants/${w.ids.bella}"`);

    const profile = await (await w.get(`/properties/${w.ids.kingSt}`, cookie)).text();
    const tenants = profile.slice(profile.indexOf('aria-label="Tenants"'), profile.indexOf('aria-label="Nominated Tradies"'));
    expect(tenants).toContain(`href="/tenants/${w.ids.tom}"`);
    expect(tenants).toContain(`href="/tenants/${w.ids.hana}"`);
  });

  test('the Ticket and its Maintenance Request name the Tenant as a link', async () => {
    const w = await webWorld();
    w.h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await w.h.receive(TOM, 'The kitchen tap is dripping');
    await w.h.answer(TOM, 'Kitchen sink');
    await w.h.answer(TOM, 'Since Monday');
    await w.h.answer(TOM, 'No', 'no');
    await w.h.answer(TOM, 'Mornings', 'weekday_mornings');
    await w.h.advance(48 * 3_600_000);
    const issueId = (await w.alice.requests())[0]!.issueId;
    const cookie = await w.signIn();

    const request = await (await w.get(`/requests/${issueId}`, cookie)).text();
    expect(request).toContain(`href="/tenants/${w.ids.tom}"`);

    const ticketId = await w.alice.confirmMaintenanceRequest(issueId);
    const ticket = await (await w.get(`/tickets/${ticketId}`, cookie)).text();
    expect(ticket).toContain(`href="/tenants/${w.ids.tom}"`);
  });
});

describe('adding and removing Tenants', () => {
  test('the list adds a Tenant to the chosen Property and comes back to the list', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const list = await (await w.get('/tenants', cookie)).text();
    expect(list).toContain('href="#add-tenant"');
    expect(list).toContain('id="add-tenant"');
    expect(list).toContain('action="/setup/tenants"');
    expect(list).toMatch(new RegExp(`<option value="${w.ids.kingSt}"[^>]*>${KING_ST}</option>`));

    const res = await w.post('/setup/tenants', { name: 'Tina Test', mobile: '0412 000 111', propertyId: w.ids.kingSt, tenancyStart: '2026-09-01' }, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/tenants\?ok=/);
    const after = visible(await (await w.get(res.headers.get('location')!, cookie)).text());
    expect(after).toContain('Tina Test added as a Tenant');
    expect(after).toContain('Tina Test');
  });

  test('a refused Tenant comes back to the list with the reason beside the form', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const res = await w.post('/setup/tenants', { name: 'Tina Test', propertyId: w.ids.kingSt, tenancyStart: '2026-09-01' }, cookie);
    expect(res.headers.get('location')).toMatch(/^\/tenants\?form=tenant&error=/);
    const page = await (await w.get(res.headers.get('location')!, cookie)).text();
    const form = page.slice(page.indexOf('id="add-tenant"'));
    expect(form).toContain('Enter a mobile number or email address');
  });

  test('removing a Tenant takes them off the list and their Property, keeps their profile, and frees their mobile', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const list = await (await w.get('/tenants', cookie)).text();
    expect(list).toContain(`action="/tenants/${w.ids.hana}/remove"`);
    expect(list).toContain(`data-confirm="Remove Hana Ho from ${KING_ST}?`);

    const res = await w.post(`/tenants/${w.ids.hana}/remove`, {}, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/tenants\?ok=/);
    const after = await (await w.get(res.headers.get('location')!, cookie)).text();
    expect(visible(after)).toContain('Hana Ho removed from their Property');
    expect(after).not.toContain(`href="/tenants/${w.ids.hana}"`);
    expect(await (await w.get('/tenants?filter=all', cookie)).text()).not.toContain(`href="/tenants/${w.ids.hana}"`);
    expect(visible(await (await w.get(`/properties/${w.ids.kingSt}`, cookie)).text())).not.toContain('Hana Ho');

    const profile = await w.get(`/tenants/${w.ids.hana}`, cookie);
    expect(profile.status).toBe(200);
    const text = visible(await profile.text());
    expect(text).toContain('Former Tenant');
    expect(text).not.toContain('Remove');

    await w.alice.addTenant({ name: 'Nadia New', mobile: HANA, propertyId: w.ids.kingSt, tenancyStart: '2026-10-01' });
  });

  test('a Tenant with an open Ticket is not removed, and their profile says why', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const cookie = await w.signIn();

    const res = await w.post(`/tenants/${w.ids.tom}/remove`, {}, cookie);
    expect(res.headers.get('location')).toMatch(new RegExp(`^/tenants/${w.ids.tom}\\?error=`));
    expect(visible(await (await w.get(res.headers.get('location')!, cookie)).text())).toContain("Close Tom Tran's open Tickets before removing them");
    expect(await (await w.get('/tenants', cookie)).text()).toContain(`href="/tenants/${w.ids.tom}"`);
  });

  test("a Tenant of another Agency can't be removed", async () => {
    const w = await webWorld();
    const sunrise = await w.signUp();
    const res = await w.post(`/tenants/${w.ids.tom}/remove`, {}, sunrise);
    expect(res.headers.get('location')).toMatch(/error=/);
    expect(await (await w.get('/tenants', await w.signIn())).text()).toContain(`href="/tenants/${w.ids.tom}"`);
  });
});
