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

/** The workflow's ordered list, from its <ol> to the end of its section. */
function workflowList(page: string): string {
  const list = page.match(/<ol[^>]*aria-labelledby="workflow"[^>]*>[\s\S]*?<\/ol>\s*<\/section>/);
  if (!list) throw new Error('No workflow list on the page');
  return list[0];
}

/** The workflow's stages (the list's own items), each as its visible text, in page order. */
function workflowStages(page: string): string[] {
  return workflowList(page)
    .split(/<li class="flow-stage/)
    .slice(1)
    .map((item) => visible(`<li ${item}`).trim());
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
    expect(visible(h1[0]!).trim()).toBe('Tenants text the problem. You decide. myEST8 does the chasing.');
    expect(text).toContain('small Agencies');
    expect(page).toMatch(/<a href="\/signup"[^>]*>Create your Agency’s account<\/a>/);
    expect(page).toMatch(/<a href="\/login"[^>]*>Sign in<\/a>/);
    expect(text).not.toContain('demo1234');
  });

  test('the hero shows a Tenant’s text becoming a Maintenance Request, then a Ticket, with nothing in it to tab to', async () => {
    const w = await webWorld();

    const page = await (await w.get('/')).text();

    const hero = page.match(/<section class="lp-hero"[\s\S]*?<\/section>/)?.[0] ?? '';
    const scene = hero.match(/<figure[\s\S]*?<\/figure>/)?.[0] ?? '';
    const text = visible(scene).replace(/\s+/g, ' ');
    const order = ['tap under the kitchen sink', 'Maintenance Request', 'Waiting for you', 'Confirmed', '#12'].map((words) => text.indexOf(words));
    expect(order.every((at) => at >= 0), text).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(scene).not.toMatch(/<(a|button|input|select|textarea)[\s>]/);
  });

  test('plays one repair through myEST8, stage by stage, as an ordered list', async () => {
    const w = await webWorld();

    const page = await (await w.get('/')).text();

    const stages = workflowStages(page);
    expect(stages).toHaveLength(8);
    const expected = [
      ['A Tenant texts the problem', 'The kitchen tap is dripping'],
      ['It becomes a Maintenance Request', 'Routine', 'Plumbing'],
      ['The Property Manager confirms', 'Confirm'],
      ['It becomes a Ticket', '#12'],
      ['Quote Requests go to Tradies', '3 Tradies'],
      ['A Quote comes back', '$180'],
      ['The Work Order goes out', 'Work Order sent'],
      ['The Job is done, and the Tenant sees it', 'Done'],
    ];
    expected.forEach((words, i) => {
      for (const word of words) expect(stages[i]).toContain(word);
    });
  });

  test('the workflow is a picture to read, with nothing in it to tab to, and a control to pause it', async () => {
    const w = await webWorld();

    const page = await (await w.get('/')).text();

    expect(workflowList(page)).not.toMatch(/<(a|button|input|select|textarea)[\s>]/);
    const pause = page.match(/<button type="button"[^>]*data-flow-pause[^>]*>[\s\S]*?<\/button>/);
    expect(visible(pause?.[0] ?? '')).toContain('Pause the animation');
  });

  test('the workflow stands still for anyone who asks for less motion', async () => {
    const w = await webWorld();

    const landing = await (await w.get('/assets/landing.css')).text();

    expect(landing).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.flow[\s\S]*animation: none/);
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
    expect(page).not.toContain('aria-labelledby="workflow"');
  });
});
