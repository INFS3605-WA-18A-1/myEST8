import { describe, expect, test } from 'vitest';
import { createFallbackClassifier } from '../../src/fallback-classifier.ts';
import type { Classifier, ClassifierAnswer } from '../../src/ports.ts';

const input = {
  text: 'The tap is leaking',
  state: { senderRole: 'tenant' },
  questions: [{ id: 'urgency', instructions: 'How soon?', options: [{ name: 'routine', when: 'Can wait' }] }],
};

const answers = (answer: string): Record<string, ClassifierAnswer> => ({ urgency: { answer, confidence: 0.9 } });

const classifier = (reply: Record<string, ClassifierAnswer> | Error): Classifier & { calls: number } => {
  const fake = {
    calls: 0,
    async classify() {
      fake.calls++;
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return fake;
};

describe('Jev with Claude as the fallback', () => {
  test('uses Jev’s answers and does not ask Claude', async () => {
    const jev = classifier(answers('high'));
    const claude = classifier(answers('routine'));
    const logs: string[] = [];
    const fallback = createFallbackClassifier(jev, claude, { log: (line) => logs.push(line) });

    expect(await fallback.classify(input)).toEqual(answers('high'));
    expect(jev.calls).toBe(1);
    expect(claude.calls).toBe(0);
    expect(logs).toEqual([]);
  });

  test('when Jev throws, logs the failure with the key redacted and uses Claude’s answers', async () => {
    const jev = classifier(new Error('Jev returned 503: bearer jev-secret is down'));
    const claude = classifier(answers('routine'));
    const logs: string[] = [];
    const fallback = createFallbackClassifier(jev, claude, { redact: 'jev-secret', log: (line) => logs.push(line) });

    expect(await fallback.classify(input)).toEqual(answers('routine'));
    expect(claude.calls).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/Jev/);
    expect(logs[0]).toMatch(/503/);
    expect(logs[0]).not.toContain('jev-secret');
  });
});
