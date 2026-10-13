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
  // The Schedule is the week of bookings; it lived at /calendar before the rail grew.
  pages.route('/dispatch', calendarPages());
  pages.get('/calendar', (c) => c.redirect(`/dispatch${new URL(c.req.url).search}`, 301));
  pages.route('/properties', propertyPages());
  pages.route('/tradies', tradiePages());
  pages.route('/setup', setupPages(o));
  if (o.connectors.gmail) pages.route('/oauth/google', googleOAuthPages(o.connectors.gmail));
  pages.route('/settings', settingsPages());
  pages.route('/requests', requestPages());
  pages.route('/', dashboardPages());
  return pages;
}
