import { afterEach, describe, expect, test } from 'vitest';
import { ident, one, openDb, run } from '../../src/db.ts';
import { createDemo } from '../../src/demo/runtime.ts';
import { demoEnv, testDatabaseUrl, uniqueSchema } from '../support/db.ts';

const HOUR = 3_600_000;
const schemas: string[] = [];

/** A schema name for a kept demo database, dropped after the test. */
function keptSchema() {
  const schema = uniqueSchema('demo_kept');
  schemas.push(schema);
  return schema;
}

/** Runs `fn` on a connection of its own to the run's database. */
async function withDb<T>(fn: (db: ReturnType<typeof openDb>) => Promise<T>, schema = 'public'): Promise<T> {
  const db = openDb(testDatabaseUrl(), { schema, max: 1 });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

afterEach(async () => {
  const drop = schemas.splice(0);
  if (drop.length) await withDb((db) => db.sql.unsafe(drop.map((s) => `DROP SCHEMA IF EXISTS ${ident(s)} CASCADE;`).join('\n')));
});

/** The demo on a kept schema, with every external API mocked. Task errors fail the test. */
async function demoOn(schema: string, options: { stories?: boolean } = {}) {
  const errors: Error[] = [];
  const d = await createDemo({ env: demoEnv({ DATABASE_SCHEMA: schema }), logError: (e) => errors.push(e), ...options });
  return { ...d, errors };
}

describe('the demo on a kept schema (DATABASE_SCHEMA)', () => {
  test('seeds a new schema, then keeps what was added across a restart without seeding again', async () => {
    const schema = keptSchema();
    const first = await demoOn(schema);
    expect(first.database).toEqual({ schema, kept: true, reused: false });
    const alice = await first.app.asPropertyManager(first.seed.ids.aliceId);
    await alice.addOwner({ name: 'Persistent Pat', mobile: '+61400000777' });
    await first.close();

    const second = await demoOn(schema);
    expect(second.database).toMatchObject({ schema, kept: true, reused: true });
    expect(second.seed).toEqual(first.seed);
    expect(await second.app.login('alice@harbour.example', 'demo1234')).toBe(first.seed.ids.aliceId);
    const owners = await (await second.app.asPropertyManager(second.seed.ids.aliceId)).people('owner');
    expect(owners.filter((o) => o.name === 'Persistent Pat')).toHaveLength(1);
    // Seeded once: still one Harbour Realty Olivia, not two.
    expect(owners.filter((o) => o.name === 'Olivia Owens')).toHaveLength(1);
    expect([...first.errors, ...second.errors]).toEqual([]);
    await second.close();
  });

  test('keeps the phone simulator history and the moved clock across a restart', async () => {
    const schema = keptSchema();
    const first = await demoOn(schema);
    const aliceId = first.seed.ids.aliceId;
    await first.demo.sendAs(aliceId, '+61400000001', 'sms', 'The kitchen tap is dripping');
    await first.demo.advance(48);
    const outboxBefore = await first.demo.outbox(aliceId);
    await first.close();

    const second = await demoOn(schema);
    expect(await second.demo.inbound(aliceId)).toMatchObject([{ from: '+61400000001', text: 'The kitchen tap is dripping' }]);
    expect(await second.demo.outbox(aliceId)).toEqual(outboxBefore);
    expect(second.demo.now().getTime() - Date.now()).toBeGreaterThanOrEqual(48 * HOUR - 60_000);
    await second.close();
  });

  test('plays the stories only on the first start, and says so when it skips them', async () => {
    const schema = keptSchema();
    const first = await demoOn(schema, { stories: true });
    expect(first.stories?.maintenanceRequests).toBeGreaterThan(0);
    await first.close();

    const second = await demoOn(schema, { stories: true });
    expect(second.stories).toBeNull();
    expect(second.database).toMatchObject({ reused: true, storiesPlayed: true });
    const dashboard = await (await second.app.asPropertyManager(second.seed.ids.aliceId)).dashboard({ filter: 'all' });
    expect(dashboard.maintenanceRequests.length).toBe(first.stories!.maintenanceRequests);
    await second.close();
  }, 120_000);

  test('refuses a schema that has data the demo did not finish seeding', async () => {
    const schema = keptSchema();
    const first = await demoOn(schema);
    await first.close();
    await withDb((db) => run(db, 'DELETE FROM demo_state'), schema);

    await expect(demoOn(schema)).rejects.toThrow(/wasn't seeded by the demo/);
  });

  test('without DATABASE_SCHEMA the data goes in a throwaway schema, dropped on close', async () => {
    const d = await createDemo({ env: demoEnv() });
    expect(d.database).toEqual({ schema: expect.stringMatching(/^demo_/), kept: false, reused: false });
    await d.close();
    const left = await withDb((db) => one(db, 'SELECT 1 AS found FROM pg_namespace WHERE nspname = ?', d.database.schema));
    expect(left).toBeUndefined();
  });
});
