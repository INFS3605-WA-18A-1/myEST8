// The TradeSuggester port over Jev, TypeSafe's System One model.
//
//   POST {baseUrl}/v1/systemone   authorization: Bearer <apiKey>
//   { "model": "jev-latest", "state": { ...the listing },
//     "questions": { "<trade>": { "type": "noul", "instructions": "...", "criteria": { "true": "...", "false": "..." } } } }
//   -> { "answers": { "<trade>": { "type": "noul", "noul": 0-1 } } }
//
// https://docs.typesafe.ai/api.md. A Noul answers with the probability that its
// question's answer is true. Only this file knows TypeSafe's format, and it
// doesn't share code with the classifier adapter (src/adapters/jev.ts): that one
// asks choice questions, and this one asks a noul per Trade.

import type { ListingDetails, TradeSuggester } from '../ports.ts';
import { TRADES, type Trade } from '../shared.ts';
import { callJson, isObject, malformed } from './json-api.ts';

const SERVICE = 'Jev';
/** The alias TypeSafe points at its newest Jev. */
const MODEL = 'jev-latest';
/** A Trade is suggested when Jev puts the chance that the business does it at this or above. */
const THRESHOLD = 0.5;

/** What each Trade is, in the words Jev is asked about. */
const WORK: Record<Trade, string> = {
  plumbing: 'plumbing (taps, pipes, drains, hot water systems, gas fitting)',
  electrical: 'electrical work (wiring, power points, switchboards, lighting)',
  carpentry: 'carpentry (doors, decks, cabinets, joinery)',
  roofing: 'roofing (roof repairs, re-roofing, gutters)',
  appliances: 'appliance repair (ovens, dishwashers, washing machines, fridges, air conditioners)',
  locksmith: 'locksmith work (locks, keys, lock-outs)',
  pest_control: 'pest control (insects, rodents, termites)',
  general_handyman: 'general handyman work (odd jobs and small repairs of many kinds)',
};

/** The TradeSuggester port over Jev's HTTP API. */
export function createJevTradeSuggester({ baseUrl, apiKey, fetch: fetchImpl = fetch }: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): TradeSuggester {
  return {
    async suggestTrades(listing) {
      try {
        // One question per Trade, asked together: a business can do several.
        const body = await callJson(fetchImpl, SERVICE, `${baseUrl.replace(/\/+$/, '')}/v1/systemone`, {
          headers: { authorization: `Bearer ${apiKey}` },
          body: { model: MODEL, state: stateOf(listing), questions: Object.fromEntries(TRADES.map((trade) => [trade, noulQuestion(trade)])) },
        });
        return readSuggestions(body);
      } catch (error) {
        throw withoutKey(error, apiKey);
      }
    },
  };
}

/** What Jev is told about the business: the parts of its listing that say what it does, under Google's names for them. */
function stateOf(listing: ListingDetails) {
  return {
    name: listing.name,
    types: listing.types,
    primaryTypeDisplayName: listing.primaryType,
    editorialSummary: listing.summary,
    website: listing.website,
  };
}

/** A Trade as a TypeSafe `noul`: the chance that the business does that work. */
function noulQuestion(trade: Trade) {
  return {
    type: 'noul',
    instructions: `Does the business described in the state do ${WORK[trade]}? A business can do several kinds of work: judge this kind only, from its name, types and description.`,
    criteria: {
      true: `The business's name, types or description say it does ${WORK[trade]}.`,
      false: `Nothing in the business's name, types or description says it does ${WORK[trade]}.`,
    },
  };
}

/**
 * The Trades Jev puts at or above the threshold, in the order of the Trade list. A
 * Trade Jev left unanswered isn't suggested, and an answer to a Trade that wasn't
 * asked is ignored. An answer that isn't a noul from 0 to 1, or a response without
 * answers, throws.
 */
function readSuggestions(body: unknown): Trade[] {
  if (!isObject(body) || !isObject(body.answers)) malformed(SERVICE, 'no answers', body);
  const answers = body.answers;
  return TRADES.filter((trade) => {
    const reply = answers[trade];
    if (reply === undefined) return false;
    if (!isObject(reply) || reply.type !== 'noul') malformed(SERVICE, `an answer for ${trade} that is not a noul`, body);
    const { noul } = reply;
    if (typeof noul !== 'number' || !(noul >= 0 && noul <= 1)) malformed(SERVICE, `noul ${String(noul)} for ${trade}`, body);
    return noul >= THRESHOLD;
  });
}

/** An error without the API key, should the service echo it back in an error body. */
function withoutKey(error: unknown, apiKey: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(apiKey ? message.replaceAll(apiKey, '[redacted]') : message);
}
