// Importing Property Owners, Building Managers, Tradies, Properties and Tenants
// from a spreadsheet the Agency already has.
//
//   1 read      the .xlsx or .csv into rows (spreadsheet.ts)
//   2 columns   match each heading to one of our fields by its name ("Landlord",
//               "Ph"); ask the classifier about headings no name matches
//   3 rows      tidy each row (mobiles to E.164, dollars to cents, dates, Trades),
//               link it to records the Agency has (a Property's Property Owner, a
//               Tenant's Property), ask the classifier for a Tradie's missing Trade,
//               and check it the way the single "Add" form would
//   4 review    the Property Manager sees every row's status, fixes flagged cells,
//               unticks rows, and adds them through the onboarding actions
//
// Classifier answers below the confidence threshold are shown as suggestions and
// never applied. The upload waits in the imports table under a random token,
// visible only to the Property Manager who made it, until it is used or expires.

import type { Context } from './context.ts';
import { one, run } from './db.ts';
import type { Onboarding } from './onboarding.ts';
import type { ClassifierAnswer } from './ports.ts';
import type { Person, Property } from './profiles.ts';
import { ActionError, addMs, dollars, HOUR_MS, isEmail, iso, newToken, normalizeAddress, TRADES, type Role, type Trade } from './shared.ts';
import { readSpreadsheet, writeCsv, type SheetRow } from './spreadsheet.ts';

export const IMPORT_KINDS = ['owners', 'building-managers', 'tradies', 'properties', 'tenants'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Sheets with more data rows than this are refused. */
export const MAX_IMPORT_ROWS = 500;
/** How long an upload waits for review. */
const IMPORT_TTL_MS = 24 * HOUR_MS;

/** The question ids the classifier is asked. */
export const IMPORT_QUESTIONS = { column: 'importColumn', trade: 'importTrade' } as const;
/** The classifier's answer for a column that holds none of our fields. */
export const IGNORE = 'ignore';

export interface ImportField {
  key: string;
  label: string;
  /** Shown as the template's example row. */
  example: string;
  /** Headings that mean this field, compared after lowercasing and dropping punctuation. */
  synonyms: string[];
}

/** One heading of the sheet and the field it fills: matched by its name, by the classifier, by the Property Manager, or not yet. */
export interface ImportColumn {
  index: number;
  header: string;
  field: string | null;
  by: 'header' | 'ai' | 'pm' | 'unsure' | 'empty';
  /** The classifier's answer when it wasn't sure enough to apply it. */
  suggestion?: { field: string; confidence: number };
  /** The first few values, to help decide what the column is. */
  samples: string[];
}

export type RowStatus = 'ready' | 'needs_fix' | 'duplicate';

/** A value the import worked out rather than read: from the classifier ('ai') or a fixed rule ('rule'). */
export type Filled = { by: 'ai' | 'rule'; note: string };

export interface ImportRow {
  /** Position among the sheet's data rows: what edits and ticks refer to. */
  index: number;
  /** The row number as the spreadsheet shows it. */
  line: number;
  status: RowStatus;
  included: boolean;
  /** Tidied values by field: what will be added. */
  values: Record<string, string>;
  filled: Record<string, Filled>;
  /** What stops the row being added, by field ('row' when no one field is at fault). */
  problems: Record<string, string>;
  /** What else adding the row does, like adding a new Property Owner. */
  notes: string[];
  /** Who or what the row repeats. */
  duplicateOf?: string;
}

export interface ImportPreview {
  token: string;
  kind: ImportKind;
  filename: string;
  expiresAt: string;
  fields: ImportField[];
  columns: ImportColumn[];
  /** Rows not added yet, in sheet order. */
  rows: ImportRow[];
  /** Rows added from this upload so far. */
  added: number;
  /** Choices for cells that link to a record: Property Owners' names, Properties' addresses. */
  choices: Record<string, string[]>;
}

/** What the Property Manager changed in the review: the rows ticked, and flagged cells retyped. */
export type ImportChanges = { included?: number[]; edits?: Record<number, Record<string, string>> };

// --- Fields ---

const NAME = ['name', 'full name', 'contact name', 'first name', 'given name', 'surname', 'last name', 'family name'];
const MOBILE = ['mobile', 'mobile number', 'mobile phone', 'mob', 'ph', 'phone', 'phone number', 'cell', 'tel', 'telephone', 'contact number', 'contact phone'];
const EMAIL = ['email', 'email address', 'e mail', 'mail', 'e mail address'];

const MOBILE_FIELD: ImportField = { key: 'mobile', label: 'Mobile', example: '0412 345 678', synonyms: MOBILE };
const EMAIL_FIELD: ImportField = { key: 'email', label: 'Email', example: '', synonyms: EMAIL };
const contact = (name: ImportField): ImportField[] => [name, MOBILE_FIELD, EMAIL_FIELD];

const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  owners: contact({
    key: 'name',
    label: 'Name',
    example: 'Olivia Owens',
    synonyms: [...NAME, 'owner', 'owner name', 'owners', 'property owner', 'landlord', 'landlord name', 'client', 'client name'],
  }),
  'building-managers': contact({
    key: 'name',
    label: 'Name',
    example: 'Barry Strata',
    synonyms: [...NAME, 'building manager', 'strata manager', 'strata', 'manager', 'contact'],
  }),
  tradies: [
    {
      key: 'businessName',
      label: 'Business name',
      example: "Pete's Plumbing",
      synonyms: ['business', 'business name', 'company', 'company name', 'trading name', 'trading as', 'firm', 'tradie', 'supplier', 'contractor'],
    },
    { key: 'name', label: 'Contact name', example: 'Pete Park', synonyms: [...NAME, 'contact', 'contact person', 'person'] },
    MOBILE_FIELD,
    EMAIL_FIELD,
    {
      key: 'trades',
      label: 'Trades',
      example: 'plumbing',
      synonyms: ['trade', 'trades', 'service', 'services', 'category', 'categories', 'type', 'trade type', 'speciality', 'specialty', 'skills', 'work'],
    },
    { key: 'startingRating', label: 'Starting rating', example: '4', synonyms: ['rating', 'starting rating', 'stars', 'score'] },
    { key: 'notes', label: 'Notes', example: 'Hot water systems and blocked drains', synonyms: ['notes', 'note', 'comments', 'comment', 'description', 'details', 'about'] },
  ],
  properties: [
    {
      key: 'address',
      label: 'Address',
      example: '12 King St, Newtown NSW 2042',
      synonyms: ['address', 'property address', 'street address', 'property', 'street', 'premises', 'location', 'rental address'],
    },
    { key: 'suburb', label: 'Suburb', example: 'Newtown', synonyms: ['suburb', 'town', 'city', 'locality'] },
    {
      key: 'maxRepairCost',
      label: 'Max Repair Cost',
      example: '500',
      synonyms: [
        'max repair cost', 'max repair', 'repair limit', 'repair authority', 'spending limit', 'spend limit', 'approval limit',
        'max spend', 'limit', 'authority', 'owner limit', 'maintenance limit',
      ],
    },
    {
      key: 'ownerName',
      label: 'Property Owner',
      example: 'Olivia Owens',
      synonyms: ['owner', 'owner name', 'owners', 'property owner', 'property owner name', 'landlord', 'landlord name', 'client'],
    },
    {
      key: 'ownerMobile',
      label: 'Property Owner mobile',
      example: '0412 345 678',
      synonyms: [
        'owner mobile', 'owner phone', 'owner ph', 'owner mob', 'landlord mobile', 'landlord phone', 'landlord ph', 'landlord mob',
        'property owner mobile', 'property owner phone',
      ],
    },
    { key: 'ownerEmail', label: 'Property Owner email', example: '', synonyms: ['owner email', 'landlord email', 'owner e mail', 'landlord e mail', 'property owner email'] },
    { key: 'propertyManager', label: 'Property Manager', example: '', synonyms: ['property manager', 'manager', 'pm', 'managed by', 'agent'] },
    { key: 'buildingManager', label: 'Building Manager', example: '', synonyms: ['building manager', 'strata manager', 'strata'] },
  ],
  tenants: [
    {
      key: 'name',
      label: 'Name',
      example: 'Tom Tran',
      synonyms: [...NAME, 'tenant', 'tenant name', 'tenants', 'resident', 'renter', 'occupant', 'lessee'],
    },
    MOBILE_FIELD,
    EMAIL_FIELD,
    {
      key: 'property',
      label: 'Property address',
      example: '12 King St, Newtown NSW 2042',
      synonyms: ['property', 'address', 'property address', 'premises', 'rental', 'rental address', 'unit', 'street address'],
    },
    {
      key: 'tenancyStart',
      label: 'Tenancy start date',
      example: '1/01/2025',
      synonyms: [
        'tenancy start', 'tenancy start date', 'start date', 'lease start', 'lease start date', 'lease commencement',
        'commencement', 'commenced', 'move in', 'move in date', 'start', 'from',
      ],
    },
  ],
};

