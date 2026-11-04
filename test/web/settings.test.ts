import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';

/**
 * A control inside Settings may point outside /settings only in these cases.
 * The scanner lists every one it actually allows.
 *
 * - Sign-out. The user menu, on every signed-in page, posts to /logout. It sits in
 *   the page header, which this scanner does not treat as a Settings control, and
 *   the header test below checks that form is the sign-out.
 * - External docs and help. Twilio's sign-up, console and buy-a-number pages.
 * - Downloads. Spreadsheet templates (`/settings/templates/<kind>.csv`, with `download`).
 *   A template is also under /settings, so it passes the path check on its own.
 * - Contact and share. A colleague's email (mailto) and the share panel's Email
 *   and SMS links open the person's own mail or messages app.
 * - Channel panels. Connect and disconnect post to /sms-number, /server-sms and
 *   /server-whatsapp (and the release page is /sms-number/release). A typed SMS
 *   number is proved at /setup/channels, which comes back to the Channels tab
 *   when the form says from=settings.
 */
const OUTSIDE: { name: string; ok: (value: string) => boolean }[] = [
  { name: 'sign-out', ok: (value) => value === '/logout' },
  { name: 'external docs and help', ok: (value) => /^https?:\/\//i.test(value) },
  { name: 'contact and share', ok: (value) => /^(mailto:|tel:|sms:)/i.test(value) },
  { name: 'channel panels', ok: (value) => value.startsWith('/sms-number') || value.startsWith('/server-sms') || value.startsWith('/server-whatsapp') || value.startsWith('/setup/channels') },
];

/** href, action and formaction values in `html`. */
function targets(html: string): string[] {
  return [...html.matchAll(/\s(?:href|action|formaction)="([^"]*)"/g)].map((match) => match[1]!);
}

/** The Settings controls: everything in `<main>` except the page header (alerts bell and sign-out). */
function settingsControls(page: string): string {
  const main = page.match(/<main id="main"[\s\S]*<\/main>/)?.[0];
  if (!main) throw new Error('page has no main');
  const body = main.replace(/<header class="page-header[\s\S]*?<\/header>/, '');
  if (!body.includes('settings-layout')) throw new Error('page has no Settings layout');
  return body;
}

/** Targets in the Settings controls that are not under /settings and not a listed exception. */
function leaving(page: string): string[] {
  return targets(settingsControls(page)).filter((value) => {
    if (value.startsWith('#') || value.startsWith('/settings')) return false;
    return !OUTSIDE.some((rule) => rule.ok(value));
  });
}

describe('Settings', () => {
  test('four tabs: Agency, Channels, Team and Import', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const agency = await (await w.get('/settings', cookie)).text();
    for (const label of ['Agency', 'Channels', 'Team', 'Import']) expect(agency).toContain(`>${label}</a>`);
    expect(visible(agency)).toContain('Harbour Realty');
    expect(visible(agency)).toContain('Sydney and Canberra');
    expect(visible(agency)).toContain('Edit details');
    expect(agency).toContain('href="/settings/agency/edit"');
    expect(visible(agency)).not.toContain('Add a Property');

    const channels = visible(await (await w.get('/settings?tab=channels', cookie)).text());
    expect(channels).toContain('Connect WhatsApp');
    expect(channels).toContain('Coming later');
    expect(channels).toContain('Not tested');
    expect(channels).not.toContain('Manage channels');
    expect(channels).not.toContain('Connect a channel');

    const team = visible(await (await w.get('/settings?tab=team', cookie)).text());
    expect(team).toContain('Alice Archer');
    expect(team).toContain('(you)');
    expect(team).toContain('Bob Baker');
    expect(team).toContain('Add a colleague');

    const imports = visible(await (await w.get('/settings?tab=import', cookie)).text());
    expect(imports).toContain('You review the rows before anything is added.');
    expect(imports).toContain('Tenants');
  });

  test('on phones the Channels and Team tables stack, each value beside its heading', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const channels = await (await w.get('/settings?tab=channels', cookie)).text();
    expect(channels).toContain('table-frame is-stacked is-labelled');
    expect(channels).toContain('data-label="Last test message"');
    const team = await (await w.get('/settings?tab=team', cookie)).text();
    expect(team).toContain('table-frame is-stacked is-labelled');
    expect(team).toContain('data-label="Email"');
  });

  test('the Import tab opens each upload in Settings, in the order they must happen, with its template', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get('/settings?tab=import', cookie)).text();
    const text = visible(page);
    const order = ['Import Property Owners', 'Import Building Managers', 'Import Properties', 'Import Tenants', 'Import Tradies'];
    for (const label of order) expect(text).toContain(label);
    for (let i = 1; i < order.length; i++) expect(text.indexOf(order[i - 1]!)).toBeLessThan(text.indexOf(order[i]!));
    expect(page).toContain('href="/settings/import/owners"');
    expect(page).toContain('href="/settings/import/tradies"');
    expect(page).not.toContain('href="/setup');
    for (const kind of ['owners', 'building-managers', 'properties', 'tenants', 'tradies']) {
      expect(page).toContain(`href="/settings/templates/${kind}.csv"`);
      expect(page).not.toContain(`href="/setup/templates/${kind}.csv"`);
    }
    expect(text).not.toMatch(/>\s*Import\s*</);
  });

  test('the Agency tab is the Agency itself, and everyday records stay on Profiles', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get('/settings', cookie)).text();
    expect(page).not.toContain('class="settings-list"');
    expect(page).not.toContain('Properties and people');
    expect(settingsControls(page)).not.toContain('href="/properties"');
    expect(settingsControls(page)).not.toContain('href="/tradies"');
    expect(settingsControls(page)).not.toContain('href="/tenants"');
    expect(page).toContain('href="/settings?tab=team"');
  });

  test('an unknown tab shows the Agency tab', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    expect(visible(await (await w.get('/settings?tab=nonsense', cookie)).text())).toContain('Urgent Repair limit');
  });
});

