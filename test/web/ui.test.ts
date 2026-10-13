import { html } from 'hono/html';
import { describe, expect, it } from 'vitest';
import { assetRoutes } from '../../src/web/assets.ts';
import { shellInfo } from '../../src/web/shell.ts';
import {
  alert,
  chatBubble,
  docket,
  field,
  formatAge,
  flashMessage,
  formatWhen,
  jobStageLabel,
  linkButton,
  logo,
  page,
  publicPage,
  queueRow,
  segmented,
  steps,
  statusBadge,
  table,
  urgencyBadge,
  type Html,
} from '../../src/web/ui.ts';

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

  it('serves the favicon as SVG: the key tag in Night, Wattle in dark mode', async () => {
    const res = await assets.request('/assets/favicon.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\/svg\+xml/);
    const svg = await res.text();
    expect(svg).toMatch(/^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('#13212E');
    expect(svg).toMatch(/prefers-color-scheme:\s*dark\)\{path\{fill:#FFC233\}/);
  });

  it('404s anything else under /assets', async () => {
    expect((await assets.request('/assets/unknown.js')).status).toBe(404);
    expect((await assets.request('/assets/static/app.css')).status).toBe(404);
    expect((await assets.request('/assets/..%2Fui.ts')).status).toBe(404);
  });

  it('serves the Lexend and Red Hat Text fonts as woff2, long-cached, and 404s other font names', async () => {
    for (const name of ['lexend-latin-600-normal.woff2', 'red-hat-text-latin-400-normal.woff2']) {
      const font = await assets.request(`/assets/fonts/${name}`);
      expect(font.status).toBe(200);
      expect(font.headers.get('content-type')).toBe('font/woff2');
      expect(font.headers.get('cache-control')).toMatch(/max-age=31536000/);
      expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    }

    expect((await assets.request('/assets/fonts/lexend-latin-800-normal.woff2')).status).toBe(404);
    expect((await assets.request('/assets/fonts/barlow-latin-400-normal.woff2')).status).toBe(404);
    expect((await assets.request('/assets/fonts/..%2Fui.ts')).status).toBe(404);
    expect((await assets.request('/assets/fonts/lexend-latin-400-normal.woff')).status).toBe(404);
  });

  it('declares every allowlisted font in app.css and preloads the two the first paint needs', async () => {
    const css = await (await assets.request('/assets/app.css')).text();
    for (const name of css.matchAll(/url\('\/assets\/fonts\/([^']+)'\)/g)) {
      expect((await assets.request(`/assets/fonts/${name[1]}`)).status).toBe(200);
    }
    expect(css).toContain("--font-head: 'Lexend'");
    expect(css).toContain("--font-body: 'Red Hat Text'");
    const out = await render(publicPage({ title: 'Sign in', body: html`<p>x</p>` }));
    for (const name of out.matchAll(/<link rel="preload" href="\/assets\/fonts\/([^"]+)"/g)) {
      expect(css).toContain(`/assets/fonts/${name[1]}`);
    }
    expect(out.match(/rel="preload"/g)).toHaveLength(2);
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
    const out = await render(page({ title: 'Dispatch', pm: { name: 'Alice' }, active: 'dispatch', body: html`<p>x</p>` }));
    expect(out).toMatch(/<a href="\/dispatch" class="rail-link" aria-current="page">/);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('lists the work, then the records and Settings, in the rail, with the Phone simulator at its foot only in the demo', async () => {
    const out = await render(page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>` }));
    const links = [...out.matchAll(/<a href="([^"]+)" class="rail-link[^"]*"/g)].map((m) => m[1]);
    expect(links).toEqual(['/', '/requests', '/tickets', '/approvals', '/dispatch', '/properties', '/tradies', '/settings', '/demo']);
    expect(out).toMatch(/<ul class="rail-nav rail-foot"><li><a href="\/demo" class="rail-link is-quiet"/);
    expect(out).toContain('Phone simulator (demo)');
    expect(out).not.toContain('href="/calendar"');
    expect(out).not.toContain('href="/setup"');
    expect(out.match(/<ul class="rail-nav">/g)).toHaveLength(2);

    const live = await render(page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>`, demo: false }));
    expect(live).not.toContain('href="/demo"');
  });

  it('shows the Agency and today in the shell, and Sign out inside the user menu', async () => {
    const out = await render(
      page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>`, shell: { agencyName: 'Harbour Realty', today: 'Fri 9 Oct' } }),
    );
    expect(out).toContain('Harbour Realty');
    expect(out).toContain('Fri 9 Oct');
    expect(out).toMatch(/<details class="user-menu" data-menu>[\s\S]*action="\/logout"/);
  });

  it('builds the Agency name, today in the Agency time zone and the rail counts', async () => {
    const c = {
      var: {
        actions: {
          agency: () => ({ name: 'Harbour Realty', timeZone: 'Australia/Sydney' }),
          now: () => new Date('2026-10-08T23:30:00Z'),
          navCounts: async () => ({ requests: 3, approvals: 0 }),
        },
      },
    };
    expect(await shellInfo(c as never)).toEqual({ agencyName: 'Harbour Realty', today: 'Fri 9 Oct', counts: { requests: 3, approvals: 0 } });
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

  it('gives links in a chat bubble the bubble’s own text colour, so they read on Harbour', async () => {
    const out = await render(chatBubble({ side: 'end', header: 'Alice', text: 'See https://myest8.test/t/abc' }));
    expect(out).toContain('chat-bubble-primary');
    const css = await (await assetRoutes().request('/assets/app.css')).text();
    expect(css).toMatch(/\.chat-bubble a:not\(\.btn\) \{\s*color: inherit;\s*text-decoration: underline;/);
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

  it('a primary link button carries the primary class, so its text stays white on the action colour', async () => {
    const out = await render(linkButton('Create your account', '/signup', { variant: 'primary' }));
    expect(out).toContain('href="/signup"');
    expect(out).toMatch(/class="btn btn-primary"/);
    expect(out).not.toContain('btn-outline');
  });

  it('a narrow public page applies the narrow width to its bar, column and footer', async () => {
    const out = await render(publicPage({ title: 'Sign in to myEST8', width: 'narrow', body: html`<p>x</p>` }));
    expect(out).toContain('class="public-bar-inner is-narrow"');
    expect(out).toContain('class="public-main is-narrow"');
    expect(out).toContain('class="public-footer is-narrow"');
    expect(out).not.toContain('is-wide');
  });

  it('wide: true still gives the wide column, and the hero title is the page h1', async () => {
    const out = await render(publicPage({ title: 'Headline', wide: true, titleSize: 'hero', body: html`<p>x</p>` }));
    expect(out).toContain('class="public-main is-wide"');
    expect(out).toContain('<h1 class="page-title is-hero">Headline</h1>');
  });

  it('page controls render in the second-row container, after the title', async () => {
    const out = await render(
      page({
        title: 'Dashboard',
        pm: { name: 'Alice' },
        active: 'dashboard',
        body: html`<p>x</p>`,
        controls: segmented([
          { label: 'Mine', href: '/', active: true },
          { label: 'All', href: '/?filter=all', active: false },
        ]),
      }),
    );
    const controls = out.indexOf('<div class="topbar-controls">');
    expect(controls).toBeGreaterThan(out.indexOf('<h1 class="topbar-title">Dashboard</h1>'));
    expect(out.slice(controls)).toMatch(/<div class="topbar-controls">\s*<nav class="segmented"/);
    expect(out.indexOf('class="topbar-end"')).toBeGreaterThan(controls);
  });

  it('a page without controls renders no controls container', async () => {
    const out = await render(page({ title: 'Dispatch', pm: { name: 'Alice' }, active: 'dispatch', body: html`<p>x</p>` }));
    expect(out).not.toContain('topbar-controls');
  });

  it('formats times as "Mon 14 Sep, 10:00 am" with three-letter months, never "Sept"', () => {
    expect(formatWhen('2026-09-14T00:00:00Z')).toBe('Mon 14 Sep, 10:00 am');
    expect(formatWhen('2026-09-14T00:00:00Z')).not.toContain('Sept');
    expect(formatWhen(null)).toBe('—');
  });

  it('says how long ago a moment was, in words', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    expect(formatAge('2026-10-07T12:00:00Z', now)).toBe('2 days ago');
    expect(formatAge('2026-10-09T11:00:00Z', now)).toBe('1 hour ago');
    expect(formatAge('2026-10-08T12:00:00Z', now)).toBe('1 day ago');
  });

  it('names the Job stages in the doc’s words, and a Job’s approved stage is Ready to book', async () => {
    expect(jobStageLabel('scheduled')).toBe('Booked');
    expect(jobStageLabel('awaiting_owner')).toBe('With Property Owner');
    expect(await render(statusBadge('awaiting_owner'))).toContain('With Property Owner');
    expect(await render(statusBadge('scheduled'))).toContain('Booked');
    expect(await render(statusBadge('approved', { job: true }))).toContain('Ready to book');
    expect(await render(statusBadge('approved'))).toContain('Approved');
  });

  it('marks the first stage not done as current, and the stages to come as plain', async () => {
    const out = await render(
      steps(
        [
          { label: 'Quote', done: true },
          { label: 'Book', done: false },
          { label: 'Done', done: false },
        ],
        { horizontal: true },
      ),
    );
    const items = out.split('<li').slice(1);
    expect(items[0]).toContain('data-content="✓"');
    expect(items[1]).toContain('aria-current="step"');
    expect(items[1]).toContain('step-primary');
    expect(items[2]).not.toContain('step-primary');
    expect(items[2]).not.toContain('aria-current');
    expect(out.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it('gives a queue row the hi-vis stripe only when it is a decision', async () => {
    expect(await render(queueRow({ title: 'Toilet keeps running', decision: true }))).toContain('is-decision');
    expect(await render(queueRow({ title: 'Toilet keeps running' }))).not.toContain('is-decision');
  });

  it('shows Routine as muted text on a hairline, and keeps the High and Urgent tones', async () => {
    const routine = await render(urgencyBadge('routine'));
    expect(routine).toContain('badge-muted');
    expect(routine).not.toContain('badge-neutral');
    expect(await render(urgencyBadge('high'))).toContain('badge-warning');
    expect(await render(urgencyBadge('urgent'))).toContain('badge-error');
  });

  it('shows the street in a large docket and clamps the issue, with the full text as a title', async () => {
    const out = await render(
      docket({
        number: 12,
        href: '/tickets/12',
        urgency: 'high',
        address: '7 Wilson Street, Newtown NSW 2042',
        street: '7 Wilson St',
        issue: 'Toilet keeps running',
        meta: [html`Plumbing`],
        size: 'large',
      }),
    );
    expect(out.startsWith('<a href="/tickets/12" class="docket is-large">')).toBe(true);
    expect(out).toContain('>7 Wilson St</span>');
    expect(out).toContain('title="7 Wilson Street, Newtown NSW 2042"');
    expect(out).toContain('line-clamp-2 docket-issue');
  });

  it('right-aligns the columns it is asked to, with the tabular numeral class', async () => {
    const out = await render(table(['Tradie', 'Median Quote'], [[html`Drip Doctors`, html`$420.00`]], { align: ['left', 'right'] }));
    expect(out).toContain('<td class="min-w-28 num text-right">$420.00</td>');
    expect(out).toContain('<td class="min-w-28">Drip Doctors</td>');
    expect(out).not.toContain('align-top');
  });

  it('renders the logo as a hidden key tag beside the wordmark, so its name is "myEST8"', async () => {
    const out = await render(logo());
    expect(out).toMatch(/^<span class="logo is-md">/);
    expect(out).toContain('<span class="logo-my">my</span>EST8');
    expect(out).toMatch(/<path fill-rule="evenodd" d="M128 14 L208 94/);
    expect(out).toMatch(/<svg [^>]*class="logo-mark"[^>]*aria-hidden="true"[^>]*focusable="false"/);
    expect(out.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '')).toBe('myEST8');
    expect(await render(logo({ size: 'sm' }))).toMatch(/^<span class="logo is-sm">/);
  });

  it('puts the logo in the rail, linking home, and the favicon in the head', async () => {
    const out = await render(page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>` }));
    expect(out).toMatch(/<a href="\/" class="rail-logo"><span class="logo is-md"><svg [^>]*class="logo-mark"/);
    expect(out).toContain('<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />');
  });

  it('puts the logo and the favicon on a public page too', async () => {
    const out = await render(publicPage({ title: 'Sign in', body: html`<p>x</p>` }));
    expect(out).toMatch(/<span class="logotype"><span class="logo is-md"><svg [^>]*class="logo-mark"/);
    expect(out).toContain('<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />');
  });

  it('draws the rail, menu and message icons from Phosphor', async () => {
    const out = await render(page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: alert('Check the photo', 'warning') }));
    const phosphor = /<svg (?![^>]*logo-mark)[^>]*viewBox="0 0 256 256"/g;
    // nine rail links, the menu button, the user menu caret, the alert (the logo's key tag is our own)
    expect(out.match(phosphor)).toHaveLength(12);
    expect(out).not.toContain('viewBox="0 0 24 24"');
    expect(out).toMatch(/class="rail-link" aria-current="page"><svg [^>]*class="size-\[18px\] shrink-0"/);
    expect(await render(flashMessage({ kind: 'ok', message: 'Saved' }))).toMatch(/<svg [^>]*viewBox="0 0 256 256"/);
  });
});
