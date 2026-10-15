// Supabase Storage (REST, private bucket) as the BlobStore. The service-role key
// stays on the server; browsers and providers only ever hold signed URLs.

import type { BlobStore } from '../ports.ts';
import { callJson, isObject, malformed } from './json-api.ts';

const TIMEOUT_MS = 30_000;

export function createSupabaseStorage(o: { url: string; serviceKey: string; bucket?: string; fetch?: typeof fetch }): BlobStore {
  const base = `${o.url.replace(/\/$/, '')}/storage/v1`;
  const bucket = o.bucket ?? 'files';
  const fetchImpl = o.fetch ?? fetch;
  const auth = { authorization: `Bearer ${o.serviceKey}`, apikey: o.serviceKey };
  // A path is app-made (agency id, uuid), but encode it anyway so a stray character can't change the route.
  const object = (path: string) => `${base}/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const sign = async (route: string, body: unknown) => {
    const result = await callJson(fetchImpl, 'Supabase Storage', route, { headers: auth, body });
    return result;
  };

  return {
    async put(path, content, contentType) {
      const response = await fetchImpl(object(path), {
        method: 'POST',
        headers: { ...auth, 'content-type': contentType, 'x-upsert': 'true' },
        body: content,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // The body is left out of the error: it can echo the request back.
      if (!response.ok) throw new Error(`Supabase Storage returned ${response.status} for an upload`);
    },

    async get(path) {
      const response = await fetchImpl(object(path), { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`Supabase Storage returned ${response.status} for a download`);
      return new Uint8Array(await response.arrayBuffer());
    },

    async remove(path) {
      const response = await fetchImpl(object(path), { method: 'DELETE', headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok && response.status !== 404) throw new Error(`Supabase Storage returned ${response.status} for a delete`);
    },

    async uploadUrl(path) {
      const result = await sign(`${base}/object/upload/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {});
      if (!isObject(result) || typeof result.url !== 'string') malformed('Supabase Storage', 'no url', result);
      return `${base}${result.url}`;
    },
  };
}
