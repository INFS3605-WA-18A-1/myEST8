import { Hono } from 'hono';
import type { App } from '../app.ts';
import type { DemoControls } from '../demo/controls.ts';
import { simulatorPages } from '../demo/simulator-pages.ts';
import { createHttpApp } from '../http.ts';
import type { Clock } from '../ports.ts';
import { assetRoutes } from './assets.ts';
import { authRoutes, requirePropertyManager, type Sessions } from './auth.ts';
import type { WebEnv } from './env.ts';
import { pmPages } from './pm-pages.ts';
import { tenantPages } from './tenant-pages.ts';

/**
 * The whole web app: assets, the no-login Tenant pages, provider webhooks and
 * JSON, sign-in, and every page behind it. `demo` adds the phone simulator.
 */
export function createWebApp(deps: {
  app: App;
  sessions: Sessions;
  clock: Clock;
  publicUrl: string;
  twilioAuthToken: string;
  sendgridPublicKey: string;
  demo?: DemoControls;
}) {
  const web = new Hono();
  web.route('/', assetRoutes());
  web.route('/', tenantPages(deps.app));
  web.route('/', createHttpApp(deps.app, deps));
  web.route('/', authRoutes(deps.app, deps.sessions));

  const signedIn = new Hono<WebEnv>();
  signedIn.use('*', requirePropertyManager(deps.app, deps.sessions));
  if (deps.demo) signedIn.route('/demo', simulatorPages(deps.demo));
  signedIn.route('/', pmPages());
  web.route('/', signedIn);
  return web;
}
