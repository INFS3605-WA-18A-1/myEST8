import { describe, expect, test } from 'vitest';
import { createClaudeSummariser } from '../../src/adapters/claude-summariser.ts';
import { mockSummariser } from '../../src/demo/mock-apis.ts';
import { json, stubFetch } from './stub-fetch.ts';

const API_KEY = 'test-anthropic-key';
const input = {
  description: 'The kitchen tap is dripping. It has been like that for days.',
  answers: { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no' },
  trade: 'plumbing' as const,
  photoCount: 1,
};

const reply = (text: string) =>
  json({ id: 'msg_01', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: 'text', text }] });

describe('Claude summariser', () => {
  test('sends the input as data and returns the sentence', async () => {
    const stub = stubFetch(() => reply('"Kitchen tap dripping since Monday."'));
    const { summary } = await createClaudeSummariser({ apiKey: API_KEY, fetch: stub.fetch }).summarise(input);

    expect(summary).toBe('Kitchen tap dripping since Monday.');
    const request = stub.requests[0]!;
    expect(request.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request.headers.get('x-api-key')).toBe(API_KEY);
    const body = (await request.json()) as { model: string; system: string; messages: { content: string }[] };
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.system).toMatch(/Never add names, prices/);
    expect(JSON.parse(body.messages[0]!.content)).toEqual(input);
  });

  test('clamps a long reply to 160 characters', async () => {
    const stub = stubFetch(() => reply('x'.repeat(300)));
    const { summary } = await createClaudeSummariser({ apiKey: API_KEY, fetch: stub.fetch }).summarise(input);
    expect(summary).toHaveLength(160);
  });

  test('throws on a failure or an empty reply, without the key or URL', async () => {
    const failing = stubFetch(() => json({ error: 'bad' }, 500));
    const error = await createClaudeSummariser({ apiKey: API_KEY, fetch: failing.fetch }).summarise(input).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/test-anthropic-key|anthropic\.com/);

    const empty = stubFetch(() => json({ content: [] }));
    await expect(createClaudeSummariser({ apiKey: API_KEY, fetch: empty.fetch }).summarise(input)).rejects.toThrow(/malformed/);
  });
});

describe('mock summariser', () => {
  test('is the first sentence plus the location', async () => {
    expect(await mockSummariser.summarise(input)).toEqual({ summary: 'The kitchen tap is dripping (Kitchen sink)' });
  });

  test('trims to 120 characters and omits an unknown location', async () => {
    const { summary } = await mockSummariser.summarise({ ...input, description: 'a'.repeat(200), answers: { location: null, started: null, worsening: null } });
    expect(summary).toBe(`${'a'.repeat(119)}…`);
  });
});
