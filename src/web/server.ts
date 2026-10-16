import { Hono } from 'hono';
import type { App } from '../app.ts';
import type { DemoControls } from '../demo/controls.ts';
import type { FileLinks } from '../file-links.ts';
import { simulatorPages } from '../demo/simulator-pages.ts';
import { createHttpApp } from '../http.ts';
import type { Clock } from '../ports.ts';
import { assetRoutes } from './assets.ts';
import { authRoutes, requirePropertyManager, type Sessions } from './auth.ts';
import { NO_CONNECTORS, type ChannelConnectors } from './connectors.ts';
import type { WebEnv } from './env.ts';
import { landingRoutes } from './pages/landing.ts';
import { signupRoutes } from './pages/signup.ts';
import { pmPages } from './pm-pages.ts';
import { rateLimit } from './rate-limit.ts';
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
  twilioAuthToken: string | null;
  sendgridPublicKey: string;
  /** Signed file links (src/file-links.ts), for Twilio to fetch attachments. */
  fileLinks?: FileLinks | null;
  /** Meta's WhatsApp Cloud API webhook secrets, when WhatsApp runs on it. */
  whatsapp?: { appSecret: string; verifyToken: string } | null;
  /** Resend inbound email, when both RESEND_WEBHOOK_SECRET and RESEND_API_KEY are set. */
  resend?: { webhookSecret: string; apiKey: string; fetch?: typeof fetch } | null;
  /** What onboarding can connect (Gmail, the WhatsApp number). */
  connectors?: ChannelConnectors;
  demo?: DemoControls;
  /** Whether the landing page lists the demo Agency's sign-ins. Defaults to whether `demo` is set. */
  demoSignIns?: boolean;
}) {
  const web = new Hono();
  // The no-login Tenant links: reading a tracker, and the upload page and its posts.
  const links = rateLimit({ max: 60, windowMs: 60_000 });
  const uploads = rateLimit({ max: 20, windowMs: 60_000 });
  for (const path of ['/t/*', '/api/t/*']) web.use(path, links);
  for (const path of ['/u/*', '/api/u/*']) web.use(path, uploads);
  web.route('/', assetRoutes());
  web.route('/', tenantPages(deps.app));
  web.route('/', createHttpApp(deps.app, deps));
  web.route('/', authRoutes(deps.app, deps.sessions));
  web.route('/', signupRoutes(deps.app, deps.sessions));
  // Signed out, / is the landing page; signed in, it falls through to the dashboard.
  web.route('/', landingRoutes(deps.app, deps.sessions, { demo: deps.demoSignIns ?? !!deps.demo }));

  const signedIn = new Hono<WebEnv>();
  signedIn.use('*', requirePropertyManager(deps.app, deps.sessions));
  signedIn.use('*', async (c, next) => {
    c.set('demo', !!deps.demo);
    await next();
  });
  signedIn.use('*', loadNavCounts());
  if (deps.demo) signedIn.route('/demo', simulatorPages(deps.demo));
  signedIn.route('/', pmPages({ demo: !!deps.demo, connectors: deps.connectors ?? NO_CONNECTORS }));
  web.route('/', signedIn);
  return web;
}
