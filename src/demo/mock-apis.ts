// Dummy versions of every external AI and data API the app calls, so the demo
// runs offline through the real adapters. Each speaks the same wire format as
// the service it stands in for; the answers come from small deterministic rules.

import { Hono, type Context } from 'hono';
import { wallClock, zonedInstant } from '../zoned-time.ts';
import type { Composer, DetailExtractor, ExtractedDetails, Summariser } from '../ports.ts';
import { AVAILABILITY_WORDS, mockClassify } from './mock-classifier.ts';
import { isTrade, mockTradeAnswers } from './mock-trades.ts';

/** A Google listing the demo's mock Places API knows. A listing may lack a phone, website or summary, as real ones do. */
interface DemoListing {
  placeId: string;
  name: string;
  address: string;
  rating: number;
  reviewCount: number;
  phone?: string;
  website?: string;
  /** Google's place types. */
  types: string[];
  /** Google's name for the main type. */
  primaryType: string;
  summary?: string;
}

const PLUMBER = { types: ['plumber', 'point_of_interest', 'establishment'], primaryType: 'Plumber' };
const ELECTRICIAN = { types: ['electrician', 'point_of_interest', 'establishment'], primaryType: 'Electrician' };
const CONTRACTOR = { types: ['general_contractor', 'point_of_interest', 'establishment'], primaryType: 'General contractor' };
const APPLIANCES = { types: ['home_appliance_repair_service', 'point_of_interest', 'establishment'], primaryType: 'Appliance repair service' };

/** Google listings the demo's mock Places API knows. Demo Tradies link to these. */
export const DEMO_PLACES: readonly DemoListing[] = [
  {
    placeId: 'demo-petes-plumbing', name: "Pete's Plumbing", address: '4 Illawarra Rd, Marrickville NSW 2204', rating: 4.8, reviewCount: 120,
    phone: '+61 412 555 018', website: 'https://petes-plumbing.example', ...PLUMBER, summary: 'Local plumbers for blocked drains, leaks and hot water systems.',
  },
  { placeId: 'demo-quick-pipes', name: 'Quick Pipes', address: '88 Regent St, Redfern NSW 2016', rating: 4.2, reviewCount: 40, phone: '+61 2 9319 0044', ...PLUMBER },
  {
    placeId: 'demo-flow-bros', name: 'Flow Bros Plumbing', address: '17 Crystal St, Petersham NSW 2049', rating: 4.9, reviewCount: 15,
    phone: '+61 423 555 071', website: 'https://flowbros.example', ...PLUMBER,
  },
  {
    placeId: 'demo-ninas-plumbing', name: "Nina's Plumbing", address: '210 Enmore Rd, Enmore NSW 2042', rating: 4.2, reviewCount: 33,
    phone: '+61 2 9557 0120', ...PLUMBER, summary: 'Plumbing and gas fitting for homes and rentals.',
  },
  {
    placeId: 'demo-sparky-sam', name: 'Sparky Sam Electrical', address: '12 Glebe Point Rd, Glebe NSW 2037', rating: 4.5, reviewCount: 60,
    phone: '+61 2 9660 0188', website: 'https://sparkysam.example', ...ELECTRICIAN, summary: 'Electricians for power points, switchboards and safety switches.',
  },
  {
    placeId: 'demo-fixit-carpentry', name: 'FixIt Carpentry', address: '3 Parramatta Rd, Annandale NSW 2038', rating: 4.6, reviewCount: 48,
    phone: '+61 2 9550 0173', ...CONTRACTOR, summary: 'Carpenters for doors, decks and cabinets.',
  },
  {
    placeId: 'demo-cool-appliances', name: 'Cool Appliance Repairs', address: '55 Victoria Rd, Rozelle NSW 2039', rating: 4.3, reviewCount: 72,
    phone: '+61 2 9818 0166', website: 'https://coolappliances.example', ...APPLIANCES, summary: 'Appliance repairs, plus electrical work for ovens and air conditioners.',
  },
  {
    placeId: 'demo-ellis-electrical', name: 'Ellis Electrical', address: '41 Addison Rd, Marrickville NSW 2204', rating: 4.7, reviewCount: 89,
    phone: '+61 431 555 092', website: 'https://ellis-electrical.example', ...ELECTRICIAN,
  },
  {
    placeId: 'demo-ridgeline-roofing', name: 'Ridgeline Roofing', address: '9 Botany Rd, Alexandria NSW 2015', rating: 4.4, reviewCount: 27,
    phone: '+61 2 9319 0155', types: ['roofing_contractor', 'point_of_interest', 'establishment'], primaryType: 'Roofing contractor', summary: 'Roof repairs, re-roofing and gutters.',
  },
  { placeId: 'demo-appliance-rescue', name: 'Appliance Rescue', address: '160 Oxford St, Bondi Junction NSW 2022', rating: 3.9, reviewCount: 210, phone: '+61 2 9387 0129', ...APPLIANCES },
  // No phone, website or summary: the form has to be completed by hand.
  { placeId: 'demo-handy-harry', name: "Handy Harry's", address: '22 Booth St, Annandale NSW 2038', rating: 4.8, reviewCount: 64, ...CONTRACTOR },
  {
    placeId: 'demo-bugs-away', name: 'Bugs Away Pest Control', address: '5 Princes Hwy, St Peters NSW 2044', rating: 4.1, reviewCount: 132,
    phone: '+61 2 9519 0148', types: ['pest_control_service', 'point_of_interest', 'establishment'], primaryType: 'Pest control service',
  },
];

