import { html } from 'hono/html';
import { describe, expect, it } from 'vitest';
import { assetRoutes } from '../../src/web/assets.ts';
import { shellInfo } from '../../src/web/shell.ts';
import {
  alert,
  badge,
  chatBubble,
  docket,
  dl,
  field,
  filterBar,
  formatAge,
  flashMessage,
  formatWhen,
  jobStageLabel,
  linkButton,
  logo,
  page,
  photoGrid,
  publicPage,
  queueRow,
  segmented,
  steps,
  statusBadge,
  table,
  ticketCell,
  urgencyBadge,
  type Html,
} from '../../src/web/ui.ts';

const render = async (markup: Html) => String(await markup);
const HOSTILE = '<script>alert("x")</script>';

describe('assets', () => {
  const assets = assetRoutes();

  it('serves Tailwind and daisyUI with their content types, cacheable', async () => {
    const tw = await assets.request('/assets/tw.css');
    expect(tw.status).toBe(200);
    expect(tw.headers.get('content-type')).toMatch(/^text\/css/);
    expect(tw.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await tw.text()).toContain('.text-muted');
    expect((await assets.request('/assets/tailwind.js')).status).toBe(404);

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

  it('serves the Bricolage Grotesque and Public Sans variable fonts as woff2, long-cached, and 404s other font names', async () => {
    for (const name of ['bricolage-grotesque-latin-opsz-normal.woff2', 'public-sans-latin-wght-normal.woff2']) {
      const font = await assets.request(`/assets/fonts/${name}`);
      expect(font.status).toBe(200);
      expect(font.headers.get('content-type')).toBe('font/woff2');
      expect(font.headers.get('cache-control')).toMatch(/max-age=31536000/);
      expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    }

    expect((await assets.request('/assets/fonts/bricolage-grotesque-latin-wght-normal.woff2')).status).toBe(404);
    expect((await assets.request('/assets/fonts/barlow-latin-400-normal.woff2')).status).toBe(404);
    expect((await assets.request('/assets/fonts/..%2Fui.ts')).status).toBe(404);
    expect((await assets.request('/assets/fonts/public-sans-latin-wght-normal.woff')).status).toBe(404);
  });

  it('declares every allowlisted font in app.css and preloads the two the first paint needs', async () => {
    const css = await (await assets.request('/assets/app.css')).text();
    for (const name of css.matchAll(/url\('\/assets\/fonts\/([^']+)'\)/g)) {
      expect((await assets.request(`/assets/fonts/${name[1]}`)).status).toBe(200);
    }
    expect(css).toContain("--font-head: 'Bricolage Grotesque'");
    expect(css).toContain("--font-body: 'Public Sans'");
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

  it('gives the rail a Collapse menu button, and keeps each label as its link\'s name for the folded rail', async () => {
    const out = await render(page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>` }));
    expect(out).toMatch(/<button type="button" class="rail-toggle" data-rail-toggle aria-controls="rail" aria-expanded="true">/);
    expect(out).toContain('<span class="rail-label">Collapse menu</span>');
    expect(out).toContain('<span class="rail-label">Dashboard</span>');
    // The folded state is set before the first paint, from this browser's choice.
    expect(out).toContain("localStorage.getItem('rail')==='collapsed'");
  });

  it('marks only the active rail link with aria-current', async () => {
    const out = await render(page({ title: 'Dispatch', pm: { name: 'Alice' }, active: 'dispatch', body: html`<p>x</p>` }));
    expect(out).toMatch(/<a href="\/dispatch" class="rail-link" aria-current="page">/);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('lists every place in the rail in three groups, Profiles under its heading, with the Phone simulator at its foot only in the demo', async () => {
    const out = await render(page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>`, demo: true }));
    const links = [...out.matchAll(/<a href="([^"]+)" class="rail-link[^"]*"/g)].map((m) => m[1]);
    expect(links).toEqual(['/', '/dispatch', '/tickets', '/archive', '/approvals', '/calendar', '/properties', '/tradies', '/tenants', '/settings', '/demo']);
    expect(out.match(/<ul class="rail-nav[ "]/g)).toHaveLength(4);
    expect(out).toMatch(/<p class="rail-group" id="rail-group-1">Profiles<\/p><ul class="rail-nav" aria-labelledby="rail-group-1">\s*<li><a href="\/properties"/);
    expect(out.match(/<ul class="rail-nav rail-gap"/g)).toHaveLength(1);
    expect(out).toMatch(/<ul class="rail-nav rail-foot"><li><a href="\/demo" class="rail-link is-quiet"/);
    expect(out).toContain('Phone simulator (demo)');
    expect(out).not.toContain('href="/setup"');

    const live = await render(page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>` }));
    expect(live).not.toContain('href="/demo"');
    const shellDemo = await render(page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>`, shell: { agencyName: 'A', today: 'Fri 9 Oct', demo: true } }));
    expect(shellDemo).toContain('href="/demo"');
  });

  it('shows a count beside a rail link only when something is waiting', async () => {
    const out = await render(
      page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>`, shell: { agencyName: 'Harbour Realty', today: 'Fri 9 Oct', counts: { tickets: 3, approvals: 0 } } }),
    );
    expect(out).toMatch(/href="\/tickets" class="rail-link"[^>]*>(?:(?!<\/a>)[\s\S])*rail-count num">3</);
    expect(out).not.toMatch(/href="\/approvals" class="rail-link"[^>]*>(?:(?!<\/a>)[\s\S])*rail-count/);
  });

  it('shows the Agency and today in the shell, and Sign out inside the user menu', async () => {
    const out = await render(
      page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: html`<p>x</p>`, shell: { agencyName: 'Harbour Realty', today: 'Fri 9 Oct' } }),
    );
    expect(out).toContain('Harbour Realty');
    expect(out).toContain('Fri 9 Oct');
    expect(out).toMatch(/<details class="user-menu" data-menu>[\s\S]*action="\/logout"/);
  });

  it('draws the filter bar as a GET form that keeps the All scope and offers Clear only when a filter is set', async () => {
    const urgencies = [{ value: 'high', label: 'High' }, { value: 'routine', label: 'Routine' }];
    const plain = await render(filterBar({ action: '/tickets', filter: { scope: 'mine' }, urgencies }));
    expect(plain).toMatch(/<form method="get" action="\/tickets" class="filter-bar" data-autosubmit/);
    expect(plain).not.toContain('name="filter"');
    expect(plain).not.toContain('Clear filters');
    expect(plain).not.toContain('name="trade"');
    const set = await render(filterBar({ action: '/tickets', filter: { scope: 'all', urgency: 'high' }, urgencies }));
    expect(set).toContain('<input type="hidden" name="filter" value="all" />');
    expect(set).toMatch(/<option value="high" selected>High<\/option>/);
    expect(set).toContain('href="/tickets?filter=all">Clear filters');
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
    expect(shellInfo(c as never)).toEqual({ agencyName: 'Harbour Realty', today: 'Fri 9 Oct', demo: false });
  });

  it('pairs a field’s label with its control and hint', async () => {
    const out = await render(field({ label: 'Mobile', name: 'mobile', type: 'tel', hint: 'Australian mobile' }));
    expect(out).toMatch(/<label for="field-mobile"/);
    expect(out).toMatch(/<input id="field-mobile" name="mobile"/);
    expect(out).toContain('aria-describedby="field-mobile-hint"');
    expect(out).toContain('id="field-mobile-hint"');
  });

  it('marks a refused file or checkbox field the way it marks a text field: a red control, its error tied to it', async () => {
    const file = await render(field({ label: 'Photos', name: 'photos', type: 'file', error: 'Choose a photo under 10 MB.' }));
    expect(file).toMatch(/<input [^>]*aria-describedby="field-photos-error"[^>]*aria-invalid="true"[^>]*class="file-input w-full file-input-error"/);
    const box = await render(field({ label: 'I agree', name: 'agree', type: 'checkbox', error: 'Tick this to go on.' }));
    expect(box).toMatch(/<input [^>]*aria-invalid="true"[^>]*class="checkbox checkbox-primary checkbox-sm[^"]*checkbox-error/);
    expect(await render(field({ label: 'Photos', name: 'photos', type: 'file' }))).not.toContain('file-input-error');
  });

  it('escapes chat text, keeps its line breaks and links only http(s) URLs', async () => {
    const out = await render(chatBubble({ side: 'start', header: 'myEST8', text: `${HOSTILE}\nUpload: https://myest8.test/u/abc?x=1&y=2.` }));
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('\nUpload: ');
    expect(out).toContain('href="https://myest8.test/u/abc?x=1&amp;y=2"');
    expect(out).toContain('whitespace-pre-wrap');
  });

  it('keeps a link in a chat bubble in the same tab, with noopener noreferrer for anyone who opens it in a new one', async () => {
    const out = await render(chatBubble({ side: 'start', header: 'myEST8', text: 'Upload: https://myest8.test/u/abc' }));
    expect(out).toContain('<a class="link" href="https://myest8.test/u/abc" rel="noopener noreferrer">https://myest8.test/u/abc</a>');
    expect(out).not.toContain('target=');
  });

  it('gives links in a chat bubble the bubble’s own text colour, so they read on Harbour', async () => {
    const out = await render(chatBubble({ side: 'end', header: 'Alice', text: 'See https://myest8.test/t/abc' }));
    expect(out).toContain('chat-bubble-primary');
    const css = await (await assetRoutes().request('/assets/app.css')).text();
    expect(css).toMatch(/\.chat-bubble a:not\(\.btn\) \{\s*color: inherit;\s*text-decoration: underline;/);
  });

  it('links each photo to its full image in the same tab, with no hint about a new one', async () => {
    const out = await render(photoGrid([{ src: '/files/1', caption: 'Mon 12 Oct, 9:00 am' }, { src: '/files/2' }]));
    expect(out).toMatch(/<a href="\/files\/1" [^>]*>\s*<img src="\/files\/1" alt="Photo 1 of 2"/);
    expect(out).toMatch(/<a href="\/files\/2" [^>]*>\s*<img src="\/files\/2" alt="Photo 2 of 2"/);
    expect(out).not.toContain('target=');
    expect(out).not.toContain('new tab');
    expect(out).toContain('<figcaption class="text-xs text-muted">Mon 12 Oct, 9:00 am</figcaption>');
  });

  it('marks the photo grid for the viewer, so app.js can open its photos over the page', async () => {
    const out = await render(photoGrid([{ src: '/files/1' }, { src: '/files/2' }]));
    expect(out).toMatch(/^<ul role="list" data-photo-grid /);
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

  it('reads a docket as the stub (number, Urgency), the perforation, then the issue, the address and the stage line', async () => {
    const out = await render(
      docket({
        number: 12,
        href: '/tickets/12',
        urgency: 'high',
        address: '7 Wilson St, Newtown NSW 2042',
        issue: 'Toilet keeps running',
        meta: [html`Plumbing`, html`Ready to choose`],
        age: '2 days ago',
        decision: true,
      }),
    );
    expect(out.startsWith('<a href="/tickets/12" class="docket is-decision">')).toBe(true);
    const at = (text: string) => out.indexOf(text);
    expect(at('#12')).toBeLessThan(at('High'));
    expect(at('High')).toBeLessThan(at('docket-perf'));
    expect(at('docket-perf')).toBeLessThan(at('Toilet keeps running'));
    expect(at('Toilet keeps running')).toBeLessThan(at('7 Wilson St'));
    expect(at('7 Wilson St')).toBeLessThan(at('Ready to choose'));
    expect(out).toContain('line-clamp-3 docket-issue');
    expect(out).toContain('2 days ago');
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

  it('page controls sit in the page header, after the title and before the date and user menu', async () => {
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
    const controls = out.indexOf('<div class="page-header-controls">');
    expect(controls).toBeGreaterThan(out.indexOf('<h1 class="page-title">Dashboard</h1>'));
    expect(out.slice(controls)).toMatch(/<div class="page-header-controls">\s*<nav class="segmented"/);
    expect(out.indexOf('class="user-menu"')).toBeGreaterThan(controls);
    expect(out).not.toContain('class="topbar');
  });

  it('a page without controls renders no controls container', async () => {
    const out = await render(page({ title: 'Dispatch', pm: { name: 'Alice' }, active: 'dispatch', body: html`<p>x</p>` }));
    expect(out).not.toContain('page-header-controls');
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

  it('gives a badge a hairline boundary when asked, keeping its tone, so it holds on the page background', async () => {
    const outlined = await render(badge('Plumbing', 'neutral', { outline: true }));
    expect(outlined).toMatch(/class="badge badge-soft badge-neutral is-outline /);
    expect(outlined).toContain('>Plumbing</span>');
    expect(await render(badge('Plumbing'))).not.toContain('is-outline');
  });

  it('shows Routine as muted text on a hairline, and keeps the High and Urgent tones', async () => {
    const routine = await render(urgencyBadge('routine'));
    expect(routine).toContain('badge-muted');
    expect(routine).not.toContain('badge-neutral');
    expect(await render(urgencyBadge('high'))).toContain('badge-warning');
    expect(await render(urgencyBadge('urgent'))).toContain('badge-error');
  });

  it('clamps a board docket’s issue to three lines, or to the lines asked for', async () => {
    const base = { number: 7, href: '/tickets/7', urgency: 'high', address: '27 Llewellyn St', issue: 'The cupboard is falling apart', meta: [] };
    expect(await render(docket(base))).toContain('class="line-clamp-3 docket-issue"');
    const two = await render(docket({ ...base, lines: 2 }));
    expect(two).toContain('class="line-clamp-2 docket-issue"');
    expect(two).toContain('title="The cupboard is falling apart"');
  });

  it('gives each step its own state when asked: a skipped step is muted with no tick, and the current one is the one named', async () => {
    const out = await render(
      steps(
        [
          { label: 'Estimates', state: 'done' },
          { label: 'Site inspection', state: 'skipped', detail: 'Not needed' },
          { label: 'Firm Quote', state: 'upcoming' },
          { label: 'Booked', state: 'current', detail: 'Waiting on Tenant to confirm' },
          { label: 'Done', state: 'upcoming' },
        ],
        { horizontal: true },
      ),
    );
    const items = out.split('<li').slice(1);
    expect(items[0]).toContain('data-content="✓"');
    expect(items[1]).toContain('step-skipped');
    expect(items[1]).not.toContain('step-primary');
    expect(items[1]).not.toContain('✓');
    expect(items[1]).toContain('(skipped)');
    expect(items[1]).toContain('Not needed');
    expect(items[2]).not.toContain('aria-current');
    expect(items[3]).toContain('aria-current="step"');
    expect(items[3]).toContain('step-primary');
    expect(items[3]).not.toContain('data-content');
    expect(out.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it('skips skipped steps when finding the first step not done', async () => {
    const out = await render(steps([{ label: 'Quote', done: true }, { label: 'Owner', state: 'skipped' }, { label: 'Book', done: false }], { horizontal: true }));
    expect(out.split('<li').slice(1)[2]).toContain('aria-current="step"');
  });

  it('keeps a done step that is the one on screen marked as both done and current', async () => {
    const out = await render(steps([{ label: 'Email', done: true }, { label: 'SMS', done: false }], { horizontal: true, current: 0 }));
    const first = out.split('<li').slice(1)[0]!;
    expect(first).toContain('data-content="✓"');
    expect(first).toContain('aria-current="step"');
    expect(first).toContain('(done)');
    expect(first).toContain('(this step)');
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

  it('stacks a table on phones only when asked, leaving the cell widths to app.css', async () => {
    const out = await render(table(['Issue', 'Price'], [[html`Leak`, html`$420.00`]], { align: ['left', 'right'], stack: true }));
    expect(out).toContain('<div class="table-frame is-stacked">');
    expect(out).toContain('<td>Leak</td>');
    expect(out).toContain('<td class="num text-right">$420.00</td>');
    expect(await render(table(['Issue'], [[html`Leak`]]))).toContain('<div class="table-frame">');
  });

  it('labels each stacked cell with its column header when asked, so a phone row still says what each value is', async () => {
    const out = await render(
      table(['Property', 'Property Owner', 'Open Tickets', ''], [[html`12 King St`, html`Olivia Owens`, html`2`, html`<a href="/x">Edit</a>`]], {
        align: ['left', 'left', 'right', 'left'],
        stack: 'labelled',
      }),
    );
    expect(out).toContain('<div class="table-frame is-stacked is-labelled">');
    expect(out).toContain('<td data-label="Property Owner">Olivia Owens</td>');
    expect(out).toContain('<td class="num text-right" data-label="Open Tickets">2</td>');
    // The first cell leads the row, and a column with no header has nothing to say.
    expect(out).toContain('<td>12 King St</td>');
    expect(out).toContain('<td><a href="/x">Edit</a></td>');
  });

  it('gives each row the attributes asked for, escaped, and leaves rows without any bare', async () => {
    const out = await render(
      table(['Address', 'Suburb'], [[html`12 King St`, html`Newtown`], [html`9 Albion St`, html`Annandale`]], {
        rowAttributes: [{ 'data-row': 'property-1', 'data-selected': true, 'aria-label': HOSTILE }, undefined],
      }),
    );
    expect(out).toContain('<tr data-row="property-1" data-selected aria-label="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;">');
    expect(out).toContain('<tr><td class="min-w-28">9 Albion St</td>');
    expect(out).not.toContain('<script>');
  });

  it('leaves out an attribute set to false, and refuses a name that is not a plain attribute name', async () => {
    expect(await render(table(['A'], [[html`x`]], { rowAttributes: [{ 'data-selected': false }] }))).toContain('<tr><td');
    expect(() => table(['A'], [[html`x`]], { rowAttributes: [{ 'onclick="x"': 'y' }] })).toThrow();
  });

  it('makes the first cell of each row its row header when asked, stacked or not', async () => {
    const out = await render(
      table(['Address', 'Open Tickets'], [[html`12 King St`, html`2`]], { rowHeader: true, stack: 'labelled', align: ['left', 'right'] }),
    );
    expect(out).toContain('<tr><th scope="row">12 King St</th><td class="num text-right" data-label="Open Tickets">2</td></tr>');
    expect(await render(table(['Address'], [[html`12 King St`]]))).toContain('<td class="min-w-28">12 King St</td>');
  });

  it('escapes a stacked cell’s label', async () => {
    const out = await render(table(['Issue', HOSTILE], [[html`Leak`, html`x`]], { stack: 'labelled' }));
    expect(out).not.toContain('<script>');
    expect(out).toContain('data-label="&lt;script&gt;');
  });

  it('pairs each label with its value in a facts list, escaping both', async () => {
    const out = await render(dl([['Max Repair Cost', '$500.00'], ['Property Owner', HOSTILE]]));
    expect(out).toMatch(/^<dl class="facts">/);
    const rows = out.split('<div class="facts-row">').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/<dt class="facts-term">Max Repair Cost<\/dt>\s*<dd class="facts-value">\$500\.00<\/dd>/);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('reads a Ticket cell issue first, linking to the Ticket, with a quiet number, the unread count and the address linking to the Property', async () => {
    const out = await render(ticketCell({ ticketId: 7, issue: 'The tap drips', address: '12 King St', propertyHref: '/properties/1', unread: 2 }));
    const issue = out.indexOf('<a href="/tickets/7" class="ticket-cell-issue">The tap drips</a>');
    expect(issue).toBeGreaterThan(-1);
    expect(out.indexOf('#7')).toBeGreaterThan(issue);
    expect(out).toContain('2 unread');
    // The address is a chip that links to the Property.
    expect(out).toMatch(/<p class="ticket-cell-address"><a class="entity-link entity-link-property" href="\/properties\/1">.*<span>12 King St<\/span><\/a><\/p>/);
    expect(out.indexOf('href="/properties/1"')).toBeGreaterThan(issue);

    const quiet = await render(ticketCell({ ticketId: 7, issue: 'The tap drips', address: '12 King St' }));
    expect(quiet).toContain('<p class="ticket-cell-address">12 King St</p>');
    expect(quiet).not.toContain('unread');
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
    const out = await render(page({ title: 'Dashboard', pm: { name: 'Alice' }, active: 'dashboard', body: alert('Check the photo', 'warning'), demo: true }));
    const phosphor = /<svg (?![^>]*logo-mark)[^>]*viewBox="0 0 256 256"/g;
    // eleven rail links (ten places and the Phone simulator), Collapse menu, the menu button, the user menu caret, the alert (the logo's key tag is our own)
    expect(out.match(phosphor)).toHaveLength(15);
    expect(out).not.toContain('viewBox="0 0 24 24"');
    expect(out).toMatch(/class="rail-link" aria-current="page"><svg [^>]*class="size-\[18px\] shrink-0"/);
    expect(await render(flashMessage({ kind: 'ok', message: 'Saved' }))).toMatch(/<svg [^>]*viewBox="0 0 256 256"/);
  });
});
