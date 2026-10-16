import { describe, expect, test } from 'vitest';
import { UndeliverableError } from '../../src/ports.ts';
import type { DemoControls } from '../../src/demo/controls.ts';
import { visible, webWorld } from '../support/web.ts';
import { KING_ST, OLIVIA } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;
type Fields = Record<string, string | number | (string | number)[]>;

async function page(w: Web, path: string, cookie: string) {
  const res = await w.get(path, cookie);
  expect(res.status, path).toBe(200);
  return res.text();
}

/** Posts a form that should succeed, and returns the page it redirects to. */
async function submit(w: Web, path: string, fields: Fields, cookie: string) {
  const res = await w.post(path, fields, cookie);
  expect(res.status, `${path} -> ${res.status}`).toBe(303);
  const location = res.headers.get('location')!;
  expect(location).not.toContain('error=');
  return { location, page: await page(w, location.split('#')[0]!, cookie) };
}

/** A first Property with its Property Owner and Tenant, with `changes` applied. */
function propertyFields(changes: Fields = {}): Fields {
  return {
    address: '3 Sun St, Newtown NSW 2042',
    suburb: 'Newtown',
    maxRepairCost: '300',
    ownerName: 'Omar Owen',
    ownerMobile: '0400 000 998',
    ownerEmail: '',
    tenantName: 'Tina Tan',
    tenantMobile: '0400 000 999',
    tenantEmail: '',
    tenancyStart: '2026-01-01',
    buildingManagerName: '',
    buildingManagerMobile: '',
    buildingManagerEmail: '',
    ...changes,
  };
}

const TRADIE: Fields = { businessName: 'Sunny Plumbing', name: 'Sunny Sun', mobile: '0400 000 997', email: '', trades: ['plumbing'], startingRating: 4, placeId: 'none' };

describe('a channel this server cannot deliver on', () => {
  const connectors = (unavailable: ('sms' | 'email')[]) => ({ gmail: null, smsInbound: 'none' as const, unavailable });

  test('is not offered on the wizard or /setup, with a plain note instead, and does not hold setup back', async () => {
    const w = await webWorld({ connectors: connectors(['sms']) });
    const sam = await w.signUp();

    for (const path of ['/welcome/channels', '/setup']) {
      const html = await page(w, path, sam);
      expect(visible(html), path).toContain("SMS isn't available on this server yet. Tenants can still reach you by email.");
      expect(html, path).not.toContain('id="sms-address"');
      expect(html, path).toContain('id="email-address"');
    }
    // Email is allocated on the first visit; with SMS unavailable there is nothing else to wait for.
    expect(visible(await page(w, '/', sam))).not.toContain('connect SMS');
  });

  test('email too: nothing is offered, and the note does not promise another way in', async () => {
    const w = await webWorld({ connectors: connectors(['sms', 'email']) });
    const sam = await w.signUp();
    for (const path of ['/welcome/channels', '/setup']) {
      const html = await page(w, path, sam);
      expect(visible(html), path).toContain("Email forwarding isn't available on this server yet.");
      expect(visible(html), path).not.toContain('Tenants can still reach you by');
      expect(html, path).not.toContain('id="email-address"');
      expect(html, path).not.toContain('id="sms-address"');
    }
  });

  test('is offered as usual when the server can deliver on it', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    const html = await page(w, '/welcome/channels', sam);
    expect(html).toContain('id="sms-address"');
    expect(visible(html)).not.toContain("isn't available on this server");
  });
});

describe('channel status badges', () => {
  test('may wrap inside their column, so a long one cannot run into the next column', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    for (const path of ['/welcome/channels', '/setup']) {
      const html = await page(w, path, sam);
      expect(html, path).toMatch(/<span class="badge[^"]*whitespace-normal[^"]*">Waiting for your first message<\/span>/);
      expect(html, path).not.toMatch(/whitespace-nowrap[^"]*">Waiting for your first message/);
    }
  });
});

