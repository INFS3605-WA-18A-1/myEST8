import { describe, expect, test } from 'vitest';
import type { DemoControls, DemoInboundMessage, DemoOutboundMessage } from '../../src/demo/controls.ts';
import { ActionError } from '../../src/shared.ts';
import { formatWhen } from '../../src/web/ui.ts';
import { webWorld } from '../support/web.ts';
import { AGENCY_INBOX, AGENCY_NUMBER } from '../support/harness.ts';
import { BARRY, OLIVIA, OLIVIA_EMAIL, PETE, TOM } from '../support/world.ts';

const TOM_ID = 901;
const PETE_ID = 902;
const OLIVIA_ID = 903;
const BARRY_ID = 904;

/**
 * A demo with four people outside Harbour Realty and a few messages, recording
 * what the simulator asks of it. Only Property Managers added to `harbour` see
 * them; WhatsApp is refused as not connected when `noWhatsApp` is set.
 */
function fakeDemo(o: { noWhatsApp?: boolean } = {}) {
  const harbour = new Set<number>();
  const ours = <T>(propertyManagerId: number, items: T[]) => (harbour.has(propertyManagerId) ? items : []);
  const sent: { as: number; from: string; channel: string; text: string; attachments: { filename: string; contentType: string; content: Uint8Array }[] | undefined }[] = [];
  const advanced: number[] = [];
  let now = new Date('2026-10-08T09:00:00+11:00');
  const outbox: DemoOutboundMessage[] = [
    {
      at: '2026-10-07T22:00:01.000Z',
      from: AGENCY_NUMBER,
      to: TOM,
      cc: [],
      channel: 'sms',
      template: 'tenant.acknowledgement',
      subject: '',
      text: "Thanks Tom, we've got your message <script>alert('hi')</script>",
      attachments: [],
    },
    {
      at: '2026-10-07T22:05:00.000Z',
      from: AGENCY_NUMBER,
      to: TOM,
      cc: [],
      channel: 'sms',
      template: 'tenant.upload_link',
      subject: '',
      text: 'Please upload photos here: https://myest8.test/u/abc123. Thanks!',
      attachments: [],
    },
    {
      at: '2026-10-07T23:00:00.000Z',
      from: AGENCY_INBOX,
      to: OLIVIA_EMAIL,
      cc: [],
      channel: 'email',
      template: 'owner.approval_request',
      subject: 'Approve a repair at 12 King St',
      text: 'Reply YES or NO',
      attachments: ['quote.pdf'],
    },
  ];
  const inbound: DemoInboundMessage[] = [
    { at: '2026-10-07T22:00:01.000Z', from: TOM, to: AGENCY_NUMBER, channel: 'sms', text: 'The kitchen tap is dripping', attachments: [] },
  ];
  const demo: DemoControls = {
    contacts: (id) =>
      ours(id, [
        { personId: TOM_ID, name: 'Tom Tran', role: 'tenant', mobile: TOM, email: null },
        { personId: PETE_ID, name: 'Pete Park', role: 'tradie', mobile: PETE, email: null },
        { personId: OLIVIA_ID, name: 'Olivia Owens', role: 'owner', mobile: OLIVIA, email: OLIVIA_EMAIL },
        { personId: BARRY_ID, name: 'Barry Strata', role: 'building_manager', mobile: null, email: BARRY },
      ]),
    outbox: (id) => ours(id, outbox),
    inbound: (id) => ours(id, inbound),
    async sendAs(id, from, channel, text, attachments) {
      if (o.noWhatsApp && channel === 'whatsapp') throw new ActionError('invalid', 'Connect WhatsApp in Setup first');
      sent.push({ as: id, from, channel, text, attachments });
    },
    async advance(hours) {
      advanced.push(hours);
      now = new Date(now.getTime() + hours * 3_600_000);
    },
    now: () => now,
  };
  return { demo, sent, advanced, harbour };
}

async function simulator(o: { noWhatsApp?: boolean } = {}) {
  const fake = fakeDemo(o);
  const w = await webWorld({ demo: fake.demo });
  fake.harbour.add(w.ids.aliceId).add(w.ids.bobId);
  const cookie = await w.signIn();
  return { ...w, ...fake, cookie };
}

