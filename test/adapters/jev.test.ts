import { describe, expect, test } from 'vitest';
import { createJevClassifier } from '../../src/adapters/jev.ts';
import { json, stubFetch } from './stub-fetch.ts';

const questions = [
  { id: 'urgency', options: ['urgent', 'high', 'routine'] },
  { id: 'trade', options: ['plumbing', 'electrical'] },
];

const classify = (respond: () => Response) => {
  const stub = stubFetch(respond);
  const jev = createJevClassifier({ baseUrl: 'https://jev.example/api', apiKey: 'jev-key', fetch: stub.fetch });
  return { stub, result: jev.classify({ text: 'The tap is leaking', state: { senderRole: 'tenant', hasAttachments: false }, questions }) };
};

describe('Jev classifier', () => {
  test('posts the message in the state with the typed questions, and returns one answer per question', async () => {
    const { stub, result } = classify(() =>
      json({
        answers: [
          { questionId: 'urgency', answer: 'high', confidence: 0.92 },
          { questionId: 'trade', answer: 'plumbing', confidence: 0.81 },
          { questionId: 'not_asked', answer: 'x', confidence: 1 },
        ],
      }),
    );

    expect(await result).toEqual({ urgency: { answer: 'high', confidence: 0.92 }, trade: { answer: 'plumbing', confidence: 0.81 } });
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://jev.example/api/v1/classify');
    expect(request.headers.get('authorization')).toBe('Bearer jev-key');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(await request.json()).toEqual({
      state: { message: 'The tap is leaking', senderRole: 'tenant', hasAttachments: false },
      questions: [
        { id: 'urgency', options: ['urgent', 'high', 'routine'] },
        { id: 'trade', options: ['plumbing', 'electrical'] },
      ],
    });
  });

  test('a question Jev leaves unanswered comes back with confidence 0, so intake sends the message to the inbox', async () => {
    const { result } = classify(() => json({ answers: [{ questionId: 'urgency', answer: 'routine', confidence: 0.8 }] }));
    expect(await result).toEqual({ urgency: { answer: 'routine', confidence: 0.8 }, trade: { answer: 'plumbing', confidence: 0 } });
  });

  test('an answer outside the options comes back with confidence 0, never as the made-up answer', async () => {
    const { result } = classify(() =>
      json({
        answers: [
          { questionId: 'urgency', answer: 'urgent', confidence: 0.99 },
          { questionId: 'trade', answer: 'roofing', confidence: 0.9 },
        ],
      }),
    );
    expect(await result).toEqual({ urgency: { answer: 'urgent', confidence: 0.99 }, trade: { answer: 'plumbing', confidence: 0 } });
  });

  test('an unanswered question with a "neither" option reports that option', async () => {
    const stub = stubFetch(() => json({ answers: [] }));
    const jev = createJevClassifier({ baseUrl: 'https://jev.example/api', apiKey: 'jev-key', fetch: stub.fetch });
    const result = await jev.classify({
      text: 'Thanks!',
      state: {},
      questions: [
        { id: 'messageClass', options: ['new_issue', 'update', 'other'] },
        { id: 'relatedItem', options: ['T-1', 'none'] },
        { id: 'answer:visit', options: ['confirm', 'reschedule', 'not_an_answer'] },
      ],
    });
    expect(result).toEqual({
      messageClass: { answer: 'other', confidence: 0 },
      relatedItem: { answer: 'none', confidence: 0 },
      'answer:visit': { answer: 'not_an_answer', confidence: 0 },
    });
  });

  test('the classified text wins over a "message" key in the state', async () => {
    const stub = stubFetch(() => json({ answers: [] }));
    const jev = createJevClassifier({ baseUrl: 'https://jev.example/api', apiKey: 'jev-key', fetch: stub.fetch });
    await jev.classify({ text: 'Real text', state: { message: 'stale' }, questions: [] });
    expect(((await stub.requests[0]!.json()) as { state: object }).state).toEqual({ message: 'Real text' });
  });

  test('a rate limit throws with its status and body, so the worker retries', async () => {
    const { result } = classify(() => json({ error: 'rate limited' }, 429));
    await expect(result).rejects.toThrow('Jev returned 429: {"error":"rate limited"}');
  });

  test('a server error throws, so the worker retries', async () => {
    const { result } = classify(() => json({ error: 'overloaded' }, 503));
    await expect(result).rejects.toThrow('Jev returned 503');
  });

  test('a network failure throws', async () => {
    const { result } = classify(() => {
      throw new TypeError('fetch failed');
    });
    await expect(result).rejects.toThrow('fetch failed');
  });

  test.each([
    ['no answers list', { result: [] }, 'no answers list'],
    ['an answer without confidence', { answers: [{ questionId: 'urgency', answer: 'high' }] }, 'without questionId'],
    ['a confidence above 1', { answers: [{ questionId: 'urgency', answer: 'high', confidence: 1.5 }] }, 'confidence 1.5 for urgency'],
  ])('a malformed response throws: %s', async (_, body, message) => {
    const { result } = classify(() => json(body));
    await expect(result).rejects.toThrow(message);
  });

  test('a body that is not JSON throws', async () => {
    const { result } = classify(() => new Response('<html>Bad gateway</html>', { status: 200 }));
    await expect(result).rejects.toThrow('Jev returned a body that is not JSON: <html>Bad gateway</html>');
  });
});
