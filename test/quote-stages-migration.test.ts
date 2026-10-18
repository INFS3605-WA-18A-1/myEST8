// The quote stages migration (supabase/migrations/20261019000000_quote_stages.sql)
// on data in the shape before it: a schema migrated to the version before, filled
// with old-shape rows, then migrated the rest of the way.

import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { all, one, openDb, run } from '../src/db.ts';
import { migrate, migrations, MIGRATIONS_DIR } from '../src/migrate.ts';
import { closeAfter, testDatabaseUrl, uniqueSchema } from './support/db.ts';

const STAGES = '20261019000000';

/** A schema with every migration before the quote stages one applied. */
async function beforeStages() {
  const dir = mkdtempSync(join(tmpdir(), 'myest8-migrations-'));
  for (const m of migrations().filter((m) => m.version < STAGES)) copyFileSync(join(MIGRATIONS_DIR, `${m.version}_${m.name}.sql`), join(dir, `${m.version}_${m.name}.sql`));
  const db = openDb(testDatabaseUrl(), { schema: uniqueSchema('m'), max: 2 });
  closeAfter(db);
  await migrate(db, dir);
  // Jobs need a Ticket, which needs an issue; this test is about Quotes, so the Job stands alone.
  await run(db, 'ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_ticket_id_fkey');
  return db;
}

