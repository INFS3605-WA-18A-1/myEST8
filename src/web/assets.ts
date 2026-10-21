// The design system's static files, served from this server so the demo works
// offline: the prebuilt Tailwind utilities (static/tw.css, from `npm run css`), daisyUI and MapLibre GL JS (the Dispatch map) from
// node_modules, the app's own CSS, JS and favicon from ./static, and the
// self-hosted Bricolage Grotesque and Public Sans variable fonts. Each file is read once, on first request.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

const require = createRequire(import.meta.url);
const JS = 'text/javascript; charset=utf-8';
const CSS = 'text/css; charset=utf-8';
const WOFF2 = 'font/woff2';
const SVG = 'image/svg+xml';

/** MapLibre GL JS's built files, in its package's dist/ folder. It is published as ES modules only. */
const maplibre = (name: string) => join(dirname(require.resolve('maplibre-gl/package.json')), 'dist', name);

const ASSETS: Record<string, { file: () => string; type: string }> = {
  'tw.css': { file: () => fileURLToPath(new URL('./static/tw.css', import.meta.url)), type: CSS },
  'daisyui.css': { file: () => require.resolve('daisyui/daisyui.css'), type: CSS },
  'app.css': { file: () => fileURLToPath(new URL('./static/app.css', import.meta.url)), type: CSS },
  'landing.css': { file: () => fileURLToPath(new URL('./static/landing.css', import.meta.url)), type: CSS },
  'auth.css': { file: () => fileURLToPath(new URL('./static/auth.css', import.meta.url)), type: CSS },
  'tenant.css': { file: () => fileURLToPath(new URL('./static/tenant.css', import.meta.url)), type: CSS },
  'app.js': { file: () => fileURLToPath(new URL('./static/app.js', import.meta.url)), type: JS },
  // MapLibre starts its worker from the module's own URL, with maplibre-gl-worker.mjs beside it.
  'maplibre-gl.mjs': { file: () => maplibre('maplibre-gl.mjs'), type: JS },
  'maplibre-gl-worker.mjs': { file: () => maplibre('maplibre-gl-worker.mjs'), type: JS },
  'maplibre-gl.css': { file: () => maplibre('maplibre-gl.css'), type: CSS },
  'dispatch-map.js': { file: () => fileURLToPath(new URL('./static/dispatch-map.js', import.meta.url)), type: JS },
  'favicon.svg': { file: () => fileURLToPath(new URL('./static/favicon.svg', import.meta.url)), type: SVG },
};

/** The fonts the design uses, by package and file name. Only these are served under /assets/fonts/. */
const FONTS: Record<string, string> = {
  'bricolage-grotesque-latin-opsz-normal.woff2': '@fontsource-variable/bricolage-grotesque',
  'public-sans-latin-wght-normal.woff2': '@fontsource-variable/public-sans',
};

const cache = new Map<string, Uint8Array<ArrayBuffer>>();

function read(key: string, file: () => string) {
  let body = cache.get(key);
  if (!body) {
    body = new Uint8Array(readFileSync(file()));
    cache.set(key, body);
  }
  return body;
}

/** The file path of one allowlisted font, inside its @fontsource package. */
function fontFile(name: string) {
  const pkg = FONTS[name]!;
  return join(dirname(require.resolve(`${pkg}/package.json`)), 'files', name);
}

/**
 * Serves /assets/*: the prebuilt Tailwind utilities, daisyUI, MapLibre GL JS, the app's own
 * CSS, JS and favicon, and the Bricolage Grotesque and Public Sans fonts under /assets/fonts/. Anything
 * else there is a 404.
 */
export function assetRoutes() {
  const routes = new Hono();
  routes.get('/assets/fonts/:name', (c, next) => {
    const name = c.req.param('name');
    if (!Object.hasOwn(FONTS, name)) return next();
    return c.body(read(`fonts/${name}`, () => fontFile(name)), 200, {
      'content-type': WOFF2,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
  });
  routes.get('/assets/:name', (c, next) => {
    const name = c.req.param('name');
    const asset = Object.hasOwn(ASSETS, name) ? ASSETS[name]! : null;
    if (!asset) return next();
    return c.body(read(name, asset.file), 200, {
      'content-type': asset.type,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
  });
  routes.all('/assets/*', (c) => c.text('Not found', 404));
  return routes;
}
