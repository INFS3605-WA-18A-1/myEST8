import { describe, expect, test } from 'vitest';
import { createImageMatcher } from '../../src/adapters/image-matcher.ts';
import { json, stubFetch } from './stub-fetch.ts';

const match = (respond: () => Response) => {
  const stub = stubFetch(respond);
  const matcher = createImageMatcher({ baseUrl: 'https://vision.example', apiKey: 'vision-key', fetch: stub.fetch });
  const result = matcher.match({
    description: 'The kitchen tap is leaking',
    photos: [{ contentType: 'image/jpeg', content: new Uint8Array([0xff, 0xd8, 0xff]) }],
  });
  return { stub, result };
};

describe('Image matcher', () => {
  test('posts the description and base64 photos, and returns the result and reason', async () => {
    const { stub, result } = match(() => json({ result: 'does_not_match', reason: 'The photo shows a bathroom, not a kitchen' }));

    expect(await result).toEqual({ result: 'does_not_match', reason: 'The photo shows a bathroom, not a kitchen' });
    const request = stub.requests[0]!;
    expect(request.url).toBe('https://vision.example/v1/image-match');
    expect(request.headers.get('authorization')).toBe('Bearer vision-key');
    expect(await request.json()).toEqual({
      description: 'The kitchen tap is leaking',
      photos: [{ contentType: 'image/jpeg', data: '/9j/' }],
    });
  });

  test('a non-2xx response throws with its status', async () => {
    const { result } = match(() => new Response('upstream model unavailable', { status: 503 }));
    await expect(result).rejects.toThrow('Image matcher returned 503: upstream model unavailable');
  });

  test.each([
    ['an unknown result', { result: 'maybe', reason: 'hard to say' }],
    ['no reason', { result: 'matches' }],
  ])('a malformed response throws: %s', async (_, body) => {
    const { result } = match(() => json(body));
    await expect(result).rejects.toThrow('Image matcher returned a malformed response');
  });
});
