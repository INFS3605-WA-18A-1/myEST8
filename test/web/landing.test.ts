import { describe, expect, test } from 'vitest';
import type { DemoControls } from '../../src/demo/controls.ts';
import { visible, webWorld } from '../support/web.ts';

const noDemo = (): DemoControls => ({
  contacts: async () => [],
  outbox: async () => [],
  inbound: async () => [],
  sendAs: async () => {},
  advance: async () => {},
  now: () => new Date(),
});

/** The section with this id, from its opening tag to its closing tag. */
function section(page: string, id: string): string {
  const found = page.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`));
  if (!found) throw new Error(`No section #${id} on the page`);
  return found[0];
}

/** The repair's stages (the inner list items of the #repair section), each as its visible text, in page order. */
function repairStages(page: string): string[] {
  return [...section(page, 'repair').matchAll(/<ol class="lp-stages">([\s\S]*?)<\/ol>/g)]
    .flatMap((list) => list[1]!.split(/<li>/).slice(1))
    .map((item) => visible(`<li>${item}`).replace(/\s+/g, ' ').trim());
}

describe('the landing page', () => {
  test('says what myEST8 does for a small Agency, with the ways in', async () => {
    const w = await webWorld();

    const res = await w.get('/');

    expect(res.status).toBe(200);
    const page = await res.text();
    const text = visible(page);
    const h1 = page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/g) ?? [];
    expect(h1).toHaveLength(1);
    expect(visible(h1[0]!).replace(/\s+/g, ' ').trim()).toBe('Tenants text. You decide.');
    expect(text).toContain('small Agencies');
    expect(page).toMatch(/<a href="\/signup"[^>]*>Create your Agency’s account<\/a>/);
    expect(page).toMatch(/<a href="\/login"[^>]*>Sign in<\/a>/);
    expect(text).not.toContain('demo1234');
  });

  test('the example shows what a Tenant texts, myEST8’s real replies, and what the Property Manager gets', async () => {
    const w = await webWorld();

    const page = await (await w.get('/')).text();

    const example = section(page, 'example');
    const text = visible(example).replace(/\s+/g, ' ');
    // The follow-up questions and the upload link are the words src/templates.ts sends.
    expect(text).toContain('To get this sorted we just need:');
    expect(text).toContain('When did it start?');
    expect(text).toContain('Is it getting worse? (yes or no)');
    expect(text).toContain('Please upload a few photos of the issue here, straight from your phone');
    expect(text).toContain('This sounds urgent.');
    // A leak is High, by the Urgency the classifier is given; no hot water is an Urgent Repair.
    const order = ['tap under the kitchen sink', 'Maintenance Request', 'Waiting for you', 'High'].map((words) => text.indexOf(words));
    expect(order.every((at) => at >= 0), text).toBe(true);
    expect(text).toContain('Urgent Repair');
    // The three messages are radio buttons; the Maintenance Requests are pictures, with nothing in them to tab to.
    expect(example.match(/<input type="radio" name="lp-example"/g)).toHaveLength(3);
    for (const fragment of example.match(/<div class="lp-request[\s\S]*?<\/div>\s*<\/div>/g) ?? []) {
      expect(fragment).not.toMatch(/<(a|button|input|select|textarea)[\s>]/);
    }
  });

  test('plays one repair through myEST8, stage by stage, as an ordered list', async () => {
    const w = await webWorld();

    const page = await (await w.get('/')).text();

    const stages = repairStages(page);
    expect(stages).toHaveLength(9);
    const expected = [
      ['Mon 7:42 am', 'kitchen tap is dripping'],
      ['Mon 7:43 am', 'upload link'],
      ['Mon 7:46 am', 'summary, Trade and Urgency'],
      ['Mon 9:10 am', 'You confirm', 'Ticket #12'],
      ['Mon 9:11 am', 'Quote Requests', '48 hours'],
      ['Mon 3:20 pm', '$180', '$240', '$500 Max Repair Cost'],
      ['Mon 3:24 pm', 'You choose', 'Work Order'],
      ['Wed 8:00 am', 'plumber arrives'],
      ['Wed 9:35 am', 'Done'],
    ];
    expected.forEach((words, i) => {
      for (const word of words) expect(stages[i]).toContain(word);
    });
    // The bar over the list is a picture: screen readers read the list instead.
    expect(section(page, 'repair')).toMatch(/<div class="lp-bar-chart"[^>]*aria-hidden="true"/);
    expect(section(page, 'repair')).not.toMatch(/<(a|button|input|select|textarea)[\s>]/);
  });

  test('says how each person who never signs in takes part, as the app really reaches them', async () => {
    const w = await webWorld();

    const text = visible(await (await w.get('/')).text()).replace(/\s+/g, ' ');

    expect(text).toContain('Nobody else needs an account');
    expect(text).toContain('Approve a Quote over the Max Repair Cost by replying YES or NO.');
    expect(text).not.toContain('with a reply or a link');
  });

  test('nothing on the page loops, and its entrances stand still for anyone who asks for less motion', async () => {
    const w = await webWorld();

    const page = await (await w.get('/')).text();
    const landing = await (await w.get('/assets/landing.css')).text();

    expect(page).not.toContain('data-flow-pause');
    expect(landing).not.toMatch(/animation:[^;]*infinite/);
    expect(landing).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.lp-line > span[\s\S]*animation: none/);
  });

  test('every photograph is served, and credited in the footer with its licence', async () => {
    const w = await webWorld();

    const page = await (await w.get('/')).text();

    const photos = [...new Set([...page.matchAll(/src="\/assets\/(landing-[a-z-]+\.jpg)"/g)].map((m) => m[1]!))];
    expect(photos.length).toBeGreaterThanOrEqual(6);
    for (const name of photos) {
      const res = await w.get(`/assets/${name}`);
      expect(res.status, name).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
    }
    const footer = visible(page.match(/<footer class="lp-footer">[\s\S]*?<\/footer>/)?.[0] ?? '');
    expect(footer).toContain('From Wikimedia Commons');
    expect(footer.match(/CC BY|CC0/g)?.length).toBeGreaterThanOrEqual(photos.length);
  });

  test('when the app runs as the demo, it gives the demo sign-ins', async () => {
    const w = await webWorld({ demo: noDemo() });

    const text = visible(await (await w.get('/')).text());

    expect(text).toContain('Try the demo Agency');
    expect(text).toContain('alice@harbour.example');
    expect(text).toContain('bob@harbour.example');
    expect(text).toContain('demo1234');
  });

  test('a signed-in Property Manager gets their dashboard at / instead', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const res = await w.get('/', cookie);

    expect(res.status).toBe(200);
    const page = await res.text();
    expect(visible(page)).toContain('Dashboard');
    expect(page).not.toContain('id="repair"');
  });
});