describe('WhatsApp is not on the channel pages', () => {
  test('neither the wizard nor /setup offers it, counts it or names it, and a posted WhatsApp number is refused', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    for (const path of ['/welcome/channels', '/setup']) {
      const html = await page(w, path, sam);
      expect(visible(html), path).not.toMatch(/whatsapp/i);
      expect(html, path).not.toContain('id="whatsapp"');
    }
    const refused = await w.post('/welcome/channels', { type: 'whatsapp', address: '+61 2 9100 0002' }, sam);
    expect(decodeURIComponent(refused.headers.get('location')!)).toContain('Choose SMS or email');
  });
});

describe('what a verified SMS number promises', () => {
  async function verifiedSms(smsInbound: 'simulator' | 'none') {
    const w = await webWorld({ connectors: { gmail: null, unavailable: [], smsInbound } });
    const sam = await w.signUp();
    await submit(w, '/welcome/channels', { type: 'sms', address: '+61 2 9100 0002' }, sam);
    const code = String(w.h.messenger.last('+61291000002')?.data.code);
    await submit(w, '/welcome/channels/confirm', { type: 'sms', address: '+61 2 9100 0002', code }, sam);
    return Promise.all(['/welcome/channels', '/setup'].map(async (path) => visible(await page(w, path, sam))));
  }

  test('on a real server the typed number is not claimed to receive Tenant texts', async () => {
    for (const text of await verifiedSms('none')) {
      expect(text).toContain("is confirmed as the Agency's number. Texts to it don't reach myEST8 yet.");
      expect(text).not.toContain('Tenants reach the Agency at +61291000002');
    }
  });

  test('in the demo the simulator receives them', async () => {
    for (const text of await verifiedSms('simulator')) expect(text).toContain('Tenants reach the Agency at +61291000002');
  });
});

