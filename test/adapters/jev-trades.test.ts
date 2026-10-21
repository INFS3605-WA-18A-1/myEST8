import { describe, expect, test } from 'vitest';
import { createJevTradeSuggester } from '../../src/adapters/jev-trades.ts';
import type { ListingDetails } from '../../src/ports.ts';
import { TRADES, type Trade } from '../../src/shared.ts';
import { json, stubFetch } from './stub-fetch.ts';

const PETES: ListingDetails = {
  placeId: 'place-pete',
  name: "Pete's Plumbing",
  address: '4 Illawarra Rd, Marrickville NSW 2204',
  phone: '+61 412 555 018',
  website: 'https://petes-plumbing.example',
  types: ['plumber', 'point_of_interest', 'establishment'],
  primaryType: 'Plumber',
  summary: 'Local plumbers for blocked drains and hot water.',
  rating: 4.8,
  reviewCount: 120,
};

/** Jev's answer to every Trade's question, with `noul` for those given and 0 for the rest. */
const answers = (noul: Partial<Record<Trade, number>>) =>
  json({ model: 'jev-1', answers: Object.fromEntries(TRADES.map((t) => [t, { type: 'noul', noul: noul[t] ?? 0 }])) });

const suggest = (respond: () => Response, listing = PETES) => {
  const stub = stubFetch(respond);
  const jev = createJevTradeSuggester({ baseUrl: 'https://jev.example/api', apiKey: 'jev-key', fetch: stub.fetch });
  return { stub, result: jev.suggestTrades(listing) };
};

describe('Jev trade suggester', () => {
  test('asks one Noul question per Trade in one request, with the listing as state and the bearer key', async () => {
    const { stub, result } = suggest(() => answers({ plumbing: 0.95 }));
    await result;

    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://jev.example/api/v1/systemone');
    expect(request.headers.get('authorization')).toBe('Bearer jev-key');
    expect(request.headers.get('content-type')).toBe('application/json');
    const body = (await request.json()) as { model: string; state: unknown; questions: Record<string, unknown> };
    expect(body.model).toBe('jev-latest');
    expect(body.state).toEqual({
      name: "Pete's Plumbing",
      types: ['plumber', 'point_of_interest', 'establishment'],
      primaryTypeDisplayName: 'Plumber',
      editorialSummary: 'Local plumbers for blocked drains and hot water.',
      website: 'https://petes-plumbing.example',
    });
    expect(Object.keys(body.questions)).toEqual([...TRADES]);
    for (const question of Object.values(body.questions)) {
      expect(question).toEqual({ type: 'noul', instructions: expect.any(String), criteria: { true: expect.any(String), false: expect.any(String) } });
    }
    expect(JSON.stringify(body.questions.pest_control)).toContain('pest control');
  });

  test('the state leaves out the address, phone and rating, and keeps what the listing lacks as null', async () => {
    const { stub, result } = suggest(() => answers({}), { ...PETES, primaryType: null, summary: null, website: null, types: [] });
    await result;
    const { state } = (await stub.requests[0]!.json()) as { state: object };
    expect(state).toEqual({ name: "Pete's Plumbing", types: [], primaryTypeDisplayName: null, editorialSummary: null, website: null });
  });

  test('returns the Trades Jev gives at least 0.5, in the order of the Trade list', async () => {
    const { result } = suggest(() => answers({ roofing: 0.5, electrical: 0.49, plumbing: 0.91, locksmith: 0.2 }));
    expect(await result).toEqual(['plumbing', 'roofing']);
  });

  test('no Trade at or above 0.5 gives no suggestions', async () => {
    const { result } = suggest(() => answers({ plumbing: 0.3 }));
    expect(await result).toEqual([]);
  });

  test('a Trade Jev leaves unanswered is not suggested, and an answer to a Trade not asked is ignored', async () => {
    const { result } = suggest(() => json({ answers: { plumbing: { type: 'noul', noul: 0.8 }, painting: { type: 'noul', noul: 0.9 } } }));
    expect(await result).toEqual(['plumbing']);
  });

  test('a base URL with a trailing slash is still posted to /v1/systemone', async () => {
    const stub = stubFetch(() => answers({}));
    await createJevTradeSuggester({ baseUrl: 'https://jev.example/api/', apiKey: 'jev-key', fetch: stub.fetch }).suggestTrades(PETES);
    expect(stub.requests[0]!.url).toBe('https://jev.example/api/v1/systemone');
  });

  test.each([
    ['a response without answers', {}],
    ['answers that are a list', { answers: [] }],
    ['an answer that is not a noul', { answers: { plumbing: { type: 'choice', choice: 'true', confidence: 1 } } }],
    ['a noul that is not a number', { answers: { plumbing: { type: 'noul', noul: 'high' } } }],
    ['a noul above 1', { answers: { plumbing: { type: 'noul', noul: 1.2 } } }],
    ['a noul below 0', { answers: { plumbing: { type: 'noul', noul: -0.1 } } }],
  ])('a malformed response throws: %s', async (_, body) => {
    const { result } = suggest(() => json(body));
    await expect(result).rejects.toThrow('Jev returned a malformed response');
  });

  test('a non-2xx response throws with its status', async () => {
    const { result } = suggest(() => json({ detail: [{ loc: ['body', 'questions'], msg: 'Field required' }] }, 422));
    await expect(result).rejects.toThrow('Jev returned 422');
  });

  test.each([
    ['an error body', () => new Response('Invalid key jev-key', { status: 401 })],
    ['a malformed response', () => json({ echoed: 'jev-key' })],
    ['a body that is not JSON', () => new Response('jev-key', { status: 200 })],
  ])('the key never appears in the error: %s', async (_, respond) => {
    const { result } = suggest(respond);
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('jev-key');
    expect(String(error)).toContain('[redacted]');
  });

  test('a network failure throws', async () => {
    const jev = createJevTradeSuggester({
      baseUrl: 'https://jev.example',
      apiKey: 'jev-key',
      fetch: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    await expect(jev.suggestTrades(PETES)).rejects.toThrow('connect ECONNREFUSED');
  });
});
