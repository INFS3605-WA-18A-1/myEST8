// A per-client request limit for the no-login Tenant links (/u/:token and
// /t/:token, issue 12). Their tokens are 24 random bytes, so guessing one is
// impractical; the limit stops anyone hammering them or flooding uploads. Counts
// are kept in memory per fixed window, which suits one server.

import type { MiddlewareHandler } from 'hono';

/**
 * The client's address. Behind a Cloudflare Tunnel every request arrives from
 * cloudflared, so Cloudflare's `cf-connecting-ip` names the real client; without
 * it, the first `x-forwarded-for` hop, then one shared bucket.
 */
function clientOf(header: (name: string) => string | undefined): string {
  return header('cf-connecting-ip') ?? header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Allows `max` requests per client in each `windowMs`; the next one gets 429 with Retry-After. */
export function rateLimit(o: { max: number; windowMs: number; now?: () => number }): MiddlewareHandler {
  const now = o.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return async (c, next) => {
    const t = now();
    // Forget finished windows now and then, so the map stays small.
    if (windows.size > 10_000) for (const [key, w] of windows) if (t - w.start >= o.windowMs) windows.delete(key);
    const key = clientOf((name) => c.req.header(name));
    const w = windows.get(key);
    if (!w || t - w.start >= o.windowMs) windows.set(key, { start: t, count: 1 });
    else if (++w.count > o.max) {
      c.header('retry-after', String(Math.ceil((w.start + o.windowMs - t) / 1000)));
      return c.text('Too many requests. Try again in a minute.', 429);
    }
    await next();
  };
}