/**
 * Dummy versions of every external API the app calls, at these paths:
 * /jev/v1/classify, /jev/v1/systemone (Trades for a Google listing), /vision/v1/image-match, /quotes/v1/quote-read (also /quotes/v1/read),
 * /google/places/v1/places:searchText, /google/places/v1/places/:id,
 * /nominatim/search, /photon/api/.
 * Wire the real adapters to it with `mockFetch()` and baseUrls under http://mock.local.
 */
export function mockApis() {
  const app = new Hono();

  app.post('/jev/v1/classify', async (c) => c.json(mockClassify(await jsonBody(c))));

  // The Noul questions about a Trade that a Google listing is asked. The classifier's choice questions
  // are served at /jev/v1/classify.
  app.post('/jev/v1/systemone', async (c) => {
    const body = await jsonBody(c);
    const questions = isObject(body) ? body.questions : null;
    // TypeSafe's validation error for a request it can't answer.
    const refused = (problem: string) => c.json({ detail: [{ loc: ['body'], msg: problem, type: 'value_error' }] }, 422);
    if (!isObject(body) || !isObject(body.state)) return refused('state is required');
    if (!isObject(questions) || Object.keys(questions).length === 0) return refused('questions is required');
    if (!Object.entries(questions).every(([name, q]) => isTrade(name) && isObject(q) && q.type === 'noul')) {
      return refused('the demo only answers noul questions named for a Trade');
    }
    return c.json(mockTradeAnswers(body.state, questions));
  });

  app.post('/vision/v1/image-match', async (c) => {
    const body = await jsonBody(c);
    if (!isObject(body) || typeof body.description !== 'string' || !Array.isArray(body.photos)) return c.json({ error: 'expected description and photos' }, 400);
    return c.json(matchImages(body.description, body.photos.length));
  });

  const quoteRead = async (c: Context) => {
    const body = await jsonBody(c);
    if (!isObject(body) || typeof body.text !== 'string' || typeof body.now !== 'string' || typeof body.timeZone !== 'string') {
      return c.json({ error: 'expected text, now and timeZone' }, 400);
    }
    const now = new Date(body.now);
    if (Number.isNaN(now.getTime()) || !isTimeZone(body.timeZone)) return c.json({ error: 'bad now or timeZone' }, 400);
    // Only an uncompressed PDF's text is readable this way; the text of the reply comes first.
    const pdfText = typeof body.pdf === 'string' ? Buffer.from(body.pdf, 'base64').toString('latin1') : '';
    return c.json(readQuote(`${body.text}\n${pdfText}`, now, body.timeZone));
  };
  // The adapter posts to {baseUrl}/v1/quote-read; /quotes/v1/read is kept as a short alias.
  app.post('/quotes/v1/quote-read', quoteRead);
  app.post('/quotes/v1/read', quoteRead);

  app.post('/google/places/v1/places:searchText', async (c) => {
    const fields = fieldMask(c);
    if (!fields) return googleError(c, 400, 'INVALID_ARGUMENT', 'FieldMask is a required parameter.');
    const body = await jsonBody(c);
    if (!isObject(body) || typeof body.textQuery !== 'string') return googleError(c, 400, 'INVALID_ARGUMENT', 'textQuery is required.');
    const places = searchPlaces(body.textQuery).map((p) => masked(googlePlace(p), fields, 'places.'));
    // Like Google, an empty list is left out of the response.
    return c.json(places.length ? { places } : {});
  });

  app.get('/google/places/v1/places/:id', (c) => {
    const fields = fieldMask(c);
    if (!fields) return googleError(c, 400, 'INVALID_ARGUMENT', 'FieldMask is a required parameter.');
    const place = DEMO_PLACES.find((p) => p.placeId === c.req.param('id'));
    if (!place) return googleError(c, 404, 'NOT_FOUND', `Place '${c.req.param('id')}' not found.`);
    return c.json(masked(googlePlace(place), fields, ''));
  });

  // Nominatim: the demo addresses' points. Photon: the same addresses, as suggestions.
  app.get('/nominatim/search', (c) => c.json(nominatimResponse(c.req.query('q') ?? '')));
  app.get('/photon/api/', (c) => c.json(photonResponse(c.req.query('q') ?? '')));

  return app;
}

