// The Classifier port over Jev's HTTP API.
//
// Assumed contract, confirm against Jev docs: Jev is in limited early access and
// its real wire format isn't published yet. This adapter assumes
//   POST {baseUrl}/v1/classify   authorization: Bearer <apiKey>
//   { "state": { "message": "...", ...state }, "questions": [{ "id": "...", "options": ["..."] }] }
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
        body: { state: { message: text, ...state }, questions: questions.map(({ id, options }) => ({ id, options })) },
      });
      return readAnswers(body, questions);
    },
  };
}

/**
 * Jev's answers keyed by question id. An answer to a question that wasn't asked is
 * ignored; a question left unanswered is missing, which the app treats as unsure.
 */
function readAnswers(body: unknown, questions: ClassifierQuestion[]): Record<string, ClassifierAnswer> {
  if (!isObject(body) || !Array.isArray(body.answers)) malformed(SERVICE, 'no answers list', body);
  const options = new Map(questions.map((q) => [q.id, q.options]));
  const answers: Record<string, ClassifierAnswer> = {};
  for (const item of body.answers as unknown[]) {
    if (!isObject(item) || typeof item.questionId !== 'string' || typeof item.answer !== 'string' || typeof item.confidence !== 'number') {
      malformed(SERVICE, 'an answer without questionId, answer and confidence', body);
    }
    const { questionId, answer, confidence } = item as { questionId: string; answer: string; confidence: number };
    const allowed = options.get(questionId);
    if (!allowed) continue;
    if (!allowed.includes(answer)) malformed(SERVICE, `'${answer}' is not an option for ${questionId}`, body);
    if (!(confidence >= 0 && confidence <= 1)) malformed(SERVICE, `confidence ${confidence} for ${questionId}`, body);
    answers[questionId] = { answer, confidence };
  }
  return answers;
}
