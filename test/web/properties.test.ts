import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { KING_ST, OCEAN_AVE, tomsTapTicket } from '../support/world.ts';

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

  test('an unknown Property is a 404 in the design, not a blank page', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const res = await w.get('/properties/99999', cookie);
    expect(res.status).toBe(404);
    expect(visible(await res.text())).toContain('There is no such Property in your Agency.');
  });
});
