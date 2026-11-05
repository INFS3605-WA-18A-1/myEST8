// The PropertyPhotos port over Google's Street View Static API.
// Metadata is asked first (no image is billed when there is none); the image
// is fetched only when that status is OK. The key travels as a query parameter
// and is never written into an error.

import type { PropertyPhoto, PropertyPhotos } from '../ports.ts';

const TIMEOUT_MS = 15_000;
const EXCERPT_LENGTH = 200;

const excerpt = (text: string) => (text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** No panorama for that place. Anything else that isn't OK is a failed lookup. */
const NO_IMAGERY = new Set(['ZERO_RESULTS', 'NOT_FOUND']);

/** The PropertyPhotos port over the Street View Static API. */
export function createStreetView({
  apiKey,
  fetch: fetchImpl = fetch,
  baseUrl = 'https://maps.googleapis.com/maps/api/streetview',
}: {
  apiKey: string;
  fetch?: typeof fetch;
  /** The image endpoint. Metadata is `{baseUrl}/metadata`. */
  baseUrl?: string;
}): PropertyPhotos {
  const redact = (text: string) => (apiKey ? text.split(apiKey).join('[redacted]') : text);

  function fail(message: string): never {
    throw new Error(redact(message));
  }

  async function call(url: URL): Promise<Response> {
    try {
      return await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(`Google Street View failed: ${message}`);
    }
  }

  function endpoint(path: string, location: string, extra: Record<string, string> = {}) {
    const url = new URL(path ? `${baseUrl}/${path}` : baseUrl);
    url.searchParams.set('location', location);
    for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);
    url.searchParams.set('key', apiKey);
    return url;
  }

  /** The metadata status for one location. Throws when the lookup itself fails. */
  async function status(location: string): Promise<string> {
    const response = await call(endpoint('metadata', location));
    const text = await response.text();
    if (!response.ok) fail(`Google Street View returned ${response.status}: ${excerpt(text)}`);
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      fail(`Google Street View returned a body that is not JSON: ${excerpt(text)}`);
    }
    if (!isObject(body) || typeof body.status !== 'string') fail(`Google Street View returned a malformed response (expected a status): ${excerpt(text)}`);
    return body.status;
  }

  /** The image bytes. Called only after metadata said OK. */
  async function image(location: string): Promise<PropertyPhoto> {
    const response = await call(endpoint('', location, { size: '640x400', fov: '80', source: 'outdoor' }));
    if (!response.ok) {
      const text = await response.text();
      fail(`Google Street View returned ${response.status}: ${excerpt(text)}`);
    }
    const contentType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim().toLowerCase();
    if (!contentType.startsWith('image/')) fail(`Google Street View returned ${contentType || 'no image'}`);
    const content = new Uint8Array(await response.arrayBuffer());
    if (content.byteLength === 0) fail('Google Street View returned an empty image');
    return { contentType, content };
  }

  /** One location: the image, null when there is no imagery, or a throw when the lookup fails. */
  async function at(location: string): Promise<PropertyPhoto | null> {
    const found = await status(location);
    if (found === 'OK') return image(location);
    if (NO_IMAGERY.has(found)) return null;
    return fail(`Google Street View returned ${found}`);
  }

  return {
    async lookup(place) {
      const point = place.location ? `${place.location.lat},${place.location.lng}` : '';
      const address = place.address.trim();
      if (point) {
        const photo = await at(point);
        if (photo) return photo;
      }
      if (address) return at(address);
      return null;
    },
  };
}
