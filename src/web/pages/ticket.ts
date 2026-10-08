// STUB — a page agent replaces this file. Exported names are the contract.
import { Hono } from 'hono';
import type { WebEnv } from '../env.ts';

/** The Ticket view under /tickets/:id and every Job action on it. */
export function ticketPages() {
  return new Hono<WebEnv>();
}
