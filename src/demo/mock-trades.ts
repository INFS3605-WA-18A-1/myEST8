// The demo's stand-in for Jev on the Trade questions asked about a Google listing
// (src/adapters/jev-trades.ts): one Noul per Trade, answered from keywords in the
// listing's name, types, description and website. Deterministic, so a demo plays
// out the same way every time.

import { TRADES, type Trade } from '../shared.ts';

const LIKELY = 0.9;
const UNLIKELY = 0.1;

/** Where a Trade's words start a word in the listing: "plumb" is plumbing, plumber and plumbers. */
const TRADE_WORDS: Record<Trade, RegExp> = {
  plumbing: /\b(plumb|pipes?\b|drain|hot water|gas fit)/,
  electrical: /\b(electric|spark|wiring|power points?\b|switchboard)/,
  carpentry: /\b(carpent|joiner|joinery|cabinet|decks?\b)/,
  roofing: /\b(roof|gutter)/,
  appliances: /\b(appliance|dishwasher|washing machine|fridge|oven|air con)/,
  locksmith: /\block(smith|s)?\b/,
  pest_control: /\b(pest|termite|bugs?\b|rodent)/,
  general_handyman: /\b(handy|odd jobs)/,
};

/** The listing's words, lowercased, with "_", "-" and "." between them as spaces ("home_appliance_repair_service" is four words). */
function readListing(state: Record<string, unknown>) {
  const parts = [state.name, state.types, state.primaryTypeDisplayName, state.editorialSummary, state.website].flat();
  return parts
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ');
}

/**
 * The answer to a System One request of Noul questions named for Trades: each is
 * likely when the listing has a word of that Trade, and unlikely when it doesn't.
 * The caller has checked that every question is a noul about a Trade.
 */
export function mockTradeAnswers(state: Record<string, unknown>, questions: Record<string, unknown>) {
  const text = readListing(state);
  return {
    answers: Object.fromEntries(
      Object.keys(questions).map((name) => [name, { type: 'noul', noul: TRADE_WORDS[name as Trade].test(text) ? LIKELY : UNLIKELY }]),
    ),
  };
}

/** Whether `name` is one of the Trades a question can be about. */
export const isTrade = (name: string): name is Trade => (TRADES as readonly string[]).includes(name);
