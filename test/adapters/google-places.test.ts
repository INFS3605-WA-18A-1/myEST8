import { describe, expect, test } from 'vitest';
import { createGooglePlaces } from '../../src/adapters/google-places.ts';
import { json, stubFetch } from './stub-fetch.ts';

const places = (respond: () => Response) => {
  const stub = stubFetch(respond);
  return { stub, google: createGooglePlaces({ apiKey: 'google-key', fetch: stub.fetch }) };
};

describe('Google Places Text Search', () => {
  test('posts the query with the key and field mask, and returns the listings', async () => {
    const { stub, google } = places(() =>
      json({
        places: [
          {
            id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
            displayName: { text: "Pete's Plumbing", languageCode: 'en' },
            formattedAddress: '4 Illawarra Rd, Marrickville NSW 2204, Australia',
          },
        ],
      }),
    );

    expect(await google.findListings("Pete's Plumbing Marrickville")).toEqual([
      { placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4', name: "Pete's Plumbing", address: '4 Illawarra Rd, Marrickville NSW 2204, Australia' },
    ]);
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(request.headers.get('x-goog-api-key')).toBe('google-key');
    expect(request.headers.get('x-goog-fieldmask')).toBe('places.id,places.displayName,places.formattedAddress');
    expect(request.headers.get('authorization')).toBeNull();
    expect(await request.json()).toEqual({ textQuery: "Pete's Plumbing Marrickville" });
  });

  test('no matches comes back as an empty object', async () => {
    const { google } = places(() => json({}));
    expect(await google.findListings('nobody')).toEqual([]);
  });

  test.each([
    ['places is not a list', { places: {} }],
    ['a place without a display name', { places: [{ id: 'abc', formattedAddress: '1 King St' }] }],
  ])('a malformed response throws: %s', async (_, body) => {
    const { google } = places(() => json(body));
    await expect(google.findListings('plumber')).rejects.toThrow('Google Places Text Search returned a malformed response');
  });
});

describe('Google Place Details', () => {
  test('gets the rating and review count for a place', async () => {
    const { stub, google } = places(() => json({ rating: 4.8, userRatingCount: 120 }));

    expect(await google.getRating('ChIJN1t_tDeuEmsRUsoyG83frY4')).toEqual({ rating: 4.8, reviewCount: 120 });
    const request = stub.requests[0]!;
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4');
    expect(request.headers.get('x-goog-api-key')).toBe('google-key');
    expect(request.headers.get('x-goog-fieldmask')).toBe('rating,userRatingCount');
  });

  test('a place with no reviews has no rating', async () => {
    const { google } = places(() => json({}));
    expect(await google.getRating('abc')).toEqual({ rating: null, reviewCount: 0 });
  });

  test('a non-2xx response throws with its status and Google error', async () => {
    const { google } = places(() => json({ error: { code: 404, message: 'Place not found.', status: 'NOT_FOUND' } }, 404));
    await expect(google.getRating('gone')).rejects.toThrow('Google Place Details returned 404: {"error":{"code":404');
  });

  test('a rating that is not a number throws', async () => {
    const { google } = places(() => json({ rating: 'great' }));
    await expect(google.getRating('abc')).rejects.toThrow('rating is not a number');
  });
});

describe('Google listing details', () => {
  const PETES = {
    id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    displayName: { text: "Pete's Plumbing", languageCode: 'en' },
    formattedAddress: '4 Illawarra Rd, Marrickville NSW 2204, Australia',
    nationalPhoneNumber: '(02) 9555 0100',
    internationalPhoneNumber: '+61 2 9555 0100',
    websiteUri: 'https://petesplumbing.example/',
    types: ['plumber', 'point_of_interest', 'establishment'],
    primaryTypeDisplayName: { text: 'Plumber', languageCode: 'en' },
    editorialSummary: { text: 'Local plumbers for blocked drains and hot water.', languageCode: 'en' },
    rating: 4.8,
    userRatingCount: 120,
  };

  test('gets the details of a place, asking only for the fields it uses', async () => {
    const { stub, google } = places(() => json(PETES));

    expect(await google.listingDetails('ChIJN1t_tDeuEmsRUsoyG83frY4')).toEqual({
      placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      name: "Pete's Plumbing",
      address: '4 Illawarra Rd, Marrickville NSW 2204, Australia',
      phone: '+61 2 9555 0100',
      website: 'https://petesplumbing.example/',
      types: ['plumber', 'point_of_interest', 'establishment'],
      primaryType: 'Plumber',
      summary: 'Local plumbers for blocked drains and hot water.',
      rating: 4.8,
      reviewCount: 120,
    });
    const request = stub.requests[0]!;
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4');
    expect(request.headers.get('x-goog-api-key')).toBe('google-key');
    expect(request.headers.get('x-goog-fieldmask')).toBe(
      'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,types,primaryTypeDisplayName,editorialSummary,rating,userRatingCount',
    );
  });

  test('a place with only a national number gives that as the phone', async () => {
    const { internationalPhoneNumber: _, ...nationalOnly } = PETES;
    const { google } = places(() => json(nationalOnly));
    expect((await google.listingDetails('abc')).phone).toBe('(02) 9555 0100');
  });

  test('a place with no phone, website, summary, type or reviews has nulls and nothing', async () => {
    const { google } = places(() => json({ id: 'abc', displayName: { text: 'Bare Plumbing' }, formattedAddress: '1 King St' }));
    expect(await google.listingDetails('abc')).toEqual({
      placeId: 'abc',
      name: 'Bare Plumbing',
      address: '1 King St',
      phone: null,
      website: null,
      types: [],
      primaryType: null,
      summary: null,
      rating: null,
      reviewCount: 0,
    });
  });

  test.each([
    ['a place without an id', { displayName: { text: 'Bare Plumbing' } }],
    ['a place without a display name', { id: 'abc' }],
    ['types that are not a list of text', { id: 'abc', displayName: { text: 'Bare Plumbing' }, types: 'plumber' }],
    ['a rating that is not a number', { id: 'abc', displayName: { text: 'Bare Plumbing' }, rating: 'great' }],
  ])('a malformed response throws: %s', async (_, body) => {
    const { google } = places(() => json(body));
    await expect(google.listingDetails('abc')).rejects.toThrow('Google Place Details returned a malformed response');
  });

  test('a non-2xx response throws with its status', async () => {
    const { google } = places(() => json({ error: { code: 404, message: 'Place not found.', status: 'NOT_FOUND' } }, 404));
    await expect(google.listingDetails('gone')).rejects.toThrow('Google Place Details returned 404');
  });
});

describe('Google Geocoding', () => {
  test('gets the first result location for an address, with the key in the query', async () => {
    const { stub, google } = places(() =>
      json({ results: [{ formatted_address: '12 King St, Newtown NSW 2042, Australia', geometry: { location: { lat: -33.897, lng: 151.179 } } }], status: 'OK' }),
    );

    expect(await google.geocode('12 King St, Newtown NSW 2042')).toEqual({ lat: -33.897, lng: 151.179 });
    const url = new URL(stub.requests[0]!.url);
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/geocode/json');
    expect(url.searchParams.get('address')).toBe('12 King St, Newtown NSW 2042');
    expect(url.searchParams.get('key')).toBe('google-key');
    expect(url.searchParams.get('region')).toBe('au');
  });

  test("a Tradie's business address with a unit geocodes the same way", async () => {
    const { stub, google } = places(() =>
      json({
        results: [{ formatted_address: 'Unit 3/45 Sydenham Rd, Marrickville NSW 2204, Australia', geometry: { location: { lat: -33.9105, lng: 151.1601 }, location_type: 'ROOFTOP' } }],
        status: 'OK',
      }),
    );
    expect(await google.geocode('Unit 3, 45 Sydenham Rd, Marrickville NSW 2204')).toEqual({ lat: -33.9105, lng: 151.1601 });
    expect(new URL(stub.requests[0]!.url).searchParams.get('address')).toBe('Unit 3, 45 Sydenham Rd, Marrickville NSW 2204');
  });

  test('a result only placed at the suburb or postcode (APPROXIMATE) is no location', async () => {
    const { google } = places(() =>
      json({
        results: [{ formatted_address: 'Newtown NSW 2042, Australia', geometry: { location: { lat: -33.8983, lng: 151.1785 }, location_type: 'APPROXIMATE' }, partial_match: true }],
        status: 'OK',
      }),
    );
    expect(await google.geocode('99 Madeup Lane, Newtown NSW 2042')).toBeNull();
  });

  test('no results is no location, and a blank address is not looked up', async () => {
    const { stub, google } = places(() => json({ results: [], status: 'ZERO_RESULTS' }));
    expect(await google.geocode('1 Nowhere Rd')).toBeNull();
    expect(await google.geocode('  ')).toBeNull();
    expect(stub.requests).toHaveLength(1);
  });

  test.each([
    ['a denied request', () => json({ results: [], status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' }), 'Google Geocoding returned REQUEST_DENIED: The provided API key is invalid.'],
    ['a server error', () => new Response('Internal error', { status: 500 }), 'Google Geocoding returned 500: Internal error'],
    ['OK with no geometry', () => json({ results: [{}], status: 'OK' }), 'no geometry.location on the first result'],
  ])('throws on %s', async (_, respond, message) => {
    const { google } = places(respond);
    await expect(google.geocode('12 King St, Newtown NSW 2042')).rejects.toThrow(message);
  });

  test('the error never includes the URL, which carries the key', async () => {
    const { google } = places(() => new Response('Internal error', { status: 500 }));
    const error = await google.geocode('12 King St').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('google-key');
  });
});
