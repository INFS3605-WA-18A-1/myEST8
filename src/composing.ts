// What Claude Haiku is told about each email it composes, and the checks its text
// must pass before it is sent in place of the template (ADR 0011). The strings a
// message can't get wrong are read here, in code, from the template's own text:
// never from the model. A composed text that drops one, or adds a link, amount,
// phone number or email address the template doesn't have, is not sent.

import type { TemplateName } from './templates.ts';

/**
 * Templates whose text always goes out as it is. The code is checked character for
 * character, the channel test proves a channel works, and a follow-up is the
 * Property Manager's own words, already drafted (`tickets.draftFollowUp`).
 */
export const NEVER_COMPOSED: ReadonlySet<TemplateName> = new Set<TemplateName>(['onboarding.verification_code', 'onboarding.test_message', 'tenant.follow_up']);

/**
 * Template fields that hold another person's words: a Tenant's description, message or
 * note, a Summary written from them, a Property Manager's reason, a Tradie's scope of
 * work. The composer gets them as untrusted data, never instructions.
 */
const UNTRUSTED_FIELDS = ['description', 'message', 'issue', 'note', 'reason', 'summary', 'work', 'jobs'];

/** The longest composed email that is sent: a few short paragraphs, with room for every button. */
export const MAX_COMPOSED_CHARS = 4000;

/** What each email is for, in a plain-English phrase. The composer gets it with the facts. */
export const PURPOSES: Record<TemplateName, string> = {
  'tenant.acknowledgement': 'Telling a Tenant we have their message about an issue at their Property',
  'tenant.missing_details': 'Asking a Tenant the questions about their issue they have not answered yet',
  'tenant.upload_link': 'Asking a Tenant to upload photos of the issue through a link',
  'tenant.urgent_repair_reminder': 'Telling a Tenant with an urgent issue they can arrange the repair themselves, claim the cost back, and where to send the receipt',
  'tenant.common_area_passed_on': 'Telling a Tenant their Common Area issue has gone to the Building Manager',
  'tenant.confirmed': 'Telling a Tenant their Maintenance Request is confirmed, with a link to follow its progress',
  'tenant.rejected': 'Telling a Tenant we will not go ahead with their Maintenance Request, and why',
  'tenant.choose_visit_time': 'Asking a Tenant to pick one of the visit times a Tradie offered',
  'tenant.pick_visit_time_reminder': 'Reminding a Tenant to pick a visit time',
  'tenant.say_when_home': 'Asking a Tenant to say when they are home, so the Tradie can offer other times',
  'tenant.visit_time': 'Telling a Tenant when a Tradie will visit, and asking them to confirm the time',
  'tenant.visit_booked': 'Telling a Tenant their visit time is booked',
  'tenant.visit_moved': 'Telling a Tenant their visit has moved to a new time, and asking them to confirm it',
  'tenant.inspection': 'Telling a Tenant a Tradie will inspect the issue before a firm price, and asking them to confirm the time',
  'tenant.inspection_cancelled': 'Telling a Tenant a Site Inspection is cancelled, so they need not be home for it',
  'tenant.fixed_properly': 'Telling a Tenant the Tradie has finished, what they did, and asking how well it was fixed',
  'tenant.reimbursed': 'Telling a Tenant the Property Owner has paid their Reimbursement Request',
  'tenant.ticket_closed': 'Telling a Tenant their repair is complete: what was done, by whom and when',
  'tenant.follow_up': 'A Property Manager following up with the Tenant about their Maintenance Request',
  'tradie.quote_request': 'Asking a Tradie to quote for a Job, with a link to give their Estimate',
  'tradie.quote_reminder': 'Reminding a Tradie to give an Estimate for a Job they were asked to quote on',
  'tradie.not_chosen': 'Telling a Tradie another Quote was chosen for the Job',
  'tradie.offer_times': 'Telling a Tradie their Quote is approved, and asking them to offer visit times',
  'tradie.offer_times_reminder': 'Reminding a Tradie to offer visit times for an approved Job',
  'tradie.offer_new_times': 'Asking a Tradie to offer new visit times for a booked Job',
  'tradie.offer_times_again': 'Telling a Tradie the Tenant cannot make the times offered, and asking for others',
  'tradie.work_order': 'Giving a Tradie the Work Order: what is approved, where and when to do the Job',
  'tradie.done_too_early': 'Telling a Tradie the visit cannot be marked done before it starts',
  'tradie.visit_moved': 'Telling a Tradie their visit has moved to a new time',
  'tradie.inspection': 'Telling a Tradie their Site Inspection is booked',
  'tradie.firm_quote_request': 'Asking a Tradie for their Firm Quote after their Site Inspection',
  'tradie.firm_quote_reminder': 'Reminding a Tradie to give their Firm Quote',
  'tradie.firm_quote_link': 'Sending a Tradie the link to give a Firm Quote, since we have their Estimate',
  'owner.approval_request': "Asking a Property Owner to approve a Quote that takes the Repair Cost over the Property's Max Repair Cost",
  'owner.approval_reminder': 'Reminding a Property Owner that a Quote needs their approval',
  'owner.work_booked': 'Telling a Property Owner a repair is booked',
  'owner.work_moved': 'Telling a Property Owner a booked repair has moved to a new time',
  'owner.ticket_closed': 'Telling a Property Owner a repair is complete: what was done, by whom, when and what it cost',
  'owner.urgent_repair_receipt': "Passing a Tenant's Reimbursement Request for an Urgent Repair to the Property Owner, with the receipt attached",
  'building_manager.common_area_issue': 'Telling a Building Manager about a Common Area issue a Tenant reported',
  'onboarding.test_message': 'Checking that a channel works',
  'onboarding.verification_code': 'Giving someone a one-time code to verify their address',
};

