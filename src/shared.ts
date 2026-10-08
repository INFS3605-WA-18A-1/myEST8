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
  constructor(code: ActionError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function notFound(what: string): never {
  throw new ActionError('not_found', `${what} not found`);
}

export function invalid(message: string): never {
  throw new ActionError('invalid', message);
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
  const digits = trimmed.replace(/[^\d+]/g, '');
  // Australian numbers written locally ("0412 345 678") become E.164.
  return digits.startsWith('0') ? `+61${digits.slice(1)}` : digits;
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
