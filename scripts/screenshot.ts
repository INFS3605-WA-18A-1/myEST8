// Screenshots of the demo for reviewing the UI. Starts the demo in-process on a
// free port with every external API mocked, signs in, and saves PNGs of each
// page: the first frame (what fits without scrolling) and the full page, at
// laptop, desktop and phone sizes.
//
//   npx tsx scripts/screenshot.ts [--as alice|bob|none] [--out .screenshots] [--only laptop,phone] [path[=name] ...]
//
// With no paths it captures the main pages. Output is git-ignored.

import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { chromium } from 'playwright';
import { createDemo } from '../src/demo/runtime.ts';

const VIEWPORTS = {
  laptop: { width: 1366, height: 768 },
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;

const DEFAULT_PATHS = ['/', '/?filter=all', '/calendar', '/setup', '/demo', '/tickets/1'];

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1]! : fallback;
};
const signInAs = option('as', 'alice');
const out = option('out', '.screenshots');
const only = option('only', Object.keys(VIEWPORTS).join(',')).split(',') as ViewportName[];
const targets = (args.length ? args : DEFAULT_PATHS).map((arg) => {
  const [path, name] = arg.split('=');
  return { path: path!, name: name ?? (path!.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home') };
});

mkdirSync(out, { recursive: true });
const errors: Error[] = [];
const port = await freePort();
const demo = await createDemo({ env: { PORT: String(port) }, logError: (e) => errors.push(e) });
const server = serve({ fetch: demo.web.fetch, port });
const base = `http://localhost:${port}`;
const browser = await chromium.launch();

try {
  for (const viewportName of only) {
    const context = await browser.newContext({ viewport: VIEWPORTS[viewportName], deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error(`  page error on ${page.url()}: ${e.message}`));
    if (signInAs !== 'none') {
      await page.goto(`${base}/login`);
      await page.fill('input[name=email]', `${signInAs}@harbour.example`);
      await page.fill('input[name=password]', 'demo1234');
      await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/login')), page.press('input[name=password]', 'Enter')]);
    }
    for (const target of targets) {
      const res = await page.goto(base + target.path, { waitUntil: 'networkidle' });
      // Tailwind's browser build styles the page after load.
      await page.waitForTimeout(300);
      const file = `${out}/${target.name}.${viewportName}`;
      await page.screenshot({ path: `${file}.png` });
      await page.screenshot({ path: `${file}.full.png`, fullPage: true });
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      console.log(`${res?.status()} ${target.path} [${viewportName}] -> ${file}.png (page height ${height}px)`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
  for (const e of errors) console.error(`task error: ${e.message}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = serve({ fetch: () => new Response(), port: 0 }, (info: AddressInfo) => {
      probe.close(() => resolve(info.port));
    });
  });
}
