// The demo's mock APIs, driven through the real adapters as the demo wires them.

import { describe, expect, test } from 'vitest';
import { createGooglePlaces } from '../../src/adapters/google-places.ts';
import { createImageMatcher } from '../../src/adapters/image-matcher.ts';
import { createJevClassifier } from '../../src/adapters/jev.ts';
import { createJevTradeSuggester } from '../../src/adapters/jev-trades.ts';
import { createNominatimGeocoder } from '../../src/adapters/nominatim.ts';
import { createQuoteReader } from '../../src/adapters/quote-reader.ts';
import { DEMO_PLACES, mockApis, mockFetch } from '../../src/demo/mock-apis.ts';
import type { ClassifierQuestion, ListingDetails } from '../../src/ports.ts';
import { AVAILABILITY, TRADES, URGENCIES, type Trade } from '../../src/shared.ts';

const fetch = mockFetch();
const classifier = createJevClassifier({ baseUrl: 'http://mock.local/jev', apiKey: 'demo', fetch });
const tradeSuggester = createJevTradeSuggester({ baseUrl: 'http://mock.local/jev', apiKey: 'demo', fetch });
const imageMatcher = createImageMatcher({ baseUrl: 'http://mock.local/vision', apiKey: 'demo', fetch });
const quoteReader = createQuoteReader({
  baseUrl: 'http://mock.local/quotes',
  apiKey: 'demo',
  clock: { now: () => new Date('2026-10-08T09:00:00+11:00') }, // a Thursday
  timeZone: 'Australia/Sydney',
  fetch,
});
// The mock needs no pacing between requests, so the geocoder doesn't wait.
const geocoder = createNominatimGeocoder({ baseUrl: 'http://mock.local/nominatim', userAgent: 'myEST8 (test)', fetch, wait: async () => {} });
const places = createGooglePlaces({ apiKey: 'demo', fetch, placesBaseUrl: 'http://mock.local/google/places', geocodeBaseUrl: 'http://mock.local/google/maps' });

type Item = { ref: string; summary: string };

/** One question's answer, as the app would ask it. */
async function ask(text: string, state: object, question: ClassifierQuestion) {
  const answers = await classifier.classify({ text, state, questions: [question] });
  return answers[question.id];
}

const LEAKING_TAP: Item = { ref: 'issue:1', summary: 'Reported issue (gathering): The kitchen tap is leaking' };
const TICKET: Item = { ref: 'ticket:2', summary: 'Ticket: The bedroom door will not close' };
const URGENT_REPAIR: Item = { ref: 'urgent_repair:3', summary: 'Urgent Repair waiting for a receipt: Burst pipe in the laundry' };

const tenant = (openItems: Item[] = [], hasAttachments = false) => ({ senderRole: 'tenant', hasAttachments, waitingForAnswers: [], openItems });
const refsOf = (items: Item[]) => ({ id: 'relatedItem', options: [...items.map((i) => i.ref), 'none'] });

