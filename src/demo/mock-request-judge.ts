// The demo's stand-in for Jev on the maintenance-request questions
// (src/adapters/jev-request-judge.ts). A dripping tap or a blown globe is minor;
// a flood, a broken lock or no hot water is not. Words a Tenant uses about
// something they did ("I broke", "kicked") raise the chance they caused it.
// Deterministic, so a demo plays out the same way every time.

import { isObject } from '../adapters/json-api.ts';

const MINOR = /\b(drip|dripping|globe|handle|squeak|paint|scratch|cosmetic|loose|rattle)\b/i;
const SERIOUS = /\b(flood|flooding|spark|sparks|gas|lock|locked|sewage|smoke|pouring|power point|no hot water)\b/i;
const CAUSED = /\b(i broke|we broke|kicked|punched|forgot|left the|my fault|accidentally)\b/i;

const textOf = (request: Record<string, unknown>) => `${typeof request.description === 'string' ? request.description : ''} ${typeof request.summary === 'string' ? request.summary : ''}`;

/**
 * Answers for a System One call whose questions are `minor_<id>` Scores and
 * `caused_<id>` Nouls. The caller has checked that shape. Level 0 is the most
 * minor, matching the adapter's levels.
 */
export function mockRequestAnswers(state: Record<string, unknown>, questions: Record<string, unknown>) {
  const requests = Array.isArray(state.requests) ? state.requests.filter(isObject) : [];
  const byId = new Map(requests.map((request) => [String(request.id), request]));
  const answers: Record<string, unknown> = {};
  for (const name of Object.keys(questions)) {
    const id = name.replace(/^(minor_|caused_)/, '');
    const text = textOf(byId.get(id) ?? {});
    if (name.startsWith('minor_')) {
      const level = MINOR.test(text) ? 0 : SERIOUS.test(text) ? 2 : 1;
      const probabilities = [0, 1, 2].map((index) => (index === level ? 1 : 0));
      answers[name] = {
        type: 'score',
        score: level,
        confidence: 1,
        legend: {},
        probabilities: Object.fromEntries(probabilities.map((probability, index) => [String(index), probability])),
      };
    } else {
      answers[name] = { type: 'noul', noul: CAUSED.test(text) ? 0.9 : 0.05 };
    }
  }
  return { model: 'jev-mock', answers };
}
