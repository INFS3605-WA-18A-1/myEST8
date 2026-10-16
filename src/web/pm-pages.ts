import { Hono } from 'hono';
import { NO_CONNECTORS, type ChannelConnectors } from './connectors.ts';
import type { WebEnv } from './env.ts';
import { approvalPages } from './pages/approvals.ts';
import { calendarPages } from './pages/calendar.ts';
import { googleOAuthPages } from './pages/oauth-google.ts';
import { dashboardPages } from './pages/dashboard.ts';
import { propertyPages } from './pages/properties.ts';
import { requestPages } from './pages/requests.ts';
import { settingsPages } from './pages/settings.ts';
import { setupPages } from './pages/setup.ts';
import { ticketListPages } from './pages/ticket-list.ts';
import { ticketPages } from './pages/ticket.ts';
import { tradiePages } from './pages/tradie.ts';
import { welcomePages } from './pages/welcome.ts';

/**
 * Every Property Manager page. Mounted behind requirePropertyManager. `demo` tailors
 * the onboarding wizard to the demo; `connectors` is what onboarding can connect.
 */
export function pmPages(o: { demo: boolean; connectors: ChannelConnectors } = { demo: false, connectors: NO_CONNECTORS }) {
  const pages = new Hono<WebEnv>();
  pages.route('/welcome', welcomePages(o));
  pages.route('/tickets', ticketListPages());
  pages.route('/tickets', ticketPages());
  pages.route('/approvals', approvalPages());
  // The Schedule is the week of bookings, at /calendar. /dispatch is the map (phase 2d restores
  // its page); until then it still shows the week, so the old links keep working.
  pages.route('/calendar', calendarPages());
  pages.route('/dispatch', calendarPages());
  pages.get('/schedule', (c) => c.redirect(`/calendar${new URL(c.req.url).search}`, 303));
  pages.route('/properties', propertyPages());
  pages.route('/tradies', tradiePages());
  pages.route('/setup', setupPages(o));
  if (o.connectors.gmail) pages.route('/oauth/google', googleOAuthPages(o.connectors.gmail));
  pages.route('/settings', settingsPages());
  pages.route('/requests', requestPages());
  pages.route('/', dashboardPages());
  return pages;
}