describe('mock classifier', () => {
  test.each([
    ['There is a burst pipe and the bathroom is flooding', 'urgent', 0.9],
    ['I can smell gas in the kitchen', 'urgent', 0.9],
    ['The front door has a broken lock', 'urgent', 0.9],
    ['There is mould on the bedroom ceiling', 'high', 0.9],
    ['The kitchen tap is leaking', 'high', 0.9],
    ['The kitchen tap is dripping', 'routine', 0.8],
    ['The power point is buzzing and warm to touch', 'urgent', 0.5],
  ])('urgency: %s -> %s', async (text, answer, confidence) => {
    expect(await ask(text, tenant(), { id: 'urgency', options: URGENCIES })).toEqual({ answer, confidence });
  });

  test('urgency: a "yes, it is getting worse" answer makes it High', async () => {
    const state = { senderRole: 'tenant', answers: { location: 'laundry', started: 'last week', worsening: 'yes', availability: null } };
    expect(await ask('The dryer makes a noise', state, { id: 'urgency', options: URGENCIES })).toEqual({ answer: 'high', confidence: 0.9 });
  });

  test.each([
    ['The toilet will not stop running', 'plumbing', 0.9],
    ['The powerpoint in the lounge has stopped working', 'electrical', 0.9],
    ['A cupboard hinge has come off', 'carpentry', 0.9],
    ['Water is coming through the roof', 'roofing', 0.9],
    ['The dishwasher is leaking', 'appliances', 0.9],
    ['I am locked out', 'locksmith', 0.9],
    ['There are cockroaches in the kitchen', 'pest_control', 0.9],
    ['Something is wrong in the hallway', 'general_handyman', 0.5],
  ])('trade: %s -> %s', async (text, answer, confidence) => {
    expect(await ask(text, tenant(), { id: 'trade', options: TRADES })).toEqual({ answer, confidence });
  });

  const MESSAGE_CLASS = { id: 'messageClass', options: ['new_issue', 'update', 'common_area', 'other'] };
  test.each([
    ['The lift in our building is broken', [], 'common_area', 0.9],
    ['When is my rent payment due?', [], 'other', 0.9],
    ['Any update on the leaking tap?', [LEAKING_TAP], 'update', 0.9],
    ['Any update on the leaking tap?', [], 'new_issue', 0.8],
    ['The oven will not turn on', [LEAKING_TAP], 'new_issue', 0.8],
    ['Help!', [], 'new_issue', 0.5],
  ])('message class: %s (open items: %j) -> %s', async (text, openItems, answer, confidence) => {
    expect(await ask(text, tenant(openItems), MESSAGE_CLASS)).toEqual({ answer, confidence });
  });

  test('message class: an attachment while an Urgent Repair waits for its receipt is an update', async () => {
    expect(await ask('Here you go', tenant([URGENT_REPAIR], true), MESSAGE_CLASS)).toEqual({ answer: 'update', confidence: 0.9 });
  });

  test.each([
    ['an update names its item by its words', 'Still waiting on the bedroom door', tenant([LEAKING_TAP, TICKET]), 'ticket:2', 0.9],
    ['an update about the only open item', 'Any update?', tenant([LEAKING_TAP]), 'issue:1', 0.9],
    ['an update it cannot place is a guess at the first item', 'Any update?', tenant([LEAKING_TAP, TICKET]), 'issue:1', 0.6],
    ['a receipt goes to the Urgent Repair', 'Receipt attached', tenant([LEAKING_TAP, URGENT_REPAIR], true), 'urgent_repair:3', 0.9],
    ['a housemate reporting the same issue', 'Our kitchen tap is leaking everywhere', tenant([LEAKING_TAP]), 'issue:1', 0.9],
    ['a new, unrelated issue', 'The oven will not turn on', tenant([LEAKING_TAP]), 'none', 0.9],
  ])('related item: %s', async (_, text, state, answer, confidence) => {
    expect(await ask(text, state, refsOf(state.openItems))).toEqual({ answer, confidence });
  });

  const QUOTE_REQUEST: Item = { ref: 'quote_request:7', summary: 'Quote Request: plumbing job in Newtown' };
  const WORK_ORDER: Item = { ref: 'work_order:8', summary: 'Work Order: plumbing at 12 King St, Newtown NSW 2042, Tue 13 Oct, 9:00 am' };
  const OTHER_QUOTE_REQUEST: Item = { ref: 'quote_request:9', summary: 'Quote Request: plumbing job in Bondi' };
  test.each([
    ['the only item waiting on them', '$450, can do Tue 9am', [QUOTE_REQUEST], 'quote_request:7', 0.9],
    ['a quote goes to the Quote Request, not the Work Order', '$450, can do Tue 9am', [WORK_ORDER, QUOTE_REQUEST], 'quote_request:7', 0.9],
    ['"all done" goes to the Work Order', 'All done', [QUOTE_REQUEST, WORK_ORDER], 'work_order:8', 0.9],
    ['several of the same kind is a guess at the first', '$450 inc GST', [OTHER_QUOTE_REQUEST, QUOTE_REQUEST], 'quote_request:9', 0.6],
  ])('related item for a Tradie: %s', async (_, text, waitingItems, answer, confidence) => {
    const state = { senderRole: 'tradie', hasAttachments: false, waitingItems };
    expect(await ask(text, state, refsOf(waitingItems))).toEqual({ answer, confidence });
  });

  test.each([
    ['Can we reschedule? I cannot make Tuesday', false, 'reschedule_request'],
    ['Confirmed, see you then', false, 'visit_confirmed'],
    ['Here is the receipt for the plumber', true, 'receipt'],
    ['The tap is still leaking a bit', false, 'general'],
  ])('update type: %s -> %s', async (text, hasAttachments, answer) => {
    const question = { id: 'updateType', options: ['general', 'reschedule_request', 'visit_confirmed', 'receipt'] };
    expect((await ask(text, tenant([TICKET], hasAttachments), question))?.answer).toBe(answer);
  });

  test.each([
    ['answer:guided', ['answer', 'not_an_answer'], 'Under the kitchen sink', 'answer'],
    ['answer:guided', ['yes', 'no', 'not_an_answer'], 'Yes, it is getting worse', 'yes'],
    ['answer:guided', ['yes', 'no', 'not_an_answer'], 'Not really', 'no'],
    ['answer:guided', [...AVAILABILITY, 'not_an_answer'], '2', 'weekday_afternoons'],
    ['answer:guided', [...AVAILABILITY, 'not_an_answer'], 'Saturday mornings are best', 'saturdays'],
    ['answer:guided', [...AVAILABILITY, 'not_an_answer'], 'Any time', 'any_time'],
    ['answer:guided', [...AVAILABILITY, 'not_an_answer'], 'Who is this?', 'not_an_answer'],
    ['answer:fix_rating', ['1', '2', '3', '4', '5', 'not_an_answer'], '4, thanks', '4'],
    ['answer:fix_rating', ['1', '2', '3', '4', '5', 'not_an_answer'], 'Great job', 'not_an_answer'],
    ['answer:visit', ['confirm', 'reschedule', 'not_an_answer'], 'YES', 'confirm'],
    ['answer:visit', ['confirm', 'reschedule', 'not_an_answer'], 'Can we do another day?', 'reschedule'],
  ])('%s %j: %s -> %s', async (id, options, text, answer) => {
    expect(await ask(text, tenant(), { id, options })).toEqual({ answer, confidence: 0.9 });
  });

  const TRADIE_REPLY = { id: 'replyType', options: ['quote', 'decline', 'reschedule_request', 'done', 'other'] };
  test.each([
    ['All done, tap replaced', 'done', 0.9],
    ['No thanks, too busy this month', 'decline', 0.9],
    ['Need to reschedule, can we do another day?', 'reschedule_request', 0.9],
    ['$1,234.50 and I can get it done Tue 9am', 'quote', 0.9],
    ['450 dollars', 'quote', 0.9],
    ['Who is this?', 'other', 0.8],
  ])('Tradie reply type: %s -> %s', async (text, answer, confidence) => {
    expect(await ask(text, { senderRole: 'tradie', waitingItems: [] }, TRADIE_REPLY)).toEqual({ answer, confidence });
  });

  test.each([
    ['YES', 'approval_answer', 'yes'],
    ['No, too expensive', 'approval_answer', 'no'],
    ['I do not approve this', 'approval_answer', 'no'],
    ['Can you call me about this?', 'other', 'yes'],
  ])('Property Owner: %s -> %s, %s', async (text, replyType, answer) => {
    const answers = await classifier.classify({
      text,
      state: { senderRole: 'property_owner', waitingItems: [] },
      questions: [
        { id: 'replyType', options: ['approval_answer', 'other'] },
        { id: 'answer', options: ['yes', 'no'] },
      ],
    });
    expect([answers.replyType?.answer, answers.answer?.answer]).toEqual([replyType, answer]);
  });

  test('an Owner reply that is neither YES nor NO is an unsure answer', async () => {
    expect(await ask('Can you call me?', { senderRole: 'property_owner' }, { id: 'answer', options: ['yes', 'no'] })).toEqual({ answer: 'yes', confidence: 0.5 });
  });

  test('a question it has no rule for gets its first option, unsure', async () => {
    expect(await ask('Hello', tenant(), { id: 'mood', options: ['happy', 'sad'] })).toEqual({ answer: 'happy', confidence: 0.5 });
  });
});

