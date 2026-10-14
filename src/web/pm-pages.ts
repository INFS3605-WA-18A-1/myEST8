import { Hono } from 'hono';
import type { ChannelModes, WebEnv } from './env.ts';
import { approvalPages } from './pages/approvals.ts';
import { calendarPages } from './pages/calendar.ts';
import { dashboardPages } from './pages/dashboard.ts';
import { dispatchPages } from './pages/dispatch.ts';
import { propertyPages } from './pages/properties.ts';
import { requestPages } from './pages/requests.ts';
import { settingsPages } from './pages/settings.ts';
import { setupPages } from './pages/setup.ts';
import { ticketPages } from './pages/ticket.ts';
import { ticketListPages } from './pages/tickets.ts';
import { tradiePages } from './pages/tradie.ts';
import { welcomePages } from './pages/welcome.ts';

/** Every Property Manager page. Mounted behind requirePropertyManager. `demo` tailors the onboarding wizard to the demo. */
export function pmPages(o: { demo: boolean; channels?: ChannelModes | undefined } = { demo: false }) {
  const pages = new Hono<WebEnv>();
  pages.route('/welcome', welcomePages(o));
  pages.route('/tickets', ticketListPages());
  pages.route('/tickets', ticketPages());
  pages.route('/approvals', approvalPages());
  pages.route('/calendar', calendarPages());
  // Schedule is the rail's name for the calendar; its link keeps the week being looked at.
  pages.get('/schedule', (c) => c.redirect(`/calendar${new URL(c.req.url).search}`, 303));
  pages.route('/dispatch', dispatchPages());
  pages.route('/properties', propertyPages());
  pages.route('/tradies', tradiePages());
  pages.route('/setup', setupPages(o));
  pages.route('/settings', settingsPages());
  pages.route('/requests', requestPages());
  pages.route('/', dashboardPages());
  return pages;
}