/** A fetch that answers from the mock APIs instead of the network, for wiring the real adapters in the demo. */
export function mockFetch(): typeof fetch {
  const app = mockApis();
  return async (input, init) => app.request(input, init);
}

// --- Request helpers ---

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function isTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// --- Image match ---

/** Any photo "matches": the demo can't look at it, and says so in the reason. */
function matchImages(description: string, photoCount: number) {
  return photoCount > 0
    ? { result: 'matches', reason: `Demo check: photo received for '${description.slice(0, 40)}'` }
    : { result: 'unclear', reason: 'Demo check: no photos to compare' };
}

// --- Quote reading ---

const PRICE_IN_DOLLARS = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/;
const PRICE_IN_WORDS = /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(?:dollars|aud|inc\.? gst|incl\.? gst|including gst|\+ ?gst)\b/i;

/** "$1,234.50", "450 dollars" or "450 inc GST", in cents. */
function readPrice(text: string): number | null {
  const match = PRICE_IN_DOLLARS.exec(text) ?? PRICE_IN_WORDS.exec(text);
  if (!match) return null;
  return Number(match[1]!.replace(/,/g, '')) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY = '(today|tomorrow|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const CLOCK = '(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm)';
const DAY_THEN_CLOCK = new RegExp(`\\b${DAY}\\b,?\\s+(?:at\\s+)?${CLOCK}\\b`, 'i');
const CLOCK_THEN_DAY = new RegExp(`\\b${CLOCK}\\s+(?:on\\s+)?${DAY}\\b`, 'i');

/** "Tue 9am", "Monday at 10:30am", "tomorrow 2pm" or "9am Tuesday": the next such time after `now` in `timeZone`. */
function readProposedTime(text: string, now: Date, timeZone: string): Date | null {
  const dayFirst = DAY_THEN_CLOCK.exec(text);
  const clockFirst = dayFirst ? null : CLOCK_THEN_DAY.exec(text);
  const parts = dayFirst
    ? { day: dayFirst[1]!, hour: dayFirst[2]!, minute: dayFirst[3], meridiem: dayFirst[4]! }
    : clockFirst
      ? { day: clockFirst[4]!, hour: clockFirst[1]!, minute: clockFirst[2], meridiem: clockFirst[3]! }
      : null;
  if (!parts) return null;
  const hour12 = Number(parts.hour);
  const minute = Number(parts.minute ?? 0);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = (hour12 % 12) + (parts.meridiem.toLowerCase() === 'pm' ? 12 : 0);
  return nextOccurrence(parts.day.toLowerCase(), hour, minute, now, timeZone);
}

function nextOccurrence(day: string, hour: number, minute: number, now: Date, timeZone: string) {
  const today = wallClock(now, timeZone);
  const onDay = (daysAhead: number) => zonedInstant(timeZone, today.year, today.month, today.day + daysAhead, hour, minute);
  if (day === 'today') return onDay(0);
  if (day === 'tomorrow') return onDay(1);
  const daysAhead = (WEEKDAYS.indexOf(day.slice(0, 3)) - today.weekday + 7) % 7;
  const at = onDay(daysAhead);
  return at > now ? at : onDay(daysAhead + 7);
}

function readQuote(text: string, now: Date, timeZone: string) {
  return { priceCents: readPrice(text), proposedTime: readProposedTime(text, now, timeZone)?.toISOString() ?? null };
}

// --- Google Places and Nominatim ---

/** Lowercase words and numbers, apostrophes and punctuation dropped. */
const searchable = (text: string) => text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9/]+/g, ' ').trim();

/** Listings whose name or address contains every word of the query. */
function searchPlaces(textQuery: string) {
  const words = searchable(textQuery).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  return DEMO_PLACES.filter((p) => {
    const haystack = searchable(`${p.name} ${p.address}`);
    return words.every((w) => haystack.includes(w));
  });
}