/** Fields whose values from several columns are joined ("First name" + "Surname"); others take the first value. */
const JOINED = new Set(['name', 'ownerName']);

/** The CSV template for a kind: our headings and one example row. */
export function importTemplate(kind: ImportKind): string {
  const fields = IMPORT_FIELDS[kind];
  return writeCsv([fields.map((f) => f.label), fields.map((f) => f.example)]);
}

// --- Reading values ---

const ROLE_LABEL: Record<Role, string> = { tenant: 'Tenant', owner: 'Property Owner', tradie: 'Tradie', building_manager: 'Building Manager' };

const TRADE_LABEL: Record<Trade, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  carpentry: 'Carpentry',
  roofing: 'Roofing',
  appliances: 'Appliances',
  locksmith: 'Locksmith',
  pest_control: 'Pest control',
  general_handyman: 'General handyman',
};

const TRADE_WORDS: Record<Trade, string[]> = {
  plumbing: ['plumbing', 'plumber', 'plumbers', 'plumb', 'gas fitter', 'gasfitter', 'gas fitting', 'gas', 'drainer', 'drainage', 'drains', 'drain', 'hot water', 'blocked drains'],
  electrical: ['electrical', 'electrician', 'electricians', 'sparky', 'sparkie', 'sparkies', 'electric', 'electrics'],
  carpentry: ['carpentry', 'carpenter', 'carpenters', 'joiner', 'joinery', 'cabinet maker', 'cabinetmaker', 'doors', 'decking'],
  roofing: ['roofing', 'roofer', 'roofers', 'roof', 'roofs', 'gutter', 'gutters', 'guttering', 'roof plumber'],
  appliances: ['appliances', 'appliance', 'appliance repairs', 'whitegoods', 'white goods', 'air conditioning', 'air con', 'aircon', 'hvac', 'refrigeration'],
  locksmith: ['locksmith', 'locksmiths', 'locks', 'lock', 'keys', 'security doors'],
  pest_control: ['pest control', 'pest', 'pests', 'pest controller', 'exterminator', 'termites', 'termite'],
  general_handyman: ['general handyman', 'handyman', 'handymen', 'handy man', 'general maintenance', 'maintenance', 'odd jobs', 'general', 'painter', 'painters', 'painting'],
};

