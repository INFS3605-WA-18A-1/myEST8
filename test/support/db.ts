// A fresh database for each test: its own schema in the run's database, with
// every migration applied, closed when the test finishes (or, when opened
// outside a test, after the file).

import { randomUUID } from 'node:crypto';
import { afterAll, inject, onTestFinished } from 'vitest';
import { openDb, type Db } from '../../src/db.ts';
import { migrate } from '../../src/migrate.ts';

/** This run's database (see test/support/global-setup.ts). */
export function testDatabaseUrl(): string {
  return inject('databaseUrl');
}

/** Env for the demo runtime (`createDemo`) that keeps it in this run's database, with every external API mocked. */
export function demoEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { SUPABASE_DB_URL: testDatabaseUrl(), ...extra };
}

/** A schema name no other test uses. */
export function uniqueSchema(prefix = 't'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

const outsideTests = new Set<{ close(): Promise<unknown> }>();

/** Closes `db` (a database, or a demo) when the current test finishes, or after the file when there's no current test (a beforeAll). */
export function closeAfter(db: { close(): Promise<unknown> }) {
  try {
    onTestFinished(async () => {
      await db.close();
    });
  } catch {
    outsideTests.add(db);
  }
}

/** An empty, migrated schema of its own. */
export async function testDb(): Promise<Db> {
  const db = openDb(testDatabaseUrl(), { schema: uniqueSchema(), max: 4 });
  closeAfter(db);
  await migrate(db);
  return db;
}

afterAll(async () => {
  await Promise.all([...outsideTests].map((db) => db.close()));
  outsideTests.clear();
});
