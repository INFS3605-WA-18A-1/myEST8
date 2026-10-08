// The QuoteReader port over a model's HTTP endpoint.
//
// No model has been chosen yet, so this is the app's own contract for a small
// gateway service that fronts whichever model is picked. It sends the current
// time and the Agency's time zone so the model can turn "Tuesday 9am" into an instant:
//   POST {baseUrl}/v1/quote-read   authorization: Bearer <apiKey>
//   { "text": "...", "pdf": "<base64, optional>", "now": "<ISO>", "timeZone": "Australia/Sydney" }
//   -> { "priceCents": 45000 | null, "proposedTime": "<ISO>" | null }

import type { Clock, QuoteReader } from '../ports.ts';
import { callJson, isObject, malformed, toBase64 } from './json-api.ts';

const SERVICE = 'Quote reader';

/** The QuoteReader port over a model's HTTP endpoint. `clock` and `timeZone` let it read "Tuesday 9am". */
export function createQuoteReader({
  baseUrl,
  apiKey,
  clock,
  timeZone,
  fetch: fetchImpl = fetch,
}: {
  baseUrl: string;
  apiKey: string;
  clock: Clock;
  timeZone: string;
  fetch?: typeof fetch;
}): QuoteReader {
  return {
    async read({ text, pdf }) {
      const body = await callJson(fetchImpl, SERVICE, `${baseUrl}/v1/quote-read`, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: { text, ...(pdf ? { pdf: toBase64(pdf) } : {}), now: clock.now().toISOString(), timeZone },
      });
      if (!isObject(body)) malformed(SERVICE, 'expected an object', body);
      const { priceCents, proposedTime } = body;
      // A missing field reads the same as null: the reply didn't say.
      if (priceCents != null && !(Number.isSafeInteger(priceCents) && (priceCents as number) >= 0)) {
        malformed(SERVICE, 'priceCents is not a whole number of cents', body);
      }
      const time = proposedTime == null ? null : typeof proposedTime === 'string' ? new Date(proposedTime) : null;
      if (proposedTime != null && (time === null || Number.isNaN(time.getTime()))) malformed(SERVICE, 'proposedTime is not an ISO time', body);
      return {
        ...(priceCents != null ? { priceCents: priceCents as number } : {}),
        ...(time ? { proposedTime: time } : {}),
      };
    },
  };
}
