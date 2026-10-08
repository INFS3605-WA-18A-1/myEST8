// The ImageMatcher port over a vision-model gateway.
//
// No vision model has been chosen yet, so this is the app's own contract for a
// small gateway service that fronts whichever model is picked:
//   POST {baseUrl}/v1/image-match   authorization: Bearer <apiKey>
//   { "description": "...", "photos": [{ "contentType": "image/jpeg", "data": "<base64>" }] }
//   -> { "result": "matches" | "does_not_match" | "unclear", "reason": "one line for the Property Manager" }

import type { ImageMatcher, ImageMatchResult } from '../ports.ts';
import { callJson, isObject, malformed, toBase64 } from './json-api.ts';

const SERVICE = 'Image matcher';
const RESULTS: readonly string[] = ['matches', 'does_not_match', 'unclear'] satisfies ImageMatchResult[];

/** The ImageMatcher port over a vision model's HTTP endpoint. */
export function createImageMatcher({ baseUrl, apiKey, fetch: fetchImpl = fetch }: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): ImageMatcher {
  return {
    async match({ description, photos }) {
      const body = await callJson(fetchImpl, SERVICE, `${baseUrl}/v1/image-match`, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: { description, photos: photos.map((p) => ({ contentType: p.contentType, data: toBase64(p.content) })) },
      });
      if (!isObject(body) || typeof body.result !== 'string' || !RESULTS.includes(body.result) || typeof body.reason !== 'string') {
        malformed(SERVICE, 'expected result and reason', body);
      }
      return { result: body.result as ImageMatchResult, reason: body.reason };
    },
  };
}
