import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

/** The server's textbee phone, as TEXTBEE_NUMBER is set: E.164, spoken on the page as "+61 412 345 678". */
const PHONE = '+61412345678';

async function page(w: Web, path: string, cookie: string) {
  const res = await w.get(path, cookie);
  expect(res.status, path).toBe(200);
  return res.text();
}

/** A server whose SMS phone is this one number. The pages read it from connectors, not the environment. */
function withServerPhone() {
  return webWorld({ connectors: { gmail: null, unavailable: [], smsInbound: 'none', smsPhone: PHONE } });
}

/** The unconnected offer: the phone's number, Connect SMS, and neither the code form nor the Twilio panel. */
function expectConnectOffer(html: string) {
  const text = visible(html);
  expect(text).toContain("Tenants text +61 412 345 678. This is the server's SMS phone.");
  expect(text).toContain('Connect SMS');
  expect(html).not.toContain('id="sms-address"');
  expect(text).not.toContain('Send code');
  expect(text).not.toContain('Create a new number');
  expect(text).not.toContain('Register a Twilio number');
}

describe("the server's SMS phone", () => {
  test("the wizard says to connect the Agency's SMS number while it is not connected", async () => {
    const w = await withServerPhone();
    const sam = await w.signUp();
    const text = visible(await page(w, '/welcome/channels', sam));
    expect(text).toContain("Still to do: connect the Agency's SMS number, and send one email to the Agency inbox so it's forwarded here.");
  });

  test('the welcome Channels step offers Connect SMS, not a code or a Twilio number', async () => {
    const w = await withServerPhone();
    const sam = await w.signUp();
    expectConnectOffer(await page(w, '/welcome/channels', sam));
  });

  test('Setup offers Connect SMS, not a code or a Twilio number', async () => {
    const w = await withServerPhone();
    const sam = await w.signUp();
    expectConnectOffer(await page(w, '/setup', sam));
  });

  test('Settings offers Connect SMS, not a code or a Twilio number', async () => {
    const w = await withServerPhone();
    const sam = await w.signUp();
    expectConnectOffer(await page(w, '/settings?tab=channels', sam));
  });

  test('Connect SMS connects the phone and shows it with Disconnect', async () => {
    const w = await withServerPhone();
    const sam = await w.signUp();

    const res = await w.post('/server-sms/connect', { from: 'welcome' }, sam);
    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(location).not.toContain('error=');

    const text = visible(await page(w, location.split('#')[0]!, sam));
    expect(text).toContain('+61 412 345 678');
    expect(text).toContain('Disconnect');
    expect(text).not.toContain('Connect SMS');
    expect(text).not.toContain("connect the Agency's SMS number");
  });

  test('Settings shows the connected phone with Disconnect, and no test message', async () => {
    const w = await withServerPhone();
    const sam = await w.signUp();

    const res = await w.post('/server-sms/connect', { from: 'settings' }, sam);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/settings?tab=channels');

    const text = visible(await page(w, res.headers.get('location')!.split('#')[0]!, sam));
    expect(text).toContain('+61 412 345 678');
    expect(text).toContain('Disconnect');
    expect(text).toContain('Not needed');
    expect(text).not.toContain('Connect SMS');
    expect(text).not.toContain('Not tested');
  });

  test('Disconnect removes the phone', async () => {
    const w = await withServerPhone();
    const sam = await w.signUp();
    const connected = await w.post('/server-sms/connect', { from: 'setup' }, sam);
    expect(connected.status).toBe(303);
    const connectedText = visible(await page(w, connected.headers.get('location')!.split('#')[0]!, sam));
    expect(connectedText).toContain('+61 412 345 678');
    expect(connectedText).toContain('Disconnect');
    expect(connectedText).not.toContain('Connect SMS');

    const res = await w.post('/server-sms/disconnect', { from: 'setup' }, sam);
    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(location).not.toContain('error=');
    expectConnectOffer(await page(w, location.split('#')[0]!, sam));
  });

  test("Connect SMS is refused when another Agency already holds the phone", async () => {
    const w = await withServerPhone();
    const first = await w.signUp();
    expect((await w.post('/server-sms/connect', { from: 'welcome' }, first)).status).toBe(303);

    const second = await w.signUp({ email: 'river@second.example', agencyName: 'Second Realty' });
    const res = await w.post('/server-sms/connect', { from: 'welcome' }, second);
    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(decodeURIComponent(location)).toContain("This server's SMS number is connected to another Agency.");
    const text = visible(await page(w, location.split('#')[0]!, second));
    expect(text).toContain("This server's SMS number is connected to another Agency.");
    expect(text).toContain('Connect SMS');
  });
});
