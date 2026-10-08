import { describe, expect, test } from 'vitest';
import { createQuoteReader } from '../../src/adapters/quote-reader.ts';
import { json, stubFetch } from './stub-fetch.ts';

const clock = { now: () => new Date('2026-10-08T09:00:00+11:00') };

const read = (respond: () => Response, pdf?: Uint8Array) => {
  const stub = stubFetch(respond);
  const reader = createQuoteReader({ baseUrl: 'https://quotes.example', apiKey: 'quotes-key', clock, timeZone: 'Australia/Sydney', fetch: stub.fetch });
  return { stub, result: reader.read({ text: 'Can do Tue 9am, $450 inc GST', ...(pdf ? { pdf } : {}) }) };
};

describe('Quote reader', () => {
  test('posts the text, PDF, current time and time zone, and returns the price and time', async () => {
    const { stub, result } = read(() => json({ priceCents: 45000, proposedTime: '2026-10-12T22:00:00.000Z' }), new Uint8Array([0x25, 0x50, 0x44, 0x46]));

    expect(await result).toEqual({ priceCents: 45000, proposedTime: new Date('2026-10-13T09:00:00+11:00') });
    const request = stub.requests[0]!;
    expect(request.url).toBe('https://quotes.example/v1/quote-read');
    expect(request.headers.get('authorization')).toBe('Bearer quotes-key');
    expect(await request.json()).toEqual({
      text: 'Can do Tue 9am, $450 inc GST',
      pdf: 'JVBERg==',
      now: '2026-10-07T22:00:00.000Z',
      timeZone: 'Australia/Sydney',
    });
  });

  test('without a PDF none is sent, and a price or time the reply lacks is left out', async () => {
    const { stub, result } = read(() => json({ priceCents: null, proposedTime: null }));

    expect(await result).toEqual({});
    expect(await stub.requests[0]!.json()).not.toHaveProperty('pdf');
  });

  test('a non-2xx response throws with its status', async () => {
    const { result } = read(() => json({ error: 'bad key' }, 401));
    await expect(result).rejects.toThrow('Quote reader returned 401: {"error":"bad key"}');
  });

  test.each([
    ['a price as text', { priceCents: '450', proposedTime: null }],
    ['a price with fractional cents', { priceCents: 450.5, proposedTime: null }],
    ['a negative price', { priceCents: -100, proposedTime: null }],
    ['a time that is not ISO', { priceCents: null, proposedTime: 'next Tuesday' }],
    ['not an object', [45000]],
  ])('a malformed response throws: %s', async (_, body) => {
    const { result } = read(() => json(body));
    await expect(result).rejects.toThrow('Quote reader returned a malformed response');
  });
});
