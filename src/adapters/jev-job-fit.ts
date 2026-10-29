// The JobFitJudge port over Jev, TypeSafe's System One model.
//
//   POST {baseUrl}/v1/systemone   authorization: Bearer <apiKey>
//   { "model": "jev-latest", "state": { "job": {...}, "tradie": {...} },
//     "questions": { "job_fit": { "type": "score", "instructions": "...", "criteria": ["...", ...] } } }
//   -> { "answers": { "job_fit": { "type": "score", "score": 0-3, "confidence": 0-1, ... } } }
//
// https://docs.typesafe.ai/api.md. A Score answers with the probability-weighted
// position on its ordered levels, so it can fall between two. One Tradie per
// request (TypeSafe's re-ranking cookbook): no judgment sees another Tradie, so
// each score means the same thing however many are compared. Only this file knows
// TypeSafe's format; like the Trade suggester it shares no code with the classifier.

import type { JobFitJudge } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

const SERVICE = 'Jev';
/** The alias TypeSafe points at its newest Jev. */
const MODEL = 'jev-latest';
const QUESTION = 'job_fit';

/**
 * The levels, lowest first. Each describes what the evidence shows, so it stands on
 * its own: Jev judges them one by one and never sees their numbers.
 */
const LEVELS = [
  'Nothing in `tradie.pastJobs` or `tradie.listing` relates to the repair described in `job`.',
  "The Tradie works in the Job's Trade, but nothing in `tradie.pastJobs` or `tradie.listing` shows this kind of repair.",
  "`tradie.pastJobs` or `tradie.listing` show closely related repairs: work on the same fixture, appliance or system as the repair in `job`.",
  '`tradie.pastJobs` or `tradie.listing` show this same kind of repair as the one described in `job`.',
];

const INSTRUCTIONS =
  'A Property Manager is choosing Tradies to quote on the repair described in `job` (its `summary`, the Tenant\'s `description` and the `location` in the home). ' +
  'How closely does the work this Tradie has done before (`tradie.pastJobs`, each with the job\'s summary and the scope of work they quoted) or advertises (`tradie.listing`) match that repair? ' +
  'Judge the kind of work only: not price, ratings or the business name.';

/** The JobFitJudge port over Jev's HTTP API. */
export function createJevJobFitJudge({ baseUrl, apiKey, fetch: fetchImpl = fetch }: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): JobFitJudge {
  return {
    async judge(evidence) {
      try {
        const body = await callJson(fetchImpl, SERVICE, `${baseUrl.replace(/\/+$/, '')}/v1/systemone`, {
          headers: { authorization: `Bearer ${apiKey}` },
          body: { model: MODEL, state: evidence, questions: { [QUESTION]: { type: 'score', instructions: INSTRUCTIONS, criteria: LEVELS } } },
        });
        return readFit(body);
      } catch (error) {
        throw withoutKey(error, apiKey);
      }
    },
  };
}

/** The score and confidence of Jev's answer. A missing answer, or one that isn't a score on the levels with a confidence from 0 to 1, throws. */
function readFit(body: unknown) {
  if (!isObject(body) || !isObject(body.answers)) malformed(SERVICE, 'no answers', body);
  const reply = body.answers[QUESTION];
  if (!isObject(reply) || reply.type !== 'score') malformed(SERVICE, 'no score for job_fit', body);
  const { score, confidence } = reply;
  if (typeof score !== 'number' || !(score >= 0 && score <= LEVELS.length - 1)) malformed(SERVICE, `score ${String(score)}`, body);
  if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) malformed(SERVICE, `confidence ${String(confidence)}`, body);
  return { score, confidence };
}

/** An error without the API key, should the service echo it back in an error body. */
function withoutKey(error: unknown, apiKey: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(apiKey ? message.replaceAll(apiKey, '[redacted]') : message);
}
