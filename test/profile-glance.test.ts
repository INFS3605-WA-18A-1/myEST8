import { describe, expect, test, vi } from 'vitest';
import type { Context } from '../src/context.ts';
import { run } from '../src/db.ts';
import { tenantProfileRead } from '../src/profile-glance.ts';
import { visible, webWorld } from './support/web.ts';
import { tomsTapTicket } from './support/world.ts';

type World = Awaited<ReturnType<typeof webWorld>>;

/** The loader only needs the clock, the database and the judge. */
function glanceCtx(w: World, requestJudge: World['h']['requestJudge'] | null = w.h.requestJudge): Context {
  return { db: w.h.db, clock: w.h.clock, ports: { requestJudge } } as unknown as Context;
}

describe("a Tenant profile's read", () => {
  test('judges the requests once, and the second view uses the stored judgment', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const cookie = await w.signIn();

    const first = visible(await (await w.get(`/tenants/${w.ids.tom}`, cookie)).text());
    expect(first).toContain('Filled in by AI');
    expect(first).toContain('Reliable reporter, few requests');
    expect(first).toContain('1 of 1 request in the last year was minor');
    expect(w.h.requestJudge.calls).toHaveLength(1);

    const second = await (await w.get(`/tenants/${w.ids.tom}`, cookie)).text();
    expect(visible(second)).toContain('Filled in by AI');
    expect(w.h.requestJudge.calls).toHaveLength(1);
  });

  test('a judge failure is one line with none of the Tenant text, and the read is code-only', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    w.h.requestJudge.failing = new Error('Jev returned 500: The kitchen tap is dripping');
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const cookie = await w.signIn();

    const page = visible(await (await w.get(`/tenants/${w.ids.tom}`, cookie)).text());
    spy.mockRestore();

    expect(page).not.toContain('Filled in by AI');
    expect(page).toContain("Reports rarely, and it's usually real");
    expect(page).not.toContain('were minor');
    expect(lines).toEqual(['request judge failed: Jev returned 500']);
    expect(lines.join('\n')).not.toContain('kitchen');
  });

  test('a judge that overruns the budget is the same fallback, and a later view can still judge', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    w.h.requestJudge.delayMs = 40;
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    const timedOut = await tenantProfileRead(glanceCtx(w), w.ids.agencyId, w.ids.tom, { timeoutMs: 10 });
    expect(timedOut).toMatchObject({ ai: false, sentence: "Reports rarely, and it's usually real" });
    expect(lines).toEqual(['request judge failed: timed out']);

    w.h.requestJudge.delayMs = 0;
    const judged = await tenantProfileRead(glanceCtx(w), w.ids.agencyId, w.ids.tom, { timeoutMs: 1000 });
    spy.mockRestore();
    expect(judged?.ai).toBe(true);
  });

  test('with no judge configured the read stays on the counts', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const read = await tenantProfileRead(glanceCtx(w, null), w.ids.agencyId, w.ids.tom);
    expect(read?.ai).toBe(false);
    expect(w.h.requestJudge.calls).toHaveLength(0);
  });

  test('one call judges at most twenty, newest first, and a request still in intake is left out', async () => {
    const w = await webWorld();
    const reported = (n: number) => new Date(Date.UTC(2026, 5, 1 + n)).toISOString();
    for (let n = 0; n < 21; n += 1) {
      await run(
        w.h.db,
        `INSERT INTO issues (agency_id, property_id, tenant_id, status, description, urgency, trade, photos_token, reported_at)
         VALUES (?, ?, ?, 'confirmed', ?, 'routine', 'plumbing', ?, ?)`,
        w.ids.agencyId,
        w.ids.kingSt,
        w.ids.tom,
        `Dripping tap ${n}`,
        `tok-glance-${n}`,
        reported(n),
      );
    }
    await run(
      w.h.db,
      `INSERT INTO issues (agency_id, property_id, tenant_id, status, description, urgency, trade, photos_token, reported_at)
       VALUES (?, ?, ?, 'gathering', 'Still asking questions', 'routine', 'plumbing', 'tok-glance-gathering', '2026-10-01T00:00:00.000Z')`,
      w.ids.agencyId,
      w.ids.kingSt,
      w.ids.tom,
    );

    await tenantProfileRead(glanceCtx(w), w.ids.agencyId, w.ids.tom);
    expect(w.h.requestJudge.calls).toHaveLength(1);
    const first = w.h.requestJudge.calls[0]!;
    expect(first).toHaveLength(20);
    expect(first.some((item) => item.description === 'Still asking questions')).toBe(false);
    expect(first.some((item) => item.description === 'Dripping tap 0')).toBe(false);
    expect(first[0]!.description).toBe('Dripping tap 20');

    await tenantProfileRead(glanceCtx(w), w.ids.agencyId, w.ids.tom);
    expect(w.h.requestJudge.calls).toHaveLength(2);
    expect(w.h.requestJudge.calls[1]!.map((item) => item.description)).toEqual(['Dripping tap 0']);
  });
});
