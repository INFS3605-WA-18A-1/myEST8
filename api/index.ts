// The Vercel function: every path is rewritten here (vercel.json). It serves the
// web app, and keeps the background worker going without a daemon: after any
// POST (a webhook, an upload) it drains due tasks once the response is sent, and
// /api/cron/worker (called on a schedule, see docs/vercel.md) drains them in
// bounded batches.

import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { hostedApp, type Hosted } from '../src/hosted.ts';

/** Real time a worker run may spend starting tasks; vercel.json gives the function 60 s. */
const WORKER_BUDGET_MS = 45_000;

// Built once per function instance. A failed start isn't kept, so the next request tries again.
let started: Promise<Hosted> | undefined;
function hosted() {
  started ??= hostedApp().catch((error) => {
    started = undefined;
    throw error;
  });
  return started;
}

function authorised(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const app = await hosted();
    const { pathname } = new URL(request.url);
    if (pathname === '/api/cron/worker') {
      if (!authorised(request)) return new Response('Unauthorized', { status: 401 });
      await app.runWorker({ budgetMs: WORKER_BUDGET_MS });
      return Response.json({ ok: true });
    }
    const response = await app.web.fetch(request);
    if (request.method === 'POST') waitUntil(app.runWorker({ budgetMs: WORKER_BUDGET_MS }));
    return response;
  },
};
