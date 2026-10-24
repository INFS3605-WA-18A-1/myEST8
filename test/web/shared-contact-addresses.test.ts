import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { HANA_EMAIL, OLIVIA_EMAIL, PETE } from '../support/world.ts';

const detailsOf = (page: string) => page.slice(page.indexOf('id="details"'), page.indexOf('</section>', page.indexOf('id="details"')));

describe('a shared contact address on the page', () => {
  test("adding a Property Owner with a Tenant's email saves, with no refusal", async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const res = await w.post('/setup/owners?from=list', { name: 'Kevin He', email: HANA_EMAIL }, cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/owners\?ok=/);
    const list = visible(await (await w.get(res.headers.get('location')!, cookie)).text());
    expect(list).toContain('Kevin He added as a Property Owner');
    expect(list).not.toContain('already belongs');
    expect((await w.alice.people('owner')).find((p) => p.name === 'Kevin He')).toMatchObject({ email: 'hana@example.com' });
    expect(await w.alice.tenant(w.ids.hana)).toMatchObject({ name: 'Hana Ho', email: 'hana@example.com' });
  });

  test('both profiles say who else uses the shared email, and the note is a link', async () => {
    const w = await webWorld();
    const kevin = await w.alice.addOwner({ name: 'Kevin He', email: HANA_EMAIL });
    const cookie = await w.signIn();

    const owner = detailsOf(await (await w.get(`/owners/${kevin}`, cookie)).text());
    expect(owner).toContain(`href="/tenants/${w.ids.hana}"`);
    expect(visible(owner)).toContain('Also Hana Ho (Tenant)');

    const tenant = detailsOf(await (await w.get(`/tenants/${w.ids.hana}`, cookie)).text());
    expect(tenant).toContain(`href="/owners/${kevin}"`);
    expect(visible(tenant)).toContain('Also Kevin He (Property Owner)');
  });

  test('the Inbox card for a shared address names both people and offers Pick a contact', async () => {
    const w = await webWorld();
    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: PETE, email: OLIVIA_EMAIL });
    await w.h.receive(PETE, 'Hello from the shared phone');
    const cookie = await w.signIn();

    const page = await (await w.get('/', cookie)).text();
    const box = page.slice(page.indexOf('id="inbox"'), page.indexOf('</section>', page.indexOf('id="inbox"')));
    expect(box).toContain('Shared address');
    expect(box).toMatch(
      new RegExp(
        `Could be <a href="/owners/${w.ids.olivia}">Olivia Owens \\(Property Owner\\)</a> or <a href="/tradies/${w.ids.pete}">Pete Park \\(Tradie\\)</a>\\.`,
      ),
    );
    expect(box).toContain(`href="/owners/${w.ids.olivia}"`);
    expect(box).toContain(`href="/tradies/${w.ids.pete}"`);
    expect(box).toContain('Pick a contact');
    expect(box).toContain('Hello from the shared phone');
  });
});
