// The work order token migration (supabase/migrations/20261024120000_work_order_tokens.sql)
// on rows that exist before it: a schema migrated to the version before, filled
// with Work Orders that have no token, then migrated the rest of the way.

import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { one, openDb, run } from '../src/db.ts';
import { migrate, migrations, MIGRATIONS_DIR } from '../src/migrate.ts';
import { closeAfter, testDatabaseUrl, uniqueSchema } from './support/db.ts';

const TOKENS = '20261024120000';

/** A schema with every migration before the work order token one applied. */
async function beforeTokens() {
  const dir = mkdtempSync(join(tmpdir(), 'myest8-migrations-'));
  for (const m of migrations().filter((m) => m.version < TOKENS)) copyFileSync(join(MIGRATIONS_DIR, `${m.version}_${m.name}.sql`), join(dir, `${m.version}_${m.name}.sql`));
  const db = openDb(testDatabaseUrl(), { schema: uniqueSchema('m'), max: 2 });
  closeAfter(db);
  await migrate(db, dir);
  return db;
}

const md5 = (value: string) => createHash('md5').update(value).digest('hex');

describe('the work order token migration', () => {
  test('gives each existing Work Order its own random 32-hex token, and leaves the column nullable', async () => {
    const db = await beforeTokens();
    const start = '2026-10-13T09:00:00.000Z';
    const later = '2026-10-14T09:00:00.000Z';
    const insert = (at: string) =>
      run(
        db,
        `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, "end", status) VALUES (1, 1, 1, 1, ?, ?, 'active') RETURNING id`,
        at,
        at,
      );
    const first = await insert(start);
    const second = await insert(later);

    expect(await migrate(db)).toEqual([TOKENS, ...migrations().filter((m) => m.version > TOKENS).map((m) => m.version)]);

    const rows = await Promise.all(
      [first, second].map(async (id) => (await one<{ id: number; token: string | null; start: string }>(db, 'SELECT id, token, start FROM work_orders WHERE id = ?', id))!),
    );
    for (const row of rows) {
      expect(row.token).toMatch(/^[0-9a-f]{32}$/);
      // md5(id || ':' || start) is 32 hex too, and anyone who can guess the id and start can compute it.
      expect(row.token).not.toBe(md5(`${row.id}:${row.start}`));
    }
    expect(rows[0]!.token).not.toBe(rows[1]!.token);

    const column = await one<{ is_nullable: string }>(
      db,
      `SELECT is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'work_orders' AND column_name = 'token'`,
    );
    expect(column).toEqual({ is_nullable: 'YES' });

    // Older code inserts a Work Order without a token. That insert has to succeed.
    const omitted = await run(
      db,
      `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, "end", status) VALUES (1, 1, 1, 1, ?, ?, 'active') RETURNING id`,
      start,
      start,
    );
    const filled = await one<{ token: string | null }>(db, 'SELECT token FROM work_orders WHERE id = ?', omitted);
    expect(filled?.token).toMatch(/^[0-9a-f]{32}$/);
    await expect(
      run(
        db,
        `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, "end", status, token) VALUES (1, 1, 1, 1, ?, ?, 'active', NULL) RETURNING id`,
        start,
        start,
      ),
    ).resolves.toEqual(expect.any(Number));
  });
});
