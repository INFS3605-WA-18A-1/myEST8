import { describe, expect, test } from 'vitest';
import { hostedApp } from '../src/hosted.ts';
import { demoEnv, testDb } from './support/db.ts';

// A migrated schema stands in for the hosted database, which `supabase db push` migrates.
// ALLOW_MOCKS=1: these tests have no provider keys, and the missing ones run on mocks.
async function hostedEnv(extra: Record<string, string> = {}) {
  const db = await testDb();
  return { ...demoEnv({ DATABASE_SCHEMA: db.schema, PUBLIC_URL: 'https://myest8.test', ALLOW_MOCKS: '1', ...extra }) };
}

/** Every setting hosted mode requires, as fake values: nothing here reaches a provider. */
const ALL_SETTINGS = {
  ANTHROPIC_API_KEY: 'test-anthropic',
  GOOGLE_MAPS_API_KEY: 'test-maps',
  SUPABASE_URL: 'https://project.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  RESEND_API_KEY: 'test-resend',
  RESEND_WEBHOOK_SECRET: 'test-webhook-secret',
  RESEND_INBOUND_DOMAIN: 'mail.myest8.test',
  FILE_LINK_SECRET: 'test-file-link-secret-of-32-characters',
  CRON_SECRET: 'test-cron',
};

const twilioPost = (hosted: Awaited<ReturnType<typeof hostedApp>>) =>
  hosted.web.fetch(new Request('https://myest8.test/webhooks/twilio', { method: 'POST', body: new URLSearchParams({ From: '+61400000001' }) }));

describe('the hosted app', () => {
  test('starts on a migrated schema without seeding, simulator controls or demo sign-ins', async () => {
    const hosted = await hostedApp(await hostedEnv(), () => {});
    const landing = await hosted.web.fetch(new Request('https://myest8.test/'));
    expect(landing.status).toBe(200);
    expect(await landing.text()).not.toContain('Harbour Realty');
    expect(hosted.seed).toBeNull();
    await hosted.close();
  });

  test("without PUBLIC_URL it takes the address Vercel gave: the production domain, or a preview's own", async () => {
    const env = await hostedEnv();
    delete (env as Record<string, string | undefined>).PUBLIC_URL;
    const production = await hostedApp({ ...env, VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'myest8.example', VERCEL_URL: 'myest8-abc.vercel.app' }, () => {});
    expect(production.baseUrl).toBe('https://myest8.example');
    await production.close();
    const preview = await hostedApp({ ...env, VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'myest8.example', VERCEL_URL: 'myest8-abc.vercel.app' }, () => {});
    expect(preview.baseUrl).toBe('https://myest8-abc.vercel.app');
    await preview.close();
  });

  test('an empty PUBLIC_URL falls back to the address Vercel gave', async () => {
    const hosted = await hostedApp({ ...(await hostedEnv({ PUBLIC_URL: '' })), VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'myest8.example' }, () => {});
    expect(hosted.baseUrl).toBe('https://myest8.example');
    await hosted.close();
  });

  test('refuses to start without an https PUBLIC_URL or a database URL', async () => {
    await expect(hostedApp({ SUPABASE_DB_URL: 'postgres://x', PUBLIC_URL: 'http://localhost' })).rejects.toThrow(/https/);
    await expect(hostedApp({ PUBLIC_URL: 'https://myest8.test', ALLOW_MOCKS: '1' }, () => {})).rejects.toThrow(/SUPABASE_DB_URL/);
  });

  test('a plain-http address is refused, even localhost, unless LOCAL_PROD=1 and it is localhost (npm run prod:local)', async () => {
    for (const PUBLIC_URL of ['http://localhost:3000', 'http://myest8.example', 'http://localhost.evil.example']) {
      await expect(hostedApp({ SUPABASE_DB_URL: 'postgres://x', PUBLIC_URL }, () => {})).rejects.toThrow(/https/);
    }
    for (const PUBLIC_URL of ['http://myest8.example', 'http://localhost.evil.example', 'http://localhost@evil.example', 'http://user@localhost:3000']) {
      await expect(hostedApp({ SUPABASE_DB_URL: 'postgres://x', PUBLIC_URL, LOCAL_PROD: '1' }, () => {})).rejects.toThrow(/https/);
    }
    const hosted = await hostedApp(await hostedEnv({ PUBLIC_URL: 'http://localhost:3000', LOCAL_PROD: '1' }), () => {});
    expect(hosted.baseUrl).toBe('http://localhost:3000');
    await hosted.close();
  });
});

