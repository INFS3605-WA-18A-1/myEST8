import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';

// Adding a Tradie from their Google listing: search, pick a result, then a form filled in from it.
// The same component is on the welcome wizard, Setup and the Tradies page.

type Web = Awaited<ReturnType<typeof webWorld>>;

const PAGES = [
  { name: 'the welcome wizard', path: '/welcome/tradies', post: '/welcome/tradies' },
  { name: 'Setup', path: '/setup', post: '/setup/tradies?from=setup' },
  { name: 'the Tradies page', path: '/tradies', post: '/setup/tradies' },
];

const LUCKY = {
  name: 'Lucky Locks',
  address: '12 Crown St, Surry Hills NSW 2010',
  rating: 4.6,
  reviewCount: 22,
  phone: '+61 412 555 018',
  website: 'https://luckylocks.example',
  types: ['locksmith'],
  primaryType: 'Locksmith',
  summary: 'Locksmiths for homes and rentals.',
};

/** A world whose Google knows Lucky Locks and whose Jev suggests locksmithing for it. */
async function luckyWorld() {
  const w = await webWorld();
  const cookie = await w.signIn();
  w.h.places.listings.set('place-lucky', LUCKY);
  w.h.places.listings.set('place-lucky-two', { ...LUCKY, name: 'Lucky Locks and Keys', address: '9 Bay St, Glebe NSW 2037' });
  w.h.tradeSuggester.next = ['locksmith'];
  return { w, cookie };
}

async function page(w: Web, path: string, cookie: string) {
  const res = await w.get(path, cookie);
  expect(res.status, path).toBe(200);
  return res.text();
}

/** A tag in the page by an attribute it carries, or undefined. */
const tag = (html: string, name: string, attr: string) => html.match(new RegExp(`<${name}\\s[^>]*${attr}[^>]*>`))?.[0];

/** The Tradie form: Setup has other forms with a Mobile field of their own. */
function tradieForm(html: string) {
  const at = html.indexOf('name="placeId"');
  return at < 0 ? html : html.slice(html.lastIndexOf('<form', at), html.indexOf('</form>', at));
}

/** What a control in the Tradie form is filled in with: an input's value. */
const valueOf = (html: string, field: string) => tag(tradieForm(html), 'input', `name="${field}"`)?.match(/value="([^"]*)"/)?.[1];

/** The values of the ticked boxes in the Trades group. */
const tickedTrades = (html: string) =>
  [...tradieForm(html).matchAll(/<input\s[^>]*name="trades"[^>]*>/g)].map((m) => m[0]).filter((t) => /\schecked\b/.test(t)).map((t) => t.match(/value="([^"]*)"/)![1]);

/** The links in the list of Google results, with the address each leads to. */
function results(html: string) {
  const start = html.indexOf('aria-label="Google listings"');
  if (start < 0) return [];
  const list = html.slice(start, html.indexOf('</ul>', start));
  return [...list.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1]!.replaceAll('&amp;', '&'),
    tag: m[0].slice(0, m[0].indexOf('>') + 1),
    text: visible(m[2]!).trim(),
  }));
}

