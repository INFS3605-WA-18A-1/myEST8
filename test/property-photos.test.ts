import { describe, expect, test } from 'vitest';
import { run } from '../src/db.ts';
import { iso } from '../src/shared.ts';
import { world } from './support/world.ts';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const fileId = (url: string) => Number(new URL(url, 'https://myest8.test').searchParams.get('v'));

const propertyInput = (w: Awaited<ReturnType<typeof world>>, address: string) => ({
  address,
  suburb: 'Newtown',
  ownerId: w.ids.olivia,
  propertyManagerId: w.ids.aliceId,
  maxRepairCostCents: 100_00,
  nominatedTradieIds: [] as number[],
});

describe('fetching a Property photo', () => {
  test('adding a Property fetches a photo from its map point, and Profiles households carry the url', async () => {
    const w = await world();
    const address = '9 Example Rd, Glebe NSW 2037';
    const location = { lat: -33.879, lng: 151.187 };
    w.h.geocoder.locations.set(address, location);
    w.h.propertyPhotos.photo = { contentType: 'image/jpeg', content: JPEG };

    const id = await w.alice.addProperty({ ...propertyInput(w, address), suburb: 'Glebe' });

    const view = await w.alice.property(id);
    expect(view.photoSource).toBe('fetched');
    expect(view.photoUrl).toMatch(new RegExp(`^/properties/${id}/photo\\?v=\\d+$`));
    expect(w.h.propertyPhotos.calls.at(-1)).toEqual({ address, location });
    const stored = await w.alice.file(fileId(view.photoUrl!));
    expect(stored).toMatchObject({ contentType: 'image/jpeg', content: JPEG });
    const household = (await w.alice.profilesOverview({ filter: 'all' })).households.find((item) => item.propertyId === id);
    expect(household?.photoUrl).toBe(view.photoUrl);
    expect((await w.alice.profilesOverview({ filter: 'all' })).households.find((item) => item.propertyId === w.ids.kingSt)?.photoUrl).toBeNull();
  });

  test('no imagery leaves the Property with no photo', async () => {
    const w = await world();
    w.h.propertyPhotos.photo = null;
    const id = await w.alice.addProperty(propertyInput(w, '1 Nowhere Rd, Newtown NSW 2042'));

    expect(await w.alice.property(id)).toMatchObject({ photoUrl: null, photoSource: null });
  });

  test('an address with no map point is what gets looked up', async () => {
    const w = await world();
    const actions = await w.h.app.asPropertyManager(w.ids.aliceId);
    const address = '2 Unplaced Ln, Newtown NSW 2042';
    w.h.propertyPhotos.photo = { contentType: 'image/jpeg', content: JPEG };
    w.h.propertyPhotos.calls.length = 0;

    const id = await actions.addProperty({ ...propertyInput(w, address), location: null });
    expect(await w.h.app.runWorker()).toEqual([]);

    expect(w.h.propertyPhotos.calls).toEqual([{ address, location: null }]);
    expect((await actions.property(id)).photoSource).toBe('fetched');
  });

  test('a failed lookup retries, and the next try stores the photo', async () => {
    const w = await world();
    const actions = await w.h.app.asPropertyManager(w.ids.aliceId);
    const address = '4 Retry St, Newtown NSW 2042';
    w.h.geocoder.locations.set(address, { lat: -33.9, lng: 151.18 });
    w.h.propertyPhotos.photo = new Error('Google Street View returned 500: unavailable');

    const id = await actions.addProperty(propertyInput(w, address));
    const errors = await w.h.app.runWorker();
    expect(errors.map((error) => error.message)).toEqual(['Google Street View returned 500: unavailable']);
    expect((await actions.property(id)).photoUrl).toBeNull();

    w.h.propertyPhotos.photo = { contentType: 'image/jpeg', content: JPEG };
    await w.h.advance(2 * 60_000);
    expect((await actions.property(id)).photoSource).toBe('fetched');
  });

  test('a Property placed later is fetched by its point when it still has no photo', async () => {
    const w = await world();
    const actions = await w.h.app.asPropertyManager(w.ids.aliceId);
    const address = '8 Later St, Newtown NSW 2042';
    const location = { lat: -33.89, lng: 151.18 };
    w.h.geocoder.geocode = async () => {
      throw new Error('Nominatim returned 429: Too many requests');
    };
    w.h.propertyPhotos.photo = null;
    const id = await actions.addProperty(propertyInput(w, address));
    expect(await w.h.app.runWorker()).toEqual([]);
    expect((await actions.property(id)).photoUrl).toBeNull();

    w.h.geocoder.geocode = async (query) => (query === address ? location : (w.h.geocoder.locations.get(query) ?? null));
    w.h.propertyPhotos.photo = { contentType: 'image/jpeg', content: JPEG };
    w.h.propertyPhotos.calls.length = 0;
    expect(await actions.geocodeMissing()).toBeGreaterThanOrEqual(1);
    expect(await w.h.app.runWorker()).toEqual([]);

    expect(w.h.propertyPhotos.calls.at(-1)).toEqual({ address, location });
    expect((await actions.property(id)).photoSource).toBe('fetched');
  });
});

