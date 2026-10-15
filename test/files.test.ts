import { describe, expect, test } from 'vitest';
import { one } from '../src/db.ts';
import { createFiles } from '../src/files.ts';
import { testDb } from './support/db.ts';
import { FakeBlobStore, FakeClock } from './support/fakes.ts';
import { START } from './support/harness.ts';

const bytes = new Uint8Array([9, 8, 7]);
const agency = async (db: Awaited<ReturnType<typeof testDb>>) =>
  (await one<{ id: number }>(db, `INSERT INTO agencies (name, time_zone) VALUES ('A', 'Australia/Sydney') RETURNING id`))!.id;

describe('files', () => {
  test('without a store the bytes stay in the row', async () => {
    const db = await testDb();
    const files = createFiles(db, new FakeClock(START));
    const id = await files.save(await agency(db), { filename: 'a.jpg', contentType: 'image/jpeg', content: bytes });
    expect(await one(db, 'SELECT storage_path FROM files WHERE id = ?', id)).toEqual({ storage_path: null });
    expect([...(await files.get(id)).content]).toEqual([9, 8, 7]);
    expect(files.direct).toBe(false);
    expect(await files.stage(1, 1)).toBeNull();
  });

  test('with a store the bytes go to it under a name the app chose, and read back from it', async () => {
    const db = await testDb();
    const blobs = new FakeBlobStore();
    const files = createFiles(db, new FakeClock(START), blobs);
    const agencyId = await agency(db);
    const id = await files.save(agencyId, { filename: '../../evil.jpg', contentType: 'image/jpeg', content: bytes });
    const row = await one<{ content: unknown; storage_path: string }>(db, 'SELECT content, storage_path FROM files WHERE id = ?', id);
    expect(row!.content).toBeNull();
    expect(row!.storage_path).toMatch(new RegExp(`^${agencyId}/[0-9a-f-]{36}$`));
    expect([...(await files.get(id)).content]).toEqual([9, 8, 7]);
  });

  test("a staged upload can only be collected from its own Agency's folder, once", async () => {
    const db = await testDb();
    const blobs = new FakeBlobStore();
    const files = createFiles(db, new FakeClock(START), blobs);
    const [slot] = (await files.stage(5, 1))!;
    expect(slot!.path).toMatch(/^staging\/5\/[0-9a-f-]{36}$/);
    await blobs.put(slot!.path, bytes, 'image/jpeg');
    await expect(files.take(6, slot!.path)).rejects.toThrow();
    await expect(files.take(5, 'staging/5/../6/x')).rejects.toThrow();
    expect([...(await files.take(5, slot!.path))]).toEqual([9, 8, 7]);
    await expect(files.take(5, slot!.path)).rejects.toThrow();
  });
});