function googlePlace(p: DemoListing): Record<string, unknown> {
  return {
    id: p.placeId,
    displayName: { text: p.name, languageCode: 'en' },
    formattedAddress: p.address,
    // Google writes the same number both ways; the demo's national form drops the country code.
    ...(p.phone ? { internationalPhoneNumber: p.phone, nationalPhoneNumber: nationalNumber(p.phone) } : {}),
    ...(p.website ? { websiteUri: p.website } : {}),
    types: p.types,
    primaryTypeDisplayName: { text: p.primaryType, languageCode: 'en' },
    ...(p.summary ? { editorialSummary: { text: p.summary, languageCode: 'en' } } : {}),
    rating: p.rating,
    userRatingCount: p.reviewCount,
  };
}

/** "+61 2 9319 0044" as "(02) 9319 0044" and "+61 412 555 018" as "0412 555 018". */
function nationalNumber(international: string) {
  const [, area, ...rest] = international.split(' ');
  return area!.length === 1 ? `(0${area}) ${rest.join(' ')}` : `0${area} ${rest.join(' ')}`;
}

function fieldMask(c: Context) {
  const header = c.req.header('x-goog-fieldmask') ?? c.req.query('fields');
  return header ? header.split(',').map((f) => f.trim()) : null;
}

/** Only the fields the request's field mask names, as Google returns them. */
function masked(place: Record<string, unknown>, fields: string[], prefix: string) {
  if (fields.includes('*') || fields.includes(`${prefix}*`)) return place;
  return Object.fromEntries(Object.entries(place).filter(([key]) => fields.includes(`${prefix}${key}`)));
}

function googleError(c: Context, code: 400 | 404, status: string, message: string) {
  return c.json({ error: { code, message, status } }, code);
}

const SYDNEY_CBD = { lat: -33.8688, lng: 151.2093 };

/** Fixed points for the demo's Properties and listings. Keys are `searchable` addresses. */
const DEMO_ADDRESSES = [
  ['12 King St, Newtown NSW 2042', -33.897, 151.179],
  ['5/40 Ocean Ave, Bondi NSW 2026', -33.8908, 151.2743],
  ['7 Wilson St, Newtown NSW 2042', -33.8955, 151.1823],
  ['21 Glebe Point Rd, Glebe NSW 2037', -33.879, 151.187],
  ['4 Illawarra Rd, Marrickville NSW 2204', -33.906, 151.158],
  ['88 Regent St, Redfern NSW 2016', -33.893, 151.203],
  ['17 Crystal St, Petersham NSW 2049', -33.893, 151.153],
  ['210 Enmore Rd, Enmore NSW 2042', -33.899, 151.173],
  ['12 Glebe Point Rd, Glebe NSW 2037', -33.881, 151.194],
  ['3 Parramatta Rd, Annandale NSW 2038', -33.885, 151.183],
  ['55 Victoria Rd, Rozelle NSW 2039', -33.864, 151.172],
  ['2/31 Australia St, Camperdown NSW 2050', -33.8905, 151.1765],
  ['9 Albion St, Annandale NSW 2038', -33.8815, 151.17],
  ['27 Llewellyn St, Marrickville NSW 2204', -33.9105, 151.156],
  ['17 Glenmore Rd, Paddington NSW 2021', -33.883, 151.224],
  ['42 Coogee Bay Rd, Coogee NSW 2034', -33.9205, 151.251],
  ['3/15 Bronte Rd, Bondi Junction NSW 2022', -33.8935, 151.252],
  ['41 Addison Rd, Marrickville NSW 2204', -33.901, 151.1605],
  ['9 Botany Rd, Alexandria NSW 2015', -33.9, 151.1985],
  ['160 Oxford St, Bondi Junction NSW 2022', -33.8915, 151.247],
  ['22 Booth St, Annandale NSW 2038', -33.88, 151.172],
  ['5 Princes Hwy, St Peters NSW 2044', -33.912, 151.18],
] as const;

const KNOWN_LOCATIONS = new Map(DEMO_ADDRESSES.map(([address, lat, lng]) => [searchable(address), { lat, lng }]));

/** FNV-1a: a stable 32-bit number for a string. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** A known demo address's point, or a stable point within about 2 km of the Sydney CBD. */
function locate(address: string) {
  const known = KNOWN_LOCATIONS.get(searchable(address));
  if (known) return known;
  const h = hash(searchable(address));
  const nudge = (bits: number) => Math.round(((bits / 0xffff - 0.5) * 0.04) * 10_000) / 10_000;
  return { lat: Math.round((SYDNEY_CBD.lat + nudge(h & 0xffff)) * 10_000) / 10_000, lng: Math.round((SYDNEY_CBD.lng + nudge(h >>> 16)) * 10_000) / 10_000 };
}

