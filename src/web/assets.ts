// The design system's static files, served from this server so the demo works
// offline: the prebuilt Tailwind utilities (static/tw.css, from `npm run css`), daisyUI and MapLibre GL JS (the Dispatch map) from
// node_modules, the app's own CSS, JS, favicon and landing photographs from ./static, and the
// self-hosted Bricolage Grotesque and Public Sans variable fonts. Each file is read once, on first request.

import { createHash } from 'node:crypto';
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
const JPEG = 'image/jpeg';

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
  // The landing page's photographs, found in Wikimedia Commons and credited in its footer (pages/landing.ts).
  ...Object.fromEntries(
    [
      'newtown-terraces.jpg',
      'dripping-tap.jpg',
      'plumber-under-sink.jpg',
      'plumber-wrenches.jpg',
      'wattle-street.jpg',
      'king-street.jpg',
      'ultimo-terrace.jpg',
    ].map((name) => [`landing-${name}`, { file: () => fileURLToPath(new URL(`./static/landing/${name}`, import.meta.url)), type: JPEG }]),
  ),
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

const versions = new Map<string, string>();

/** A short hash of one asset's bytes: its version in the URL head() links to. */
function version(name: string) {
  let v = versions.get(name);
  if (!v) {
    v = createHash('sha256').update(read(name, ASSETS[name]!.file)).digest('hex').slice(0, 10);
    versions.set(name, v);
  }
  return v;
}

/**
 * The URL of one asset with its content hash in the query ("/assets/app.css?v=…"). A URL that
 * carries the current hash never changes meaning, so browsers keep it for a year and Vercel's
 * CDN serves it from the edge near the visitor instead of the function in Seoul.
 */
export function assetUrl(name: string) {
  if (!Object.hasOwn(ASSETS, name)) throw new Error(`Unknown asset ${name}`);
  return `/assets/${name}?v=${version(name)}`;
}

/** Kept by browsers and the CDN for a year: the URL changes whenever the file does. */
const IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';

/** The file path of one allowlisted font, inside its @fontsource package. */
function fontFile(name: string) {
  const pkg = FONTS[name]!;
  return join(dirname(require.resolve(`${pkg}/package.json`)), 'files', name);
}

/** Every file assetRoutes reads, as absolute paths. The Vercel function must include each one (scripts/check-vercel-function.ts). */
export function servedFiles(): string[] {
  return [...Object.values(ASSETS).map((asset) => asset.file()), ...Object.keys(FONTS).map(fontFile)];
}

/**
 * Serves /assets/*: the prebuilt Tailwind utilities, daisyUI, MapLibre GL JS, the app's own
 * CSS, JS and favicon, and the Bricolage Grotesque and Public Sans fonts under /assets/fonts/. Anything
 * else there is a 404. Fonts, and any asset asked for at its current assetUrl, are cached for a year.
 */
export function assetRoutes() {
  const routes = new Hono();
  routes.get('/assets/fonts/:name', (c, next) => {
    const name = c.req.param('name');
    if (!Object.hasOwn(FONTS, name)) return next();
    return c.body(read(`fonts/${name}`, () => fontFile(name)), 200, {
      'content-type': WOFF2,
      'cache-control': IMMUTABLE,
      'x-content-type-options': 'nosniff',
    });
  });
  routes.get('/assets/:name', (c, next) => {
    const name = c.req.param('name');
    const asset = Object.hasOwn(ASSETS, name) ? ASSETS[name]! : null;
    if (!asset) return next();
    return c.body(read(name, asset.file), 200, {
      'content-type': asset.type,
      // An unversioned URL (or an old version) may change on the next deploy, so it is kept only an hour.
      'cache-control': c.req.query('v') === version(name) ? IMMUTABLE : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
  });
  routes.all('/assets/*', (c) => c.text('Not found', 404));
  return routes;
}