describe('the onboarding wizard', () => {
  test('a code that cannot be delivered (no SMS provider, as on a hosted app without Twilio) is a message on the page, not a server error', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    w.h.messenger.send = async (message) => {
      throw new UndeliverableError(message.channelType, message.to, 'no sms provider is configured');
    };

    const res = await w.post('/welcome/channels', { type: 'sms', address: '+61 2 9100 0002' }, sam);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/welcome\/channels\?channel=sms&error=.*#sms$/);
    const text = visible(await page(w, res.headers.get('location')!.split('#')[0]!, sam));
    expect(text).toContain("We couldn't send a code to +61 2 9100 0002");
    expect(text).toContain('Check the number and try again');
    expect(text).not.toContain('Undeliverable');
  });

  test('a new Agency adds a colleague, connects and tests its channels, adds its first Property and a Tradie, and sees it all ticked', async () => {
    const w = await webWorld();
    const sam = await w.signUp();

    const welcome = visible(await page(w, '/welcome', sam));
    expect(welcome).toContain('Step 1 of 6');
    expect(welcome).toContain('about 5 minutes');

    // 2 Your team: the colleague's temporary password is shown once, and works.
    const added = await w.post('/welcome/team', { name: 'Casey Cole', email: 'casey@sunrise.example' }, sam);
    expect(added.status).toBe(200);
    expect(added.headers.get('cache-control')).toBe('no-store');
    const teamPage = await added.text();
    expect(visible(teamPage)).toContain('Casey Cole added as a Property Manager');
    const temporaryPassword = /data-temporary-password>([^<]+)</.exec(teamPage)![1]!;
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(10);
    const casey = await w.signIn('casey@sunrise.example', temporaryPassword);
    expect(visible(await page(w, '/welcome/team', casey))).toContain('Sam Sun');
    expect(await page(w, '/welcome/team', sam)).not.toContain(temporaryPassword);

    // 3 Channels: a code verifies a typed number. Email is the allocated inbound address.
    const before = visible(await page(w, '/welcome/channels', sam));
    expect(before).toContain("Still to do: verify the Agency's SMS number with a code, and send one email to the Agency inbox so it's forwarded here.");
    expect(before).toContain('sunrise-realty@mail.example.test');
    expect(before).toContain('Waiting for your first message');
    expect(before).toContain('Copy');
    expect(before).toContain('Forward');
    expect(before).not.toContain('WhatsApp sandbox');
    expect(before).not.toContain('SendGrid');

    const sms = await submit(w, '/welcome/channels', { type: 'sms', address: '+61 2 9100 0002' }, sam);
    expect(sms.location).toMatch(/^\/welcome\/channels\?channel=sms&ok=.*#sms$/);
    expect(visible(sms.page)).toContain('We sent a 6-digit code to +61291000002');
    expect(visible(sms.page)).not.toContain('SMS verified');
    const smsCode = String(w.h.messenger.last('+61291000002')?.data.code);
    const verified = await submit(w, '/welcome/channels/confirm', { type: 'sms', address: '+61 2 9100 0002', code: smsCode }, sam);
    expect(visible(verified.page)).toContain('SMS verified');

    expect(visible(verified.page)).toContain("Still to do: send one email to the Agency inbox so it's forwarded here.");
    const typed = await w.post('/welcome/channels', { type: 'email', address: 'inbox@sunrise.example' }, sam);
    expect(decodeURIComponent(typed.headers.get('location')!)).not.toContain('inbox@sunrise.example');
    expect(visible(await page(w, '/welcome/channels', sam))).not.toContain('inbox@sunrise.example');

    // 4 First Property, with its Property Owner and Tenant in one form.
    const property = await submit(w, '/welcome/property', propertyFields(), sam);
    expect(property.location).toMatch(/^\/welcome\/property\?added=\d+$/);
    const shown = visible(property.page);
    expect(shown).toContain('Property added');
    expect(shown).toContain('3 Sun St, Newtown NSW 2042 is set up with Property Owner Omar Owen and Tenant Tina Tan');
    expect(shown).toContain('$300.00');
    expect(shown).toContain('Add another Property');

    // 5 Tradies
    const tradie = await submit(w, '/welcome/tradies', TRADIE, sam);
    expect(visible(tradie.page)).toContain('Sunny Plumbing added as a Tradie');
    expect(visible(tradie.page)).toContain('Not on Google');

    // 6 Done
    const done = visible(await page(w, '/welcome/done', sam));
    expect(done).toContain("You're set up");
    for (const item of [
      'Done: Sunrise Realty created',
      'Done: 2 Property Managers on the team',
      'Done: SMS verified at +61291000002',
      'To do: Email is sunrise-realty@mail.example.test, waiting for your first message',
      'Done: 1 Property with 1 Tenant',
      'Done: 1 Tradie',
    ]) {
      expect(done).toContain(item);
    }
    expect(done).toContain('Go to your dashboard');
    expect(visible(await page(w, '/', sam))).not.toContain('Finish setting up');
  });

  test('fills the page with no rail, and offers "Set up later" on the first step', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    for (const path of ['/welcome', '/welcome/team', '/welcome/channels', '/welcome/tradies', '/welcome/property', '/welcome/done']) {
      const html = await page(w, path, sam);
      expect(html, path).not.toContain('has-rail');
      expect(html, path).not.toContain('data-drawer-toggle');
      expect(html, path).toContain('aria-label="Setup steps"');
    }
    expect(visible(await page(w, '/welcome', sam))).toContain('Set up later');
    expect((await w.get('/tickets', sam)).status).toBe(200);
  });

  test('says which step this is inside the steps, not at the far edge of the page', async () => {
    const w = await webWorld();
    const sam = await w.signUp();

    const html = await page(w, '/welcome/channels', sam);

    const nav = html.match(/<nav aria-label="Setup steps"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(visible(nav)).toContain('Step 3 of 6');
    expect(visible(nav)).toContain('Setting up Sunrise Realty');
    expect(html).not.toMatch(/class="page-subtitle"[^>]*>[\s\S]*?Step 3 of 6/);
  });

  test('the last step lists what is left with a button for each, and ends with the way to the dashboard', async () => {
    const w = await webWorld();
    const sam = await w.signUp();

    const html = await page(w, '/welcome/done', sam);

    for (const [href, label] of [
      ['/welcome/team', 'Add colleagues'],
      ['/welcome/channels#sms', 'Connect SMS'],
      ['/welcome/channels#email', 'Check email'],
      ['/welcome/tradies', 'Add Tradies'],
      ['/welcome/property', 'Add a Property'],
    ]) {
      expect(html).toMatch(new RegExp(`<a href="${href}" class="btn [^"]*">${label}</a>`));
    }
    const checklist = html.match(/<ul[^>]*aria-label="Setup checklist"[\s\S]*?<\/ul>/)?.[0] ?? '';
    expect(checklist).toContain('Connect SMS');
    expect(checklist).not.toMatch(/class="link[ "]/);
    const foot = html.match(/<div class="wizard-foot[^"]*">[\s\S]*?<\/main>/)?.[0] ?? '';
    expect(foot).toMatch(/<a href="\/" class="btn [^"]*btn-primary[^"]*">Go to your dashboard<\/a>/);
  });

  test('shows where the Agency is up to: each step offers "Skip for now" until it is done, then "Continue"', async () => {
    const w = await webWorld();
    const sam = await w.signUp();

    const before = await page(w, '/welcome/team', sam);
    expect(before).toContain('aria-current="step"');
    expect(visible(before)).toContain('Skip for now');
    expect(visible(before)).not.toContain('Continue');
    expect(before).toContain('href="/welcome"'); // Back

    await w.post('/welcome/team', { name: 'Casey Cole', email: 'casey@sunrise.example' }, sam);
    const after = await page(w, '/welcome/team', sam);
    expect(visible(after)).toContain('Continue');
    expect(after).toMatch(/class="step [^"]*step-primary" data-content="✓"[^>]*>\s*<div[^>]*>\s*<span[^>]*\s*>Your team/);
  });

  test('a refused Property form keeps what was typed, says what is wrong next to each field, and adds nothing', async () => {
    const w = await webWorld();
    const sam = await w.signUp();

    const res = await w.post('/welcome/property', propertyFields({ tenantMobile: '', tenancyStart: 'last year', maxRepairCost: 'lots' }), sam);

    expect(res.status).toBe(400);
    const refused = await res.text();
    expect(refused).toMatch(/id="tenant-mobile-error"[^>]*>Enter a mobile number or email address</);
    expect(refused).toMatch(/id="tenant-start-error"[^>]*>Enter the date the tenancy started</);
    expect(refused).toMatch(/id="property-max-error"[^>]*>Enter the Max Repair Cost in dollars, like 500</);
    for (const kept of ['value="3 Sun St, Newtown NSW 2042"', 'value="Omar Owen"', 'value="0400 000 998"', 'value="Tina Tan"']) expect(refused).toContain(kept);

    const after = visible(await page(w, '/welcome/property', sam));
    expect(after).toContain('Your first Property');
    expect(after).not.toContain('Omar Owen');
  });

  test('a Property Owner already added is reused for another Property, but a Tenant\'s number cannot be the Property Owner\'s', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    await submit(w, '/welcome/property', propertyFields(), sam);

    const another = await page(w, '/welcome/property?another', sam);
    expect(another).toContain('action="/welcome/property"');
    await submit(w, '/welcome/property', propertyFields({ address: '5 Sun St, Newtown NSW 2042', ownerName: 'Omar', tenantName: 'Uma Ung', tenantMobile: '0400 000 996' }), sam);
    expect((await page(w, '/properties', sam)).match(/>Omar Owen<\/option>/g)).toHaveLength(1);

    const clash = await w.post('/welcome/property', propertyFields({ address: '7 Sun St, Newtown NSW 2042', ownerMobile: '0400 000 999', tenantName: 'Vic Vo', tenantMobile: '0400 000 995' }), sam);
    expect(clash.status).toBe(400);
    expect(visible(await clash.text())).toContain('0400 000 999 already belongs to Tina Tan, a Tenant');
  });

  test('a colleague with an email that already has an account, or a Tradie with no Trades, is refused with the form kept', async () => {
    const w = await webWorld();
    const sam = await w.signUp();

    const colleague = await w.post('/welcome/team', { name: 'Alice Again', email: 'alice@harbour.example' }, sam);
    expect(colleague.status).toBe(400);
    const teamPage = await colleague.text();
    expect(teamPage).toMatch(/id="colleague-email-error"[^>]*>An account with that email already exists</);
    expect(teamPage).toContain('value="Alice Again"');

    const tradie = await w.post('/welcome/tradies', { ...TRADIE, trades: [] }, sam);
    expect(tradie.status).toBe(400);
    const tradiePage = await tradie.text();
    expect(visible(tradiePage)).toContain('Choose Trades from');
    expect(tradiePage).toContain('value="Sunny Plumbing"');
    expect(visible(await page(w, '/welcome/tradies', sam))).toContain('No Tradies yet');
  });

  test('as the demo, the Channels step suggests made-up addresses the phone simulator can use', async () => {
    const demo: DemoControls = { contacts: async () => [], outbox: async () => [], inbound: async () => [], sendAs: async () => {}, advance: async () => {}, now: () => new Date() };
    const w = await webWorld({ demo });
    const sam = await w.signUp();

    const channels = await page(w, '/welcome/channels', sam);

    expect(channels).toMatch(/id="sms-address"[^>]*value="\+61 2 9100 \d{4}"/);
    expect(channels).toMatch(/id="email-address"[^>]*value="sunrise-realty@mail\.example\.test"/);
    expect(channels).toContain('>Copy<');
    expect(visible(channels)).toContain('Waiting for your first message');
    expect(visible(channels)).toContain('phone simulator');
  });
});

