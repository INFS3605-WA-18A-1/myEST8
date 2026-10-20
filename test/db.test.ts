// The data layer on Postgres: values come back as they did from SQLite, and
// transactions keep to one connection, commit together or not at all.

import { describe, expect, test } from 'vitest';
import { all, one, run, transaction, withReadCache } from '../src/db.ts';
import { migrations } from '../src/migrate.ts';
import { testDb } from './support/db.ts';

describe('values round-trip as they did on SQLite', () => {
  test('ids and counts are JS numbers, times are the ISO text written, and a BLOB comes back as the same bytes', async () => {
    const db = await testDb();
    const at = '2026-10-08T09:00:00.000Z';
    const agencyId = await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?) RETURNING id', 'Harbour Realty', 'Australia/Sydney');
    expect(agencyId).toBe(1);
    const content = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const fileId = await run(
      db,
      'INSERT INTO files (agency_id, filename, content_type, content, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
      agencyId,
      'tap.jpg',
      'image/jpeg',
      content,
      at,
    );

    const file = await one<{ id: number; agency_id: number; content: Uint8Array; created_at: string }>(db, 'SELECT * FROM files WHERE id = ?', fileId);
    expect(file).toEqual({ id: fileId, agency_id: agencyId, filename: 'tap.jpg', content_type: 'image/jpeg', content, storage_path: null, created_at: at });
    expect(file!.content).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(file!.content)).toBe(false);
    expect(await one(db, 'SELECT count(*) AS n, sum(agency_id) AS total FROM files')).toEqual({ n: 1, total: agencyId });
  });

  test('big ids, cents and fractional ratings keep their exact values', async () => {
    const db = await testDb();
    const agencyId = await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?) RETURNING id', 'A', 'Australia/Sydney');
    const personId = await run(
      db,
      `INSERT INTO people (agency_id, role, name, starting_rating, google_rating, google_review_count) VALUES (?, 'tradie', 'P', ?, ?, ?) RETURNING id`,
      agencyId,
      4,
      4.85,
      2 ** 40,
    );
    expect(await one(db, 'SELECT starting_rating, google_rating, google_review_count, trades FROM people WHERE id = ?', personId)).toEqual({
      starting_rating: 4,
      google_rating: 4.85,
      google_review_count: 2 ** 40,
      trades: '[]',
    });
  });

  test('a number that isn\'t one (NaN, as from Number("abc")) matches nothing, as SQLite stored it as NULL', async () => {
    const db = await testDb();
    expect(await one(db, 'SELECT * FROM agencies WHERE id = ?', Number('abc'))).toBeUndefined();
  });

  test('`?` inside quoted text is left alone', async () => {
    const db = await testDb();
    expect(await one(db, `SELECT 'why?' AS q, ?::text AS a`, 'yes')).toEqual({ q: 'why?', a: 'yes' });
  });
});

describe('transactions', () => {
  test('commit everything together, on one connection, including what modules write through `db`', async () => {
    const db = await testDb();
    const pids = await transaction(db, async () => {
      await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?)', 'A', 'Australia/Sydney');
      const [a, b] = await Promise.all([one<{ pid: number }>(db, 'SELECT pg_backend_pid() AS pid'), one<{ pid: number }>(db, 'SELECT pg_backend_pid() AS pid')]);
      return [a!.pid, b!.pid];
    });
    expect(pids[0]).toBe(pids[1]);
    expect(await all(db, 'SELECT name FROM agencies')).toEqual([{ name: 'A' }]);
  });

  test('roll back everything when one statement fails', async () => {
    const db = await testDb();
    await expect(
      transaction(db, async () => {
        await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?)', 'A', 'Australia/Sydney');
        throw new Error('part-way');
      }),
    ).rejects.toThrow('part-way');
    expect(await all(db, 'SELECT * FROM agencies')).toEqual([]);
  });

  test('a transaction inside one is a savepoint: its failure is undone alone', async () => {
    const db = await testDb();
    await transaction(db, async () => {
      await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?)', 'Kept', 'Australia/Sydney');
      await transaction(db, async () => {
        await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?)', 'Undone', 'Australia/Sydney');
        throw new Error('inner');
      }).catch(() => {});
    });
    expect(await all(db, 'SELECT name FROM agencies')).toEqual([{ name: 'Kept' }]);
  });

  test('run one at a time, so a check made inside one still holds when it writes', async () => {
    const db = await testDb();
    // Each transaction reads the count, waits, then writes count + 1: interleaved, both would write 1.
    const bump = () =>
      transaction(db, async () => {
        const { n } = (await one<{ n: number }>(db, 'SELECT count(*) AS n FROM agencies'))!;
        await new Promise((resolve) => setTimeout(resolve, 50));
        await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?)', String(n + 1), 'Australia/Sydney');
      });
    await Promise.all([bump(), bump(), bump()]);
    expect((await all<{ name: string }>(db, 'SELECT name FROM agencies ORDER BY id')).map((r) => r.name)).toEqual(['1', '2', '3']);
  });
});

describe('migrations', () => {
  test('are named as the Supabase CLI names them, and every one applies to a fresh schema', async () => {
    const files = migrations();
    expect(files.length).toBeGreaterThan(0);
    for (const m of files) expect(m.version).toMatch(/^\d{14}$/);
    const db = await testDb();
    expect((await all<{ version: string }>(db, 'SELECT version FROM schema_migrations ORDER BY version')).map((r) => r.version)).toEqual(files.map((m) => m.version));
  });
});

describe("a page request's read cache", () => {
  /** An agency renamed behind the data layer's back, as another server would. */
  const renameElsewhere = (db: Awaited<ReturnType<typeof testDb>>, id: number, name: string) => db.sql.unsafe('UPDATE agencies SET name = $1 WHERE id = $2', [name, id]);
  const nameOf = async (db: Awaited<ReturnType<typeof testDb>>, id: number) => (await one<{ name: string }>(db, 'SELECT name FROM agencies WHERE id = ?', id))!.name;

  test('the same read is sent once, and every caller gets its own array of the rows', async () => {
    const db = await testDb();
    const id = await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?) RETURNING id', 'Harbour Realty', 'Australia/Sydney');

    await withReadCache(async () => {
      expect(await nameOf(db, id)).toBe('Harbour Realty');
      await renameElsewhere(db, id, 'Renamed');
      // Answered from the first read: the database wasn't asked again.
      expect(await nameOf(db, id)).toBe('Harbour Realty');
      const first = await all(db, 'SELECT id FROM agencies');
      first.pop();
      expect(await all(db, 'SELECT id FROM agencies')).toHaveLength(1);
    });
    // Outside a request there is no cache.
    expect(await nameOf(db, id)).toBe('Renamed');
  });

  test('any write clears it, so a read after a write sees the database as it is', async () => {
    const db = await testDb();
    const id = await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?) RETURNING id', 'Harbour Realty', 'Australia/Sydney');

    await withReadCache(async () => {
      expect(await nameOf(db, id)).toBe('Harbour Realty');
      await run(db, 'UPDATE agencies SET name = ? WHERE id = ?', 'Written', id);
      expect(await nameOf(db, id)).toBe('Written');
    });
  });

  test('a transaction never reads from it, so its checks read the database as it is', async () => {
    const db = await testDb();
    const id = await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?) RETURNING id', 'Harbour Realty', 'Australia/Sydney');

    await withReadCache(async () => {
      expect(await nameOf(db, id)).toBe('Harbour Realty');
      await renameElsewhere(db, id, 'Renamed');
      expect(await transaction(db, () => nameOf(db, id))).toBe('Renamed');
    });
  });
});
