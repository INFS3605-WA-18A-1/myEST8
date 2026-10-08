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

  test('a question Jev leaves unanswered is missing, which the app reads as unsure', async () => {
    const { result } = classify(() => json({ answers: [{ questionId: 'urgency', answer: 'routine', confidence: 0.8 }] }));
    expect(await result).toEqual({ urgency: { answer: 'routine', confidence: 0.8 } });
  });

  test('a non-2xx response throws with its status and body', async () => {
    const { result } = classify(() => json({ error: 'rate limited' }, 429));
    await expect(result).rejects.toThrow('Jev returned 429: {"error":"rate limited"}');
  });

  test.each([
    ['no answers list', { result: [] }, 'no answers list'],
    ['an answer without confidence', { answers: [{ questionId: 'urgency', answer: 'high' }] }, 'without questionId'],
    ['an answer outside the options', { answers: [{ questionId: 'trade', answer: 'roofing', confidence: 0.9 }] }, "'roofing' is not an option for trade"],
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
