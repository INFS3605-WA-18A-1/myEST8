import { describe, expect, test } from 'vitest';
import { createSupabaseStorage } from '../../src/adapters/supabase-storage.ts';
import { json, stubFetch } from './stub-fetch.ts';

const storage = (respond: Parameters<typeof stubFetch>[0]) => {
  const stub = stubFetch(respond);
  return { ...stub, blobs: createSupabaseStorage({ url: 'https://abc.supabase.co/', serviceKey: 'service-key', fetch: stub.fetch }) };
};

describe('Supabase Storage', () => {
  test('puts bytes in the private bucket with the service key and reads them back', async () => {
    const { blobs, requests } = storage((r) => (r.method === 'GET' ? new Response(new Uint8Array([1, 2, 3])) : new Response('{}')));
    await blobs.put('7/abc', new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(requests[0]!.url).toBe('https://abc.supabase.co/storage/v1/object/files/7/abc');
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer service-key');
    expect(requests[0]!.headers.get('content-type')).toBe('image/jpeg');
    expect([...(await blobs.get('7/abc'))]).toEqual([1, 2, 3]);
  });

  test('asks for an upload URL and returns it whole', async () => {
    const { blobs, requests } = storage(() => json({ url: '/object/upload/sign/files/staging/7/abc?token=t0k' }));
    expect(await blobs.uploadUrl('staging/7/abc')).toBe('https://abc.supabase.co/storage/v1/object/upload/sign/files/staging/7/abc?token=t0k');
    expect(requests[0]!.url).toBe('https://abc.supabase.co/storage/v1/object/upload/sign/files/staging/7/abc');
  });

  test('a failure names the status and never the key', async () => {
    const { blobs } = storage(() => new Response('{"error":"nope service-key"}', { status: 403 }));
    await expect(blobs.put('7/abc', new Uint8Array(), 'image/jpeg')).rejects.toThrow('Supabase Storage returned 403 for an upload');
    await expect(blobs.get('7/abc')).rejects.not.toThrow(/service-key/);
    await expect(blobs.remove('7/abc')).rejects.toThrow(/403/);
  });

  test('removing something already gone is fine', async () => {
    const { blobs } = storage(() => new Response('{}', { status: 404 }));
    await expect(blobs.remove('7/abc')).resolves.toBeUndefined();
  });
});
