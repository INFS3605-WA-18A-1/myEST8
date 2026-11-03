import { describe, expect, test } from 'vitest';
import { serverWhatsappNumber } from '../../src/demo/runtime.ts';
import { buttonsOn, visible, webWorld } from '../support/web.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

/** Meta's test-style number, spoken on the page as "+1 555 123 4567". */
const NUMBER = '+15551234567';
const SPOKEN = '+1 555 123 4567';
const HINT = 'Tenants message first; replies are free for 24 hours, then myEST8 uses SMS or email.';
const LATER = ['messenger', 'telegram', 'wechat', 'line'] as const;

async function page(w: Web, path: string, cookie: string) {
  const res = await w.get(path, cookie);
  expect(res.status, path).toBe(200);
  return res.text();
}

/** A server whose WhatsApp number is this one. The pages read it from connectors, not the environment. */
function withServerNumber() {
  return webWorld({ connectors: { gmail: null, unavailable: [], smsInbound: 'simulator', smsPhone: null, whatsappNumber: NUMBER } });
}

/** The WhatsApp panel, from its marker up to the next channel. SMS on the same page has its own code form. */
function whatsappPanel(html: string) {
  const start = html.search(/data-server-whatsapp=/);
  const rest = html.slice(start);
  const end = rest.search(/id="(?:email|later-channels)"/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The unconnected offer: the number, Connect WhatsApp, and no code form. */
function expectConnectOffer(html: string) {
  const panel = whatsappPanel(html);
  const text = visible(panel);
  expect(text).toContain(`Tenants message ${SPOKEN} on WhatsApp. This is the server's WhatsApp number.`);
  expect(text).toContain('Connect WhatsApp');
  expect(text).toContain(HINT);
  expect(panel).not.toContain('id="whatsapp-address"');
  expect(text).not.toContain('Send code');
  const connect = buttonsOn(panel).find((button) => button.label === 'Connect WhatsApp');
  expect(connect).toEqual({ label: 'Connect WhatsApp', disabled: false });
}

/** Messenger, Telegram, WeChat and LINE: disabled buttons, "Coming later", and no link. */
function expectLaterChannels(html: string) {
  const list = html.match(/<ul class="channel-later-list"[\s\S]*?<\/ul>/)?.[0] ?? '';
  expect(list, 'later channel list').not.toBe('');
  expect(list).not.toContain('<a');
  const buttons = buttonsOn(list);
  expect(buttons.map((button) => button.label)).toEqual([
    'Connect Messenger Coming later',
    'Connect Telegram Coming later',
    'Connect WeChat Coming later',
    'Connect LINE Coming later',
  ]);
  expect(buttons.every((button) => button.disabled)).toBe(true);
  for (const key of LATER) expect(list).toContain(`data-channel-later="${key}"`);
}

describe("the server's WhatsApp number", () => {
  test('is offered on the wizard, Setup and Settings, with the later channels disabled', async () => {
    const w = await withServerNumber();
    const sam = await w.signUp();
    for (const path of ['/welcome/channels', '/setup', '/settings?tab=channels']) {
      const html = await page(w, path, sam);
      expectConnectOffer(html);
      expectLaterChannels(html);
    }
  });

  test('Connect WhatsApp stores the number without texting it, and shows Disconnect', async () => {
    const w = await withServerNumber();
    const sam = await w.signUp();

    const res = await w.post('/server-whatsapp/connect', { from: 'welcome' }, sam);
    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(location).not.toContain('error=');
    expect(decodeURIComponent(location)).toContain(`${SPOKEN} is now the Agency's WhatsApp number.`);

    const text = visible(await page(w, location.split('#')[0]!, sam));
    expect(text).toContain(SPOKEN);
    expect(text).toContain('Disconnect');
    expect(text).toContain(HINT);
    expect(text).not.toContain('Connect WhatsApp');
    // The old button sent a verification code to the platform number. Connect must not.
    expect(w.h.messenger.last(NUMBER)).toBeUndefined();
  });

  test('Settings shows the connected number with Disconnect, and no test message', async () => {
    const w = await withServerNumber();
    const sam = await w.signUp();

    const res = await w.post('/server-whatsapp/connect', { from: 'settings' }, sam);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/settings?tab=channels');

    const text = visible(await page(w, res.headers.get('location')!.split('#')[0]!, sam));
    expect(text).toContain(SPOKEN);
    expect(text).toContain('Disconnect');
    expect(text).toContain('Not needed');
    expect(text).not.toContain('Connect WhatsApp');
    expect(text).not.toContain('Not tested');
  });

  test('Disconnect removes the number and returns to the page that asked', async () => {
    const w = await withServerNumber();
    const sam = await w.signUp();
    const connected = await w.post('/server-whatsapp/connect', { from: 'setup' }, sam);
    expect(connected.status).toBe(303);
    expect(connected.headers.get('location')).toContain('/setup?form=channels');

    const res = await w.post('/server-whatsapp/disconnect', { from: 'setup' }, sam);
    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(location).not.toContain('error=');
    expect(location).toContain('/setup?form=channels');
    expectConnectOffer(await page(w, location.split('#')[0]!, sam));
  });

  test("Connect WhatsApp is refused when another Agency already holds the number", async () => {
    const w = await withServerNumber();
    const first = await w.signUp();
    expect((await w.post('/server-whatsapp/connect', { from: 'welcome' }, first)).status).toBe(303);

    const second = await w.signUp({ email: 'river@second.example', agencyName: 'Second Realty' });
    const res = await w.post('/server-whatsapp/connect', { from: 'welcome' }, second);
    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(decodeURIComponent(location)).toContain("This server's WhatsApp number is connected to another Agency.");
    const text = visible(await page(w, location.split('#')[0]!, second));
    expect(text).toContain("This server's WhatsApp number is connected to another Agency.");
    expect(text).toContain('Connect WhatsApp');
  });
});

describe('WhatsApp when this server has no number', () => {
  test('stays on the wizard, Setup and Settings, disabled, with the reason and the later channels', async () => {
    const w = await webWorld();
    const sam = await w.signUp();
    for (const path of ['/welcome/channels', '/setup', '/settings?tab=channels']) {
      const html = await page(w, path, sam);
      const text = visible(html);
      expect(html, path).toContain('id="whatsapp"');
      expect(text, path).toContain("WhatsApp isn't set up on this server yet, so it can't be connected.");
      expect(text, path).toContain(HINT);
      expect(buttonsOn(html).find((button) => button.label === 'Connect WhatsApp')).toEqual({ label: 'Connect WhatsApp', disabled: true });
      expectLaterChannels(html);
    }
    expect((await w.post('/server-whatsapp/connect', { from: 'welcome' }, sam)).status).toBe(404);
  });
});

describe('when the server offers its WhatsApp number', () => {
  test('needs the number and the sending pair, and the webhook pair when hosted', () => {
    expect(serverWhatsappNumber({}, false)).toBeNull();
    expect(serverWhatsappNumber({ META_WHATSAPP_NUMBER: NUMBER, META_WHATSAPP_PHONE_NUMBER_ID: 'id' }, false)).toBeNull();
    const sending = { META_WHATSAPP_NUMBER: '+1 555 123 4567', META_WHATSAPP_PHONE_NUMBER_ID: 'id', META_WHATSAPP_ACCESS_TOKEN: 'token' };
    expect(serverWhatsappNumber(sending, false)).toBe(NUMBER);
    expect(serverWhatsappNumber(sending, true)).toBeNull();
    expect(serverWhatsappNumber({ ...sending, META_APP_SECRET: 'sec', META_WEBHOOK_VERIFY_TOKEN: 'verify' }, true)).toBe(NUMBER);
  });
});
