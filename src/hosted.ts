// The app as Vercel runs it (docs/vercel.md): the same composition as `npm start`
// (src/demo/runtime.ts) in hosted mode. There is no listener and no worker loop:
// api/index.ts serves `web.fetch` and runs the worker when a webhook arrives and
// on a schedule.

import { createDemo } from './demo/runtime.ts';

export type Hosted = Awaited<ReturnType<typeof createDemo<false>>>;

/**
 * PUBLIC_URL, or the address Vercel gave this deployment: the project's production
 * domain in production, the deployment's own address in a preview. Providers and
 * Tenants need an https address.
 */
function publicUrl(env: Record<string, string | undefined>) {
  const vercelHost = env.VERCEL_ENV === 'production' ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL;
  const url = env.PUBLIC_URL?.trim() || (vercelHost ? `https://${vercelHost}` : '');
  if (!url.startsWith('https://')) throw new Error('Set PUBLIC_URL to the https address providers and Tenants reach this app on.');
  return url;
}

/** Builds the hosted app. api/index.ts calls it once per function instance. */
export async function hostedApp(env: Record<string, string | undefined> = process.env): Promise<Hosted> {
  return createDemo({ env: { ...env, PUBLIC_URL: publicUrl(env) }, seedAgency: false, hosted: true });
}
