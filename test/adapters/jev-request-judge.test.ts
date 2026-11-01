import { describe, expect, test } from 'vitest';
import { createJevRequestJudge } from '../../src/adapters/jev-request-judge.ts';
import type { RequestToJudge } from '../../src/ports.ts';
import { json, stubFetch } from './stub-fetch.ts';

const DRIP: RequestToJudge = { issueId: 7, description: 'The kitchen tap is dripping', summary: 'Kitchen tap', urgency: 'routine' };
const LOCK: RequestToJudge = { issueId: 8, description: 'The front door lock is broken', summary: null, urgency: 'urgent', propertyType: 'house' };

const score = (value: number, confidence = 0.8) => ({ type: 'score', score: value, confidence, legend: {}, probabilities: {} });
const noul = (value: number) => ({ type: 'noul', noul: value });

const answers = (body: Record<string, unknown>) => json({ model: 'jev-1', answers: body });

const judge = (requests: RequestToJudge[], respond: () => Response) => {
  const stub = stubFetch(respond);
  const jev = createJevRequestJudge({ baseUrl: 'https://jev.example/api', apiKey: 'jev-key', fetch: stub.fetch });
  return { stub, result: jev.judge(requests) };
};

describe('Jev request judge', () => {
  test('asks a Score and a Noul for each request in one call, with the Tenant text only in state', async () => {
    const { stub, result } = judge([DRIP, LOCK], () =>
      answers({
        minor_7: score(0),
        caused_7: noul(0.1),
        minor_8: score(2),
        caused_8: noul(0.2),
      }),
    );
    await result;

    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://jev.example/api/v1/systemone');
    expect(request.headers.get('authorization')).toBe('Bearer jev-key');
    const body = (await request.json()) as {
      model: string;
      state: { requests: { id: string; description: string; propertyType?: string }[] };
      questions: Record<string, { type: string; instructions: string; criteria: unknown }>;
    };
    expect(body.model).toBe('jev-latest');
    expect(body.state.requests).toEqual([
      { id: '7', description: DRIP.description, summary: 'Kitchen tap', urgency: 'routine' },
      { id: '8', description: LOCK.description, summary: null, urgency: 'urgent', propertyType: 'house' },
    ]);
    expect(Object.keys(body.questions)).toEqual(['minor_7', 'caused_7', 'minor_8', 'caused_8']);
    expect(body.questions.minor_7!.type).toBe('score');
    expect(body.questions.caused_7!.type).toBe('noul');
    expect(body.questions.minor_7!.criteria).toHaveLength(3);
    const criteria = body.questions.caused_7!.criteria as { true: string; false: string };
    expect(criteria.true).toBeTruthy();
    expect(criteria.false).toBeTruthy();
    const instructions = Object.values(body.questions).map((question) => question.instructions).join('\n');
    expect(instructions).toContain('`requests`');
    expect(instructions).toContain('"7"');
    expect(instructions).not.toContain(DRIP.description);
    expect(instructions).not.toContain('broken');
  });

  test('flips the score so 1 is the most minor, and keeps the noul', async () => {
    const { result } = judge([DRIP], () => answers({ minor_7: score(0, 0.9), caused_7: noul(0.15) }));
    expect(await result).toEqual(new Map([[7, { minor: 1, tenantCaused: 0.15 }]]));

    const least = judge([DRIP], () => answers({ minor_7: score(2), caused_7: noul(0.8) }));
    expect([...(await least.result).values()][0]).toMatchObject({ minor: 0, tenantCaused: 0.8 });
  });

  test('an empty list asks nothing', async () => {
    const { stub, result } = judge([], () => answers({}));
    expect(await result).toEqual(new Map());
    expect(stub.requests).toHaveLength(0);
  });

  test('a base URL with a trailing slash is still posted to /v1/systemone', async () => {
    const stub = stubFetch(() => answers({ minor_7: score(1), caused_7: noul(0.1) }));
    await createJevRequestJudge({ baseUrl: 'https://jev.example/api/', apiKey: 'jev-key', fetch: stub.fetch }).judge([DRIP]);
    expect(stub.requests[0]!.url).toBe('https://jev.example/api/v1/systemone');
  });

  test.each([
    ['a response without answers', {}],
    ['no score', { answers: { caused_7: noul(0.1) } }],
    ['a score that is a noul', { answers: { minor_7: noul(0.1), caused_7: noul(0.1) } }],
    ['a score past the top level', { answers: { minor_7: score(3), caused_7: noul(0.1) } }],
    ['a score without a confidence', { answers: { minor_7: { type: 'score', score: 1 }, caused_7: noul(0.1) } }],
    ['a noul that is a score', { answers: { minor_7: score(1), caused_7: score(1) } }],
    ['a noul above 1', { answers: { minor_7: score(1), caused_7: noul(1.2) } }],
  ])('a malformed response throws: %s', async (_, body) => {
    const { result } = judge([DRIP], () => json(body));
    await expect(result).rejects.toThrow('Jev returned a malformed response');
  });

  test('a non-2xx response throws with its status', async () => {
    const { result } = judge([DRIP], () => json({ detail: 'no' }, 422));
    await expect(result).rejects.toThrow('Jev returned 422');
  });

  test('the key never appears in the error', async () => {
    const error = await judge([DRIP], () => new Response('Invalid key jev-key', { status: 401 })).result.catch((e: unknown) => e);
    expect(String(error)).not.toContain('jev-key');
    expect(String(error)).toContain('[redacted]');
  });
});
