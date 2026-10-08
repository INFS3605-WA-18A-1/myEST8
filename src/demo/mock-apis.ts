// Dummy versions of every external AI and data API the app calls, so the demo
// runs offline through the real adapters. Each speaks the same wire format as
// the service it stands in for; the answers come from small deterministic rules.

import { Hono, type Context } from 'hono';
import { wallClock, zonedInstant } from '../zoned-time.ts';
import { mockClassify } from './mock-classifier.ts';

/** Google listings the demo's mock Places API knows. Demo Tradies link to these. */
export const DEMO_PLACES = [
  { placeId: 'demo-petes-plumbing', name: "Pete's Plumbing", address: '4 Illawarra Rd, Marrickville NSW 2204', rating: 4.8, reviewCount: 120 },
  { placeId: 'demo-quick-pipes', name: 'Quick Pipes', address: '88 Regent St, Redfern NSW 2016', rating: 4.2, reviewCount: 40 },
  { placeId: 'demo-flow-bros', name: 'Flow Bros Plumbing', address: '17 Crystal St, Petersham NSW 2049', rating: 4.9, reviewCount: 15 },
  { placeId: 'demo-ninas-plumbing', name: "Nina's Plumbing", address: '210 Enmore Rd, Enmore NSW 2042', rating: 4.2, reviewCount: 33 },
  { placeId: 'demo-sparky-sam', name: 'Sparky Sam Electrical', address: '12 Glebe Point Rd, Glebe NSW 2037', rating: 4.5, reviewCount: 60 },
  { placeId: 'demo-fixit-carpentry', name: 'FixIt Carpentry', address: '3 Parramatta Rd, Annandale NSW 2038', rating: 4.6, reviewCount: 48 },
  { placeId: 'demo-cool-appliances', name: 'Cool Appliance Repairs', address: '55 Victoria Rd, Rozelle NSW 2039', rating: 4.3, reviewCount: 72 },
] as const;

/**
 * Dummy versions of every external API the app calls, at these paths:
 * /jev/v1/classify, /vision/v1/image-match, /quotes/v1/quote-read (also /quotes/v1/read),
 * /google/places/v1/places:searchText, /google/places/v1/places/:id,
 * /google/maps/api/geocode/json (also /google/maps/maps/api/geocode/json).
 * Wire the real adapters to it with `mockFetch()` and baseUrls under http://mock.local.
 */
export function mockApis() {
  const app = new Hono();

  app.post('/jev/v1/classify', async (c) => c.json(mockClassify(await jsonBody(c))));

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

  // The prefix stands for the host, so geocodeBaseUrl http://mock.local/google/maps plus Google's
  // path /maps/api/geocode/json lands on the second route; the first serves geocodeBaseUrl http://mock.local/google.
  const geocode = (c: Context) => c.json(geocodeResponse(c.req.query('address') ?? ''));
  app.get('/google/maps/api/geocode/json', geocode);
  app.get('/google/maps/maps/api/geocode/json', geocode);

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

// --- Google Places and Geocoding ---

type DemoPlace = (typeof DEMO_PLACES)[number];

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

function googlePlace(p: DemoPlace): Record<string, unknown> {
  return {
    id: p.placeId,
    displayName: { text: p.name, languageCode: 'en' },
    formattedAddress: p.address,
    rating: p.rating,
    userRatingCount: p.reviewCount,
  };
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
const KNOWN_LOCATIONS = new Map(
  (
    [
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
    ] as const
  ).map(([address, lat, lng]) => [searchable(address), { lat, lng }]),
);

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

function geocodeResponse(address: string) {
  if (!address.trim()) return { results: [], status: 'ZERO_RESULTS' };
  const location = locate(address);
  return {
    results: [
      {
        formatted_address: address.trim(),
        geometry: { location, location_type: 'ROOFTOP' },
        place_id: `demo-geocode-${hash(searchable(address)).toString(16)}`,
        types: ['street_address'],
      },
    ],
    status: 'OK',
  };
}
