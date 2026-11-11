import { Hono } from 'hono';
import type { App } from '../app.ts';
import type { DemoControls } from '../demo/controls.ts';
import type { FileLinks } from '../file-links.ts';
import { simulatorPages } from '../demo/simulator-pages.ts';
import { createHttpApp } from '../http.ts';
import { withReadCache } from '../db.ts';
import type { Clock } from '../ports.ts';
import type { SmsNumbers } from '../sms-numbers.ts';
import { assetRoutes } from './assets.ts';
import { authRoutes, requirePropertyManager, type Sessions } from './auth.ts';
import { NO_CONNECTORS, type ChannelConnectors } from './connectors.ts';
import type { WebEnv } from './env.ts';
import { landingRoutes } from './pages/landing.ts';
import { legalRoutes } from './pages/legal.ts';
import { quoteFormPages } from './pages/quote-form.ts';
import { visitConfirmPages } from './pages/visit-confirm.ts';
import { visitOfferPages } from './pages/visit-offer.ts';
import { signupRoutes } from './pages/signup.ts';
import { pmPages } from './pm-pages.ts';
import { rateLimit } from './rate-limit.ts';
import { loadNavCounts } from './shell.ts';
import { loadSetupLink } from './pages/welcome.ts';
import { tenantPages } from './tenant-pages.ts';
import type { AuthKit } from '../adapters/workos.ts';

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
  /** Agencies' own Twilio numbers, whose texts are checked with their own account's token (ADR 0005). */
  smsNumbers?: Pick<SmsNumbers, 'authTokenFor'> | null;
  sendgridPublicKey: string;
  /** Signed file links (src/file-links.ts), for Twilio to fetch attachments. */
  fileLinks?: FileLinks | null;
  /** Meta's WhatsApp Cloud API webhook secrets, when WhatsApp runs on it. */
  whatsapp?: { appSecret: string; verifyToken: string } | null;
  /** Resend inbound email, when both RESEND_WEBHOOK_SECRET and RESEND_API_KEY are set. */
  resend?: { webhookSecret: string; apiKey: string; inboundDomain?: string; fetch?: typeof fetch } | null;
  /** The server's textbee phone (ADR 0013). Absent turns /webhooks/textbee off. */
  textbee?: { webhookSecret: string; number: string } | null;
  /** What onboarding can connect (Gmail). */
  connectors?: ChannelConnectors;
  demo?: DemoControls;
  /** WorkOS AuthKit (ADR 0020): the one sign-in and sign-up page, and colleagues' invitations. Absent keeps the password forms. */
  authKit?: AuthKit | null;
  /** Whether the landing page lists the demo Agency's sign-ins. Defaults to whether `demo` is set. */
  demoSignIns?: boolean;
}) {
  const web = new Hono();
  // A page reads the same rows many times over; each GET shares its reads (src/db.ts).
  web.use('*', (c, next) => (c.req.method === 'GET' || c.req.method === 'HEAD' ? withReadCache(next) : next()));
  // A form static/app.js posts with fetch (x-myest8-post) gets its redirect as a header
  // instead: fetch would follow it and drop the #fragment, and the page decides whether the
  // next page replaces it in the history (the same page again) or comes after it.
  web.use('*', async (c, next) => {
    await next();
    if (c.req.method !== 'POST' || !c.req.header('x-myest8-post')) return;
    const location = c.res.headers.get('location');
    if (c.res.status < 300 || c.res.status >= 400 || !location) return;
    // A redirect status with no Location is handed to fetch as it is, not followed.
    c.res.headers.delete('location');
    c.res.headers.set('x-myest8-redirect', location);
  });
  // The no-login Tenant links (a tracker, the upload page and its posts) and the Tradie's quote page.
  const links = rateLimit({ max: 60, windowMs: 60_000 });
  // The browser suite shares one address, and a run opens more upload and quote
  // pages than a person would. RATE_LIMIT_UPLOADS raises the cap for that run.
  const uploadMax = Number(process.env.RATE_LIMIT_UPLOADS);
  const uploads = rateLimit({ max: uploadMax > 0 ? uploadMax : 20, windowMs: 60_000 });
  for (const path of ['/t/*', '/api/t/*', '/v/*']) web.use(path, links);
  for (const path of ['/u/*', '/api/u/*', '/q/*']) web.use(path, uploads);
  web.route('/', assetRoutes());
  web.route('/', tenantPages(deps.app));
  // The no-login Tradie quote page (Estimate, then Firm Quote).
  web.route('/', quoteFormPages(deps.app));
  // The Tenant confirms a booked visit, or asks for another time. A GET only shows the page.
  web.route('/', visitConfirmPages(deps.app));
  // The Tenant picks a visit time. A GET only shows the button.
  web.route('/', visitOfferPages(deps.app));
  web.route('/', createHttpApp(deps.app, deps));
  web.route('/', authRoutes(deps.app, deps.sessions, { authKit: deps.authKit, publicUrl: deps.publicUrl }));
  web.route('/', signupRoutes(deps.app, deps.sessions, deps.authKit ?? null));
  // The two public pages an account agrees to (/terms, /privacy): no session needed.
  web.route('/', legalRoutes());
  // Signed out, / is the landing page; signed in, it falls through to the dashboard.
  web.route('/', landingRoutes(deps.app, deps.sessions, { demo: deps.demoSignIns ?? !!deps.demo }));

  const signedIn = new Hono<WebEnv>();
  signedIn.use('*', requirePropertyManager(deps.app, deps.sessions));
  signedIn.use('*', async (c, next) => {
    c.set('demo', !!deps.demo);
    c.set('unavailableChannels', deps.connectors?.unavailable ?? []);
    if (deps.authKit) c.set('invite', deps.authKit.invite);
    await next();
  });
  // Signed-in pages change as the work moves on, so the browser keeps none to show again:
  // Back loads the page afresh (static/app.js reloads one the back-forward cache kept anyway).
  signedIn.use('*', async (c, next) => {
    await next();
    if ((c.res.headers.get('content-type') ?? '').startsWith('text/html') && !c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
  });
  signedIn.use('*', loadNavCounts());
  signedIn.use('*', loadSetupLink());
  if (deps.demo) signedIn.route('/demo', simulatorPages(deps.demo));
  signedIn.route('/', pmPages({ demo: !!deps.demo, connectors: deps.connectors ?? NO_CONNECTORS }));
  web.route('/', signedIn);
  return web;
}
