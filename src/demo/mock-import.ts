// The demo's stand-in for Jev on the spreadsheet import's questions: what a
// heading the import didn't recognise holds (importColumn), and a Tradie's Trade
// (importTrade). Rules read the heading and its sample values, or the Tradie's
// business name and notes. Deterministic, so a demo upload plays out the same way.

import { IGNORE, IMPORT_QUESTIONS, readDate, readEmail, readMobile, readMoney, readTrades } from '../imports.ts';
import type { ClassifierAnswer } from '../ports.ts';

const SURE = 0.85;
const UNSURE = 0.5;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Business-name words the Trade list doesn't have ("Bright Sparks", "Kool Air"). */
const NAME_WORDS: [trade: string, pattern: RegExp][] = [
  ['electrical', /\b(sparks?|volt|wired?|power)\b/i],
  ['plumbing', /\b(pipes?|taps?|flow|drip|leak)\b/i],
  ['appliances', /\b(air|cool|kool|fridge|appliance)\b/i],
  ['pest_control', /\b(bugs?|termite|pest)\b/i],
  ['locksmith', /\b(keys?|secure|security)\b/i],
  ['roofing', /\b(roof|gutter)/i],
  ['carpentry', /\b(timber|wood|joinery)\b/i],
  ['general_handyman', /\b(fix|handy|odd jobs|maintenance)\b/i],
];

/** A Trade from the business name, Trades text and notes. Unsure when nothing names one. */
function trade(state: Record<string, unknown>, heading: string, options: readonly string[]): ClassifierAnswer {
  const all = [heading, text(state.businessName), text(state.trades), text(state.notes)].join(', ');
  const read = readTrades(all)[0] ?? NAME_WORDS.find(([, pattern]) => pattern.test(all))?.[0];
  return read && options.includes(read) ? { answer: read, confidence: SURE } : { answer: options.includes('general_handyman') ? 'general_handyman' : options[0]!, confidence: UNSURE };
}

/** What a column holds, judged by its sample values, then its heading. */
function column(state: Record<string, unknown>, heading: string, options: readonly string[]): ClassifierAnswer {
  const samples = strings(state.samples);
  const h = heading.toLowerCase();
  const owner = /owner|landlord|lessor/.test(h);
  const most = (test: (s: string) => boolean) => samples.length > 0 && samples.filter(test).length / samples.length >= 0.6;
  const pick = (...fields: string[]): ClassifierAnswer | null => {
    const field = fields.find((f) => options.includes(f));
    return field ? { answer: field, confidence: SURE } : null;
  };

  const found =
    (most((s) => !!readEmail(s)) && (owner ? pick('ownerEmail', 'email') : pick('email', 'ownerEmail'))) ||
    (most((s) => !!readMobile(s)) && (owner ? pick('ownerMobile', 'mobile') : pick('mobile', 'ownerMobile'))) ||
    (most((s) => !!readDate(s)) && pick('tenancyStart')) ||
    (most((s) => /\$/.test(s) && readMoney(s) !== null) && pick('maxRepairCost')) ||
    (most((s) => readTrades(s).length > 0) && pick('trades')) ||
    (/\b(st|street|rd|road|ave|avenue)\b/i.test(samples.join(' ')) && pick('address', 'property')) ||
    (/limit|approv|spend/.test(h) && pick('maxRepairCost')) ||
    (owner && pick('ownerName', 'name')) ||
    (/comment|remark|info/.test(h) && pick('notes'));
  if (found) return found;
  // Codes and references ("P-17", "#2041") are confidently nothing of ours; anything else is left to the Property Manager.
  if (most((s) => /^[#A-Z]*-?\d+$/i.test(s.trim()))) return { answer: IGNORE, confidence: SURE };
  return { answer: options.includes(IGNORE) ? IGNORE : options[0]!, confidence: UNSURE };
}

/**
 * Answers an import question in the shape mockClassify returns, or undefined for
 * any other question. `state` is what the Jev adapter sends: the text as `message`.
 */
export function mockImportAnswer(questionId: string, state: unknown, options: readonly string[]): ClassifierAnswer | undefined {
  const s = isObject(state) ? state : {};
  const heading = text(s.message);
  if (questionId === IMPORT_QUESTIONS.column) return column(s, heading, options);
  if (questionId === IMPORT_QUESTIONS.trade) return trade(s, heading, options);
  return undefined;
}