describe('the phone simulator', () => {
  test('is only for signed-in Property Managers', async () => {
    const w = await webWorld({ demo: fakeDemo().demo });

    const res = await w.get('/demo');

    expect([302, 303]).toContain(res.status);
    expect(res.headers.get('location')).toContain('/login');
  });

  test('lists everyone outside the Agency by role, with the demo clock and what myEST8 sent', async () => {
    const { get, cookie } = await simulator();

    const res = await get('/demo', cookie);

    expect(res.status).toBe(200);
    const page = await res.text();
    for (const text of ['Tenants', 'Tradies', 'Property Owners', 'Building Managers', 'Tom Tran', 'Pete Park', 'Olivia Owens', 'Barry Strata']) {
      expect(page).toContain(text);
    }
    expect(page).toContain(`href="/demo?contact=${TOM_ID}"`);
    expect(page).toContain('Demo clock');
    expect(page).toContain('+24 hours');
    expect(page).toContain('What myEST8 sent');
    expect(page).toContain('Tenant · Upload link');
    expect(page).toContain('Owner · Approval request: Approve a repair at 12 King St');
  });

  test("a contact's thread shows both sides, escapes the text, and makes the upload link clickable", async () => {
    const { get, cookie } = await simulator();

    const page = await (await get(`/demo?contact=${TOM_ID}`, cookie)).text();

    expect(page).toContain('Tom Tran&#39;s phone');
    expect(page.indexOf('The kitchen tap is dripping')).toBeLessThan(page.indexOf('we&#39;ve got your message'));
    expect(page).toContain('&lt;script&gt;alert(&#39;hi&#39;)&lt;/script&gt;');
    expect(page).not.toContain("<script>alert('hi')</script>");
    expect(page).toMatch(/<a [^>]*href="https:\/\/myest8\.test\/u\/abc123"[^>]*>https:\/\/myest8\.test\/u\/abc123<\/a>\. Thanks!/);
    expect(page).toContain('<option value="sms" selected>');
    expect(page).toContain('<option value="whatsapp"');
    expect(page).not.toContain('<option value="email"');
    expect(page).toContain('The kitchen tap is dripping');
    expect(page).toContain('name="quick" value="Any time"');
  });

  test("an email thread shows the subject and the attachments", async () => {
    const { get, cookie } = await simulator();

    const page = await (await get(`/demo?contact=${OLIVIA_ID}`, cookie)).text();

    expect(page).toContain('Approve a repair at 12 King St');
    expect(page).toContain('Attached: quote.pdf');
    expect(page).toContain('<option value="email" selected>');
    expect(page).toContain('name="quick" value="YES"');
  });

  test('replying as a contact sends in from their address on the chosen channel', async () => {
    const { post, cookie, sent, ids } = await simulator();

    const res = await post('/demo/send', { contact: TOM_ID, channel: 'whatsapp', text: '  Yes  ' }, cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(new RegExp(`^/demo\\?contact=${TOM_ID}&ok=`));
    expect(sent).toEqual([{ as: ids.aliceId, from: TOM, channel: 'whatsapp', text: 'Yes', attachments: [] }]);
  });

  test('a quick reply sends its text, and a file goes as an attachment', async () => {
    const { web, post, cookie, sent, ids } = await simulator();

    await post('/demo/send', { contact: PETE_ID, channel: 'sms', quick: '$180, Tue 9am', text: '' }, cookie);
    const form = new FormData();
    form.set('contact', String(PETE_ID));
    form.set('channel', 'sms');
    form.set('text', 'Here is my quote');
    form.append('attachments', new File([new Uint8Array([1, 2, 3])], 'quote.pdf', { type: 'application/pdf' }));
    const res = await web.request('/demo/send', { method: 'POST', body: form, headers: { cookie } });

    expect(res.status).toBe(303);
    expect(sent).toEqual([
      { as: ids.aliceId, from: PETE, channel: 'sms', text: '$180, Tue 9am', attachments: [] },
      { as: ids.aliceId, from: PETE, channel: 'sms', text: 'Here is my quote', attachments: [{ filename: 'quote.pdf', contentType: 'application/pdf', content: new Uint8Array([1, 2, 3]) }] },
    ]);
  });

  test("a channel the contact doesn't have, or an empty message, is refused", async () => {
    const { post, cookie, sent } = await simulator();

    const noEmail = await post('/demo/send', { contact: TOM_ID, channel: 'email', text: 'Hello' }, cookie);
    const empty = await post('/demo/send', { contact: TOM_ID, channel: 'sms', text: ' ' }, cookie);

    expect(decodeURIComponent(noEmail.headers.get('location')!)).toContain("Tom Tran can't send by Email");
    expect(decodeURIComponent(empty.headers.get('location')!)).toContain('Type a message or attach a file');
    expect(sent).toEqual([]);
  });

  test("a channel the Agency hasn't connected is refused with how to fix it", async () => {
    const { post, get, cookie, sent } = await simulator({ noWhatsApp: true });

    const res = await post('/demo/send', { contact: TOM_ID, channel: 'whatsapp', text: 'Hello' }, cookie);

    expect(decodeURIComponent(res.headers.get('location')!)).toContain('Connect WhatsApp in Setup first');
    expect(await (await get(res.headers.get('location')!, cookie)).text()).toContain('Connect WhatsApp in Setup first');
    expect(sent).toEqual([]);
  });

  test("shows only the signed-in Property Manager's Agency, and says which channels it still has to connect", async () => {
    const { web, get } = await simulator();
    const signUp = await web.request('/signup', {
      method: 'POST',
      body: new URLSearchParams({ name: 'Sam Sun', email: 'sam@sunrise.example', password: 'sunrise-2026', confirmPassword: 'sunrise-2026', agencyName: 'Sunrise Realty', timeZone: 'Australia/Sydney' }),
    });
    const sam = signUp.headers.get('set-cookie')!.split(';')[0]!;

    const page = await (await get('/demo', sam)).text();

    for (const name of ['Tom Tran', 'Pete Park', 'Olivia Owens', 'Approve a repair at 12 King St']) expect(page).not.toContain(name);
    expect(page).toContain('SMS, WhatsApp and Email not connected yet');
    expect(page).toContain('href="/welcome/channels"');
    expect(page).toContain('No people to act as yet');
  });

  test('Harbour Realty, with every channel connected, gets no notice about channels', async () => {
    const { get, cookie } = await simulator();
    expect(await (await get('/demo', cookie)).text()).not.toContain('not connected yet');
  });

  test('moving the clock runs the demo forward and says where it is now', async () => {
    const { post, get, cookie, advanced } = await simulator();

    const res = await post('/demo/advance', { hours: 24, contact: TOM_ID }, cookie);

    expect(res.status).toBe(303);
    expect(advanced).toEqual([24]);
    const location = res.headers.get('location')!;
    expect(location).toMatch(new RegExp(`^/demo\\?contact=${TOM_ID}&ok=`));
    expect(decodeURIComponent(location)).toContain(`Clock moved to ${formatWhen('2026-10-09T09:00:00+11:00')}`);
    expect(await (await get(location, cookie)).text()).toContain('reminders and timeouts ran');
  });
});
