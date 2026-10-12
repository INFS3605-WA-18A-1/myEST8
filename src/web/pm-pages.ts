import { Hono } from 'hono';
import type { WebEnv } from './env.ts';
import { calendarPages } from './pages/calendar.ts';
import { dashboardPages } from './pages/dashboard.ts';
import { dispatchPages } from './pages/dispatch.ts';
import { requestPages } from './pages/requests.ts';
import { settingsPages } from './pages/settings.ts';
import { setupPages } from './pages/setup.ts';
import { ticketPages } from './pages/ticket.ts';
import { tradiePages } from './pages/tradie.ts';
import { welcomePages } from './pages/welcome.ts';

/** Every Property Manager page. Mounted behind requirePropertyManager. `demo` tailors the onboarding wizard to the demo. */
export function pmPages(o: { demo: boolean } = { demo: false }) {
  const pages = new Hono<WebEnv>();
  pages.route('/welcome', welcomePages(o));
  pages.route('/tickets', ticketPages());
  pages.route('/calendar', calendarPages());
  pages.route('/dispatch', dispatchPages());
  pages.route('/tradies', tradiePages());
  pages.route('/setup', setupPages());
  pages.route('/settings', settingsPages());
  pages.route('/requests', requestPages());
  pages.route('/', dashboardPages());
  return pages;
}