/** Nominatim's jsonv2 answer to a search: no results for a blank query, else the demo's point for the address, as a street-level result. */
function nominatimResponse(query: string) {
  if (!query.trim()) return [];
  const { lat, lng } = locate(query);
  return [{ place_id: hash(searchable(query)), lat: String(lat), lon: String(lng), place_rank: 30, category: 'building', type: 'yes', display_name: query.trim() }];
}

/** Photon's GeoJSON for the demo addresses whose words all appear in the query, at most 5. */
function photonResponse(query: string) {
  const words = searchable(query).split(' ').filter(Boolean);
  const features = DEMO_ADDRESSES.filter(([address]) => words.every((word) => searchable(address).includes(word)))
    .slice(0, 5)
    .map(([address, lat, lng]) => photonFeature(address, lat, lng));
  return { type: 'FeatureCollection', features };
}

/** One demo address as a Photon house, so the real adapter reads it. Coordinates are [lon, lat]. */
function photonFeature(address: string, lat: number, lng: number) {
  const [, streetLine = address, suburb = '', state = '', postcode = ''] = /^(.*), (.+) ([A-Z]{2,3}) (\d{4})$/.exec(address) ?? [];
  const [, housenumber = '', street = streetLine] = /^(\S+)\s+(.+)$/.exec(streetLine) ?? [];
  return {
    type: 'Feature',
    properties: { osm_key: 'building', osm_value: 'house', type: 'house', housenumber, street, district: suburb, state, postcode, countrycode: 'AU' },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

/** The demo's Summariser: the description's first sentence trimmed to 120 characters, then the location when known. Deterministic. */
export const mockSummariser: Summariser = {
  async summarise({ description, answers }) {
    const first = (description.trim().split(/(?<=[.!?])\s+|\n/)[0] ?? '').replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
    const head = first.length > 120 ? `${first.slice(0, 119).trimEnd()}…` : first;
    const location = answers.location?.trim();
    return { summary: location ? `${head} (${location.slice(0, 30)})` : head };
  },
};

/** The demo's Composer: the draft between a greeting to `facts.tenantName` (when it has one) and the Agency's name, so it reads as written from notes. Deterministic. */
export const mockComposer: Composer = {
  async compose({ facts, draft, agencyName }) {
    const { tenantName } = facts as { tenantName?: unknown };
    return { text: [typeof tenantName === 'string' ? `Hi ${tenantName},` : null, draft, agencyName].filter((part) => part !== null).join('\n\n') };
  },
};

const LOCATION = /\b(?:(?:main|master|upstairs|downstairs|front|back) )?(?:kitchen|bathroom|ensuite|laundry|bedroom|lounge(?: room)?|living room|hallway|balcony|garage|roof|ceiling|toilet|back ?yard|front door|back door)(?: (?:sink|tap|window|door|light|shower|bath|wall|floor))?\b/i;
const STARTED = /\b(?:since (?:last |the )?\w+|yesterday|last night|this morning|last (?:week|month)|today|(?:\d+|a|an|two|three|a few|a couple of) (?:hours?|days?|weeks?|months?) ago)\b/i;
const NOT_WORSE = /\b(?:not|isnt|arent|no|never|hasnt|stopped)\b(?: \w+){0,2} worse\b|\bthe same\b/;
const WORSE = /\b(?:worse|worsening|spreading|bigger|growing)\b/;

/**
 * The demo's DetailExtractor: keyword rules for a room and fixture, a time like "since Monday" or
 * "last night", "getting worse" or not, and the words for when the Tenant is home. A bare yes or no
 * answers "is it getting worse" only when that was the one question asked. Deterministic.
 */
export const mockExtractor: DetailExtractor = {
  async extract({ text, wanted }) {
    const found: ExtractedDetails = {};
    const plain = text.toLowerCase().replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim();
    const location = LOCATION.exec(text)?.[0];
    if (wanted.includes('location') && location) found.location = location;
    const started = STARTED.exec(text)?.[0];
    if (wanted.includes('started') && started) found.started = started;
    if (wanted.includes('worsening')) {
      const bare = wanted.length === 1 ? (/^(?:yes|yeah|yep)\b/.test(plain) ? 'yes' : /^(?:no|nope|nah)\b/.test(plain) ? 'no' : null) : null;
      if (NOT_WORSE.test(plain)) found.worsening = 'no';
      else if (WORSE.test(plain)) found.worsening = 'yes';
      else if (bare) found.worsening = bare;
    }
    const availability = AVAILABILITY_WORDS.find(([, pattern]) => pattern.test(plain))?.[0];
    if (wanted.includes('availability') && availability) found.availability = availability;
    return found;
  },
};
