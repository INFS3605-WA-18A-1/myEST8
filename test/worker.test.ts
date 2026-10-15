import { describe, expect, test } from 'vitest';
import { all, run } from '../src/db.ts';
import { createWorker } from '../src/worker.ts';
import { FakeClock } from './support/fakes.ts';
import { testDb } from './support/db.ts';
import { START, MINUTE } from './support/harness.ts';

async function setup() {
  const db = await testDb();
  const clock = new FakeClock(START);
  const worker = createWorker(db, clock);
  const ran: string[] = [];
  worker.on<{ n: number }>('job', ({ n }) => {
    ran.push(`job${n}`);
  });
  const tasks = () => all<{ kind: string; status: string; attempts: number }>(db, 'SELECT kind, status, attempts FROM tasks ORDER BY id');
  return { db, clock, worker, ran, tasks };
}

describe('worker', () => {
  test('a budget of zero starts nothing, and the tasks run on the next call', async () => {
    const { worker, ran } = await setup();
    await worker.schedule('job', { n: 1 });
    await worker.runDue({ budgetMs: 0 });
    expect(ran).toEqual([]);
    await worker.runDue({ budgetMs: 60_000 });
    expect(ran).toEqual(['job1']);
  });

  test('a task left running by a run that died is retried once it is stale', async () => {
    const { db, clock, worker, ran, tasks } = await setup();
    await worker.schedule('job', { n: 1 });
    await run(db, `UPDATE tasks SET status = 'running', run_at = ?`, new Date(START.getTime()).toISOString());
    await worker.runDue();
    expect(ran).toEqual([]); // claimed a moment ago: another run may still be on it
    clock.advance(11 * MINUTE);
    await worker.runDue();
    expect(ran).toEqual(['job1']);
    expect(await tasks()).toEqual([{ kind: 'job', status: 'done', attempts: 1 }]);
  });
});
