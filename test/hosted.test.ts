import { describe, expect, test } from 'vitest';
import { hostedApp } from '../src/hosted.ts';
import { demoEnv, testDb } from './support/db.ts';

// A migrated schema stands in for the hosted database, which `supabase db push` migrates.
async function hostedEnv(extra: Record<string, string> = {}) {
  const db = await testDb();
  return { ...demoEnv({ DATABASE_SCHEMA: db.schema, PUBLIC_URL: 'https://myest8.test', ...extra }) };
}

describe('the hosted app', () => {
  test('starts on a migrated schema without seeding, simulator controls or demo sign-ins', async () => {
    const hosted = await hostedApp(await hostedEnv());
    const landing = await hosted.web.fetch(new Request('https://myest8.test/'));
    expect(landing.status).toBe(200);
    expect(await landing.text()).not.toContain('Harbour Realty');
    expect(hosted.seed).toBeNull();
    await hosted.close();
  });

  test('refuses to start without an https PUBLIC_URL or a database URL', async () => {
    await expect(hostedApp({ SUPABASE_DB_URL: 'postgres://x', PUBLIC_URL: 'http://localhost' })).rejects.toThrow(/https/);
    await expect(hostedApp({ PUBLIC_URL: 'https://myest8.test' })).rejects.toThrow(/SUPABASE_DB_URL/);
  });
});