/** Lowercase words only: "E-mail" -> "e mail", "Contact No." -> "contact no". */
function words(text: string) {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const hasWords = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

/** Trades named in text ("Roofer; gutters" -> roofing). Each piece takes the Trade with the longest matching word. */
export function readTrades(text: string): Trade[] {
  const found: Trade[] = [];
  for (const piece of text.split(/[,;/&+|\n]|\band\b/i).map(words).filter(Boolean)) {
    let best: { trade: Trade; length: number } | null = null;
    for (const trade of TRADES) {
      for (const word of [...TRADE_WORDS[trade], words(trade)]) {
        if (hasWords(piece, word) && word.length > (best?.length ?? 0)) best = { trade, length: word.length };
      }
    }
    if (best && !found.includes(best.trade)) found.push(best.trade);
  }
  return found;
}

/** An Australian or international phone number as E.164, or null when it can't be one. Excel drops a leading 0, so "412 345 678" is read as 0412 345 678. */
export function readMobile(text: string): string | null {
  const first = text.replace(/^tel:/i, '').split(/[/;,]| or /)[0]!.replace(/\(0\)/g, '');
  const digits = first.replace(/[^\d+]/g, '');
  let number: string;
  if (digits.startsWith('+')) number = digits;
  else if (digits.startsWith('61') && digits.length === 11) number = `+${digits}`;
  else if (digits.startsWith('0') && digits.length === 10) number = normalizeAddress(digits);
  else if (digits.length === 9 && digits.startsWith('4')) number = `+61${digits}`;
  else return null;
  return /^\+\d{8,15}$/.test(number) ? number : null;
}

/** The first email address in text, lowercased, or null. */
export function readEmail(text: string): string | null {
  const candidate = text.replace(/^mailto:/i, '').split(/[;,\s]+/).find(Boolean) ?? '';
  return isEmail(candidate) ? normalizeAddress(candidate) : null;
}

/** Dollars as typed in a sheet ("$1,200", "1.5k", "AUD 800") as cents, or null. */
export function readMoney(text: string): number | null {
  const cleaned = text.replace(/aud|\$|,|\s/gi, '');
  const thousands = /k$/i.test(cleaned);
  const value = Number(cleaned.replace(/k$/i, ''));
  if (!cleaned || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * (thousands ? 1000 : 1) * 100);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date as YYYY-MM-DD, reading day-first as Australians write it ("1/3/2026" is 1 March), or null. */
export function readDate(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t))) {
    const year = Number(match[3]);
    [y, m, d] = [match[3]!.length === 2 ? (year < 70 ? 2000 + year : 1900 + year) : year, Number(match[2]), Number(match[1])];
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\.?,?\s+(\d{4})$/i.exec(t))) {
    [y, m, d] = [Number(match[3]), MONTHS.indexOf(match[2]!.slice(0, 3).toLowerCase()) + 1, Number(match[1])];
  } else if ((match = /^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(t))) {
    [y, m, d] = [Number(match[3]), MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase()) + 1, Number(match[2])];
  } else if (/^\d{5}$/.test(t) && Number(t) > 20000 && Number(t) < 80000) {
    // An Excel date serial: days since 30 December 1899.
    return new Date(Date.UTC(1899, 11, 30) + Number(t) * 86_400_000).toISOString().slice(0, 10);
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** A starting rating from "4", "4/5", "4 stars" or "4.5" (rounded), or null. */
function readRating(text: string): number | null {
  const match = /^(\d(?:\.\d+)?)\s*(?:\/\s*5|stars?)?$/i.exec(text.trim());
  const value = match ? Math.round(Number(match[1])) : NaN;
  return value >= 1 && value <= 5 ? value : null;
}

const STREET_WORDS: Record<string, string> = {
  street: 'st', road: 'rd', avenue: 'ave', av: 'ave', parade: 'pde', drive: 'dr', place: 'pl', crescent: 'cres', court: 'ct', lane: 'ln',
  highway: 'hwy', terrace: 'tce', boulevard: 'blvd', close: 'cl', circuit: 'cct', square: 'sq',
};
const STATES = new Set(['nsw', 'vic', 'qld', 'sa', 'wa', 'tas', 'nt', 'act']);

/** An address reduced to compare: "12 King Street, Newtown NSW 2042" -> "12 king st newtown". */
function addressKey(address: string) {
  return words(address)
    .split(' ')
    .filter((w) => w && !STATES.has(w) && !/^\d{4}$/.test(w) && !['unit', 'apartment', 'apt'].includes(w))
    .map((w) => STREET_WORDS[w] ?? w)
    .join(' ');
}

/** The suburb in "12 King St, Newtown NSW 2042", or ''. */
function suburbOf(address: string) {
  const parts = address.split(',');
  if (parts.length < 2) return '';
  return parts
    .at(-1)!
    .replace(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b.*$/i, '')
    .replace(/\d{4}\s*$/, '')
    .trim();
}

const sameName = (a: string, b: string) => words(a) === words(b);

/** Runs `items` through `fn`, a few at a time. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) results.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  return results;
}

// --- Stored uploads ---

interface StoredColumn {
  header: string;
  field: string | null;
  by: ImportColumn['by'];
  suggestion?: { field: string; confidence: number };
}

interface Stored {
  kind: ImportKind;
  filename: string;
  columns: StoredColumn[];
  rows: SheetRow[];
  /** The classifier's Trade for each Tradie row it was asked about, by row index. */
  trades: Record<number, ClassifierAnswer | null>;
  edits: Record<number, Record<string, string>>;
  /** The rows ticked, once the Property Manager has posted the review; null until then. */
  included: number[] | null;
  done: number[];
}

