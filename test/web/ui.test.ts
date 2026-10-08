import { html } from 'hono/html';
import { describe, expect, it } from 'vitest';
import { assetRoutes } from '../../src/web/assets.ts';
import { chatBubble, field, page, type Html } from '../../src/web/ui.ts';

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
});

describe('ui', () => {
  it('escapes a hostile title and body text', async () => {
    const out = await render(page({ title: HOSTILE, pm: { name: HOSTILE }, active: 'dashboard', body: html`<p>${HOSTILE}</p>` }));
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(out).toContain('aria-current="page"');
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
});
