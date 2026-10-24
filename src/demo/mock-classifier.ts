// The demo's stand-in for Jev: keyword rules that answer whatever questions the
// app asks, reading the same state the app sends to the real classifier. It
// speaks TypeSafe's System One format (src/adapters/jev.ts) but ignores the
// instructions and criteria wording: it reads the option names and the state's
// `message`. It is deterministic so a demo script plays out the same way every time.

import type { ClassifierAnswer } from '../ports.ts';
import { AVAILABILITY, type Availability } from '../shared.ts';
import { mockImportAnswer } from './mock-import.ts';

interface Item {
  ref: string;
  summary: string;
}

/** One message as the rules see it: normalised text plus the state the app sent. */
interface Reading {
  /** Lowercased, apostrophes dropped ("can't" -> "cant"), whitespace collapsed. */
  text: string;
  senderRole: string;
  hasAttachments: boolean;
  /** A Tenant's Property's open items. */
  openItems: Item[];
  /** Items waiting on a Tradie or Property Owner. */
  waitingItems: Item[];
  /** A Tenant's answers to the guided questions, when Urgency and Trade are classified again. */
  guidedAnswers: Record<string, string>;
}

type Rule = (reading: Reading, options: readonly string[]) => ClassifierAnswer;

const SURE = 0.9;
const LIKELY = 0.8;
const GUESS = 0.6;
const UNSURE = 0.5;

const answer = (value: string, confidence = SURE): ClassifierAnswer => ({ answer: value, confidence });

// --- Reading text ---

function normalise(text: string) {
  return text.toLowerCase().replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim();
}

