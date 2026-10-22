import { describe, expect, test } from 'vitest';
import { createTextbeeMessenger } from '../../src/adapters/textbee.ts';
import { createFileLinks } from '../../src/file-links.ts';
import { UndeliverableError, type OutboundMessage } from '../../src/ports.ts';
import { FakeClock } from '../support/fakes.ts';
import { json, stubFetch } from './stub-fetch.ts';

const API_KEY = 'textbee-test-api-key';
const DEVICE_ID = '664a9b8cd0e1f2a3b4c5d6e7';
const clock = new FakeClock(new Date('2026-10-08T09:00:00+11:00'));
const fileLinks = createFileLinks({ secret: 'a-test-secret-that-is-long-enough-1234', baseUrl: 'https://myest8.test/', clock });

// HMAC of `file:7:1791414000` with the test secret, worked out once and pasted in.
const PHOTO_LINK = 'https://myest8.test/media/7?expires=1791414000&signature=RnyKmpRdSsvYfV9Jhw7TARj7V4HGB5B2r0PURpBMIBY';

// The queued-send body from textbee's sending-SMS docs.
const queued = () =>
  json({
    data: {
      success: true,
      message: 'SMS added to queue for processing',
      smsBatchId: '66b1f2c3a4d5e6f7a8b9c0d2',
      recipientCount: 1,
    },
  });

const photo = (id: number) => ({ id, filename: `photo-${id}.jpg`, contentType: 'image/jpeg', content: new Uint8Array([0xff, 0xd8, 0xff]) });

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  channelType: 'sms',
  from: '+61290000000',
  to: '+61400000001',
  cc: [],
  subject: 'Your maintenance request',
  text: 'Thanks, we got your message about the kitchen tap.',
  template: 'intake.acknowledged',
  data: {},
  attachments: [],
  ...overrides,
});

function textbee(respond: () => Response = queued, config: { apiBaseUrl?: string; fileLinks?: typeof fileLinks | null } = {}) {
  const stub = stubFetch(respond);
  return { stub, messenger: createTextbeeMessenger({ apiKey: API_KEY, deviceId: DEVICE_ID, fileLinks, fetch: stub.fetch, ...config }) };
}

describe('textbee outbound SMS', () => {
  test('posts one text to /gateway/send-sms with the API key and the device id in the body', async () => {
    const { stub, messenger } = textbee();
    await messenger.send(message());

    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
    expect(request.headers.get('x-api-key')).toBe(API_KEY);
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(await request.json()).toEqual({
      recipients: ['+61400000001'],
      message: 'Thanks, we got your message about the kitchen tap.',
      deviceId: DEVICE_ID,
    });
  });

  test("a text with an attachment carries the file's signed link, because SMS can't carry the file", async () => {
    const { stub, messenger } = textbee();
    await messenger.send(message({ attachments: [photo(7)] }));

    expect(await stub.requests[0]!.json()).toMatchObject({
      recipients: ['+61400000001'],
      message: `Thanks, we got your message about the kitchen tap.\n${PHOTO_LINK}`,
    });
  });

  test('an attachment that is not a stored file, or no file links, throws before anything is sent', async () => {
    const { stub, messenger } = textbee();
    const { id: _, ...unstored } = photo(7);
    await expect(messenger.send(message({ attachments: [unstored] }))).rejects.toThrow('photo-7.jpg has no file id');

    const bare = createTextbeeMessenger({ apiKey: API_KEY, deviceId: DEVICE_ID, fetch: stub.fetch });
    await expect(bare.send(message({ attachments: [photo(7)] }))).rejects.toThrow('FILE_LINK_SECRET');
    expect(stub.requests).toHaveLength(0);
  });

  test('a refused number is undeliverable, with a reason a person can read', async () => {
    const { messenger } = textbee(() => json({ success: false, error: 'Invalid recipients' }, 400));
    const error = await messenger.send(message()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UndeliverableError);
    expect((error as UndeliverableError).permanent).toBe(true);
    expect((error as Error).message).toBe('Undeliverable sms message to +61400000001: Textbee Invalid recipients');
    expect((error as UndeliverableError).userReason).toBe("that doesn't look like a valid phone number");
  });

  test('a server error is retried, and the API key never appears in it', async () => {
    const { messenger } = textbee(() => new Response(`upstream down ${API_KEY}`, { status: 503 }));
    const error = await messenger.send(message()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UndeliverableError);
    expect((error as { permanent?: boolean }).permanent).toBeUndefined();
    expect((error as Error).message).toBe('Textbee returned 503: upstream down [redacted]');
    expect((error as Error).message).not.toContain(API_KEY);
  });

  test('a phone that cannot send is a plain error, so the outage surfaces', async () => {
    const { messenger } = textbee(() => json({ success: false, error: 'No enabled device found. Enable a device or pass a deviceId.' }, 400));
    const error = await messenger.send(message()).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UndeliverableError);
    expect((error as Error).message).toBe('Textbee returned 400: No enabled device found. Enable a device or pass a deviceId.');
  });

  test('a plan limit is read from the message field and retried', async () => {
    const { messenger } = textbee(() => json({ message: 'daily limit is used up' }, 429));
    const error = await messenger.send(message()).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UndeliverableError);
    expect((error as Error).message).toBe('Textbee returned 429: daily limit is used up');
  });
});
