import { afterEach, describe, expect, test, vi } from 'vitest';
import handler from '../api/index.ts';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));
vi.mock('../src/hosted.ts', () => ({ hostedApp: async () => ({ runWorker: async () => {}, web: { fetch: async () => new Response('page') } }) }));

const cron = (authorization?: string) => handler.fetch(new Request('https://myest8.test/api/cron/worker', { headers: authorization ? { authorization } : {} }));

describe('the cron route', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('is refused without the CRON_SECRET bearer, and when no secret is set', async () => {
    expect((await cron()).status).toBe(401);
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect((await cron()).status).toBe(401);
    expect((await cron('Bearer wrong')).status).toBe(401);
  });

  test('runs the worker for the right bearer', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect((await cron('Bearer s3cret')).status).toBe(200);
  });

  test('other paths go to the web app', async () => {
    expect(await (await handler.fetch(new Request('https://myest8.test/'))).text()).toBe('page');
  });
});