/** Whether `text` contains any of the phrases as whole words. */
function mentions(text: string, phrases: readonly string[]) {
  return phrases.some((phrase) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}($|[^a-z0-9])`).test(text));
}

const escapeRegExp = (phrase: string) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STOPWORDS = new Set([
  'about', 'again', 'also', 'been', 'could', 'from', 'have', 'here', 'into', 'just', 'please', 'should', 'some', 'still',
  'thank', 'thanks', 'that', 'their', 'them', 'there', 'they', 'this', 'very', 'were', 'what', 'when', 'where', 'which',
  'will', 'with', 'would', 'your', 'hello', 'reported', 'issue', 'ticket', 'urgent', 'repair', 'waiting', 'receipt',
  'gathering', 'checking', 'awaiting', 'photos', 'maintenance', 'request',
]);

/** Words of four letters or more that carry meaning, lightly stemmed ("leaking" -> "leak"). */
function significantWords(text: string) {
  const words = normalise(text).match(/[a-z]{4,}/g) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)).map((w) => w.replace(/(ing|ed|s)$/, '')));
}

function sharedWords(text: string, summary: string) {
  const summaryWords = significantWords(summary);
  return [...significantWords(text)].filter((w) => summaryWords.has(w)).length;
}

const wordCount = (text: string) => (text ? text.split(' ').length : 0);

// --- Urgency ---

const URGENT_WORDS = [
  'gas', 'flood', 'flooding', 'flooded', 'burst', 'sewage', 'fire', 'smoke', 'sparks', 'sparking', 'no power',
  'power is out', 'no hot water', 'no water', 'pouring', 'broken lock', 'lock is broken', 'cant lock', 'wont lock',
  'break-in', 'break in', 'broken into',
];
const HIGH_WORDS = ['leak', 'leaks', 'leaking', 'mould', 'mold', 'mouldy', 'water damage', 'getting worse', 'worsening', 'crack', 'cracked', 'cracks'];
/** Signs of a possible hazard that keywords can't judge: it may be Urgent, or may not. */
const MAYBE_URGENT_WORDS = ['buzzing', 'crackling', 'burning smell', 'warm to touch', 'hot to touch', 'scorched', 'scorch marks'];

const urgency: Rule = (r) => {
  const text = [r.text, normalise(r.guidedAnswers.location ?? ''), normalise(r.guidedAnswers.started ?? '')].join(' ');
  if (mentions(text, URGENT_WORDS)) return answer('urgent');
  // Unsure, so the app treats it as High and flags it for the Property Manager to check.
  if (mentions(text, MAYBE_URGENT_WORDS)) return answer('urgent', UNSURE);
  if (mentions(text, HIGH_WORDS) || r.guidedAnswers.worsening === 'yes') return answer('high');
  return answer('routine', LIKELY);
};

// --- Safety ---

/** A risk to people. An essential service being out is Urgent, and is not this. */
const SAFETY_WORDS = ['gas', 'sparks', 'sparking', 'flooding'];

const safety: Rule = (r) => {
  const text = [r.text, normalise(r.guidedAnswers.location ?? ''), normalise(r.guidedAnswers.started ?? '')].join(' ');
  return mentions(text, SAFETY_WORDS) ? answer('risk') : answer('no_risk');
};

// --- Trade ---

/** Checked in this order, so "dishwasher leaking" is appliances and "leak in the roof" is roofing. */
const TRADE_WORDS: [trade: string, words: string[]][] = [
  ['locksmith', ['lock', 'locks', 'locked out', 'cant lock', 'wont lock', 'key', 'keys', 'deadbolt', 'deadlock']],
  ['pest_control', ['pest', 'pests', 'cockroach', 'cockroaches', 'roach', 'roaches', 'rat', 'rats', 'mice', 'mouse', 'termite', 'termites', 'ants', 'wasp', 'wasps', 'bees', 'bed bugs', 'possum', 'spider', 'spiders']],
  ['roofing', ['roof', 'roofing', 'gutter', 'gutters', 'downpipe', 'skylight']],
  ['appliances', ['oven', 'stove', 'cooktop', 'dishwasher', 'washing machine', 'dryer', 'fridge', 'rangehood', 'microwave', 'air con', 'aircon', 'air conditioner', 'heater']],
  ['electrical', ['power', 'no power', 'powerpoint', 'power point', 'outlet', 'socket', 'switch', 'light', 'lights', 'fuse', 'circuit', 'breaker', 'sparks', 'sparking', 'wiring', 'electrical', 'smoke alarm']],
  ['plumbing', ['tap', 'taps', 'leak', 'leaks', 'leaking', 'pipe', 'pipes', 'toilet', 'drain', 'drains', 'blocked', 'sink', 'shower', 'basin', 'bath', 'cistern', 'drip', 'dripping', 'hot water', 'water', 'sewage', 'flood', 'flooding', 'burst', 'gas']],
  ['carpentry', ['door', 'doors', 'cupboard', 'cupboards', 'cabinet', 'drawer', 'drawers', 'floorboard', 'floorboards', 'deck', 'fence', 'skirting', 'stairs', 'handrail', 'wardrobe', 'hinge', 'hinges']],
  ['general_handyman', ['paint', 'painting', 'hole in the wall', 'curtain', 'blind', 'blinds', 'flyscreen', 'fly screen', 'window', 'windows']],
];

/** Finds the Trade by keyword. With no keyword it guesses handyman, unsure, so the app flags "check trade". */
const trade: Rule = (r) => {
  const text = [r.text, normalise(r.guidedAnswers.location ?? '')].join(' ');
  const match = TRADE_WORDS.find(([, words]) => mentions(text, words));
  return match ? answer(match[0]) : answer('general_handyman', UNSURE);
};

const anyKeyword = (text: string) => mentions(text, URGENT_WORDS) || mentions(text, HIGH_WORDS) || TRADE_WORDS.some(([, words]) => mentions(text, words));

// --- Message class ---

const COMMON_AREA_WORDS = ['lift', 'lifts', 'elevator', 'foyer', 'lobby', 'stairwell', 'common area', 'common property', 'car park', 'carpark', 'garage door', 'intercom', 'pool', 'shared'];
const OTHER_WORDS = ['rent', 'lease', 'bond', 'inspection', 'payment', 'pay'];
const FOLLOW_UP_WORDS = [
  'still', 'again', 'any update', 'update', 'when will', 'following up', 'follow up', 'reschedule', 'another time',
  'another day', 'cant make', 'confirm', 'confirmed', 'see you', 'receipt', 'invoice',
];
const RESCHEDULE_WORDS = ['reschedule', 'another time', 'another day', 'different time', 'different day', 'cant make', 'cant do', 'wont be home', 'not home', 'postpone', 'move the visit'];
const CONFIRM_WORDS = ['confirm', 'confirmed', 'see you', 'works for me', 'that works', 'sounds good', 'will be home', 'ill be home'];
const RECEIPT_WORDS = ['receipt', 'invoice', 'paid'];

const urgentRepairOpen = (r: Reading) => r.openItems.some((i) => i.ref.startsWith('urgent_repair:'));

/** A follow-up about something already open: a chaser, a scheduling reply, or a receipt for an Urgent Repair. */
function isUpdate(r: Reading) {
  if (r.openItems.length === 0) return false;
  return mentions(r.text, FOLLOW_UP_WORDS) || (r.hasAttachments && urgentRepairOpen(r));
}

const messageClass: Rule = (r) => {
  if (mentions(r.text, COMMON_AREA_WORDS)) return answer('common_area');
  if (mentions(r.text, OTHER_WORDS)) return answer('other');
  if (isUpdate(r)) return answer('update');
  // "Help!" could be anything: unsure, so it goes to the inbox.
  if (wordCount(r.text) < 3 && !anyKeyword(r.text)) return answer('new_issue', UNSURE);
  return answer('new_issue', LIKELY);
};

// --- Update type ---

function tenantUpdateType(r: Reading) {
  if (mentions(r.text, RESCHEDULE_WORDS)) return 'reschedule_request';
  if (mentions(r.text, RECEIPT_WORDS)) return 'receipt';
  if (mentions(r.text, CONFIRM_WORDS)) return 'visit_confirmed';
  if (r.hasAttachments) return 'receipt';
  return 'general';
}

const updateType: Rule = (r) => {
  const type = tenantUpdateType(r);
  return answer(type, type === 'general' ? LIKELY : SURE);
};

// --- Replies from Tradies and Property Owners ---

// Not plain "done" or "fixed": "can get it done Tuesday" and "fixed price" are quotes.
const DONE_WORDS = ['all done', 'job done', 'job is done', 'its done', 'finished', 'completed', 'job complete', 'all fixed', 'fixed it', 'its fixed', 'fixed now'];
const DECLINE_WORDS = ['no thanks', 'decline', 'declined', 'too busy', 'not available', 'unavailable', 'cant quote', 'pass', 'not interested', 'cant help'];
const PRICE = /\$\s?\d|\b\d[\d,]*(\.\d{1,2})?\s?(dollars|aud|inc gst|incl gst|including gst|\+ ?gst|ex gst)\b/;

function tradieReplyType(r: Reading) {
  if (mentions(r.text, DECLINE_WORDS)) return 'decline';
  if (mentions(r.text, RESCHEDULE_WORDS)) return 'reschedule_request';
  if (mentions(r.text, DONE_WORDS) || /^done\W*$/.test(r.text)) return 'done';
  if (PRICE.test(r.text) || (r.hasAttachments && mentions(r.text, ['quote', 'quoted']))) return 'quote';
  return 'other';
}

const YES_FIRST_WORDS = ['yes', 'yep', 'yeah', 'yup', 'y', 'ok', 'okay', 'sure', 'approve', 'approved'];
const NO_FIRST_WORDS = ['no', 'nope', 'nah', 'n'];
const NO_PHRASES = ['dont approve', 'do not approve', 'not approved', 'decline', 'declined', 'reject', 'rejected', 'not getting worse', 'not worse', 'no change', 'hasnt changed', 'same', 'stable', 'not really'];
const YES_PHRASES = ['approve', 'approved', 'go ahead', 'proceed', 'getting worse', 'worse', 'worsening', 'spreading', 'bigger'];

/** Reads YES or NO: the first word decides, then phrases, negative ones first. */
function yesNo(text: string): 'yes' | 'no' | null {
  const first = text.split(/[^a-z]+/).find(Boolean) ?? '';
  if (YES_FIRST_WORDS.includes(first)) return 'yes';
  if (NO_FIRST_WORDS.includes(first)) return 'no';
  if (mentions(text, NO_PHRASES)) return 'no';
  if (mentions(text, YES_PHRASES)) return 'yes';
  return null;
}

/** A Tradie's reply type, or an owner's when the options are approval_answer and other. */
const replyType: Rule = (r, options) => {
  if (options.includes('approval_answer')) return yesNo(r.text) ? answer('approval_answer') : answer('other', LIKELY);
  const type = tradieReplyType(r);
  return answer(type, type === 'other' ? LIKELY : SURE);
};

// --- Related item ---

/** The item kinds a message can be about, given what it says. Jobs are left to their Ticket. */
function likelyKinds(r: Reading): string[] {
  if (r.senderRole === 'tradie') {
    const type = tradieReplyType(r);
    return type === 'quote' || type === 'decline' ? ['quote_request'] : ['work_order'];
  }
  if (r.senderRole === 'property_owner') return ['approval'];
  const type = tenantUpdateType(r);
  if (type === 'receipt') return ['urgent_repair'];
  if (type === 'reschedule_request' || type === 'visit_confirmed') return ['ticket'];
  return ['issue', 'ticket', 'urgent_repair'];
}

/** Picks the item a reply is about: the one it names by its words, the only candidate, or a guess at the first. */
function pickItem(r: Reading, items: Item[]): ClassifierAnswer {
  if (items.length === 0) return answer('none');
  const kinds = likelyKinds(r);
  const ofKind = items.filter((i) => kinds.includes(i.ref.split(':')[0]!));
  const candidates = ofKind.length ? ofKind : items;
  if (candidates.length === 1) return answer(candidates[0]!.ref);
  const named = candidates.find((i) => sharedWords(r.text, i.summary) >= 1);
  return named ? answer(named.ref) : answer(candidates[0]!.ref, GUESS);
}

const relatedItem: Rule = (r) => {
  if (r.senderRole === 'tradie' || r.senderRole === 'property_owner') return pickItem(r, r.waitingItems);
  if (isUpdate(r)) return pickItem(r, r.openItems);
  // A new issue that reads like an open one (a housemate's report) is a duplicate.
  const duplicate = r.openItems.find((i) => !i.ref.startsWith('job:') && sharedWords(r.text, i.summary) >= 2);
  return answer(duplicate ? duplicate.ref : 'none');
};

// --- The answer the agent is waiting for, typed by its options ---

export const AVAILABILITY_WORDS: [option: Availability, pattern: RegExp][] = [
  ['saturdays', /\b(saturdays?|sat|weekends?)\b/],
  ['weekday_mornings', /\bmornings?\b/],
  ['weekday_afternoons', /\bafternoons?\b/],
  ['any_time', /\b(any ?time|any|whenever)\b/],
];

/** "2", "option 2", or words like "afternoons". The question numbers the options in AVAILABILITY's order. */
function availability(text: string): Availability | null {
  const numbered = /^(option )?([1-4])\W*$/.exec(text);
  if (numbered) return AVAILABILITY[Number(numbered[2]) - 1]!;
  return AVAILABILITY_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/** "4", "4/5" or "five stars". */
function rating(text: string) {
  const digit = /\b([1-5])\b/.exec(text)?.[1];
  if (digit) return digit;
  const word = /\b(one|two|three|four|five) stars?\b/.exec(text)?.[1];
  return word ? String(['one', 'two', 'three', 'four', 'five'].indexOf(word) + 1) : null;
}

/** "YES" confirms a visit; asking for another time, or a plain "no", reschedules it. */
function visitReply(text: string) {
  if (mentions(text, RESCHEDULE_WORDS)) return 'reschedule';
  if (mentions(text, [...CONFIRM_WORDS, 'no problem', 'no worries', 'works', 'fine', 'great'])) return 'confirm';
  const yn = yesNo(text);
  return yn === 'yes' ? 'confirm' : yn === 'no' ? 'reschedule' : null;
}

/** A guided question, a 1–5 rating, a visit confirmation, or an owner's YES/NO. */
const waitingAnswer: Rule = (r, options) => {
  const read = options.includes(AVAILABILITY[0])
    ? availability(r.text)
    : options.includes('5')
      ? rating(r.text)
      : options.includes('confirm')
        ? visitReply(r.text)
        : options.includes('yes')
          ? yesNo(r.text)
          : r.text
            ? 'answer'
            : null;
  if (read) return answer(read);
  return options.includes('not_an_answer') ? answer('not_an_answer') : answer(options[0]!, UNSURE);
};

// --- Answering the questions ---

const RULES: Record<string, Rule> = { messageClass, relatedItem, urgency, safety, trade, updateType, replyType, answer: waitingAnswer };

/** The Jev adapter sends `answer:guided` as `answer_guided`: colons aren't safe in a question name. */
function ruleFor(name: string): Rule | undefined {
  return name.startsWith('answer_') || name.startsWith('answer:') ? waitingAnswer : RULES[name];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function items(value: unknown): Item[] {
  if (!Array.isArray(value)) return [];
  return value.filter((i): i is Item => isObject(i) && typeof i.ref === 'string' && typeof i.summary === 'string');
}

function reading(state: Record<string, unknown>): Reading {
  const guided = isObject(state.answers) ? state.answers : {};
  return {
    text: normalise(typeof state.message === 'string' ? state.message : ''),
    senderRole: typeof state.senderRole === 'string' ? state.senderRole : '',
    hasAttachments: state.hasAttachments === true,
    openItems: items(state.openItems),
    waitingItems: items(state.waitingItems),
    guidedAnswers: Object.fromEntries(Object.entries(guided).filter((e): e is [string, string] => typeof e[1] === 'string')),
  };
}

/** Probabilities that give the answer `confidence` the way TypeSafe computes it: (n x largest - 1) / (n - 1). */
function probabilities(options: string[], chosen: string, confidence: number) {
  const n = options.length;
  const largest = n === 1 ? 1 : (confidence * (n - 1) + 1) / n;
  const round = (p: number) => Math.round(p * 10_000) / 10_000;
  return Object.fromEntries(options.map((o) => [o, round(o === chosen ? largest : (1 - largest) / (n - 1))]));
}

/**
 * Answers a System One request: one `choice` answer per question, named as the
 * question is. A question with no rule, or a rule whose answer isn't among the
 * options (the keys of `criteria`), gets the first option, unsure.
 */
export function mockClassify(body: unknown) {
  const state = isObject(body) && isObject(body.state) ? body.state : {};
  const questions = isObject(body) && isObject(body.questions) ? Object.entries(body.questions) : [];
  const r = reading(state);
  const answers = questions.flatMap(([name, question]) => {
    const options = isObject(question) && isObject(question.criteria) ? Object.keys(question.criteria) : [];
    if (!options.length) return [];
    const given = mockImportAnswer(name, state, options) ?? ruleFor(name)?.(r, options);
    const { answer: choice, confidence } = given && options.includes(given.answer) ? given : answer(options[0]!, UNSURE);
    return [[name, { type: 'choice', choice, confidence, probabilities: probabilities(options, choice, confidence) }] as const];
  });
  return { model: 'jev-mock', answers: Object.fromEntries(answers), usage: { input_tokens: 0, output_tokens: 0 } };
}
