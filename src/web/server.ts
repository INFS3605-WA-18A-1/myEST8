import { Hono } from 'hono';
import type { App } from '../app.ts';
import type { DemoControls } from '../demo/controls.ts';
import type { FileLinks } from '../file-links.ts';
import { simulatorPages } from '../demo/simulator-pages.ts';
import { createHttpApp } from '../http.ts';
import type { Clock } from '../ports.ts';
import { assetRoutes } from './assets.ts';
import { authRoutes, requirePropertyManager, type Sessions } from './auth.ts';
import type { WebEnv } from './env.ts';
import { landingRoutes } from './pages/landing.ts';
import { signupRoutes } from './pages/signup.ts';
import { pmPages } from './pm-pages.ts';
import { tenantPages } from './tenant-pages.ts';

/**
 * The whole web app: assets, the no-login Tenant pages, provider webhooks and
 * JSON, the landing page, sign-in and sign-up, and every page behind them.
 * `demo` adds the phone simulator and the demo sign-ins on the landing page.
 */
export function createWebApp(deps: {
  app: App;
  sessions: Sessions;
  clock: Clock;
  publicUrl: string;
  twilioAuthToken: string;
  sendgridPublicKey: string;
  /** Signed file links (src/file-links.ts), for Twilio to fetch attachments. */
  fileLinks?: FileLinks | null;
  demo?: DemoControls;
}) {
  const web = new Hono();
  web.route('/', assetRoutes());
  web.route('/', tenantPages(deps.app));
  web.route('/', createHttpApp(deps.app, deps));
  web.route('/', authRoutes(deps.app, deps.sessions));
  web.route('/', signupRoutes(deps.app, deps.sessions));
  // Signed out, / is the landing page; signed in, it falls through to the dashboard.
  web.route('/', landingRoutes(deps.app, deps.sessions, { demo: !!deps.demo }));

  const signedIn = new Hono<WebEnv>();
  signedIn.use('*', requirePropertyManager(deps.app, deps.sessions));
  if (deps.demo) signedIn.route('/demo', simulatorPages(deps.demo));
  signedIn.route('/', pmPages({ demo: !!deps.demo }));
  web.route('/', signedIn);
  return web;
}
