import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rateLimit } from '../../src/web/rate-limit.ts';

describe('rateLimit', () => {
  const build = (now: () => number) => {
    const app = new Hono();
    app.use('/t/*', rateLimit({ max: 2, windowMs: 60_000, now }));
    app.get('/t/:token', (c) => c.text('ok'));
    return app;
  };
  const from = (ip: string) => ({ headers: { 'cf-connecting-ip': ip } });

  it('lets a client through up to the limit, then answers 429 with Retry-After until the window ends', async () => {
    let t = 0;
    const app = build(() => t);
    expect((await app.request('/t/abc', from('1.1.1.1'))).status).toBe(200);
    expect((await app.request('/t/abc', from('1.1.1.1'))).status).toBe(200);
    const refused = await app.request('/t/abc', from('1.1.1.1'));
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('60');
    t = 60_000;
    expect((await app.request('/t/abc', from('1.1.1.1'))).status).toBe(200);
  });

  it('counts each client separately', async () => {
    const app = build(() => 0);
    for (let i = 0; i < 3; i++) await app.request('/t/abc', from('1.1.1.1'));
    expect((await app.request('/t/abc', from('2.2.2.2'))).status).toBe(200);
  });
});
