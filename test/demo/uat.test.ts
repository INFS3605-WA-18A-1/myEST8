import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { all, ident, openDb, type Db } from '../../src/db.ts';
import { createDemo } from '../../src/demo/runtime.ts';
import { isMadeUpAddress } from '../../src/demo/uat.ts';
import { closeAfter, demoEnv, testDatabaseUrl, uniqueSchema } from '../support/db.ts';

type Started = Awaited<ReturnType<typeof createDemo<false>>>;

/** UAT only: every Agency that signs up starts with the demo's people and ten days of work in it. */
describe('a sign-up during UAT', () => {
  let d: Started;
  let db: Db;
  const schema = uniqueSchema('uat');
  const errors: Error[] = [];
  const signUp = (n: number) =>
    d.app.signUp({ agencyName: `Tester ${n} Realty`, timeZone: 'Australia/Sydney', name: `Tester ${n}`, email: `tester${n}@uat.test`, password: 'password1234' });
  let first: number;
  let second: number;

  beforeAll(async () => {
    d = await createDemo({ seedAgency: false, env: demoEnv({ DATABASE_SCHEMA: schema, UAT_SEED_SIGNUPS: '1' }), logError: (e) => errors.push(e), log: () => {} });
    closeAfter(d);
    db = openDb(testDatabaseUrl(), { schema });
    first = await signUp(1);
    // Two Agencies seeded side by side, as every tester on production is.
    second = await signUp(2);
    // The seeds run after the sign-ups return, queued with the worker.
    await d.runWorker();
  }, 360_000);

  afterAll(async () => {
    await db.sql.unsafe(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
    await db.close();
  });

  test('seeds without an error, and leaves the stories in the Agency that signed up', async () => {
    expect(errors).toEqual([]);
    for (const pm of [first, second]) {
      const dashboard = await (await d.app.asPropertyManager(pm)).dashboard({ filter: 'all' });
      expect(dashboard.maintenanceRequests).toHaveLength(4);
      expect(dashboard.tickets.length).toBeGreaterThanOrEqual(10);
      expect(dashboard.inbox).toHaveLength(4);
    }
  });

  test('makes the tester Alice, with Bob as a colleague who cannot sign in', async () => {
    const me = await d.app.asPropertyManager(first);
    expect((await me.dashboard({ filter: 'mine' })).tickets.length).toBeGreaterThanOrEqual(3);
    expect(await d.app.login(`bob.baker+${me.agency().id}@harbour.example`, 'demo1234')).toBeNull();
  });

  test('hands every task still waiting to the live worker, which runs them', async () => {
    const statuses = await all<{ status: string }>(db, 'SELECT DISTINCT status FROM tasks');
    expect(statuses.map((s) => s.status).filter((s) => !['pending', 'done', 'failed'].includes(s))).toEqual([]);
    expect(await all(db, "SELECT kind, last_error FROM tasks WHERE status = 'failed'")).toEqual([]);
    await d.runWorker();
    expect(errors).toEqual([]);
  });

  test("leaves the Agency's own inbound email and a made-up SMS number connected", async () => {
    const me = await d.app.asPropertyManager(first);
    const channels = await me.channels();
    expect(channels.find((c) => c.type === 'email')?.address).toBe('tester-1-realty@mail.example.test');
    expect(isMadeUpAddress(channels.find((c) => c.type === 'sms')!.address)).toBe(true);
  });
});

describe('isMadeUpAddress', () => {
  test('matches the seeded people and reserved domains, and nothing real', () => {
    for (const a of ['+61400000001', '+61400000215', '0400 000 101', 'olivia@example.com', 'quotes@quickpipes.example', 'x@y.invalid', '+61255500042']) {
      expect(isMadeUpAddress(a), a).toBe(true);
    }
    for (const a of ['+61412345678', '+61400000300', 'someone@gmail.com', 'me@example.com.au', '+61290000000']) expect(isMadeUpAddress(a), a).toBe(false);
  });
});
