import { describe, expect, test } from 'vitest';
import { createFileLinks } from '../src/file-links.ts';
import { createFiles } from '../src/files.ts';
import { createHttpApp } from '../src/http.ts';
import { HOUR, MINUTE } from './support/harness.ts';
import { world } from './support/world.ts';

const SECRET = 'a-test-secret-that-is-long-enough-1234';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

async function server() {
  const w = await world();
  const fileLinks = createFileLinks({ secret: SECRET, baseUrl: 'https://myest8.test', clock: w.h.clock });
  const http = createHttpApp(w.h.app, { publicUrl: 'https://myest8.test', twilioAuthToken: 'token', sendgridPublicKey: '', clock: w.h.clock, fileLinks });
  const fileId = await createFiles(w.h.db, w.h.clock).save(w.ids.agencyId, { filename: 'leak under sink.jpg', contentType: 'image/jpeg', content: JPEG });
  const get = (url: string) => http.request(new URL(url).pathname + new URL(url).search);
  return { ...w, http, fileLinks, fileId, get };
}

describe('signed file links', () => {
  test('a link serves the stored file, never cached and never run as a page', async () => {
    const { fileLinks, fileId, get } = await server();
    const response = await get(fileLinks.url(fileId));

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''leak%20under%20sink.jpg");
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  test('a link stops working when it expires', async () => {
    const { h, fileLinks, fileId, get } = await server();
    const url = fileLinks.url(fileId);
    h.clock.advance(HOUR - MINUTE);
    expect((await get(url)).status).toBe(200);
    h.clock.advance(MINUTE);
    expect((await get(url)).status).toBe(404);
  });

  test('a link can not be changed to reach another file, extend its expiry, or drop its signature', async () => {
    const { fileLinks, fileId, get } = await server();
    const url = new URL(fileLinks.url(fileId));
    const other = new URL(url);
    other.pathname = `/media/${fileId + 1}`;
    const later = new URL(url);
    later.searchParams.set('expires', String(Number(url.searchParams.get('expires')) + 86_400));
    const unsigned = new URL(url);
    unsigned.searchParams.delete('signature');

    for (const tampered of [other, later, unsigned]) expect((await get(tampered.href)).status).toBe(404);
  });

  test('a link signed with another secret is refused', async () => {
    const { h, fileId, get } = await server();
    const forged = createFileLinks({ secret: 'another-secret-that-is-long-enough-5678', baseUrl: 'https://myest8.test', clock: h.clock });
    expect((await get(forged.url(fileId))).status).toBe(404);
  });

  test('without file links configured, nothing is served', async () => {
    const w = await world();
    const http = createHttpApp(w.h.app, { publicUrl: 'https://myest8.test', twilioAuthToken: 'token', sendgridPublicKey: '', clock: w.h.clock });
    const fileLinks = createFileLinks({ secret: SECRET, baseUrl: 'https://myest8.test', clock: w.h.clock });
    const url = new URL(fileLinks.url(1));
    expect((await http.request(url.pathname + url.search)).status).toBe(404);
  });

  test.each([['0'], ['01'], ['1.5'], ['abc'], ['99999999999999999999']])('a malformed id %s is refused', (id) => {
    const fileLinks = createFileLinks({ secret: SECRET, baseUrl: 'https://myest8.test', clock: { now: () => new Date('2026-10-08T00:00:00Z') } });
    expect(fileLinks.check(id, '9999999999', 'c2ln')).toBe(false);
  });
});
