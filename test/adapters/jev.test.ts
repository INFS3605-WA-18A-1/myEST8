import { describe, expect, test } from 'vitest';
import { createJevClassifier } from '../../src/adapters/jev.ts';
import type { ClassifierQuestion } from '../../src/ports.ts';
import { json, stubFetch } from './stub-fetch.ts';

// The expected requests and responses are written out as JSON from
// https://docs.typesafe.ai/api.md and /primitives/choice.md, not built by the adapter.

const urgency: ClassifierQuestion = {
  id: 'urgency',
  instructions: 'How soon must the issue in `message` be dealt with?',
  options: [
    { name: 'urgent', when: 'A threat to safety, the structure, security or an essential service' },
    { name: 'high', when: 'Gets worse or does damage if left, but is not a threat' },
    { name: 'routine', when: 'Can wait for a normal repair visit' },
  ],
};

const trade: ClassifierQuestion = {
  id: 'trade',
  instructions: 'Which trade does the issue in `message` need?',
  options: [
    { name: 'plumbing', when: 'Taps, pipes, drains, toilets, hot water' },
    { name: 'electrical', when: 'Power, lights, wiring, smoke alarms' },
  ],
};

const asked = [urgency, trade];

const classify = (respond: (request: Request) => Response, questions: ClassifierQuestion[] = asked) => {
  const stub = stubFetch(respond);
  const jev = createJevClassifier({ baseUrl: 'https://api.typesafe.example', apiKey: 'jev-key', fetch: stub.fetch });
  return { stub, result: jev.classify({ text: 'The tap is leaking', state: { senderRole: 'tenant', hasAttachments: false }, questions }) };
};

/** A choice answer as TypeSafe returns it (docs: primitives/choice, "Response structure"). */
const choiceAnswer = (choice: string, confidence: number, probabilities: Record<string, number>) => ({ type: 'choice', choice, confidence, probabilities });

