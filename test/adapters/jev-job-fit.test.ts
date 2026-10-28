import { describe, expect, test } from 'vitest';
import { createJevJobFitJudge } from '../../src/adapters/jev-job-fit.ts';
import type { JobFitEvidence } from '../../src/ports.ts';
import { json, stubFetch } from './stub-fetch.ts';

const EVIDENCE: JobFitEvidence = {
  job: { trade: 'plumbing', summary: 'Hot water system leaking', description: 'The hot water tank is dripping in the garage', location: 'Garage' },
  tradie: {
    businessName: 'Hot Water Heroes',
    trades: ['plumbing'],
    listing: { types: ['plumber'], summary: 'Hot water systems and leaking taps' },
    pastJobs: [{ trade: 'plumbing', summary: 'No hot water', scopeOfWork: 'Replace the tempering valve' }],
  },
};

/** Jev's answer to the job-fit question. */
const answer = (score: number, confidence = 0.8) =>
  json({ model: 'jev-1', answers: { job_fit: { type: 'score', score, confidence, legend: {}, probabilities: {} } } });

const judge = (respond: () => Response) => {
  const stub = stubFetch(respond);
  const jev = createJevJobFitJudge({ baseUrl: 'https://jev.example/api', apiKey: 'jev-key', fetch: stub.fetch });
  return { stub, result: jev.judge(EVIDENCE) };
};

describe('Jev job-fit judge', () => {
  test('asks one Score question on four levels, with the evidence as state and the bearer key', async () => {
    const { stub, result } = judge(() => answer(2.4));
    await result;

    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://jev.example/api/v1/systemone');
    expect(request.headers.get('authorization')).toBe('Bearer jev-key');
    const body = (await request.json()) as { model: string; state: unknown; questions: Record<string, { type: string; instructions: string; criteria: string[] }> };
    expect(body.model).toBe('jev-latest');
    expect(body.state).toEqual(EVIDENCE);
    expect(Object.keys(body.questions)).toEqual(['job_fit']);
    const question = body.questions.job_fit!;
    expect(question.type).toBe('score');
    expect(question.criteria).toHaveLength(4);
    // Levels name what the evidence shows, never a number or "more than the last".
    for (const level of question.criteria) expect(level).not.toMatch(/\d|more than|less than/);
    expect(question.instructions).toContain('`tradie.pastJobs`');
  });

  test("returns Jev's score and confidence", async () => {
    const { result } = judge(() => answer(2.4, 0.55));
    expect(await result).toEqual({ score: 2.4, confidence: 0.55 });
  });

  test('a base URL with a trailing slash is still posted to /v1/systemone', async () => {
    const stub = stubFetch(() => answer(1));
    await createJevJobFitJudge({ baseUrl: 'https://jev.example/api/', apiKey: 'jev-key', fetch: stub.fetch }).judge(EVIDENCE);
    expect(stub.requests[0]!.url).toBe('https://jev.example/api/v1/systemone');
  });

  test.each([
    ['a response without answers', {}],
    ['no answer to job_fit', { answers: {} }],
    ['an answer that is not a score', { answers: { job_fit: { type: 'noul', noul: 0.9 } } }],
    ['a score above the top level', { answers: { job_fit: { type: 'score', score: 3.5, confidence: 0.9 } } }],
    ['a score below 0', { answers: { job_fit: { type: 'score', score: -1, confidence: 0.9 } } }],
    ['a score without a confidence', { answers: { job_fit: { type: 'score', score: 2 } } }],
    ['a confidence above 1', { answers: { job_fit: { type: 'score', score: 2, confidence: 1.5 } } }],
  ])('a malformed response throws: %s', async (_, body) => {
    const { result } = judge(() => json(body));
    await expect(result).rejects.toThrow('Jev returned a malformed response');
  });

  test('a non-2xx response throws with its status', async () => {
    const { result } = judge(() => json({ detail: [{ loc: ['body', 'questions'], msg: 'Field required' }] }, 422));
    await expect(result).rejects.toThrow('Jev returned 422');
  });

  test.each([
    ['an error body', () => new Response('Invalid key jev-key', { status: 401 })],
    ['a malformed response', () => json({ echoed: 'jev-key' })],
  ])('the key never appears in the error: %s', async (_, respond) => {
    const error = await judge(respond).result.catch((e: unknown) => e);
    expect(String(error)).not.toContain('jev-key');
    expect(String(error)).toContain('[redacted]');
  });
});