describe('Settings stays on its own pages', () => {
  test('no link or form in Settings points outside /settings, apart from the listed exceptions', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const paths = [
      '/settings',
      '/settings?tab=channels',
      '/settings?tab=team',
      '/settings?tab=import',
      '/settings/agency/edit',
      '/settings/import/owners',
      '/settings/import/building-managers',
      '/settings/import/properties',
      '/settings/import/tenants',
      '/settings/import/tradies',
      `/settings/team/${w.ids.bobId}/remove`,
    ];

    for (const path of paths) {
      const res = await w.get(path, cookie);
      expect(res.status, path).toBe(200);
      const page = await res.text();
      expect(leaving(page), path).toEqual([]);
      expect(page).toContain('aria-label="Settings"');
      expect(page).toContain('aria-current="page"');
      // Templates download, and from Settings they are served under /settings.
      for (const href of targets(settingsControls(page)).filter((value) => value.includes('/templates/'))) {
        expect(href, path).toMatch(/^\/settings\/templates\/[a-z-]+\.csv$/);
      }
    }

    // Sign-out is the header's form. The alerts bell is the app shell, not a Settings control.
    const header = (await (await w.get('/settings', cookie)).text()).match(/<header class="page-header[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(targets(header).filter((value) => value !== '/#alerts')).toEqual(['/logout']);
  });

  test('saving the Agency returns to Settings with a flash, and a blank name stays on the form', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const saved = await w.post('/settings/agency', { name: 'Harbour Realty Group', timeZone: 'Australia/Perth' }, cookie);
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toBe('/settings?ok=Agency%20details%20saved.');
    const page = await (await w.get(saved.headers.get('location')!, cookie)).text();
    expect(visible(page)).toContain('Agency details saved.');
    expect(visible(page)).toContain('Harbour Realty Group');
    expect(visible(page)).toContain('Perth (WA)');
    expect(leaving(page)).toEqual([]);

    const refused = await w.post('/settings/agency', { name: ' ', timeZone: 'Australia/Sydney' }, cookie);
    expect(refused.status).toBe(400);
    const form = await refused.text();
    expect(visible(form)).toContain("Enter your Agency's name");
    expect(form).toContain('action="/settings/agency"');
    expect(leaving(form)).toEqual([]);
    expect(visible(await (await w.get('/settings', cookie)).text())).toContain('Harbour Realty Group');
  });

  test('adding a colleague stays on the Team tab and shows the password once', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const added = await w.post('/settings/team', { name: 'Casey Cole', email: 'casey@harbour.example' }, cookie);
    expect(added.status).toBe(200);
    expect(added.headers.get('cache-control')).toBe('no-store');
    const page = await added.text();
    expect(visible(page)).toContain('Casey Cole added as a Property Manager');
    expect(page).toContain('data-temporary-password');
    expect(page).toContain('action="/settings/team"');
    expect(leaving(page)).toEqual([]);

    const refused = await w.post('/settings/team', { name: 'Casey Again', email: 'casey@harbour.example' }, cookie);
    expect(refused.status).toBe(400);
    expect(leaving(await refused.text())).toEqual([]);
  });

  test('removing a colleague returns to the Team tab with a flash', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const removed = await w.post(`/settings/team/${w.ids.bobId}/remove`, { handTo: String(w.ids.aliceId) }, cookie);
    expect(removed.status).toBe(303);
    const location = removed.headers.get('location')!;
    expect(location).toMatch(/^\/settings\?tab=team&ok=/);
    const page = await (await w.get(location, cookie)).text();
    expect(visible(page)).toContain('Bob Baker removed.');
    expect(visible(page)).toContain("now Alice Archer's");
    expect(page).not.toContain('bob@harbour.example');
    expect(leaving(page)).toEqual([]);
  });

  test('a spreadsheet import started in Settings reviews and finishes in Settings', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const body = new FormData();
    body.append('file', new File(['Name,Mobile,Email\nPriya Settings,0412 111 333,priya.settings@example.com\n'], 'owners.csv', { type: 'text/csv' }));
    const uploaded = await w.web.request('/settings/import/owners', { method: 'POST', body, headers: { cookie } });
    await w.h.drain();
    expect(uploaded.status).toBe(303);
    const reviewUrl = uploaded.headers.get('location')!;
    expect(reviewUrl).toMatch(/^\/settings\/imports\/[\w-]+$/);

    const review = await (await w.get(reviewUrl, cookie)).text();
    expect(visible(review)).toContain('Review Property Owners');
    expect(visible(review)).toContain('Back to the upload');
    expect(review).toContain('class="settings-layout is-wide"');
    expect(review).toContain(`action="${reviewUrl}"`);
    expect(leaving(review)).toEqual([]);

    const token = reviewUrl.split('/').at(-1)!;
    const added = await w.post(`/settings/imports/${token}`, { intent: 'add', include: '0', from: 'setup' }, cookie);
    expect(added.status).toBe(303);
    const done = added.headers.get('location')!;
    // A posted `from` cannot steer a Settings import back to Setup.
    expect(done).toMatch(/^\/settings\?tab=import&ok=Added%201%20Property%20Owner\./);
    const page = await (await w.get(done, cookie)).text();
    expect(visible(page)).toContain('Added 1 Property Owner.');
    expect(leaving(page)).toEqual([]);
  });
});
