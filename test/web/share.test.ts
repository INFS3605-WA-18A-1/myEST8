import { describe, expect, test } from 'vitest';
import { shareButton } from '../../src/web/share.ts';
import { webWorld } from '../support/web.ts';
import { TOM, tomsTapTicket } from '../support/world.ts';

const render = async (markup: unknown) => String(await markup);
const HOSTILE = '<script>alert("x")</script>';

/** An attribute value as the browser reads it. */
const decode = (value: string) =>
  value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The share controls on a page: the link in its copy field and each channel's href. */
function shareControls(page: string) {
  const block = /<details[^>]*data-share[\s\S]*?<\/details>/.exec(page)?.[0];
  if (!block) throw new Error('No share control on the page');
  const href = (channel: string) => {
    const m = new RegExp(`<a[^>]*data-share-channel="${channel}"[^>]*>`).exec(block)?.[0];
    return m ? decode(/href="([^"]*)"/.exec(m)![1]!) : null;
  };
  const input = /<input[^>]*data-share-url[^>]*>/.exec(block)?.[0];
  return {
    block,
    url: input ? decode(/value="([^"]*)"/.exec(input)![1]!) : null,
    email: href('email'),
    sms: href('sms'),
  };
}

describe('shareButton', () => {
  const o = { title: 'Jobs booked this week', text: 'Here are the Jobs booked this week & next.', url: 'https://myest8.test/dispatch?week=2026-10-12' };

  test('a Share button opens a panel with Copy link, Email and SMS, each carrying the link', async () => {
    const page = await render(shareButton(o));
    const share = shareControls(page);

    expect(page).toMatch(/<summary[^>]*>[\s\S]*<svg[\s\S]*Share[\s\S]*<\/summary>/);
    expect(share.url).toBe(o.url);
    expect(page).toMatch(/<button[^>]*type="button"[^>]*data-share-copy[^>]*>[\s\S]*Copy link/);
    expect(page).toMatch(/aria-live="polite"/);

    const message = `${o.text} ${o.url}`;
    expect(share.email).toBe(`mailto:?subject=${encodeURIComponent(o.title)}&body=${encodeURIComponent(`${o.text}\n\n${o.url}`)}`);
    expect(share.sms).toBe(`sms:?&body=${encodeURIComponent(message)}`);
    expect(page).not.toMatch(/whatsapp|wa\.me/i);
  });

  test('works without JavaScript: a disclosure with plain links and a read-only link to copy by hand', async () => {
    const page = await render(shareButton(o));

    expect(page).toMatch(/^<details[^>]*data-share/);
    expect(page).toMatch(/<input[^>]*readonly[^>]*data-share-url|<input[^>]*data-share-url[^>]*readonly/);
    expect(page).toMatch(/<label[^>]*for="([^"]+)"[\s\S]*<input[^>]*id="\1"/);
    // Copy and the phone's share sheet need JavaScript, so they start hidden.
    expect(page).toMatch(/<button[^>]*data-share-copy[^>]*hidden/);
    expect(page).toMatch(/data-share-native[^>]*hidden/);
  });

  test('escapes a hostile title, text and link', async () => {
    const page = await render(shareButton({ title: HOSTILE, text: HOSTILE, url: `https://myest8.test/"><script>x</script>` }));

    expect(page).not.toContain('<script>');
    expect(page).not.toContain('"><script');
    const share = shareControls(page);
    expect(share.url).toBe(`https://myest8.test/"><script>x</script>`);
    expect(share.sms).toBe(`sms:?&body=${encodeURIComponent(`${HOSTILE} https://myest8.test/"><script>x</script>`)}`);
  });

  test('takes a label and a choice of channels', async () => {
    const page = await render(shareButton({ ...o, label: 'Send to a colleague', channels: ['copy', 'email'] }));

    expect(page).toContain('Send to a colleague');
    const share = shareControls(page);
    expect(share.email).not.toBeNull();
    expect(share.sms).toBeNull();
  });

  test('gives each control its own ids, so two on a page never clash', async () => {
    const page = (await render(shareButton(o))) + (await render(shareButton(o)));
    const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('where people share', () => {
  test('the sign-up page shares its own link, to send to the colleague who should set the Agency up', async () => {
    const w = await webWorld();
    const page = await (await w.get('/signup')).text();

    const share = shareControls(page);
    expect(share.url).toBe('http://localhost/signup');
    expect(share.email).toContain(encodeURIComponent('http://localhost/signup'));
  });

  test('the calendar shares the week being looked at, using the address the request came to', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.web.request('https://desk.harbour.example/calendar?week=2026-10-19&ok=Done', { headers: { cookie } })).text();

    const share = shareControls(page);
    expect(share.url).toBe('https://desk.harbour.example/calendar?view=week&date=2026-10-19');
    expect(share.email).toContain(encodeURIComponent('Jobs booked, 19 – 25 October 2026'));
    expect(share.block).toContain('Only Property Managers in your Agency can open this link');

    // "This week" is shared as its dates, so the link still shows the same week next month.
    const thisWeek = shareControls(await (await w.get('/calendar', cookie)).text());
    expect(thisWeek.url).toMatch(/^http:\/\/localhost\/calendar\?view=week&date=\d{4}-\d{2}-\d{2}$/);
  });

  test('a Maintenance Request and the dashboard list of them can be shared', async () => {
    const w = await webWorld();
    w.h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await w.h.receive(TOM, 'The kitchen tap is dripping');
    for (const [answer, value] of [['Kitchen sink'], ['Since Monday'], ['No', 'no'], ['Mornings', 'weekday_mornings']] as const) await w.h.answer(TOM, answer, value);
    await w.h.advance(48 * 3_600_000); // no photos, so it waits for review
    const [request] = (await w.alice.dashboard()).maintenanceRequests;
    const cookie = await w.signIn();

    const review = shareControls(await (await w.get(`/requests/${request!.issueId}`, cookie)).text());
    expect(review.url).toBe(`http://localhost/requests/${request!.issueId}`);
    expect(review.sms).toContain(encodeURIComponent('The kitchen tap is dripping'));

    const dashboard = shareControls(await (await w.get('/', cookie)).text());
    expect(dashboard.url).toBe('http://localhost/?filter=all#requests');
    expect(dashboard.email).toContain(encodeURIComponent('1 Maintenance Request is waiting for review'));
  });

  test('a Ticket page shares that Ticket', async () => {
    const w = await webWorld();
    const { ticketId } = await tomsTapTicket(w);
    const cookie = await w.signIn();

    const share = shareControls(await (await w.get(`/tickets/${ticketId}`, cookie)).text());

    expect(share.url).toBe(`http://localhost/tickets/${ticketId}`);
    expect(share.email).toContain(encodeURIComponent(`Ticket #${ticketId}`));
    expect(share.email).toContain(encodeURIComponent('The kitchen tap is dripping'));
  });

  test("a Tenant shares their tracker link, say with a flatmate", async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const path = new URL(w.h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string).pathname;

    const page = await (await w.get(path)).text();

    const share = shareControls(page);
    expect(share.url).toBe(`http://localhost${path}`);
    expect(share.sms).toContain(encodeURIComponent('The kitchen tap is dripping'));
    expect(page).toContain('Anyone with this link can see');
  });
});
