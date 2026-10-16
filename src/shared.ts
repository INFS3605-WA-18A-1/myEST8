import { randomBytes } from 'node:crypto';

export const TRADES = [
  'plumbing',
  'electrical',
  'carpentry',
  'roofing',
  'appliances',
  'locksmith',
  'pest_control',
  'general_handyman',
] as const;
export type Trade = (typeof TRADES)[number];

export const URGENCIES = ['urgent', 'high', 'routine'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const AVAILABILITY = ['weekday_mornings', 'weekday_afternoons', 'saturdays', 'any_time'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export type Role = 'tenant' | 'owner' | 'tradie' | 'building_manager';

export interface Settings {
  /** Public address of the web app, used in upload and tracker links. */
  baseUrl: string;
  /** Classifier answers below this confidence are treated as unsure. */
  confidenceThreshold: number;
  /** A photo taken this many days before the report is flagged. */
  photoMaxAgeDays: number;
  /** A photo taken further than this from the Property is flagged. */
  photoMaxDistanceKm: number;
}

export const DEFAULT_SETTINGS: Omit<Settings, 'baseUrl'> = {
  confidenceThreshold: 0.7,
  photoMaxAgeDays: 14,
  photoMaxDistanceKm: 1,
};

/** A Property Manager action was refused. The message is shown to the Property Manager. */
export class ActionError extends Error {
  readonly code: 'not_found' | 'invalid' | 'conflict';
  /**
   * The input fields at fault, each with its own message, named as in the
   * action's input ("email", "password"). Empty when the refusal isn't about one field.
   */
  readonly fields: Readonly<Record<string, string>>;
  constructor(code: ActionError['code'], message: string, fields: Record<string, string> = {}) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

export function notFound(what: string): never {
  throw new ActionError('not_found', `${what} not found`);
}

/** Refuses an action. `field` names the input at fault, so a form can show the message next to it. */
export function invalid(message: string, field?: string): never {
  throw new ActionError('invalid', message, field ? { [field]: message } : {});
}

/** True for something shaped like an email address: text, one @, and a dotted domain. */
export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** An unguessable token for a no-login link. */
export function newToken() {
  return randomBytes(24).toString('base64url');
}

export const HOUR_MS = 3_600_000;

export function addMs(at: Date | string, ms: number) {
  return new Date(new Date(at).getTime() + ms);
}

export function iso(at: Date) {
  return at.toISOString();
}

/** Formats cents as dollars: 123456 -> "$1,234.56". */
export function dollars(cents: number) {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

/** Normalises a phone number or email address so the same contact always matches. */
export function normalizeAddress(address: string) {
  const trimmed = address.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  // "+61 (0)412 345 678": the bracketed trunk 0 isn't part of the number.
  const digits = trimmed.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  // "0061412345678": 00 is the international call prefix.
  if (digits.startsWith('00')) return normalizeLocal(`+${digits.slice(2)}`);
  // Australian numbers written locally ("0412 345 678") become E.164.
  if (digits.startsWith('0')) return `+61${digits.slice(1)}`;
  return normalizeLocal(digits);
}

/** "61412345678" (a plus left off) and "+610412345678" (the trunk 0 left in) become "+61412345678". */
function normalizeLocal(digits: string) {
  if (/^61\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\+610\d{9}$/.test(digits)) return `+61${digits.slice(4)}`;
  return digits;
}

/**
 * Why a normalised phone number can't be texted, in words for the person who typed it,
 * or null when it looks usable: "+" and 8 to 15 digits, and exactly 9 after +61.
 */
export function phoneProblem(normalized: string): string | null {
  const example = 'Enter a mobile number with its area code, like 0412 345 678 or +61 412 345 678';
  if (!normalized.startsWith('+')) return `${example}. For another country, start with + and the country code.`;
  if (!/^\+\d+$/.test(normalized)) return `${example}. Use digits only.`;
  const length = normalized.length - 1;
  if (length < 8 || length > 15) return `That number is too ${length < 8 ? 'short' : 'long'}. ${example}.`;
  if (normalized.startsWith('+61') && length !== 11) return `An Australian number has 9 digits after +61 (or 10 starting with 0). ${example}.`;
  return null;
}

/** Removes phone numbers and email addresses from text a Tenant wrote, before it goes to a Tradie. */
export function withoutContactDetails(text: string) {
  return text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[contact removed]').replace(/\+?\d[\d\s()-]{6,}\d/g, '[contact removed]');
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
