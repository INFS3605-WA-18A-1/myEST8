// STUB — a page agent replaces this file. Exported names are the contract.
import { Hono } from 'hono';
import type { WebEnv } from '../env.ts';

/** The shared calendar under /calendar. */
export function calendarPages() {
  return new Hono<WebEnv>();
}
