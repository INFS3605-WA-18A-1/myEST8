// STUB — a page agent replaces this file. Exported names are the contract.
import { Hono } from 'hono';
import type { WebEnv } from '../env.ts';

/** A Tradie's profile under /tradies/:id. */
export function tradiePages() {
  return new Hono<WebEnv>();
}
