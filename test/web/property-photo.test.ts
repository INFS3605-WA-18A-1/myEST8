import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("a Property's photo", () => {
  test('the profile shows none until a Property Manager replaces it, and can go back to the online photo', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const id = w.ids.kingSt;

    const before = await (await w.get(`/properties/${id}`, cookie)).text();
    expect(visible(before)).toContain('No photo of this Property yet.');
    expect(before).toContain('Replace photo');
    expect(before).not.toContain('Use the online photo');
    expect(await w.get(`/properties/${id}/photo`, cookie)).toMatchObject({ status: 404 });

    const upload = new FormData();
    upload.append('photo', new File([PNG], 'front.png', { type: 'image/png' }));
    const posted = await w.web.request(`/properties/${id}/photo`, { method: 'POST', body: upload, headers: { cookie } });
    expect(posted.status).toBe(303);
    const replaced = await (await w.get(posted.headers.get('location')!, cookie)).text();
    expect(visible(replaced)).toContain('Photo replaced.');
    expect(visible(replaced)).toContain('Your photo');
    expect(replaced).toContain('Use the online photo');
    const src = /src="(\/properties\/\d+\/photo\?v=\d+)"/.exec(replaced)![1]!;

    const photo = await w.get(src, cookie);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect(photo.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(photo.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(PNG);

    const notes = new FormData();
    notes.append('photo', new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    const refused = await w.web.request(`/properties/${id}/photo`, { method: 'POST', body: notes, headers: { cookie } });
    expect(visible(await (await w.get(refused.headers.get('location')!, cookie)).text())).toContain('Upload a JPEG, PNG, WebP or HEIC photo.');

    w.h.propertyPhotos.photo = { contentType: 'image/jpeg', content: JPEG };
    const online = await w.post(`/properties/${id}/photo/online`, {}, cookie);
    expect(online.status).toBe(303);
    const restored = await (await w.get(online.headers.get('location')!, cookie)).text();
    expect(visible(restored)).toContain('Using the online photo.');
    expect(visible(restored)).toContain('Online photo');
    expect(restored).not.toContain('Use the online photo');
    const again = /src="(\/properties\/\d+\/photo\?v=\d+)"/.exec(restored)![1]!;
    expect(again).not.toBe(src);
    const bytes = await w.get(again, cookie);
    expect(bytes.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(JPEG);
  });

  test('the photo needs a sign-in, and another Agency is refused', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const upload = new FormData();
    upload.append('photo', new File([JPEG], 'front.jpg', { type: 'image/jpeg' }));
    await w.web.request(`/properties/${w.ids.kingSt}/photo`, { method: 'POST', body: upload, headers: { cookie } });

    const signedOut = await w.get(`/properties/${w.ids.kingSt}/photo`);
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.get('location')).toContain('/login');

    const stranger = await w.signUp();
    expect((await w.get(`/properties/${w.ids.kingSt}/photo`, stranger)).status).toBe(404);
    const posted = await w.web.request(`/properties/${w.ids.kingSt}/photo/online`, { method: 'POST', headers: { cookie: stranger } });
    expect(posted.status).toBe(404);
  });
});
