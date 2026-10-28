// The demo's stand-in for Jev on the job-fit question (src/adapters/jev-job-fit.ts):
// a Score on four levels, answered from the words the Job shares with the Tradie's
// past jobs and Google listing. Deterministic, so a demo plays out the same way every time.

/** Words too common in repair descriptions to say two jobs are alike. */
const COMMON = new Set(['about', 'after', 'again', 'because', 'been', 'from', 'have', 'into', 'just', 'kitchen', 'more', 'needs', 'repair', 'since', 'some', 'that', 'there', 'they', 'this', 'very', 'when', 'with', 'work']);

/** The distinct words of four letters or more, lowercased and without a plural "s" ("systems" is "system"), leaving out the common ones. */
function words(text: string) {
  return new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !COMMON.has(w)).map((w) => w.replace(/s$/, '')));
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join(' ') : value && typeof value === 'object' ? Object.values(value).map(text).join(' ') : '';

/**
 * The answer to a System One request with one `job_fit` Score question: "this same kind of
 * repair" when the Tradie's record shares two or more words with the Job, "closely related"
 * for one, and "Trade only" for none. The caller has checked the question's shape.
 */
export function mockJobFitAnswers(state: Record<string, unknown>) {
  const job = state.job as Record<string, unknown> | undefined;
  const tradie = state.tradie as Record<string, unknown> | undefined;
  const asked = words(text([job?.summary, job?.description, job?.location]));
  const record = words(text([tradie?.pastJobs, tradie?.listing]));
  const shared = [...asked].filter((w) => record.has(w)).length;
  const probabilities = shared >= 2 ? [0.02, 0.08, 0.2, 0.7] : shared === 1 ? [0.05, 0.2, 0.65, 0.1] : [0.1, 0.75, 0.1, 0.05];
  const score = probabilities.reduce((sum, p, level) => sum + p * level, 0);
  return {
    model: 'jev-mock',
    answers: {
      job_fit: { type: 'score', score, confidence: Math.max(...probabilities), probabilities: Object.fromEntries(probabilities.map((p, level) => [String(level), p])) },
    },
  };
}
