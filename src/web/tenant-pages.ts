// STUB — the Tenant pages agent replaces this file. Exported names are the contract.
import { Hono } from 'hono';
import type { App } from '../app.ts';

/** The no-login pages: GET/POST /u/:token (upload) and GET /t/:token (progress tracker). */
export function tenantPages(_app: App) {
  return new Hono();
}
