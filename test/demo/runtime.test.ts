import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDemo } from '../../src/demo/runtime.ts';
import { closeAfter, demoEnv } from '../support/db.ts';
import { addPropertyTo, stubFetch } from '../support/geocoding.ts';

const HOUR = 3_600_000;

/** The demo with every external API mocked, whatever this machine's env vars say. Task errors fail the test. */
async function demoWorld() {
  return demoWorldWith();
}

async function demoWorldWith(extra: Record<string, string> = {}) {
  const errors: Error[] = [];
  const d = await createDemo({ now: new Date('2026-10-08T09:00:00+11:00'), env: demoEnv(extra), logError: (e) => errors.push(e) });
  closeAfter(d);
  return { ...d, errors };
}

describe('the demo', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('ANTHROPIC_API_KEY counts the classifier as real without a Jev URL', async () => {
    const { apis } = await demoWorldWith({ ANTHROPIC_API_KEY: 'test-anthropic-key' });
    expect(apis.classifier).toBe('real');
  });

  test('a Jev URL still counts the classifier as real when no Anthropic key is set', async () => {
    const { apis } = await demoWorldWith({ JEV_API_URL: 'https://jev.example/api' });
    expect(apis.classifier).toBe('real');
  });

  test('a blank Anthropic key stays on the mock classifier', async () => {
    const { apis } = await demoWorldWith({ ANTHROPIC_API_KEY: '   ' });
    expect(apis.classifier).toBe('mock');
  });

  test('NOMINATIM_URL counts the geocoder as real, and the demo geocodes through it', async () => {
    const requests = stubFetch();
    // Unseeded: a real Nominatim is asked one address a second, and the demo Agency has a dozen.
    const d = await createDemo({ env: demoEnv({ NOMINATIM_URL: 'https://nominatim.example', PUBLIC_URL: 'https://myest8.test' }), seedAgency: false });
    closeAfter(d);
    expect(d.apis.geocoder).toBe('real');
    await addPropertyTo(d.app, '12 King St, Newtown NSW 2042');

    const [request] = requests;
    expect(request!.url).toMatch(/^https:\/\/nominatim\.example\/search\?/);
    expect(request!.headers.get('user-agent')).toBe('myEST8 (https://myest8.test)');
  });

  test('a live server (npm start) geocodes through the public Nominatim by default, never the mock', async () => {
    const requests = stubFetch();
    const d = await createDemo({ env: demoEnv({ PUBLIC_URL: 'https://myest8.test' }), seedAgency: false, live: true });
    closeAfter(d);
    expect(d.apis.geocoder).toBe('real');
    await addPropertyTo(d.app, '12 King St, Newtown NSW 2042');

    expect(requests.map((r) => new URL(r.url).origin)).toEqual(['https://nominatim.openstreetmap.org']);
  });

  test('the demo suggests a known address from the mock, unless PHOTON_URL is set', async () => {
    const d = await createDemo({ env: demoEnv(), seedAgency: false });
    closeAfter(d);
    expect(d.apis.addressSuggester).toBe('mock');
    const propertyManagerId = await d.app.signUp({
      agencyName: 'Sunrise Realty',
      timeZone: 'Australia/Brisbane',
      name: 'Sam Sun',
      email: 'sam@sunrise.example',
      password: 'sunrise-2026',
    });
    const sam = await d.app.asPropertyManager(propertyManagerId);

    expect(await sam.suggestAddresses('Parramatta')).toEqual([
      {
        label: '3 Parramatta Rd, Annandale NSW 2038',
        address: '3 Parramatta Rd',
        suburb: 'Annandale',
        postcode: '2038',
        state: 'NSW',
        location: { lat: -33.885, lng: 151.183 },
      },
    ]);
  });

  test('PHOTON_URL sends suggestions there, and a live server uses the public Photon by default', async () => {
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({ type: 'FeatureCollection', features: [] });
    });
    const signUp = {
      agencyName: 'Sunrise Realty',
      timeZone: 'Australia/Brisbane',
      name: 'Sam Sun',
      email: 'sam@sunrise.example',
      password: 'sunrise-2026',
    };

    const custom = await createDemo({ env: demoEnv({ PHOTON_URL: 'https://photon.example', PUBLIC_URL: 'https://myest8.test' }), seedAgency: false });
    closeAfter(custom);
    expect(custom.apis.addressSuggester).toBe('real');
    const customPm = await custom.app.asPropertyManager(await custom.app.signUp(signUp));
    await customPm.suggestAddresses('King Street');
    expect(new URL(requests[0]!.url).origin).toBe('https://photon.example');
    expect(requests[0]!.headers.get('user-agent')).toBe('myEST8 (https://myest8.test)');

    requests.length = 0;
    const live = await createDemo({ env: demoEnv({ PUBLIC_URL: 'https://myest8.test' }), seedAgency: false, live: true });
    closeAfter(live);
    const livePm = await live.app.asPropertyManager(await live.app.signUp(signUp));
    await livePm.suggestAddresses('King Street');
    expect(requests.map((r) => new URL(r.url).origin)).toEqual(['https://photon.komoot.io']);
  });

  test("a demo listing's details and suggested Trades come from the mock Google and Jev", async () => {
    const { app, seed, errors } = await demoWorld();
    const alice = await app.asPropertyManager(seed.ids.aliceId);

    expect(await alice.googleListing('demo-sparky-sam')).toMatchObject({ name: 'Sparky Sam Electrical', phone: '+61 2 9660 0188', suggestedTrades: ['electrical'], tradesSuggested: true });
    expect(errors).toEqual([]);
  });

  test('starts with Harbour Realty seeded and every external API mocked', async () => {
    const { demo, app, seed, apis, errors } = await demoWorld();
    expect(apis).toEqual({ classifier: 'mock', imageMatcher: 'mock', quoteReader: 'mock', places: 'mock', geocoder: 'mock', addressSuggester: 'mock', messenger: 'mock' });
    expect(await app.login('alice@harbour.example', 'demo1234')).toBe(seed.ids.aliceId);
    expect(await app.login('bob@harbour.example', 'demo1234')).toBe(seed.ids.bobId);

    const alice = await app.asPropertyManager(seed.ids.aliceId);
    const properties = await alice.properties();
    expect(properties.map((p) => p.address)).toEqual(
      expect.arrayContaining([
        '12 King St, Newtown NSW 2042',
        '21 Glebe Point Rd, Glebe NSW 2037',
        '5/40 Ocean Ave, Bondi NSW 2026',
        '7 Wilson St, Newtown NSW 2042',
      ]),
    );
    // Five Properties each for Alice and Bob.
    expect([seed.ids.aliceId, seed.ids.bobId].map((pm) => properties.filter((p) => p.propertyManagerId === pm).length)).toEqual([5, 5]);

    const contacts = await demo.contacts(seed.ids.aliceId);
    const count = (role: string) => contacts.filter((c) => c.role === role).length;
    expect([count('tenant'), count('tradie'), count('owner'), count('building_manager')]).toEqual([13, 17, 6, 1]);
    expect(contacts.find((c) => c.name === 'Tom Tran')).toMatchObject({ role: 'tenant', mobile: '+61400000001', email: null });
    expect(contacts.find((c) => c.name === 'Bella Bui')).toMatchObject({ mobile: null, email: 'bella@example.com' });
    expect(errors).toEqual([]);
  });

  test('a Tenant texting from the simulator gets an acknowledgement', async () => {
    const { demo, seed, errors } = await demoWorld();
    const alice = seed.ids.aliceId;
    await demo.sendAs(alice, '+61400000001', 'sms', 'The kitchen tap is dripping');

    expect(await demo.inbound(alice)).toMatchObject([{ from: '+61400000001', to: '+61290000000', channel: 'sms', text: 'The kitchen tap is dripping' }]);
    expect(errors).toEqual([]);
    const toTom = (await demo.outbox(alice)).filter((m) => m.to === '+61400000001');
    expect(toTom[0]).toMatchObject({ channel: 'sms', from: '+61290000000', template: 'tenant.acknowledgement' });
  });

  test('an Agency that signs up gets its own simulator: its own people, channels and messages', async () => {
    const { app, demo, seed, errors } = await demoWorld();
    const sam = await app.signUp({ agencyName: 'Sunrise Realty', timeZone: 'Australia/Brisbane', name: 'Sam Sun', email: 'sam@sunrise.example', password: 'sunrise-2026' });
    const sunrise = await app.asPropertyManager(sam);
    const TINA = '+61400000999';

    expect(await demo.contacts(sam)).toEqual([]);
    expect(await demo.outbox(sam)).toEqual([]);
    await expect(demo.sendAs(sam, TINA, 'sms', 'Hello')).rejects.toThrow('Connect SMS in Setup first');

    await sunrise.connectChannel('sms', '+61 2 9100 0002');
    await sunrise.connectChannel('email', 'inbox@sunrise-realty.example');
    const owner = await sunrise.addOwner({ name: 'Omar Owen', mobile: '+61400000998' });
    const property = await sunrise.addProperty({
      address: '3 Sun St, Newtown NSW 2042',
      suburb: 'Newtown',
      ownerId: owner,
      propertyManagerId: sam,
      maxRepairCostCents: 300_00,
      nominatedTradieIds: [],
    });
    await sunrise.addTenant({ name: 'Tina Tan', mobile: TINA, propertyId: property, tenancyStart: '2026-01-01' });

    expect((await demo.contacts(sam)).map((p) => p.name)).toEqual(['Omar Owen', 'Tina Tan']);
    await demo.sendAs(sam, TINA, 'sms', 'The kitchen tap is dripping');

    expect(await demo.inbound(sam)).toMatchObject([{ from: TINA, to: '+61291000002' }]);
    expect((await demo.outbox(sam)).filter((m) => m.to === TINA)[0]).toMatchObject({ from: '+61291000002', template: 'tenant.acknowledgement' });
    expect(await demo.inbound(seed.ids.aliceId)).toEqual([]);
    expect((await demo.outbox(seed.ids.aliceId)).some((m) => m.to === TINA)).toBe(false);
    expect((await demo.contacts(seed.ids.aliceId)).some((p) => p.name === 'Tina Tan')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('time travel moves the clock and runs what falls due', async () => {
    const { demo } = await demoWorld();
    const before = demo.now().getTime();
    await demo.advance(48);
    const moved = demo.now().getTime() - before;
    expect(moved).toBeGreaterThanOrEqual(48 * HOUR);
    expect(moved).toBeLessThan(48 * HOUR + 60_000);
  });

  test('an empty PUBLIC_URL falls back to localhost on the port', async () => {
    const { baseUrl } = await demoWorldWith({ PUBLIC_URL: '', PORT: '4321' });
    expect(baseUrl).toBe('http://localhost:4321');
  });

  test('without TWILIO_AUTH_TOKEN the Twilio webhook still checks the demo key (dev behaviour is unchanged)', async () => {
    const { web } = await demoWorld();
    const res = await web.request('/webhooks/twilio', { method: 'POST', body: new URLSearchParams({ From: '+61400000000' }) });
    expect(res.status).toBe(403);
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
