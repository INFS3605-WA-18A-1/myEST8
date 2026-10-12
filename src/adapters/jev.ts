// The Classifier port over Jev's HTTP API.
//
// Assumed contract, confirm against Jev docs: Jev is in limited early access and
// its real wire format isn't published yet. This adapter assumes
//   POST {baseUrl}/v1/classify   authorization: Bearer <apiKey>
//   { "state": { ...state, "message": "..." }, "questions": [{ "id": "...", "options": ["..."] }] }
//   -> { "answers": [{ "questionId": "...", "answer": "...", "confidence": 0.0-1.0 }] }
// Only this file knows Jev's format, so a correction stays here.

import type { Classifier, ClassifierAnswer, ClassifierQuestion } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

const SERVICE = 'Jev';

/** The Classifier port over Jev's HTTP API. */
export function createJevClassifier({ baseUrl, apiKey, fetch: fetchImpl = fetch }: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): Classifier {
  return {
    async classify({ text, state, questions }) {
      const body = await callJson(fetchImpl, SERVICE, `${baseUrl}/v1/classify`, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: { state: { ...state, message: text }, questions: questions.map(({ id, options }) => ({ id, options })) },
      });
      return readAnswers(body, questions);
    },
  };
}

/** The answer reported for a question Jev couldn't answer: an option meaning "neither", when the question has one. */
const UNSURE_OPTIONS = ['not_an_answer', 'none', 'other'];
const unsure = (options: readonly string[]): ClassifierAnswer => ({
  answer: UNSURE_OPTIONS.find((o) => options.includes(o)) ?? options[0] ?? '',
  confidence: 0,
});

/**
 * One answer per question asked, keyed by question id. A question Jev left
 * unanswered, or answered with something that isn't one of its options, gets
 * confidence 0, so intake sends the message to the inbox rather than act on it.
 * An answer to a question that wasn't asked is ignored. A response that isn't
 * shaped like Jev's throws, so the worker retries.
 */
function readAnswers(body: unknown, questions: ClassifierQuestion[]): Record<string, ClassifierAnswer> {
  if (!isObject(body) || !Array.isArray(body.answers)) malformed(SERVICE, 'no answers list', body);
  const given = new Map<string, { answer: string; confidence: number }>();
  for (const item of body.answers as unknown[]) {
    if (!isObject(item) || typeof item.questionId !== 'string' || typeof item.answer !== 'string' || typeof item.confidence !== 'number') {
      malformed(SERVICE, 'an answer without questionId, answer and confidence', body);
    }
    const { questionId, answer, confidence } = item as { questionId: string; answer: string; confidence: number };
    if (!(confidence >= 0 && confidence <= 1)) malformed(SERVICE, `confidence ${confidence} for ${questionId}`, body);
    given.set(questionId, { answer, confidence });
  }
  return Object.fromEntries(
    questions.map(({ id, options }) => {
      const reply = given.get(id);
      return [id, reply && options.includes(reply.answer) ? reply : unsure(options)];
    }),
  );
}