/** The template data's fields that hold another person's words, among those it has. */
export function untrustedFieldsOf(data: object): string[] {
  const facts = data as Record<string, unknown>;
  return UNTRUSTED_FIELDS.filter((field) => facts[field] !== undefined && facts[field] !== null);
}

/** A line that is only "<Label>: <url>": the email renderer draws it as a button. */
const BUTTON_LINE = /^.{1,40}: https?:\/\/\S+$/gm;
/** A web address, without the punctuation that ends the sentence around it (as the email renderer reads it). */
const URLS = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]']/g;
/** An amount as `dollars` writes it: "$1,265.00". */
const AMOUNTS = /\$\d[\d,]*(?:\.\d+)?/g;
/** A day as `formatDay` writes it, with the time when `formatVisit` adds one: "Tue 13 Oct, 9:00 am". */
const DAYS = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:, \d{1,2}:\d{2} [ap]m)?/g;
const PHONES = /\+?\d[\d ()-]{7,}\d/g;
const EMAILS = /[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:.]+/g;
/** "Reply YES or NO", "reply to this message": to the end of its sentence. */
const REPLIES = /\breply\b[^.?!\n]*/gi;

type Match = { text: string; start: number; end: number };

const matches = (text: string, pattern: RegExp): Match[] =>
  [...text.matchAll(pattern)].map((m) => ({ text: m[0].trim(), start: m.index, end: m.index + m[0].length }));

const within = (m: Match, spans: { start: number; end: number }[]) => spans.some((s) => m.start >= s.start && m.end <= s.end);
const digits = (phone: string) => phone.replace(/\D/g, '');

/** Every string inside `value`: a field's text, or each text in a list of Jobs. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

/** Where `values` (another person's words) appear in `text`. */
function spansOf(text: string, values: string[]) {
  const spans: { start: number; end: number }[] = [];
  for (const value of values) {
    if (!value.trim()) continue;
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + value.length)) spans.push({ start: at, end: at + value.length });
  }
  return spans;
}

/** Phone numbers, leaving out the digits inside a link. */
function phonesIn(text: string): Match[] {
  const links = matches(text, URLS);
  return matches(text, PHONES).filter((m) => !links.some((l) => m.start < l.end && m.end > l.start));
}

/**
 * The strings a composed email must contain exactly as given, read from the template's
 * text: each button line whole, then every link, amount, visit time or day, phone number
 * and "Reply …" instruction. Those inside another person's words (`untrusted`) are left
 * out, so a Tenant's text can't add a requirement of its own.
 */
export function mustIncludeIn(draft: string, data: object): string[] {
  const facts = data as Record<string, unknown>;
  const spans = spansOf(draft, untrustedFieldsOf(data).flatMap((field) => stringsIn(facts[field])));
  const found = [BUTTON_LINE, URLS, AMOUNTS, DAYS, REPLIES].flatMap((pattern) => matches(draft, pattern));
  return [...new Set([...found, ...phonesIn(draft)].filter((m) => !within(m, spans)).map((m) => m.text))];
}

/**
 * Why a composed email can't be sent in place of the template's text, or null when it
 * can. Never quotes either text, so the reason can be logged.
 */
export function problemWith(composed: string, draft: string, mustInclude: string[]): string | null {
  if (!composed.trim()) return 'the composed text is empty';
  if (composed.length > MAX_COMPOSED_CHARS) return `the composed text is over ${MAX_COMPOSED_CHARS} characters`;
  const lines = new Set(composed.split('\n').map((line) => line.trim()));
  for (const required of mustInclude) {
    const buttonLine = new RegExp(BUTTON_LINE.source).test(required);
    if (buttonLine ? !lines.has(required) : !composed.includes(required)) {
      return `the composed text is missing ${buttonLine ? 'a button line' : 'a link, amount, time, phone number or reply instruction'}`;
    }
  }
  const adds = (find: (text: string) => Match[], normalise = (s: string) => s) => {
    const known = new Set(find(draft).map((m) => normalise(m.text)));
    return find(composed).some((m) => !known.has(normalise(m.text)));
  };
  if (adds((t) => matches(t, URLS))) return 'the composed text adds a link';
  if (adds((t) => matches(t, AMOUNTS))) return 'the composed text adds an amount';
  if (adds(phonesIn, digits)) return 'the composed text adds a phone number';
  if (adds((t) => matches(t, EMAILS), (s) => s.toLowerCase())) return 'the composed text adds an email address';
  return null;
}
