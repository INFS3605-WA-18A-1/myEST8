import { describe, expect, test } from 'vitest';
import { createStreetView } from '../../src/adapters/street-view.ts';
import { json, stubFetch } from './stub-fetch.ts';

const KEY = 'super-secret-google-key';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const POINT = { lat: -33.897, lng: 151.179 };
const ADDRESS = '12 King St, Newtown NSW 2042';

const meta = (status: string) => json({ status, copyright: '© Google' });
const image = () => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });

function streetView(respond: () => Response) {
  const stub = stubFetch(respond);
  return { stub, photos: createStreetView({ apiKey: KEY, fetch: stub.fetch }) };
}

function scripted(steps: Response[]) {
  const pending = [...steps];
  return streetView(() => pending.shift() ?? new Response('no more responses', { status: 500 }));
}

const locationOf = (request: Request) => new URL(request.url).searchParams.get('location');

describe('Street View photos', () => {
  test('no imagery is null, and the image is not fetched', async () => {
    const { stub, photos } = scripted([meta('ZERO_RESULTS')]);

    expect(await photos.lookup({ address: ADDRESS, location: null })).toBeNull();
    expect(stub.requests).toHaveLength(1);
    const url = new URL(stub.requests[0]!.url);
    expect(url.pathname).toBe('/maps/api/streetview/metadata');
    expect(url.searchParams.get('location')).toBe(ADDRESS);
    expect(url.searchParams.get('key')).toBe(KEY);
    expect(url.searchParams.get('size')).toBeNull();
  });

  test('NOT_FOUND is no imagery too', async () => {
    const { photos } = scripted([meta('NOT_FOUND')]);
    expect(await photos.lookup({ address: ADDRESS, location: null })).toBeNull();
  });

  test('OK returns the image bytes, and only then is the image fetched', async () => {
    const { stub, photos } = scripted([meta('OK'), image()]);

    expect(await photos.lookup({ address: ADDRESS, location: POINT })).toEqual({ contentType: 'image/jpeg', content: JPEG });
    expect(stub.requests.map((request) => new URL(request.url).pathname)).toEqual(['/maps/api/streetview/metadata', '/maps/api/streetview']);
    expect(locationOf(stub.requests[0]!)).toBe(`${POINT.lat},${POINT.lng}`);
    const picture = new URL(stub.requests[1]!.url);
    expect(picture.searchParams.get('location')).toBe(`${POINT.lat},${POINT.lng}`);
    expect(picture.searchParams.get('size')).toBe('640x400');
    expect(picture.searchParams.get('fov')).toBe('80');
    expect(picture.searchParams.get('source')).toBe('outdoor');
    expect(picture.searchParams.get('key')).toBe(KEY);
  });

  test('a point with no imagery falls back to the address', async () => {
    const { stub, photos } = scripted([meta('ZERO_RESULTS'), meta('OK'), image()]);

    expect(await photos.lookup({ address: ADDRESS, location: POINT })).toEqual({ contentType: 'image/jpeg', content: JPEG });
    expect(stub.requests.map(locationOf)).toEqual([`${POINT.lat},${POINT.lng}`, ADDRESS, ADDRESS]);
  });

  test('nothing to look up asks for nothing', async () => {
    const { stub, photos } = scripted([]);
    expect(await photos.lookup({ address: '  ', location: null })).toBeNull();
    expect(stub.requests).toHaveLength(0);
  });

  test('a failed lookup throws, and a metadata failure does not fetch the image', async () => {
    const denied = scripted([meta('REQUEST_DENIED')]);
    await expect(denied.photos.lookup({ address: ADDRESS, location: null })).rejects.toThrow('Google Street View returned REQUEST_DENIED');
    expect(denied.stub.requests).toHaveLength(1);

    const down = scripted([new Response('unavailable', { status: 503 })]);
    await expect(down.photos.lookup({ address: ADDRESS, location: null })).rejects.toThrow('Google Street View returned 503: unavailable');

    const odd = scripted([json({ copyright: '© Google' })]);
    await expect(odd.photos.lookup({ address: ADDRESS, location: null })).rejects.toThrow('expected a status');
  });

  test('the key is not in an error, even when the failure mentions it', async () => {
    const network = streetView(() => {
      throw new Error(`connect ECONNREFUSED https://maps.googleapis.com/maps/api/streetview/metadata?key=${KEY}`);
    });
    await expect(network.photos.lookup({ address: ADDRESS, location: null })).rejects.toThrow('[redacted]');
    await expect(network.photos.lookup({ address: ADDRESS, location: null })).rejects.not.toThrow(KEY);

    const echoed = scripted([new Response(`denied for ${KEY}`, { status: 500 })]);
    const error = await echoed.photos.lookup({ address: ADDRESS, location: POINT }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(KEY);
    expect(String(error)).toContain('[redacted]');
  });
});
