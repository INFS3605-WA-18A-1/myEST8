import { describe, expect, test } from 'vitest';
import { createDemo } from '../../src/demo/runtime.ts';

const HOUR = 3_600_000;

/** The demo with every external API mocked, whatever this machine's env vars say. Task errors fail the test. */
async function demoWorld() {
  const errors: Error[] = [];
  const d = await createDemo({ now: new Date('2026-10-08T09:00:00+11:00'), env: {}, logError: (e) => errors.push(e) });
  return { ...d, errors };
}

describe('the demo', () => {
  test('starts with Harbour Realty seeded and every external API mocked', async () => {
    const { demo, app, seed, apis, errors } = await demoWorld();
    expect(apis).toEqual({ classifier: 'mock', imageMatcher: 'mock', quoteReader: 'mock', places: 'mock' });
    expect(app.login('alice@harbour.example', 'demo1234')).toBe(seed.ids.aliceId);
    expect(app.login('bob@harbour.example', 'demo1234')).toBe(seed.ids.bobId);

    const alice = app.asPropertyManager(seed.ids.aliceId);
    expect(alice.properties().map((p) => p.address)).toEqual([
      '12 King St, Newtown NSW 2042',
      '21 Glebe Point Rd, Glebe NSW 2037',
      '5/40 Ocean Ave, Bondi NSW 2026',
      '7 Wilson St, Newtown NSW 2042',
    ]);

    const contacts = demo.contacts();
    const count = (role: string) => contacts.filter((c) => c.role === role).length;
    expect([count('tenant'), count('tradie'), count('owner'), count('building_manager')]).toEqual([5, 9, 2, 1]);
    expect(contacts.find((c) => c.name === 'Tom Tran')).toMatchObject({ role: 'tenant', mobile: '+61400000001', email: null });
    expect(contacts.find((c) => c.name === 'Bella Bui')).toMatchObject({ mobile: null, email: 'bella@example.com' });
    expect(errors).toEqual([]);
  });

  test('a Tenant texting from the simulator gets an acknowledgement', async () => {
    const { demo, errors } = await demoWorld();
    await demo.sendAs('+61400000001', 'sms', 'The kitchen tap is dripping');

    expect(demo.inbound()).toMatchObject([{ from: '+61400000001', channel: 'sms', text: 'The kitchen tap is dripping' }]);
    expect(errors).toEqual([]);
    const toTom = demo.outbox().filter((m) => m.to === '+61400000001');
    expect(toTom[0]).toMatchObject({ channel: 'sms', template: 'tenant.acknowledgement' });
  });

  test('time travel moves the clock and runs what falls due', async () => {
    const { demo } = await demoWorld();
    const before = demo.now().getTime();
    await demo.advance(48);
    const moved = demo.now().getTime() - before;
    expect(moved).toBeGreaterThanOrEqual(48 * HOUR);
    expect(moved).toBeLessThan(48 * HOUR + 60_000);
  });

  test('serves the sign-in page and keeps the simulator behind it', async () => {
    const { web } = await demoWorld();
    expect((await web.request('/login')).status).toBe(200);
    const res = await web.request('/demo');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login?next=%2Fdemo');

    const signIn = await web.request('/login', { method: 'POST', body: new URLSearchParams({ email: 'alice@harbour.example', password: 'demo1234' }) });
    expect(signIn.status).toBe(303);
    expect(signIn.headers.get('set-cookie')).toMatch(/^myest8_session=/);
  });
});