describe('a new Agency', () => {
  test('sees a "Finish setting up" banner on its dashboard, pointing at the next step it needs', async () => {
    const w = await webWorld();
    const sam = await w.signUp();

    const dashboard = await page(w, '/', sam);
    expect(visible(dashboard)).toContain('Finish setting up Sunrise Realty');
    expect(visible(dashboard)).toContain('connect SMS and email, add the Tradies you use and add your first Property');
    expect(dashboard).toMatch(/data-banner="finish-setup"[\s\S]*href="\/welcome\/channels"/);

    await page(w, '/welcome/channels', sam);
    for (const type of ['sms'] as const) {
      await w.post('/welcome/channels', { type, address: '+61 2 9100 0002' }, sam);
      const code = String(w.h.messenger.last('+61291000002')?.data.code);
      await w.post('/welcome/channels/confirm', { type, address: '+61 2 9100 0002', code }, sam);
    }
    expect(await page(w, '/', sam)).toMatch(/data-banner="finish-setup"[\s\S]*href="\/welcome\/tradies"/);
  });

  test('a set-up Agency gets no banner', async () => {
    const w = await webWorld();
    expect(visible(await page(w, '/', await w.signIn()))).not.toContain('Finish setting up');
  });

  test("can't see or use Harbour Realty's Properties, people, Tradies or channels", async () => {
    const w = await webWorld();
    const sam = await w.signUp();

    for (const path of ['/?filter=all', '/setup', '/dispatch', '/welcome/property', '/welcome/tradies', '/welcome/team', '/welcome/done']) {
      const text = visible(await page(w, path, sam));
      for (const harbour of ['Harbour Realty', 'Alice Archer', 'Olivia Owens', 'Tom Tran', "Pete's Plumbing", KING_ST]) expect(text, path).not.toContain(harbour);
    }
    expect((await w.get(`/tradies/${w.ids.pete}`, sam)).status).toBe(404);

    const taken = await w.post('/welcome/channels', { type: 'sms', address: '+61 2 9000 0000' }, sam);
    expect(decodeURIComponent(taken.headers.get('location')!)).toContain('is connected to another Agency');

    // Contact details are the Agency's own: Olivia's number is free to use here.
    await submit(w, '/welcome/property', propertyFields({ ownerName: 'Olive Other', ownerMobile: OLIVIA }), sam);
  });
});

describe('inviting a colleague', () => {
  test('after adding a colleague, the guide offers to send them the sign-in link, never the temporary password', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    const added = await (await w.post('/welcome/team', { name: 'Casey Cole', email: 'casey@sunrise.example' }, sam)).text();
    const temporaryPassword = /data-temporary-password>([^<]+)</.exec(added)![1]!;

    const share = /<details class="share[\s\S]*?<\/details>/.exec(added)?.[0];
    expect(share, 'a Share control on the team step').toBeDefined();
    expect(visible(share!)).toContain('Send Casey Cole their sign-in link');
    expect(share).toContain(encodeURIComponent('/login'));
    expect(share).toContain(encodeURIComponent('casey@sunrise.example'));
    expect(share).not.toContain(temporaryPassword);
    expect(share).not.toContain(encodeURIComponent(temporaryPassword));

    // Before anyone is added there's nothing to send.
    expect(await page(w, '/welcome/team', sam)).not.toContain('their sign-in link');
  });
});
