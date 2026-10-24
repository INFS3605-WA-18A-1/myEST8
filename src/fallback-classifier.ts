// Jev classifies, and Claude is asked only when Jev throws (ADR 0011, with the
// fallback the hosted app needs while Jev is still new). A thrown error is an
// outage, a 4xx or 5xx, or a malformed answer. Claude's own failure is left to
// throw, so the worker retries.

import type { Classifier } from './ports.ts';

/** Tries `primary` and, when that throws, logs the error and asks `fallback`. */
export function createFallbackClassifier(
  primary: Classifier,
  fallback: Classifier,
  options: { redact?: string; log?: (line: string) => void } = {},
): Classifier {
  const log = options.log ?? ((line) => console.error(line));
  return {
    async classify(input) {
      try {
        return await primary.classify(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const safe = options.redact ? message.replaceAll(options.redact, '[redacted]') : message;
        log(`Jev classify failed, asking Claude instead: ${safe}`);
        return fallback.classify(input);
      }
    },
  };
}