describe('replacing a Property photo', () => {
  test("a Property Manager's photo is kept when a later fetch runs, and the online photo can be brought back", async () => {
    const w = await world();
    const address = '3 Mine St, Newtown NSW 2042';
    w.h.geocoder.locations.set(address, { lat: -33.9, lng: 151.2 });
    w.h.propertyPhotos.photo = { contentType: 'image/jpeg', content: JPEG };
    const id = await w.alice.addProperty(propertyInput(w, address));
    const fetched = (await w.alice.property(id)).photoUrl;

    await w.alice.replacePropertyPhoto(id, { filename: 'front.png', contentType: 'image/png', content: PNG });
    const mine = await w.alice.property(id);
    expect(mine.photoSource).toBe('manager');
    expect(mine.photoUrl).not.toBe(fetched);
    expect(await w.alice.file(fileId(mine.photoUrl!))).toMatchObject({ contentType: 'image/png', content: PNG });

    await run(w.h.db, `INSERT INTO tasks (kind, payload, run_at) VALUES ('properties.fetch_photo', ?, ?)`, JSON.stringify({ propertyId: id }), iso(w.h.clock.now()));
    await w.h.drain();
    expect(await w.alice.property(id)).toMatchObject({ photoUrl: mine.photoUrl, photoSource: 'manager' });

    w.h.propertyPhotos.photo = null;
    await expect(w.alice.useOnlinePropertyPhoto(id)).rejects.toThrow("There's no online photo of this Property.");
    expect((await w.alice.property(id)).photoSource).toBe('manager');

    w.h.propertyPhotos.photo = new Error(`Google Street View returned 503 for super-secret-google-key`);
    await expect(w.alice.useOnlinePropertyPhoto(id)).rejects.toThrow("The online photo couldn't be fetched. Try again.");
    expect((await w.alice.property(id)).photoUrl).toBe(mine.photoUrl);

    w.h.propertyPhotos.photo = { contentType: 'image/jpeg', content: JPEG };
    await w.alice.useOnlinePropertyPhoto(id);
    const restored = await w.alice.property(id);
    expect(restored.photoSource).toBe('fetched');
    expect(restored.photoUrl).not.toBe(mine.photoUrl);
    expect(await w.alice.file(fileId(restored.photoUrl!))).toMatchObject({ contentType: 'image/jpeg', content: JPEG });
  });

  test('only a JPEG, PNG, WebP or HEIC under 10 MB is stored', async () => {
    const w = await world();
    await expect(w.alice.replacePropertyPhoto(w.ids.kingSt, { filename: 'notes.gif', contentType: 'image/gif', content: JPEG })).rejects.toThrow('Upload a JPEG, PNG, WebP or HEIC photo.');
    await expect(w.alice.replacePropertyPhoto(w.ids.kingSt, { filename: 'huge.jpg', contentType: 'image/jpeg', content: new Uint8Array(10 * 1024 * 1024 + 1) })).rejects.toThrow('The photo must be under 10 MB.');
    await w.alice.replacePropertyPhoto(w.ids.kingSt, { filename: 'front.heic', contentType: 'image/heic', content: JPEG });
    expect((await w.alice.property(w.ids.kingSt)).photoSource).toBe('manager');
  });

  test("another Agency's Property Manager cannot change or read the photo", async () => {
    const w = await world();
    w.h.propertyPhotos.photo = { contentType: 'image/jpeg', content: JPEG };
    await w.bob.replacePropertyPhoto(w.ids.kingSt, { filename: 'front.png', contentType: 'image/png', content: PNG });
    expect((await w.alice.property(w.ids.kingSt)).photoSource).toBe('manager');

    const other = await w.h.app.setup.createAgency({ name: 'Other Realty', timeZone: 'Australia/Sydney' });
    const pm = await w.h.app.setup.addPropertyManager(other, { name: 'Sam Sun', email: 'sam@other.example', password: 'correct horse battery' });
    const them = w.h.as(pm);
    const upload = { filename: 'front.jpg', contentType: 'image/jpeg', content: JPEG };
    await expect(them.replacePropertyPhoto(w.ids.kingSt, upload)).rejects.toMatchObject({ code: 'not_found' });
    await expect(them.useOnlinePropertyPhoto(w.ids.kingSt)).rejects.toMatchObject({ code: 'not_found' });
    await expect(them.propertyPhoto(w.ids.kingSt)).rejects.toMatchObject({ code: 'not_found' });
    expect((await w.alice.property(w.ids.kingSt)).photoSource).toBe('manager');
  });
});
