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

  test('an unknown tab shows the Agency tab', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    expect(visible(await (await w.get('/settings?tab=nonsense', cookie)).text())).toContain('Urgent Repair limit');
  });
});