/** A listing with nothing in it that names a Trade, then what each test gives it. */
const listing = (overrides: Partial<ListingDetails>): ListingDetails => ({
  placeId: 'demo-test',
  name: 'Acme Pty Ltd',
  address: '1 King St, Newtown NSW 2042',
  phone: null,
  website: null,
  types: ['point_of_interest', 'establishment'],
  primaryType: null,
  summary: null,
  rating: null,
  reviewCount: 0,
  ...overrides,
});

describe('mock trade suggestions', () => {
  test.each<[string, Trade[]]>([
    ['demo-petes-plumbing', ['plumbing']],
    ['demo-quick-pipes', ['plumbing']],
    ['demo-ninas-plumbing', ['plumbing']],
    ['demo-sparky-sam', ['electrical']],
    ['demo-fixit-carpentry', ['carpentry']],
    ['demo-cool-appliances', ['electrical', 'appliances']],
    ['demo-ridgeline-roofing', ['roofing']],
    ['demo-appliance-rescue', ['appliances']],
    ['demo-handy-harry', ['general_handyman']],
    ['demo-bugs-away', ['pest_control']],
  ])("the demo listing %s is suggested %j, through the real adapter", async (placeId, trades) => {
    expect(await tradeSuggester.suggestTrades(await places.listingDetails(placeId))).toEqual(trades);
  });

  test.each<[Trade, Partial<ListingDetails>]>([
    ['plumbing', { name: 'Reliable Plumbers' }],
    ['electrical', { primaryType: 'Electrician' }],
    ['carpentry', { summary: 'Custom joinery and cabinets.' }],
    ['roofing', { types: ['roofing_contractor'] }],
    ['appliances', { name: 'Fridge Fixers' }],
    ['locksmith', { name: 'Keys & Locks 24/7', types: ['locksmith'] }],
    ['pest_control', { name: 'Termite Busters' }],
    ['general_handyman', { website: 'https://handyman-sydney.example' }],
  ])('%s is suggested from its keywords in the listing', async (trade, overrides) => {
    expect(await tradeSuggester.suggestTrades(listing(overrides))).toEqual([trade]);
  });

  test('a listing with no keyword gets no suggestions, and "blocked" is not a lock', async () => {
    expect(await tradeSuggester.suggestTrades(listing({}))).toEqual([]);
    expect(await tradeSuggester.suggestTrades(listing({ summary: 'We clear blocked access roads.' }))).toEqual([]);
  });

  test('a business that does several Trades is suggested all of them', async () => {
    expect(await tradeSuggester.suggestTrades(listing({ name: 'Sparks & Pipes', summary: 'Plumbing and electrical.' }))).toEqual(['plumbing', 'electrical']);
  });

  test('answers every Trade asked, as noul probabilities', async () => {
    const response = await mockApis().request('http://mock.local/jev/v1/systemone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { name: "Pete's Plumbing", types: ['plumber'] },
        questions: { plumbing: { type: 'noul', instructions: 'Plumbing?', criteria: { true: 'Yes', false: 'No' } }, locksmith: { type: 'noul', instructions: 'Locks?', criteria: { true: 'Yes', false: 'No' } } },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answers: { plumbing: { type: 'noul', noul: 0.9 }, locksmith: { type: 'noul', noul: 0.1 } } });
  });

  test.each([
    ['no questions', { state: {}, questions: {} }],
    ['no state', { questions: { plumbing: { type: 'noul' } } }],
    ['a question that is not a noul', { state: {}, questions: { plumbing: { type: 'choice' } } }],
    ['a question that is not about a Trade', { state: {}, questions: { painting: { type: 'noul' } } }],
    ['a body that is not JSON', 'nope'],
  ])('refuses %s with a 422, as TypeSafe does for a bad request', async (_, body) => {
    const response = await mockApis().request('http://mock.local/jev/v1/systemone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    expect(response.status).toBe(422);
  });

  test('the classifier route is still served', async () => {
    const response = await mockApis().request('http://mock.local/jev/v1/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: {}, questions: [] }) });
    expect(response.status).toBe(200);
  });
});

describe('mock image matcher', () => {
  test('a photo matches, with a demo reason', async () => {
    const photos = [{ contentType: 'image/jpeg', content: new Uint8Array([1, 2, 3]) }];
    expect(await imageMatcher.match({ description: 'The kitchen tap is leaking all over the floor', photos })).toEqual({
      result: 'matches',
      reason: "Demo check: photo received for 'The kitchen tap is leaking all over the '",
    });
  });

  test('no photos is unclear', async () => {
    expect(await imageMatcher.match({ description: 'Leaking tap', photos: [] })).toEqual({ result: 'unclear', reason: 'Demo check: no photos to compare' });
  });
});

describe('mock quote reader', () => {
  test.each([
    ['Can do Tue 9am, $450 inc GST', { priceCents: 45000, proposedTime: new Date('2026-10-13T09:00:00+11:00') }],
    ['$1,234.50. Monday at 10:30am suits', { priceCents: 123450, proposedTime: new Date('2026-10-12T10:30:00+11:00') }],
    ['450 dollars, tomorrow 2pm', { priceCents: 45000, proposedTime: new Date('2026-10-09T14:00:00+11:00') }],
    ['600 inc GST, 8am Saturday', { priceCents: 60000, proposedTime: new Date('2026-10-10T08:00:00+11:00') }],
    ['$300, Thu 9am', { priceCents: 30000, proposedTime: new Date('2026-10-15T09:00:00+11:00') }],
    ['$300, Thu 11am', { priceCents: 30000, proposedTime: new Date('2026-10-08T11:00:00+11:00') }],
    ['I will send a price soon', {}],
  ])('%s', async (text, expected) => {
    expect(await quoteReader.read({ text })).toEqual(expected);
  });

  test('a price in an uncompressed PDF is read when the text has none', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4 BT (Total: $880.00 inc GST) Tj ET');
    expect(await quoteReader.read({ text: 'Quote attached', pdf })).toEqual({ priceCents: 88000 });
  });
});

