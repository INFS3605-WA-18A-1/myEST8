// The Tradie's no-login quote page at /q/:token: the Estimate (with "I need to
// inspect before giving a firm price" and a Call-out Fee), then the Firm Quote.
// Placeholder registered by the desk feedback round's foundation; its task replaces it.

import { Hono } from 'hono';
import type { App } from '../../app.ts';

export function quoteFormPages(_app: App) {
  const pages = new Hono();
  pages.get('/q/:token', (c) => c.text('Not found', 404));
  return pages;
}
