// The design system's static files, served from this server so the demo works
// offline: Tailwind's browser build and daisyUI from node_modules, and the app's
// own CSS and JS from ./static. Each file is read once, on first request.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

const require = createRequire(import.meta.url);
const JS = 'text/javascript; charset=utf-8';
const CSS = 'text/css; charset=utf-8';

const ASSETS: Record<string, { file: () => string; type: string }> = {
  'tailwind.js': { file: () => require.resolve('@tailwindcss/browser'), type: JS },
  'daisyui.css': { file: () => require.resolve('daisyui/daisyui.css'), type: CSS },
  'app.css': { file: () => fileURLToPath(new URL('./static/app.css', import.meta.url)), type: CSS },
  'app.js': { file: () => fileURLToPath(new URL('./static/app.js', import.meta.url)), type: JS },
};

const cache = new Map<string, Uint8Array<ArrayBuffer>>();

function read(name: string) {
  let body = cache.get(name);
  if (!body) {
    body = new Uint8Array(readFileSync(ASSETS[name]!.file()));
    cache.set(name, body);
  }
  return body;
}

/** Serves /assets/*: Tailwind's browser build, daisyUI, and the app's own CSS and JS. Anything else there is a 404. */
export function assetRoutes() {
  const routes = new Hono();
  routes.get('/assets/:name', (c, next) => {
    const name = c.req.param('name');
    const asset = Object.hasOwn(ASSETS, name) ? ASSETS[name]! : null;
    if (!asset) return next();
    return c.body(read(name), 200, {
      'content-type': asset.type,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
  });
  routes.all('/assets/*', (c) => c.text('Not found', 404));
  return routes;
}
