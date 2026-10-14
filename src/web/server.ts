import { Hono } from 'hono';
import type { App } from '../app.ts';
import type { DemoControls } from '../demo/controls.ts';
import type { FileLinks } from '../file-links.ts';
import { simulatorPages } from '../demo/simulator-pages.ts';
import { createHttpApp } from '../http.ts';
import type { Clock } from '../ports.ts';
import { assetRoutes } from './assets.ts';
import { authRoutes, requirePropertyManager, type Sessions } from './auth.ts';
import { googleOAuthRoutes } from './google-oauth.ts';
import type { ChannelModes, WebEnv } from './env.ts';
import { landingRoutes } from './pages/landing.ts';
import { signupRoutes } from './pages/signup.ts';
import { pmPages } from './pm-pages.ts';
import { requireEmailFirst } from './pages/welcome.ts';
import { loadNavCounts } from './shell.ts';
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
  /** Meta's WhatsApp Cloud API webhook (src/http.ts). */
  whatsapp?: Parameters<typeof createHttpApp>[1]['whatsapp'];
  /** Signed file links (src/file-links.ts), for Twilio to fetch attachments. */
  fileLinks?: FileLinks | null;
  demo?: DemoControls;
  /** How the channels connect on this server. Without it the Agency types in each channel's address. */
  channels?: ChannelModes | undefined;
}) {
  const web = new Hono();
  web.route('/', assetRoutes());
  web.route('/', tenantPages(deps.app));
  web.route('/', createHttpApp(deps.app, deps));
  web.route('/', authRoutes(deps.app, deps.sessions));
  web.route('/', signupRoutes(deps.app, deps.sessions, { channels: deps.channels }));
  // Signed out, / is the landing page; signed in, it falls through to the dashboard.
  web.route('/', landingRoutes(deps.app, deps.sessions, { demo: !!deps.demo }));

  const signedIn = new Hono<WebEnv>();
  signedIn.use('*', requirePropertyManager(deps.app, deps.sessions));
  signedIn.use('*', requireEmailFirst());
  signedIn.use('*', loadNavCounts());
  if (deps.demo) signedIn.route('/demo', simulatorPages(deps.demo));
  signedIn.route('/oauth/google', googleOAuthRoutes({ publicUrl: deps.publicUrl }));
  signedIn.route('/', pmPages({ demo: !!deps.demo, channels: deps.channels }));
  web.route('/', signedIn);
  return web;
}
