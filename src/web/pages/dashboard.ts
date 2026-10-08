// STUB — a page agent replaces this file. Exported names are the contract.
import { Hono } from 'hono';
import type { WebEnv } from '../env.ts';

/** The dashboard at /: Maintenance Requests, Tickets, Urgent Repairs, the inbox, alerts and the coming calendar; their actions; and /files/:id for photos. */
export function dashboardPages() {
  return new Hono<WebEnv>();
}