describe('hosted mode and missing provider settings', () => {
  test('refuses to start, naming every missing setting', async () => {
    const lines: string[] = [];
    const error = await hostedApp({ SUPABASE_DB_URL: 'postgres://x', PUBLIC_URL: 'https://myest8.test' }, (line) => lines.push(line)).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    for (const name of Object.keys(ALL_SETTINGS)) expect((error as Error).message).toContain(name);
    expect((error as Error).message).toContain('ALLOW_MOCKS=1');
    expect(lines).toEqual([]);
  });

  test('names only what is missing, and a Jev URL stands in for the Anthropic key', async () => {
    const { ANTHROPIC_API_KEY: _a, CRON_SECRET: _c, ...rest } = ALL_SETTINGS;
    const error = (await hostedApp({ SUPABASE_DB_URL: 'postgres://x', PUBLIC_URL: 'https://myest8.test', ...rest, JEV_API_URL: 'https://jev.test', JEV_API_KEY: 'k' }, () => {}).catch((e: Error) => e)) as Error;
    expect(error.message).toContain('CRON_SECRET');
    expect(error.message).not.toContain('ANTHROPIC_API_KEY');
    expect(error.message).not.toContain('GOOGLE_MAPS_API_KEY');
  });

  test('a blank setting counts as missing', async () => {
    const error = (await hostedApp({ SUPABASE_DB_URL: 'postgres://x', PUBLIC_URL: 'https://myest8.test', ...ALL_SETTINGS, CRON_SECRET: '  ' }, () => {}).catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/CRON_SECRET/);
  });

  test('ALLOW_MOCKS=1 starts anyway and logs which providers are mocked', async () => {
    const lines: string[] = [];
    const hosted = await hostedApp(await hostedEnv({ ANTHROPIC_API_KEY: 'test-anthropic' }), (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Real: classifier\./);
    expect(lines[0]).toMatch(/Mocked or off: .*places.*email.*worker cron/);
    expect(lines[0]).toContain('ALLOW_MOCKS=1');
    expect(JSON.stringify(lines)).not.toContain('test-anthropic');
    await hosted.close();
  });

  test('with everything set it starts on real providers and logs that', async () => {
    const lines: string[] = [];
    const hosted = await hostedApp(await hostedEnv({ ALLOW_MOCKS: '', ...ALL_SETTINGS }), (line) => lines.push(line));
    expect(lines[0]).toMatch(/Real: classifier, places, file storage, email, inbound email, file links, worker cron/);
    expect(lines[0]).toMatch(/Mocked or off: imageMatcher, quoteReader\./);
    await hosted.close();
  });

  test("a real service URL with no key is refused even with ALLOW_MOCKS=1: it would be called with 'demo'", async () => {
    const env = { SUPABASE_DB_URL: 'postgres://x', PUBLIC_URL: 'https://myest8.test', ALLOW_MOCKS: '1' };
    await expect(hostedApp({ ...env, VISION_API_URL: 'https://vision.test' }, () => {})).rejects.toThrow(/VISION_API_KEY/);
    await expect(hostedApp({ ...env, QUOTES_API_URL: 'https://quotes.test' }, () => {})).rejects.toThrow(/QUOTES_API_KEY/);
    await expect(hostedApp({ ...env, JEV_API_URL: 'https://jev.test' }, () => {})).rejects.toThrow(/JEV_API_KEY/);
  });

  test('Twilio credentials without TWILIO_SMS_FROM refuse to start', async () => {
    const env = await hostedEnv({ TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'test-twilio-token', FILE_LINK_SECRET: ALL_SETTINGS.FILE_LINK_SECRET });
    await expect(hostedApp(env, () => {})).rejects.toThrow(/TWILIO_SMS_FROM/);
  });

  test('/webhooks/twilio is 404 without TWILIO_AUTH_TOKEN', async () => {
    const hosted = await hostedApp(await hostedEnv(), () => {});
    expect((await twilioPost(hosted)).status).toBe(404);
    await hosted.close();
  });

  test('/webhooks/twilio is served, and checks its signature, when TWILIO_AUTH_TOKEN is set', async () => {
    const hosted = await hostedApp(await hostedEnv({ TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'test-twilio-token', TWILIO_SMS_FROM: '+61480000000', FILE_LINK_SECRET: ALL_SETTINGS.FILE_LINK_SECRET }), () => {});
    expect((await twilioPost(hosted)).status).toBe(403);
    await hosted.close();
  });
});