describe.each(PAGES)('adding a Tradie from their Google listing on $name', ({ path }) => {
  test('the results are links under the search bar, one per listing, with the chosen one marked', async () => {
    const { w, cookie } = await luckyWorld();

    const searched = await page(w, `${path}?google=lucky`, cookie);
    const found = results(searched);
    expect(found.map((r) => r.text)).toEqual(['Lucky Locks 12 Crown St, Surry Hills NSW 2010', 'Lucky Locks and Keys 9 Bay St, Glebe NSW 2037']);
    expect(found.map((r) => r.href.replace(/#.*/, ''))).toEqual([
      `${path}?google=lucky&place=place-lucky`,
      `${path}?google=lucky&place=place-lucky-two`,
    ]);
    expect(found.some((r) => r.tag.includes('aria-current'))).toBe(false);
    // The search bar comes first, then the results.
    expect(searched.indexOf('name="google"')).toBeLessThan(searched.indexOf('aria-label="Google listings"'));

    const chosen = results(await page(w, found[1]!.href, cookie));
    expect(chosen.map((r) => r.tag.includes('aria-current="true"'))).toEqual([false, true]);
  });

  test("choosing a listing shows its card and fills the form in: the name, the mobile, Jev's Trades and the listing", async () => {
    const { w, cookie } = await luckyWorld();

    const html = await page(w, `${path}?google=lucky&place=place-lucky`, cookie);
    const text = visible(html);
    for (const shown of ['Lucky Locks', '12 Crown St, Surry Hills NSW 2010', '+61 412 555 018', 'https://luckylocks.example', '4.6', '22', 'Locksmith']) expect(text).toContain(shown);
    expect(valueOf(html, 'businessName')).toBe('Lucky Locks');
    expect(valueOf(html, 'mobile')).toBe('+61 412 555 018');
    expect(valueOf(html, 'name')).toBe('');
    expect(tickedTrades(html)).toEqual(['locksmith']);
    expect(text).toContain('Suggested from their Google listing. Check them.');
    expect(tag(html, 'input', 'name="placeId"')).toContain('type="hidden"');
    expect(valueOf(html, 'placeId')).toBe('place-lucky');
    // The listing is no longer picked from a radio group at the bottom of the form.
    expect(html).not.toContain('type="radio"');
    expect(text).not.toContain('Google listing Not on Google');
  });

  test("the listing's website is a link that stays in this tab, with noopener noreferrer for anyone who opens it in a new one", async () => {
    const { w, cookie } = await luckyWorld();

    const html = await page(w, `${path}?google=lucky&place=place-lucky`, cookie);
    expect(html).toContain('<a class="link" href="https://luckylocks.example" rel="noopener noreferrer">https://luckylocks.example</a>');
    expect(html).not.toContain('target="_blank"');
  });

  test('a landline is shown in the card but not put in Mobile, because myEST8 texts that number', async () => {
    const { w, cookie } = await luckyWorld();
    w.h.places.listings.set('place-lucky', { ...LUCKY, phone: '+61 2 9319 0044' });

    const html = await page(w, `${path}?google=lucky&place=place-lucky`, cookie);
    expect(visible(html)).toContain('+61 2 9319 0044');
    expect(valueOf(html, 'mobile')).toBe('');
  });

  test('a listing with no phone, website or summary still fills in the rest', async () => {
    const { w, cookie } = await luckyWorld();
    w.h.places.listings.set('place-lucky', { name: 'Lucky Locks', address: '12 Crown St, Surry Hills NSW 2010', rating: null, reviewCount: 0 });

    const html = await page(w, `${path}?google=lucky&place=place-lucky`, cookie);
    expect(valueOf(html, 'businessName')).toBe('Lucky Locks');
    expect(valueOf(html, 'mobile')).toBe('');
    expect(valueOf(html, 'placeId')).toBe('place-lucky');
  });

  test('when Jev cannot suggest Trades none are ticked and the form says to choose them', async () => {
    const { w, cookie } = await luckyWorld();
    w.h.tradeSuggester.next = new Error('Jev returned 500: down');

    const html = await page(w, `${path}?google=lucky&place=place-lucky`, cookie);
    expect(valueOf(html, 'businessName')).toBe('Lucky Locks');
    expect(tickedTrades(html)).toEqual([]);
    expect(visible(html)).toContain('Choose their Trades.');
    expect(visible(html)).not.toContain('Suggested from their Google listing');
  });

  test('when Jev suggests no Trade at all the form also says to choose them', async () => {
    const { w, cookie } = await luckyWorld();
    w.h.tradeSuggester.next = [];

    const html = await page(w, `${path}?google=lucky&place=place-lucky`, cookie);
    expect(tickedTrades(html)).toEqual([]);
    expect(visible(html)).toContain('Choose their Trades.');
  });

  test('"Not on Google? Enter their details yourself" opens the empty form, marked not on Google', async () => {
    const { w, cookie } = await luckyWorld();

    const searched = await page(w, `${path}?google=lucky`, cookie);
    const link = [...searched.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>\s*Not on Google\? Enter their details yourself\s*<\/a>/g)][0];
    expect(link).toBeDefined();
    const href = link![1]!.replaceAll('&amp;', '&');
    expect(href).toMatch(/manual=1/);

    const html = await page(w, href.replace(/#.*/, ''), cookie);
    expect(valueOf(html, 'businessName')).toBe('');
    expect(valueOf(html, 'mobile')).toBe('');
    expect(tickedTrades(html)).toEqual([]);
    expect(valueOf(html, 'placeId')).toBe('none');
    expect(visible(html)).not.toContain('Suggested from their Google listing');
    expect(w.h.tradeSuggester.calls).toEqual([]);
  });

  test('with no listing chosen there is no form, just the search and its results', async () => {
    const { w, cookie } = await luckyWorld();

    for (const url of [path, `${path}?google=lucky`]) {
      const html = await page(w, url, cookie);
      expect(html, url).toContain('name="google"');
      expect(tag(html, 'input', 'name="businessName"'), url).toBeUndefined();
      expect(tag(html, 'input', 'name="placeId"'), url).toBeUndefined();
      expect(html, url).not.toContain('action="/setup/tradies');
    }
    expect(results(await page(w, `${path}?google=lucky`, cookie))).toHaveLength(2);
  });

  test("when Google fails loading the listing's details it says so and offers the empty form", async () => {
    const { w, cookie } = await luckyWorld();
    w.h.places.listingDetails = async () => {
      throw new Error('Google returned 503');
    };

    const html = await page(w, `${path}?google=lucky&place=place-lucky`, cookie);
    expect(visible(html)).toContain("Google search isn't working right now.");
    expect(tag(html, 'input', 'name="businessName"')).toBeUndefined();
    expect(html).toMatch(/href="[^"]*manual=1[^"]*"[^>]*>\s*Not on Google\? Enter their details yourself/);
  });
});

describe('a refused Tradie form keeps the listing', () => {
  const listing = '?google=lucky&place=place-lucky';
  const posted = { businessName: 'Lucky Locks', name: '', mobile: '+61 412 555 018', email: '', trades: ['locksmith', 'general_handyman'], startingRating: '', placeId: 'place-lucky' };

  test('on the welcome wizard it shows again with what was posted and the errors, on the same listing', async () => {
    const { w, cookie } = await luckyWorld();

    const refused = await w.post(`/welcome/tradies${listing}`, { ...posted, name: 'Lou Lucky' }, cookie);
    expect(refused.status).toBe(400);
    const html = await refused.text();
    expect(visible(html)).toContain('Choose a starting rating');
    expect(valueOf(html, 'businessName')).toBe('Lucky Locks');
    expect(valueOf(html, 'name')).toBe('Lou Lucky');
    expect(tickedTrades(html)).toEqual(['locksmith', 'general_handyman']);
    expect(valueOf(html, 'placeId')).toBe('place-lucky');
    expect(visible(html)).toContain('12 Crown St, Surry Hills NSW 2010');
    expect(results(html).map((r) => r.tag.includes('aria-current="true"'))).toEqual([true, false]);
    expect(html).toContain(`action="/welcome/tradies${listing.replaceAll('&', '&amp;')}"`);
  });

  test('on the welcome wizard the Trades the Property Manager changed are kept, not Jev suggestions again', async () => {
    const { w, cookie } = await luckyWorld();

    const html = await (await w.post(`/welcome/tradies${listing}`, { ...posted, name: 'Lou Lucky', trades: ['carpentry'] }, cookie)).text();
    expect(tickedTrades(html)).toEqual(['carpentry']);
  });

  test('on the welcome wizard a form with no Google details still keeps its manual mode', async () => {
    const { w, cookie } = await luckyWorld();

    const refused = await w.post('/welcome/tradies?manual=1', { ...posted, businessName: 'Cash Only Keys', placeId: 'none', trades: [] }, cookie);
    expect(refused.status).toBe(400);
    const html = await refused.text();
    expect(valueOf(html, 'businessName')).toBe('Cash Only Keys');
    expect(valueOf(html, 'placeId')).toBe('none');
  });

  test.each([
    { name: 'Setup', post: '/setup/tradies?from=setup', back: '/setup' },
    { name: 'the Tradies page', post: '/setup/tradies', back: '/tradies' },
  ])('on $name it goes back to the page with the listing still chosen', async ({ post, back }) => {
    const { w, cookie } = await luckyWorld();
    const url = `${post}${post.includes('?') ? '&' : '?'}${listing.slice(1)}`;

    const refused = await w.post(url, { ...posted, name: 'Lou Lucky' }, cookie);
    expect(refused.status).toBe(303);
    const location = refused.headers.get('location')!;
    expect(location).toContain(`${back}?form=tradie&google=lucky&place=place-lucky&error=`);

    const html = await page(w, location.replace(/#.*/, ''), cookie);
    expect(visible(html)).toContain('Choose a starting rating');
    expect(valueOf(html, 'placeId')).toBe('place-lucky');
    expect(valueOf(html, 'businessName')).toBe('Lucky Locks');
    expect(results(html).map((r) => r.tag.includes('aria-current="true"'))).toEqual([true, false]);
  });

  test('a refused manual form goes back to the manual form', async () => {
    const { w, cookie } = await luckyWorld();

    const refused = await w.post('/setup/tradies?from=setup&manual=1', { ...posted, placeId: 'none', businessName: '' }, cookie);
    const location = refused.headers.get('location')!;
    expect(location).toContain('/setup?form=tradie&manual=1&error=');
    const html = await page(w, location.replace(/#.*/, ''), cookie);
    expect(valueOf(html, 'placeId')).toBe('none');
  });
});

describe('adding the Tradie from the filled-in form', () => {
  test('posts the listing, so the Tradie is added linked to it with their Google rating', async () => {
    const { w, cookie } = await luckyWorld();

    const html = await page(w, '/welcome/tradies?google=lucky&place=place-lucky', cookie);
    const added = await w.post(
      '/welcome/tradies?google=lucky&place=place-lucky',
      { businessName: valueOf(html, 'businessName')!, name: 'Lou Lucky', mobile: valueOf(html, 'mobile')!, email: '', trades: tickedTrades(html) as string[], startingRating: 4, placeId: valueOf(html, 'placeId')! },
      cookie,
    );
    expect(added.status).toBe(303);

    const shown = await page(w, added.headers.get('location')!, cookie);
    expect(visible(shown)).toContain('Lucky Locks added as a Tradie');
    expect(visible(shown)).toContain('4.6 (22) from 22 reviews');
  });

  test('looking at a listing adds nothing', async () => {
    const { w, cookie } = await luckyWorld();
    const before = (await w.alice.tradieDirectory()).length;

    await page(w, '/tradies?google=lucky&place=place-lucky', cookie);
    expect((await w.alice.tradieDirectory()).length).toBe(before);
  });
});