describe('mock Google Places', () => {
  test.each([
    ['plumbing', ["Pete's Plumbing", 'Flow Bros Plumbing', "Nina's Plumbing"]],
    ["Pete's Plumbing Marrickville", ["Pete's Plumbing"]],
    ['glebe', ['Sparky Sam Electrical']],
    ['roofer', []],
  ])('search %s', async (query, names) => {
    expect((await places.findListings(query)).map((l) => l.name)).toEqual(names);
  });

  test('a listing has its id, name and address', async () => {
    expect(await places.findListings('Quick Pipes')).toEqual([{ placeId: 'demo-quick-pipes', name: 'Quick Pipes', address: '88 Regent St, Redfern NSW 2016' }]);
  });

  test('details give the rating, and an unknown place is a 404', async () => {
    expect(await places.getRating('demo-flow-bros')).toEqual({ rating: 4.9, reviewCount: 15 });
    await expect(places.getRating('demo-nobody')).rejects.toThrow('Google Place Details returned 404');
  });

  test("listing details give a place's phone, website, types and summary", async () => {
    expect(await places.listingDetails('demo-petes-plumbing')).toEqual({
      placeId: 'demo-petes-plumbing',
      name: "Pete's Plumbing",
      address: '4 Illawarra Rd, Marrickville NSW 2204',
      phone: '+61 412 555 018',
      website: 'https://petes-plumbing.example',
      types: ['plumber', 'point_of_interest', 'establishment'],
      primaryType: 'Plumber',
      summary: 'Local plumbers for blocked drains, leaks and hot water systems.',
      rating: 4.8,
      reviewCount: 120,
    });
  });

  test('some demo listings are landlines, or have no website or summary, as real ones do', async () => {
    expect((await places.listingDetails('demo-quick-pipes')).phone).toBe('+61 2 9319 0044');
    const harry = await places.listingDetails('demo-handy-harry');
    expect([harry.phone, harry.website, harry.summary]).toEqual([null, null, null]);
  });

  test('every demo listing has details, and the search answer still holds only what its field mask names', async () => {
    for (const { placeId } of DEMO_PLACES) expect((await places.listingDetails(placeId)).types.length).toBeGreaterThan(0);
    const response = await mockApis().request('http://mock.local/google/places/v1/places:searchText', {
      method: 'POST',
      headers: { 'x-goog-fieldmask': 'places.id,places.displayName', 'content-type': 'application/json' },
      body: JSON.stringify({ textQuery: 'Quick Pipes' }),
    });
    expect(await response.json()).toEqual({ places: [{ id: 'demo-quick-pipes', displayName: { text: 'Quick Pipes', languageCode: 'en' } }] });
  });

  test('details of an unknown place are a 404', async () => {
    await expect(places.listingDetails('demo-nobody')).rejects.toThrow('Google Place Details returned 404');
  });

  test.each([
    ['12 King St, Newtown NSW 2042', { lat: -33.897, lng: 151.179 }],
    ['5/40 Ocean Ave, Bondi NSW 2026', { lat: -33.8908, lng: 151.2743 }],
    ['7 Wilson St Newtown NSW 2042', { lat: -33.8955, lng: 151.1823 }],
    ['21 Glebe Point Rd, Glebe NSW 2037', { lat: -33.879, lng: 151.187 }],
    ['4 Illawarra Rd, Marrickville NSW 2204', { lat: -33.906, lng: 151.158 }],
    ['1 Nowhere Rd', { lat: -33.875, lng: 151.2135 }],
  ])('geocode %s', async (address, location) => {
    expect(await places.geocode(address)).toEqual(location);
  });

  test.each([
    ['12 King St, Newtown NSW 2042', { lat: -33.897, lng: 151.179 }],
    ['5/40 Ocean Ave, Bondi NSW 2026', { lat: -33.8908, lng: 151.2743 }],
    ['7 Wilson St Newtown NSW 2042', { lat: -33.8955, lng: 151.1823 }],
    ['21 Glebe Point Rd, Glebe NSW 2037', { lat: -33.879, lng: 151.187 }],
    ['4 Illawarra Rd, Marrickville NSW 2204', { lat: -33.906, lng: 151.158 }],
    ['1 Nowhere Rd', { lat: -33.875, lng: 151.2135 }],
  ])('Nominatim geocode %s', async (address, location) => {
    expect(await geocoder.geocode(address)).toEqual(location);
  });

  test('Nominatim answers in jsonv2: the point as strings, and a street-level place_rank', async () => {
    const response = await mockApis().request('http://mock.local/nominatim/search?q=12+King+St%2C+Newtown+NSW+2042&format=jsonv2&limit=1&countrycodes=au');
    expect(await response.json()).toMatchObject([{ lat: '-33.897', lon: '151.179', place_rank: 30, display_name: '12 King St, Newtown NSW 2042' }]);
  });

  test('Nominatim finds nothing for an empty query', async () => {
    const response = await mockApis().request('http://mock.local/nominatim/search?q=&format=jsonv2');
    expect(await response.json()).toEqual([]);
  });

  test('geocoding an empty address has no results, at either geocode path', async () => {
    const app = mockApis();
    for (const path of ['/google/maps/api/geocode/json', '/google/maps/maps/api/geocode/json']) {
      const response = await app.request(`http://mock.local${path}?address=&key=demo`);
      expect(await response.json()).toEqual({ results: [], status: 'ZERO_RESULTS' });
    }
  });

  test('the Places API needs a field mask, as Google does', async () => {
    const response = await mockApis().request('http://mock.local/google/places/v1/places/demo-flow-bros');
    expect(response.status).toBe(400);
  });
});
