// The Classifier port over Jev, TypeSafe's System One model.
//
//   POST {baseUrl}/v1/systemone   authorization: Bearer <apiKey>
//   { "model": "jev-latest", "state": { ...state, "message": "..." },
//     "questions": { "<name>": { "type": "choice", "instructions": "...", "criteria": { "<option>": "<when it applies>" } } } }
//   -> { "model": "...", "answers": { "<name>": { "type": "choice", "choice": "...", "confidence": 0-1, "probabilities": { ... } } }, "usage": { ... } }
//
// https://docs.typesafe.ai/api.md and /primitives/choice.md. Only this file
// knows TypeSafe's format.

import type { Classifier, ClassifierAnswer, ClassifierQuestion } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

const SERVICE = 'Jev';
/** The alias TypeSafe points at its newest Jev. */
const MODEL = 'jev-latest';

/** The Classifier port over Jev's HTTP API. */
export function createJevClassifier({ baseUrl, apiKey, fetch: fetchImpl = fetch }: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): Classifier {
  return {
    async classify({ text, state, questions }) {
      // A question with a single option has one possible answer, which needs no judging
      // (and gives Jev's confidence nothing to measure), so only the others are asked.
      const asked = questions.filter((q) => q.options.length > 1);
      const answers = asked.length ? await ask(asked) : {};
      return Object.fromEntries(questions.map((q) => [q.id, answers[q.id] ?? only(q)]));

      async function ask(asked: ClassifierQuestion[]) {
        const names = safeNames(asked.map((q) => q.id));
        try {
          const body = await callJson(fetchImpl, SERVICE, `${baseUrl.replace(/\/+$/, '')}/v1/systemone`, {
            headers: { authorization: `Bearer ${apiKey}` },
            body: {
              model: MODEL,
              state: { ...state, message: text },
              questions: Object.fromEntries(asked.map((q) => [names.get(q.id)!, choiceQuestion(q)])),
            },
          });
          return readAnswers(body, asked, names);
        } catch (error) {
          throw withoutKey(error, apiKey);
        }
      }
    },
  };
}

/**
 * The name each question is sent under. TypeSafe doesn't say which characters a
 * question name may have, and ours include colons (`answer:guided`), so anything
 * but letters, digits and underscores becomes an underscore. Names that end up
 * the same get a number after them.
 */
function safeNames(ids: string[]): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const id of ids) {
    const base = id.replace(/[^A-Za-z0-9_]/g, '_');
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
    taken.add(name);
    names.set(id, name);
  }
  return names;
}

/** A question as a TypeSafe `choice`: its instructions, and each option with when it applies. */
function choiceQuestion({ instructions, options }: ClassifierQuestion) {
  return { type: 'choice', instructions, criteria: Object.fromEntries(options.map((o) => [o.name, o.when])) };
}

/** The answer to a question with fewer than two options: its one option, for certain. */
const only = ({ options }: ClassifierQuestion): ClassifierAnswer => (options.length === 1 ? { answer: options[0]!.name, confidence: 1 } : unsure(options));

/** The answer reported for a question Jev couldn't answer: an option meaning "neither", when the question has one. */
const UNSURE_OPTIONS = ['not_an_answer', 'none', 'other'];
const unsure = (options: ClassifierQuestion['options']): ClassifierAnswer => ({
  answer: options.find((o) => UNSURE_OPTIONS.includes(o.name))?.name ?? options[0]?.name ?? '',
  confidence: 0,
});

/**
 * One answer per question asked, keyed by question id. A question Jev left
 * unanswered, or answered with something that isn't one of its options, gets
 * confidence 0, so intake sends the message to the inbox rather than act on it.
 * An answer to a question that wasn't asked is ignored. An answer that isn't a
 * choice with a confidence from 0 to 1, or a response without answers, throws,
 * so the worker retries.
 */
function readAnswers(body: unknown, questions: ClassifierQuestion[], names: Map<string, string>): Record<string, ClassifierAnswer> {
  if (!isObject(body) || !isObject(body.answers)) malformed(SERVICE, 'no answers', body);
  const answers = body.answers;
  return Object.fromEntries(
    questions.map(({ id, options }) => {
      const reply = answers[names.get(id)!];
      if (reply === undefined) return [id, unsure(options)];
      if (!isObject(reply) || reply.type !== 'choice' || typeof reply.choice !== 'string') malformed(SERVICE, `an answer for ${id} that is not a choice`, body);
      const { choice, confidence } = reply as { choice: string; confidence: unknown };
      if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) malformed(SERVICE, `confidence ${confidence} for ${id}`, body);
      return [id, options.some((o) => o.name === choice) ? { answer: choice, confidence } : unsure(options)];
    }),
  );
}

/** An error without the API key, should the service echo it back in an error body. */
function withoutKey(error: unknown, apiKey: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(apiKey ? message.replaceAll(apiKey, '[redacted]') : message);
}
