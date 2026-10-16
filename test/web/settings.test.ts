import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';

describe('Settings', () => {
  test('four tabs: Agency, Channels, Team and Import', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const agency = await (await w.get('/settings', cookie)).text();
    for (const label of ['Agency', 'Channels', 'Team', 'Import']) expect(agency).toContain(`>${label}</a>`);
    expect(visible(agency)).toContain('Harbour Realty');
    expect(visible(agency)).toContain('Australia/Sydney');
    expect(visible(agency)).toContain('Add a Property');

    const channels = visible(await (await w.get('/settings?tab=channels', cookie)).text());
    expect(channels).toContain('Manage channels');
    expect(channels).toContain('Not tested');

    const team = visible(await (await w.get('/settings?tab=team', cookie)).text());
    expect(team).toContain('Alice Archer');
    expect(team).toContain('(you)');
    expect(team).toContain('Bob Baker');

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

  test('the Import tab names each import, in the order they must happen, with its template', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get('/settings?tab=import', cookie)).text();
    const text = visible(page);
    const order = ['Import Property Owners', 'Import Building Managers', 'Import Properties', 'Import Tenants', 'Import Tradies'];
    for (const label of order) expect(text).toContain(label);
    for (let i = 1; i < order.length; i++) expect(text.indexOf(order[i - 1]!)).toBeLessThan(text.indexOf(order[i]!));
    expect(page).toContain('href="/setup#import-owners"');
    expect(page).toContain('href="/setup#import-tradies"');
    for (const kind of ['owners', 'building-managers', 'properties', 'tenants', 'tradies']) expect(page).toContain(`href="/setup/templates/${kind}.csv"`);
    expect(text).not.toMatch(/>\s*Import\s*</);
  });

  test('the Agency tab lists each kind of record with where to see it and how to add one', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get('/settings', cookie)).text();
    expect(page).toContain('class="settings-list"');
    expect(page).toContain('href="/properties"');
    expect(page).toContain('href="/setup#tenants"');
  });

  test('an unknown tab shows the Agency tab', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    expect(visible(await (await w.get('/settings?tab=nonsense', cookie)).text())).toContain('Urgent Repair limit');
  });
});