describe('the quote stages migration', () => {
  test('turns revised Quotes into Firm Quotes over their kept Estimates, maps statuses, and leaves no Job site quoting', async () => {
    const db = await beforeStages();
    const at = '2026-10-10T00:00:00.000Z';
    const job = (agency: number, status: string) => run(db, `INSERT INTO jobs (agency_id, ticket_id, trade, status) VALUES (?, 1, 'plumbing', ?) RETURNING id`, agency, status);
    const site = await job(1, 'site_quoting');
    const plain = await job(1, 'quoting');
    const request = (jobId: number, tradieId: number, status: string) =>
      run(db, `INSERT INTO quote_requests (agency_id, job_id, ticket_id, tradie_id, status, sent_at) VALUES (1, ?, 1, ?, ?, ?) RETURNING id`, jobId, tradieId, status, at);
    const revised = await request(site, 10, 'quoted');
    const visiting = await request(site, 11, 'quoted');
    const remote = await request(plain, 12, 'quoted');
    const silent = await request(plain, 13, 'sent');
    const quote = (requestId: number, jobId: number, tradieId: number, price: number, revisedFrom: number | null) =>
      run(
        db,
        `INSERT INTO quotes (agency_id, job_id, ticket_id, quote_request_id, tradie_id, trade, price_cents, proposed_time, confirmed, status, received_at,
           initial_price_cents, initial_proposed_time, revised_at)
         VALUES (1, ?, 1, ?, ?, 'plumbing', ?, NULL, 1, 'open', ?, ?, ?, ?) RETURNING id`,
        jobId,
        requestId,
        tradieId,
        price,
        at,
        revisedFrom,
        revisedFrom === null ? null : '2026-10-13T09:00:00.000Z',
        revisedFrom === null ? null : '2026-10-12T00:00:00.000Z',
      );
    const revisedQuote = await quote(revised, site, 10, 380_00, 300_00);
    await quote(visiting, site, 11, 340_00, null);
    await quote(remote, plain, 12, 150_00, null);
    const visit = (requestId: number, tradieId: number, status: string) =>
      run(
        db,
        `INSERT INTO work_orders (agency_id, job_id, ticket_id, tradie_id, start, "end", status, kind, quote_request_id) VALUES (1, ?, 1, ?, ?, ?, ?, 'site_quote', ?)`,
        site,
        tradieId,
        at,
        at,
        status,
        requestId,
      );
    await visit(revised, 10, 'done');
    await visit(visiting, 11, 'active');

    expect(await migrate(db)).toEqual([STAGES, ...migrations().filter((m) => m.version > STAGES).map((m) => m.version)]);

    expect((await all<{ status: string }>(db, 'SELECT status FROM jobs ORDER BY id')).map((j) => j.status)).toEqual(['quoting', 'quoting']);
    const statuses = await all<{ id: number; status: string; token: string }>(db, 'SELECT id, status, token FROM quote_requests ORDER BY id');
    expect(statuses.map((r) => r.status)).toEqual(['firm_quoted', 'inspection_booked', 'estimated', 'sent']);
    expect(statuses.every((r) => r.token.length >= 32)).toBe(true);
    expect(new Set(statuses.map((r) => r.token)).size).toBe(4);
    expect(silent).toBe(statuses[3]!.id);

    type Q = { id: number; quote_request_id: number; stage: string; price_cents: number; status: string; supersedes_quote_id: number | null; needs_inspection: boolean; proposed_time: string | null };
    const quotes = await all<Q>(db, 'SELECT * FROM quotes ORDER BY quote_request_id, stage');
    const firm = quotes.find((q) => q.id === revisedQuote)!;
    const kept = quotes.find((q) => q.quote_request_id === revised && q.stage === 'estimate')!;
    expect(firm).toMatchObject({ stage: 'firm', price_cents: 380_00, status: 'open', supersedes_quote_id: kept.id });
    expect(kept).toMatchObject({ price_cents: 300_00, proposed_time: '2026-10-13T09:00:00.000Z', status: 'superseded', needs_inspection: true });
    expect(quotes.find((q) => q.quote_request_id === visiting)).toMatchObject({ stage: 'estimate', needs_inspection: true, status: 'open' });
    expect(quotes.find((q) => q.quote_request_id === remote)).toMatchObject({ stage: 'estimate', needs_inspection: false });
    expect((await all<{ kind: string }>(db, 'SELECT DISTINCT kind FROM work_orders')).map((r) => r.kind)).toEqual(['inspection']);

    // One Quote per stage per request, no longer one per request.
    await expect(
      run(db, `INSERT INTO quotes (agency_id, job_id, ticket_id, quote_request_id, tradie_id, trade, status, received_at, stage) VALUES (1, ?, 1, ?, 12, 'plumbing', 'open', ?, 'estimate')`, plain, remote, at),
    ).rejects.toThrow(/quotes_request_stage/);

    // Run again, it changes nothing.
    const before = await all(db, 'SELECT * FROM quotes ORDER BY id');
    await db.sql.unsafe(readFileSync(join(MIGRATIONS_DIR, `${STAGES}_quote_stages.sql`), 'utf8'));
    expect(await all(db, 'SELECT * FROM quotes ORDER BY id')).toEqual(before);
    expect((await one<{ n: number }>(db, 'SELECT count(*) AS n FROM quote_requests WHERE status = ?', 'firm_quoted'))!.n).toBe(1);
  });
  test('makes the Quotes the old single-step flow chose, sent to the Owner or passed over Firm Quotes; a still-open one stays an Estimate', async () => {
    const db = await beforeStages();
    const at = '2026-10-10T00:00:00.000Z';
    const job = (status: string) => run(db, `INSERT INTO jobs (agency_id, ticket_id, trade, status) VALUES (1, 1, 'plumbing', ?) RETURNING id`, status);
    const done = await job('done');
    const quoting = await job('quoting');
    const request = (jobId: number, tradieId: number, status: string) =>
      run(db, `INSERT INTO quote_requests (agency_id, job_id, ticket_id, tradie_id, status, sent_at) VALUES (1, ?, 1, ?, ?, ?) RETURNING id`, jobId, tradieId, status, at);
    const quote = (jobId: number, requestId: number, tradieId: number, status: string, confirmed = 1) =>
      run(
        db,
        `INSERT INTO quotes (agency_id, job_id, ticket_id, quote_request_id, tradie_id, trade, price_cents, confirmed, status, received_at)
         VALUES (1, ?, 1, ?, ?, 'plumbing', 20000, ?, ?, ?) RETURNING id`,
        jobId,
        requestId,
        tradieId,
        confirmed,
        status,
        at,
      );
    const approved = await quote(done, await request(done, 10, 'quoted'), 10, 'approved');
    const passedOver = await quote(done, await request(done, 11, 'closed'), 11, 'not_chosen');
    const neverChecked = await quote(done, await request(done, 12, 'closed'), 12, 'not_chosen', 0);
    const ownerSaidNo = await quote(quoting, await request(quoting, 13, 'quoted'), 13, 'declined_by_owner');
    const stillOpen = await quote(quoting, await request(quoting, 14, 'quoted'), 14, 'open');

    await migrate(db);

    const stage = async (id: number) => (await one<{ stage: string; not_to_exceed_cents: number | null }>(db, 'SELECT stage, not_to_exceed_cents FROM quotes WHERE id = ?', id))!;
    expect(await stage(approved)).toEqual({ stage: 'firm', not_to_exceed_cents: null });
    expect((await stage(passedOver)).stage).toBe('firm');
    expect((await stage(ownerSaidNo)).stage).toBe('firm');
    expect((await stage(neverChecked)).stage).toBe('estimate');
    expect((await stage(stillOpen)).stage).toBe('estimate');
    // They were single-step prices: no Estimate is made up for them.
    expect((await one<{ n: number }>(db, 'SELECT count(*) AS n FROM quotes'))!.n).toBe(5);
    expect((await all<{ status: string }>(db, 'SELECT status FROM quote_requests ORDER BY id')).map((r) => r.status)).toEqual(['firm_quoted', 'closed', 'closed', 'firm_quoted', 'estimated']);

    // Run again over a new Estimate passed over since, it is left an Estimate.
    const later = await quote(quoting, await request(quoting, 15, 'closed'), 15, 'not_chosen');
    await db.sql.unsafe(readFileSync(join(MIGRATIONS_DIR, `${STAGES}_quote_stages.sql`), 'utf8'));
    expect((await stage(later)).stage).toBe('estimate');
    expect((await stage(approved)).stage).toBe('firm');
  });
});