/** A row worked out, with how to add it. */
type Draft = Omit<ImportRow, 'included'> & { add: (cache: Map<string, number>) => Promise<unknown> };

const EXPIRED = 'This upload has expired. Upload the spreadsheet again.';

/** The import module: reads uploads, works out each row, and adds them through the onboarding actions. */
export function createImports({ db, clock, settings, ports, modules }: Context, onboarding: Onboarding) {
  const { profiles } = modules;

  const sure = (answer: ClassifierAnswer | null | undefined) => !!answer && answer.confidence >= settings.confidenceThreshold;

  async function load(agencyId: number, propertyManagerId: number, token: string): Promise<Stored> {
    const row = await one<{ state: string }>(
      db,
      'SELECT state FROM imports WHERE token = ? AND agency_id = ? AND property_manager_id = ? AND expires_at > ?',
      token,
      agencyId,
      propertyManagerId,
      iso(clock.now()),
    );
    if (!row) throw new ActionError('not_found', EXPIRED);
    return JSON.parse(row.state) as Stored;
  }

  async function save(token: string, stored: Stored) {
    await run(db, 'UPDATE imports SET state = ? WHERE token = ?', JSON.stringify(stored), token);
  }

  // Columns

  function matchHeader(kind: ImportKind, header: string): string | null {
    const key = words(header);
    return IMPORT_FIELDS[kind].find((f) => f.synonyms.includes(key) || words(f.label) === key)?.key ?? null;
  }

  /** The heading row: of the first five, the one with the most headings we know (a title row above it is skipped). */
  function headerRow(kind: ImportKind, rows: SheetRow[]) {
    let best = 0;
    let bestScore = 0;
    rows.slice(0, 5).forEach((row, i) => {
      const score = row.cells.filter((cell) => matchHeader(kind, cell)).length;
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    return best;
  }

  const samplesOf = (rows: SheetRow[], column: number) =>
    rows
      .map((r) => r.cells[column] ?? '')
      .filter(Boolean)
      .slice(0, 5);

  /** Matches each heading by name, then asks the classifier about the rest, one question per heading. */
  async function mapColumns(kind: ImportKind, headers: string[], rows: SheetRow[]): Promise<StoredColumn[]> {
    const fields = IMPORT_FIELDS[kind];
    return mapLimit(headers.map((header, index) => ({ header, index })), 6, async ({ header, index }) => {
      const label = header || `Column ${String.fromCharCode(65 + (index % 26))}`;
      const field = matchHeader(kind, header);
      if (field) return { header: label, field, by: 'header' as const };
      const samples = samplesOf(rows, index);
      if (!samples.length) return { header: label, field: null, by: 'empty' as const };
      let answer: ClassifierAnswer | undefined;
      try {
        const answers = await ports.classifier.classify({
          text: label,
          state: { sheet: kind, samples, fields: Object.fromEntries(fields.map((f) => [f.key, f.label])) },
          questions: [{ id: IMPORT_QUESTIONS.column, options: [...fields.map((f) => f.key), IGNORE] }],
        });
        answer = answers[IMPORT_QUESTIONS.column];
      } catch {
        // The Property Manager decides when the classifier can't be asked.
      }
      if (answer && sure(answer)) return { header: label, field: answer.answer === IGNORE ? null : answer.answer, by: 'ai' as const };
      return {
        header: label,
        field: null,
        by: 'unsure' as const,
        ...(answer && answer.answer !== IGNORE ? { suggestion: { field: answer.answer, confidence: answer.confidence } } : {}),
      };
    });
  }

  // Rows

  /** A row's values by field, from its columns and then the Property Manager's edits. */
  function rawValues(stored: Stored, index: number): Record<string, string> {
    const values: Record<string, string> = {};
    const row = stored.rows[index]!;
    stored.columns.forEach((column, i) => {
      if (!column.field) return;
      const value = row.cells[i] ?? '';
      const before = values[column.field];
      if (before === undefined || before === '') values[column.field] = value;
      else if (value && JOINED.has(column.field) && !before.split(' ').includes(value)) values[column.field] = `${before} ${value}`;
    });
    for (const [field, value] of Object.entries(stored.edits[index] ?? {})) values[field] = value.trim();
    return values;
  }

  /** Tradie rows whose Trades can't be read from the sheet, so the classifier is asked. */
  function needsTrade(stored: Stored, index: number) {
    return stored.kind === 'tradies' && stored.edits[index]?.trades === undefined && !readTrades(rawValues(stored, index).trades ?? '').length;
  }

  async function askTrades(stored: Stored) {
    const asking = stored.rows.map((_, i) => i).filter((i) => needsTrade(stored, i) && !(i in stored.trades));
    await mapLimit(asking, 6, async (i) => {
      const v = rawValues(stored, i);
      try {
        const answers = await ports.classifier.classify({
          text: v.businessName || v.name || `Row ${stored.rows[i]!.line}`,
          state: { sheet: 'tradies', businessName: v.businessName ?? '', contactName: v.name ?? '', trades: v.trades ?? '', notes: v.notes ?? '' },
          questions: [{ id: IMPORT_QUESTIONS.trade, options: [...TRADES] }],
        });
        stored.trades[i] = answers[IMPORT_QUESTIONS.trade] ?? null;
      } catch {
        stored.trades[i] = null;
      }
    });
  }

  /** Works out every row against what the Agency has now. */
  async function draftRows(agencyId: number, propertyManagerId: number, stored: Stored): Promise<Draft[]> {
    const people = await profiles.people(agencyId);
    const properties = await profiles.properties(agencyId);
    const managers = await profiles.propertyManagers(agencyId);
    const holders = new Map<string, Person>();
    for (const p of people) for (const a of [p.mobile, p.email]) if (a) holders.set(normalizeAddress(a), p);
    /** Contacts and addresses earlier rows use, to spot a row repeated in the sheet. */
    const seen = new Map<string, number>();
    const me = await profiles.propertyManager(propertyManagerId);

    // One row at a time, in sheet order: each row sees the contacts and addresses of the rows before it.
    const drafts: Draft[] = [];
    for (const [index, sheetRow] of stored.rows.entries()) {
      drafts.push(await draftRow(sheetRow, index));
    }
    return drafts;

    async function draftRow(sheetRow: SheetRow, index: number): Promise<Draft> {
      const v = rawValues(stored, index);
      const values: Record<string, string> = {};
      const filled: Record<string, Filled> = {};
      const problems: Record<string, string> = {};
      const notes: string[] = [];
      let duplicateOf: string | undefined;
      const problem = (field: string, message: string) => {
        problems[field] ??= message;
      };
      /** Runs an onboarding check, recording its refusal against the field it names (as this sheet names it). */
      const check = async (fn: () => unknown, rename: Record<string, string> = {}) => {
        try {
          await fn();
        } catch (error) {
          if (!(error instanceof ActionError)) throw error;
          const [field] = Object.keys(error.fields);
          problem(field ? (rename[field] ?? field) : 'row', error.message);
        }
      };
      const copy = (...fields: string[]) => fields.forEach((f) => v[f] !== undefined && (values[f] = v[f]));

      /** A mobile and email tidied, with problems against `mobileField` and `emailField`. */
      const tidyContact = (mobileField: string, emailField: string) => {
        const mobileRaw = v[mobileField] ?? '';
        const emailRaw = v[emailField] ?? '';
        const mobile = mobileRaw ? readMobile(mobileRaw) : null;
        const email = emailRaw ? readEmail(emailRaw) : null;
        if (mobileRaw && !mobile) problem(mobileField, `${mobileRaw} isn't a mobile number`);
        if (emailRaw && !email) problem(emailField, `${emailRaw} isn't an email address`);
        if (v[mobileField] !== undefined) values[mobileField] = mobile ?? mobileRaw;
        if (v[emailField] !== undefined) values[emailField] = email ?? emailRaw;
        return { mobile: mobile ?? undefined, email: email ?? undefined };
      };

      /** Marks the row a duplicate when someone with `role` already has its mobile or email, or an earlier row does. */
      const checkHolders = (role: Role, contactInfo: { mobile?: string; email?: string }, fields: { mobile: string; email: string }) => {
        for (const [kind, address] of [['mobile', contactInfo.mobile], ['email', contactInfo.email]] as const) {
          if (!address) continue;
          const holder = holders.get(address);
          if (holder && holder.role === role) duplicateOf ??= holder.businessName ?? holder.name;
          else if (holder) problem(fields[kind], `${address} already belongs to ${holder.name}, a ${ROLE_LABEL[holder.role]}`);
          const earlier = seen.get(address);
          if (earlier !== undefined && earlier !== sheetRow.line) duplicateOf ??= `Row ${earlier} of this sheet`;
          else seen.set(address, sheetRow.line);
        }
      };

      let add: Draft['add'] = async () => {};

      switch (stored.kind) {
        case 'owners':
        case 'building-managers': {
          const role: Role = stored.kind === 'owners' ? 'owner' : 'building_manager';
          copy('name');
          const person = { name: v.name ?? '', ...tidyContact('mobile', 'email') };
          checkHolders(role, person, { mobile: 'mobile', email: 'email' });
          await check(() => onboarding.checkContact(person));
          add = async () => (role === 'owner' ? onboarding.addOwner(agencyId, person) : onboarding.addBuildingManager(agencyId, person));
          break;
        }

        case 'tradies': {
          copy('businessName', 'notes');
          const businessName = v.businessName ?? '';
          let name = v.name ?? '';
          if (!name && businessName) {
            name = businessName;
            filled.name = { by: 'rule', note: 'No contact name, so the business name' };
          }
          values.name = name;
          const contactInfo = tidyContact('mobile', 'email');
          let trades = readTrades(v.trades ?? '');
          if (stored.edits[index]?.trades !== undefined) {
            if (!trades.length) problem('trades', `Choose Trades from: ${TRADES.map((t) => TRADE_LABEL[t]).join(', ')}`);
          } else if (!trades.length) {
            const answer = stored.trades[index];
            if (sure(answer)) {
              trades = [answer!.answer as Trade];
              filled.trades = { by: 'ai', note: 'Filled in by AI' };
            } else if (answer) problem('trades', `The AI isn't sure. Its guess: ${TRADE_LABEL[answer.answer as Trade] ?? answer.answer}.`);
            else problem('trades', 'Enter the Trades');
          }
          values.trades = trades.join(', ');
          let startingRating = 3;
          if (v.startingRating) {
            const read = readRating(v.startingRating);
            if (read === null) problem('startingRating', 'The starting rating is a whole number from 1 to 5');
            else startingRating = read;
          } else filled.startingRating = { by: 'rule', note: 'No rating in the sheet, so 3' };
          values.startingRating = String(startingRating);
          const existing = people.find((p) => p.role === 'tradie' && businessName && sameName(p.businessName ?? '', businessName));
          if (existing) duplicateOf = existing.businessName ?? existing.name;
          checkHolders('tradie', contactInfo, { mobile: 'mobile', email: 'email' });
          const tradie = { name, businessName, ...contactInfo, trades, startingRating, notOnGoogle: true as const };
          await check(() => onboarding.checkTradie(tradie));
          add = () => onboarding.addTradie(agencyId, tradie);
          break;
        }

        case 'properties': {
          copy('address');
          const address = v.address ?? '';
          let suburb = v.suburb ?? '';
          if (!suburb && suburbOf(address)) {
            suburb = suburbOf(address);
            filled.suburb = { by: 'rule', note: 'From the address' };
          }
          values.suburb = suburb;

          let maxRepairCostCents = -1;
          if (!v.maxRepairCost) problem('maxRepairCost', 'Enter the Max Repair Cost');
          else {
            const cents = readMoney(v.maxRepairCost);
            if (cents === null) problem('maxRepairCost', `Can't read ${v.maxRepairCost} as dollars. Enter it like 500.`);
            else maxRepairCostCents = cents;
          }
          values.maxRepairCost = maxRepairCostCents >= 0 ? dollars(maxRepairCostCents) : (v.maxRepairCost ?? '');

          let manager = me;
          if (v.propertyManager) {
            const wanted = v.propertyManager;
            const found = managers.filter(
              (m) => sameName(m.name, wanted) || m.email === wanted.toLowerCase() || sameName(m.name.split(' ')[0] ?? '', wanted),
            );
            if (found.length === 1) manager = found[0]!;
            else problem('propertyManager', `No Property Manager called ${wanted} in your Agency`);
          } else filled.propertyManager = { by: 'rule', note: 'No Property Manager in the sheet, so you' };
          values.propertyManager = manager.name;

          // The Property Owner: one the Agency has (by mobile, email, then name), or a new one from this row.
          const ownerName = v.ownerName ?? '';
          const ownerContact = tidyContact('ownerMobile', 'ownerEmail');
          let owner: Person | undefined;
          for (const [field, address] of [['ownerMobile', ownerContact.mobile], ['ownerEmail', ownerContact.email]] as const) {
            const holder = address ? holders.get(address) : undefined;
            if (holder?.role === 'owner') owner ??= holder;
            else if (holder) problem(field, `${address} already belongs to ${holder.name}, a ${ROLE_LABEL[holder.role]}`);
          }
          if (!owner && ownerName) {
            const named = people.filter((p) => p.role === 'owner' && sameName(p.name, ownerName));
            if (named.length === 1) owner = named[0];
            else if (named.length > 1) problem('ownerName', `Two Property Owners are called ${ownerName}. Add their mobile or email to this row.`);
          }
          const newOwner = !owner && ownerName && (ownerContact.mobile || ownerContact.email) ? { name: ownerName, ...ownerContact } : null;
          if (!owner && !newOwner) {
            if (!ownerName) problem('ownerName', 'Enter the Property Owner');
            else problem('ownerName', `No Property Owner called ${ownerName}. Choose one, or add their mobile or email to add them too.`);
          }
          if (newOwner) {
            const ownerKey = `owner:${newOwner.mobile ?? newOwner.email}`;
            const first = seen.get(ownerKey);
            if (first === undefined) seen.set(ownerKey, sheetRow.line);
            notes.push(first === undefined ? `Adds ${ownerName} as a new Property Owner` : `Uses ${ownerName}, the new Property Owner from row ${first}`);
            await check(() => onboarding.checkContact(newOwner), { name: 'ownerName', mobile: 'ownerMobile', email: 'ownerEmail' });
          }
          values.ownerName = owner?.name ?? ownerName;

          let buildingManagerId: number | undefined;
          if (v.buildingManager) {
            const wanted = v.buildingManager;
            const found = people.filter((p) => p.role === 'building_manager' && (sameName(p.name, wanted) || p.email === wanted.toLowerCase()));
            if (found.length === 1) {
              buildingManagerId = found[0]!.id;
              values.buildingManager = found[0]!.name;
            } else {
              problem('buildingManager', `No Building Manager called ${wanted}. Add them first.`);
              values.buildingManager = wanted;
            }
          }

          const key = addressKey(address);
          const same = properties.find((p) => key && addressKey(p.address) === key);
          if (same) duplicateOf = same.address;
          const earlier = seen.get(`address:${key}`);
          if (key && earlier !== undefined) duplicateOf ??= `Row ${earlier} of this sheet`;
          else if (key) seen.set(`address:${key}`, sheetRow.line);

          const property = { address, suburb, propertyManagerId: manager.id, maxRepairCostCents, nominatedTradieIds: [], buildingManagerId };
          if (maxRepairCostCents >= 0) await check(() => onboarding.checkProperty(agencyId, { ...property, ownerId: owner?.id }), { maxRepairCostCents: 'maxRepairCost', propertyManagerId: 'propertyManager' });
          add = async (cache) => {
            let ownerId = owner?.id;
            if (!ownerId && newOwner) {
              // Rows naming the same new Property Owner share one.
              const ownerKey = newOwner.mobile ?? newOwner.email!;
              ownerId = cache.get(ownerKey) ?? (await onboarding.addOwner(agencyId, newOwner));
              cache.set(ownerKey, ownerId);
            }
            // No lookup here. A sheet would wait on Nominatim's one request a second and
            // run past the host's time limit. Dispatch's Look up missing addresses places them.
            return onboarding.addProperty(agencyId, { ...property, ownerId: ownerId!, location: null });
          };
          break;
        }

        case 'tenants': {
          copy('name', 'property');
          const name = v.name ?? '';
          const contactInfo = tidyContact('mobile', 'email');
          let tenancyStart = '';
          if (!v.tenancyStart) problem('tenancyStart', 'Enter the tenancy start date');
          else {
            tenancyStart = readDate(v.tenancyStart) ?? '';
            if (!tenancyStart) problem('tenancyStart', `Can't read ${v.tenancyStart} as a date. Use a date like 1/3/2026.`);
          }
          values.tenancyStart = tenancyStart || (v.tenancyStart ?? '');

          let property: Property | undefined;
          const wanted = v.property ?? '';
          if (!wanted) problem('property', 'Enter the Property address');
          else {
            property = findProperty(properties, wanted, problem);
            if (property) values.property = property.address;
          }
          checkHolders('tenant', contactInfo, { mobile: 'mobile', email: 'email' });
          const tenant = { name, ...contactInfo, propertyId: property?.id ?? 0, tenancyStart };
          if (property && tenancyStart) await check(() => onboarding.checkTenant(agencyId, tenant));
          else await check(() => onboarding.checkContact(tenant));
          add = async () => onboarding.addTenant(agencyId, tenant);
          break;
        }
      }

      const status: RowStatus = duplicateOf ? 'duplicate' : Object.keys(problems).length ? 'needs_fix' : 'ready';
      return { index, line: sheetRow.line, status, values, filled, problems, notes, duplicateOf, add };
    }
  }

  /** Rows as the review shows them, without the ones already added. */
  async function reviewRows(agencyId: number, propertyManagerId: number, stored: Stored) {
    return (await draftRows(agencyId, propertyManagerId, stored))
      .filter((d) => !stored.done.includes(d.index))
      .map((d) => ({ ...d, included: stored.included ? stored.included.includes(d.index) : d.status !== 'duplicate' }));
  }

  function applyChanges(stored: Stored, changes: ImportChanges) {
    if (changes.included) stored.included = changes.included.filter((i) => Number.isInteger(i) && stored.rows[i]);
    const known = new Set(IMPORT_FIELDS[stored.kind].map((f) => f.key));
    for (const [index, fields] of Object.entries(changes.edits ?? {})) {
      const i = Number(index);
      if (!stored.rows[i]) continue;
      const kept = Object.fromEntries(Object.entries(fields).filter(([field]) => known.has(field)).map(([field, value]) => [field, String(value).slice(0, 500)]));
      stored.edits[i] = { ...stored.edits[i], ...kept };
    }
  }

  return {
    /** Reads an uploaded sheet, works out its columns and rows, and keeps it for review. Returns its token. */
    async start(agencyId: number, propertyManagerId: number, kind: ImportKind, upload: { filename: string; content: Uint8Array }) {
      if (!IMPORT_KINDS.includes(kind)) throw new ActionError('invalid', `Unknown import ${kind}`);
      const rows = await readSpreadsheet(upload);
      const headerAt = headerRow(kind, rows);
      const headers = rows[headerAt]?.cells ?? [];
      const data = rows.slice(headerAt + 1).map((r) => ({ line: r.line, cells: headers.map((_, i) => r.cells[i] ?? '') }));
      if (!data.length) throw new ActionError('invalid', 'That sheet has no rows under its headings', { file: 'That sheet has no rows under its headings' });
      if (data.length > MAX_IMPORT_ROWS) {
        const message = `That sheet has ${data.length} rows. Upload up to ${MAX_IMPORT_ROWS} at a time.`;
        throw new ActionError('invalid', message, { file: message });
      }
      const stored: Stored = {
        kind,
        filename: upload.filename,
        columns: await mapColumns(kind, headers, data),
        rows: data,
        trades: {},
        edits: {},
        included: null,
        done: [],
      };
      await askTrades(stored);
      const now = clock.now();
      await run(db, 'DELETE FROM imports WHERE expires_at <= ?', iso(now));
      const token = newToken();
      await run(
        db,
        'INSERT INTO imports (token, agency_id, property_manager_id, state, expires_at) VALUES (?, ?, ?, ?, ?)',
        token,
        agencyId,
        propertyManagerId,
        JSON.stringify(stored),
        iso(addMs(now, IMPORT_TTL_MS)),
      );
      return { token };
    },

    async preview(agencyId: number, propertyManagerId: number, token: string): Promise<ImportPreview> {
      const stored = await load(agencyId, propertyManagerId, token);
      const { expires_at } = (await one<{ expires_at: string }>(db, 'SELECT expires_at FROM imports WHERE token = ?', token))!;
      const rows = (await reviewRows(agencyId, propertyManagerId, stored)).map(({ add: _, ...row }) => row);
      return {
        token,
        kind: stored.kind,
        filename: stored.filename,
        expiresAt: expires_at,
        fields: IMPORT_FIELDS[stored.kind],
        columns: stored.columns.map((c, index) => ({ ...c, index, samples: samplesOf(stored.rows, index) })),
        rows,
        added: stored.done.length,
        choices: {
          ownerName: (await profiles.people(agencyId, 'owner')).map((p) => p.name),
          property: (await profiles.properties(agencyId)).map((p) => p.address),
          propertyManager: (await profiles.propertyManagers(agencyId)).map((m) => m.name),
          buildingManager: (await profiles.people(agencyId, 'building_manager')).map((p) => p.name),
        },
      };
    },

    /** Sets what each column holds (a field key, or null to ignore it), as the Property Manager chose. */
    async remap(agencyId: number, propertyManagerId: number, token: string, fields: (string | null)[]) {
      const stored = await load(agencyId, propertyManagerId, token);
      const known = new Set(IMPORT_FIELDS[stored.kind].map((f) => f.key));
      stored.columns = stored.columns.map((column, i) => {
        const field = fields[i] === undefined ? column.field : fields[i] && known.has(fields[i]!) ? fields[i]! : null;
        if (field === column.field && column.by !== 'unsure') return column;
        return { header: column.header, field, by: 'pm' };
      });
      await askTrades(stored);
      await save(token, stored);
    },

    /** Keeps the review's ticks and edits without adding anything. */
    async revise(agencyId: number, propertyManagerId: number, token: string, changes: ImportChanges) {
      const stored = await load(agencyId, propertyManagerId, token);
      applyChanges(stored, changes);
      await save(token, stored);
    },

    /**
     * Adds every ticked row, in sheet order (a Property's new Property Owner before
     * the Property). A row that still needs a fix, or that an add action refuses,
     * is reported and stays for review. Once nothing ticked is left, the upload is done.
     */
    async confirm(agencyId: number, propertyManagerId: number, token: string, changes: ImportChanges) {
      const stored = await load(agencyId, propertyManagerId, token);
      applyChanges(stored, changes);
      const cache = new Map<string, number>();
      const failed: { line: number; message: string }[] = [];
      let added = 0;
      for (const row of (await reviewRows(agencyId, propertyManagerId, stored)).filter((r) => r.included)) {
        if (row.status === 'needs_fix') {
          failed.push({ line: row.line, message: Object.values(row.problems)[0]! });
          continue;
        }
        try {
          await row.add(cache);
          stored.done.push(row.index);
          added++;
        } catch (error) {
          if (!(error instanceof ActionError)) throw error;
          failed.push({ line: row.line, message: error.message });
        }
      }
      const finished = !(await reviewRows(agencyId, propertyManagerId, stored)).some((r) => r.included);
      if (finished) await run(db, 'DELETE FROM imports WHERE token = ?', token);
      else await save(token, stored);
      return { kind: stored.kind, added, failed, finished };
    },

    /** Throws the upload away. */
    async discard(agencyId: number, propertyManagerId: number, token: string) {
      await load(agencyId, propertyManagerId, token);
      await run(db, 'DELETE FROM imports WHERE token = ?', token);
    },
  };
}

/** The one Property at `wanted`, matching its street address with or without the suburb, or a problem against "property". */
function findProperty(properties: Property[], wanted: string, problem: (field: string, message: string) => void): Property | undefined {
  const key = addressKey(wanted);
  const keysOf = (p: Property) => [addressKey(p.address), addressKey(`${p.address} ${p.suburb}`)];
  const exact = properties.filter((p) => keysOf(p).includes(key));
  const close = properties.filter((p) => keysOf(p).some((k) => k.startsWith(`${key} `) || key.startsWith(`${k} `)));
  const found = exact.length === 1 ? exact : exact.length ? exact : close;
  if (found.length === 1) return found[0];
  problem('property', found.length ? `More than one Property matches ${wanted}. Choose one.` : `No Property at ${wanted}. Add the Property first, or choose one.`);
  return undefined;
}

export type Imports = ReturnType<typeof createImports>;
