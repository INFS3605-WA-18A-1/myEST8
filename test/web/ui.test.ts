import { html } from 'hono/html';
import { describe, expect, it } from 'vitest';
import { assetRoutes } from '../../src/web/assets.ts';
import { shellInfo } from '../../src/web/shell.ts';
import { chatBubble, docket, field, page, type Html } from '../../src/web/ui.ts';

const render = async (markup: Html) => String(await markup);
const HOSTILE = '<script>alert("x")</script>';

describe('assets', () => {
  const assets = assetRoutes();

  it('serves Tailwind and daisyUI with their content types, cacheable', async () => {
    const js = await assets.request('/assets/tailwind.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(js.headers.get('cache-control')).toBe('public, max-age=3600');
    expect((await js.text()).length).toBeGreaterThan(100_000);

    const css = await assets.request('/assets/daisyui.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toMatch(/^text\/css/);
    expect(await css.text()).toContain('daisyUI');

    expect((await assets.request('/assets/app.css')).headers.get('content-type')).toMatch(/^text\/css/);
    expect((await assets.request('/assets/app.js')).headers.get('content-type')).toMatch(/^text\/javascript/);
  });

  it('404s anything else under /assets', async () => {
    expect((await assets.request('/assets/unknown.js')).status).toBe(404);
    expect((await assets.request('/assets/static/app.css')).status).toBe(404);
    expect((await assets.request('/assets/..%2Fui.ts')).status).toBe(404);
  });

  it('serves the Barlow fonts as woff2, long-cached, and 404s other font names', async () => {
    const font = await assets.request('/assets/fonts/barlow-semi-condensed-latin-600-normal.woff2');
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect(font.headers.get('cache-control')).toMatch(/max-age=31536000/);
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1000);

    expect((await assets.request('/assets/fonts/barlow-latin-700-normal.woff2')).status).toBe(404);
    expect((await assets.request('/assets/fonts/..%2Fui.ts')).status).toBe(404);
    expect((await assets.request('/assets/fonts/barlow-latin-400-normal.woff')).status).toBe(404);
  });
});

describe('ui', () => {
  it('escapes a hostile title and body text', async () => {
    const out = await render(page({ title: HOSTILE, pm: { name: HOSTILE }, active: 'dashboard', body: html`<p>${HOSTILE}</p>` }));
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(out).toContain('aria-current="page"');
  });

  it('marks only the active rail link with aria-current', async () => {
    const out = await render(page({ title: 'Calendar', pm: { name: 'Alice' }, active: 'calendar', body: html`<p>x</p>` }));
    expect(out).toMatch(/<a href="\/calendar" class="rail-link" aria-current="page">/);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toContain('href="/demo" class="rail-link"');
  });

  it('shows the Agency and today in the shell, and Sign out inside the user menu', async () => {
    const out = await render(
      page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>`, shell: { agencyName: 'Harbour Realty', today: 'Fri 9 Oct' } }),
    );
    expect(out).toContain('Harbour Realty');
    expect(out).toContain('Fri 9 Oct');
    expect(out).toMatch(/<details class="user-menu" data-menu>[\s\S]*action="\/logout"/);
  });

  it('builds the Agency name and today in the Agency time zone', () => {
    const c = {
      var: {
        actions: {
          agency: () => ({ name: 'Harbour Realty', timeZone: 'Australia/Sydney' }),
          now: () => new Date('2026-10-08T23:30:00Z'),
        },
      },
    };
    expect(shellInfo(c as never)).toEqual({ agencyName: 'Harbour Realty', today: 'Fri 9 Oct' });
  });

  it('pairs a field’s label with its control and hint', async () => {
    const out = await render(field({ label: 'Mobile', name: 'mobile', type: 'tel', hint: 'Australian mobile' }));
    expect(out).toMatch(/<label for="field-mobile"/);
    expect(out).toMatch(/<input id="field-mobile" name="mobile"/);
    expect(out).toContain('aria-describedby="field-mobile-hint"');
    expect(out).toContain('id="field-mobile-hint"');
  });

  it('escapes chat text, keeps its line breaks and links only http(s) URLs', async () => {
    const out = await render(chatBubble({ side: 'start', header: 'myEST8', text: `${HOSTILE}\nUpload: https://myest8.test/u/abc?x=1&y=2.` }));
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('\nUpload: ');
    expect(out).toContain('href="https://myest8.test/u/abc?x=1&amp;y=2"');
    expect(out).toContain('whitespace-pre-wrap');
  });

  it('renders a docket as one escaped link with its number, urgency and unread dot', async () => {
    const out = await render(
      docket({
        number: 12,
        href: '/tickets/12',
        urgency: 'urgent',
        address: HOSTILE,
        issue: 'Toilet keeps running',
        meta: [html`Plumbing`, html`2d`],
        unread: 2,
      }),
    );
    expect(out.startsWith('<a href="/tickets/12" class="docket">')).toBe(true);
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;alert');
    expect(out).toContain('#12');
    expect(out).toContain('Urgent');
    expect(out).toContain('unread messages');
    expect(out).toContain('aria-hidden="true"');
    expect(out.match(/<a /g)).toHaveLength(1);
  });
});