describe('Jev classifier', () => {
  test('posts one choice question per question to /v1/systemone, with the message in the state', async () => {
    const { stub, result } = classify(() =>
      json({
        model: 'jev-1.13.0',
        answers: {
          urgency: choiceAnswer('high', 0.92, { urgent: 0.02, high: 0.95, routine: 0.03 }),
          trade: choiceAnswer('plumbing', 0.81, { plumbing: 0.87, electrical: 0.13 }),
        },
        usage: { input_tokens: 328, output_tokens: 34 },
      }),
    );

    expect(await result).toEqual({ urgency: { answer: 'high', confidence: 0.92 }, trade: { answer: 'plumbing', confidence: 0.81 } });

    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.typesafe.example/v1/systemone');
    expect(request.headers.get('authorization')).toBe('Bearer jev-key');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(await request.json()).toEqual({
      model: 'jev-latest',
      state: { senderRole: 'tenant', hasAttachments: false, message: 'The tap is leaking' },
      questions: {
        urgency: {
          type: 'choice',
          instructions: 'How soon must the issue in `message` be dealt with?',
          criteria: {
            urgent: 'A threat to safety, the structure, security or an essential service',
            high: 'Gets worse or does damage if left, but is not a threat',
            routine: 'Can wait for a normal repair visit',
          },
        },
        trade: {
          type: 'choice',
          instructions: 'Which trade does the issue in `message` need?',
          criteria: {
            plumbing: 'Taps, pipes, drains, toilets, hot water',
            electrical: 'Power, lights, wiring, smoke alarms',
          },
        },
      },
    });
  });

  test('a question Jev leaves unanswered comes back with confidence 0, so intake sends the message to the inbox', async () => {
    const { result } = classify(() =>
      json({
        model: 'jev-1.13.0',
        answers: { urgency: choiceAnswer('routine', 0.8, { urgent: 0.05, high: 0.1, routine: 0.85 }) },
        usage: { input_tokens: 328, output_tokens: 34 },
      }),
    );
    expect(await result).toEqual({ urgency: { answer: 'routine', confidence: 0.8 }, trade: { answer: 'plumbing', confidence: 0 } });
  });

  test('an answer outside the options comes back with confidence 0, never as the made-up answer', async () => {
    const { result } = classify(() =>
      json({
        model: 'jev-1.13.0',
        answers: {
          urgency: choiceAnswer('urgent', 0.99, { urgent: 1, high: 0, routine: 0 }),
          trade: choiceAnswer('roofing', 0.9, { roofing: 0.95, plumbing: 0.05 }),
        },
        usage: { input_tokens: 328, output_tokens: 34 },
      }),
    );
    expect(await result).toEqual({ urgency: { answer: 'urgent', confidence: 0.99 }, trade: { answer: 'plumbing', confidence: 0 } });
  });

  test('an unanswered question that has a "neither" option reports that option', async () => {
    const option = (name: string) => ({ name, when: `When it is ${name}` });
    const { result } = classify(
      () => json({ model: 'jev-1.13.0', answers: {}, usage: { input_tokens: 10, output_tokens: 1 } }),
      [
        { id: 'messageClass', instructions: 'What is `message`?', options: [option('new_issue'), option('update'), option('other')] },
        { id: 'relatedItem', instructions: 'Which of `openItems`?', options: [option('ticket:1'), option('none')] },
        { id: 'answer:visit', instructions: 'Does `message` answer the visit question?', options: [option('confirm'), option('reschedule'), option('not_an_answer')] },
      ],
    );
    expect(await result).toEqual({
      messageClass: { answer: 'other', confidence: 0 },
      relatedItem: { answer: 'none', confidence: 0 },
      'answer:visit': { answer: 'not_an_answer', confidence: 0 },
    });
  });

  test('the classified text is the `message` in the state, over a "message" key already there', async () => {
    const stub = stubFetch(() => json({ model: 'jev-1.13.0', answers: { urgency: choiceAnswer('high', 0.9, {}) }, usage: { input_tokens: 1, output_tokens: 1 } }));
    const jev = createJevClassifier({ baseUrl: 'https://api.typesafe.example', apiKey: 'jev-key', fetch: stub.fetch });
    await jev.classify({ text: 'Real text', state: { message: 'stale' }, questions: [urgency] });
    expect(((await stub.requests[0]!.json()) as { state: object }).state).toEqual({ message: 'Real text' });
  });

  test('a trailing slash on the base URL does not double the slash before /v1/systemone', async () => {
    const stub = stubFetch(() => json({ model: 'jev-1.13.0', answers: { urgency: choiceAnswer('high', 0.9, {}) }, usage: { input_tokens: 1, output_tokens: 1 } }));
    const jev = createJevClassifier({ baseUrl: 'https://api.typesafe.example/', apiKey: 'jev-key', fetch: stub.fetch });
    await jev.classify({ text: 'Leak', state: {}, questions: [urgency] });
    expect(stub.requests[0]!.url).toBe('https://api.typesafe.example/v1/systemone');
  });

  test('a question id with a colon, such as answer:guided, is sent under a safe name and mapped back', async () => {
    const option = (name: string) => ({ name, when: `When it is ${name}` });
    const { stub, result } = classify(
      () =>
        json({
          model: 'jev-1.13.0',
          answers: {
            answer_guided: choiceAnswer('answer', 0.9, { answer: 0.95, not_an_answer: 0.05 }),
            answer_visit: choiceAnswer('confirm', 0.85, { confirm: 0.9, reschedule: 0.1 }),
            answer_visit_2: choiceAnswer('reschedule', 0.7, { confirm: 0.2, reschedule: 0.8 }),
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      [
        { id: 'answer:guided', instructions: 'Is this the reply we asked for?', options: [option('answer'), option('not_an_answer')] },
        { id: 'answer:visit', instructions: 'Visit?', options: [option('confirm'), option('reschedule')] },
        { id: 'answer_visit', instructions: 'Visit again?', options: [option('confirm'), option('reschedule')] },
      ],
    );
    expect(await result).toEqual({
      'answer:guided': { answer: 'answer', confidence: 0.9 },
      'answer:visit': { answer: 'confirm', confidence: 0.85 },
      answer_visit: { answer: 'reschedule', confidence: 0.7 },
    });
    expect(Object.keys(((await stub.requests[0]!.json()) as { questions: object }).questions)).toEqual(['answer_guided', 'answer_visit', 'answer_visit_2']);
  });

  test('a question with one option is answered without asking Jev, and is sent nowhere', async () => {
    const option = (name: string) => ({ name, when: `When it is ${name}` });
    const { stub, result } = classify(
      () => json({ model: 'jev-1.13.0', answers: { urgency: choiceAnswer('routine', 0.9, {}) }, usage: { input_tokens: 1, output_tokens: 1 } }),
      [urgency, { id: 'relatedItem', instructions: 'Which of `openItems`?', options: [option('none')] }],
    );
    expect(await result).toEqual({ urgency: { answer: 'routine', confidence: 0.9 }, relatedItem: { answer: 'none', confidence: 1 } });
    expect(Object.keys(((await stub.requests[0]!.json()) as { questions: object }).questions)).toEqual(['urgency']);
  });

  test('when every question has one option, Jev is not called at all', async () => {
    const { stub, result } = classify(
      () => json({}, 500),
      [{ id: 'relatedItem', instructions: 'Which of `openItems`?', options: [{ name: 'none', when: 'Nothing is open' }] }],
    );
    expect(await result).toEqual({ relatedItem: { answer: 'none', confidence: 1 } });
    expect(stub.requests).toEqual([]);
  });

  test('a rate limit throws with its status and body, so the worker retries', async () => {
    const { result } = classify(() => json({ detail: 'Too many requests' }, 429));
    await expect(result).rejects.toThrow('Jev returned 429: {"detail":"Too many requests"}');
  });

  test('an overloaded service throws, so the worker retries', async () => {
    const { result } = classify(() => json({ detail: 'Overloaded' }, 529));
    await expect(result).rejects.toThrow('Jev returned 529');
  });

  test('a network failure throws', async () => {
    const { result } = classify(() => {
      throw new TypeError('fetch failed');
    });
    await expect(result).rejects.toThrow('fetch failed');
  });

  test('a 422 throws with the field that failed validation', async () => {
    const { result } = classify(() =>
      json({ detail: [{ loc: ['body', 'questions', 'trade', 'choice', 'criteria'], msg: 'Field required', type: 'missing' }] }, 422),
    );
    await expect(result).rejects.toThrow(/Jev returned 422: .*"questions","trade","choice","criteria".*Field required/);
  });

  test("a rejected key's error does not repeat the key, even when the service echoes it", async () => {
    const { result } = classify((request) => json({ detail: `Invalid API key: ${request.headers.get('authorization')}` }, 401));
    const error = await result.catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Jev returned 401/);
    expect((error as Error).message).not.toContain('jev-key');
  });

  const answers = (answer: unknown) => ({ model: 'jev-1.13.0', answers: { urgency: answer }, usage: { input_tokens: 1, output_tokens: 1 } });

  test.each([
    ['no answers', { model: 'jev-1.13.0', usage: {} }, 'no answers'],
    ['answers that is a list', { answers: [] }, 'no answers'],
    ['an answer that is not an object', answers('high'), 'an answer for urgency that is not a choice'],
    ['an answer of another type', answers({ type: 'noul', noul: 0.9 }), 'an answer for urgency that is not a choice'],
    ['an answer without a choice', answers({ type: 'choice', confidence: 0.9, probabilities: {} }), 'an answer for urgency that is not a choice'],
    ['an answer without confidence', answers({ type: 'choice', choice: 'high', probabilities: {} }), 'confidence undefined for urgency'],
    ['a confidence above 1', answers(choiceAnswer('high', 1.5, {})), 'confidence 1.5 for urgency'],
    ['a negative confidence', answers(choiceAnswer('high', -0.1, {})), 'confidence -0.1 for urgency'],
  ])('a malformed response throws: %s', async (_, body, message) => {
    const { result } = classify(() => json(body));
    await expect(result).rejects.toThrow(message);
  });

  test('a body that is not JSON throws', async () => {
    const { result } = classify(() => new Response('<html>Bad gateway</html>', { status: 200 }));
    await expect(result).rejects.toThrow('Jev returned a body that is not JSON: <html>Bad gateway</html>');
  });
});
