import { Hono } from 'hono';
import type { WebEnv } from './env.ts';
import { calendarPages } from './pages/calendar.ts';
import { dashboardPages } from './pages/dashboard.ts';
import { setupPages } from './pages/setup.ts';
import { ticketPages } from './pages/ticket.ts';
import { tradiePages } from './pages/tradie.ts';

/** Every Property Manager page. Mounted behind requirePropertyManager. */
export function pmPages() {
  const pages = new Hono<WebEnv>();
  pages.route('/tickets', ticketPages());
  pages.route('/calendar', calendarPages());
  pages.route('/tradies', tradiePages());
  pages.route('/setup', setupPages());
  pages.route('/', dashboardPages());
  return pages;
}
