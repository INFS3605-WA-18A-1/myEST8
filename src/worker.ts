import { one, run, type Db } from './db.ts';
import type { Clock } from './ports.ts';
import { iso } from './shared.ts';

type Handler = (payload: never) => Promise<void> | void;

const MAX_ATTEMPTS = 5;

/**
 * The background worker: runs tasks now or at a later time on the clock, and
 * recurring tasks every so often. A failing task is retried with backoff, then
 * left as failed; a task that fails with a permanent error (`error.permanent`,
 * such as an UndeliverableError) is left as failed straight away.
 */
export function createWorker(db: Db, clock: Clock) {
  const handlers = new Map<string, Handler>();
  const recurring = new Map<string, number>();
  const scheduleNext = (kind: string, intervalMs: number) =>
    run(db, 'INSERT INTO tasks (kind, payload, run_at) VALUES (?, ?, ?)', kind, '{}', iso(new Date(clock.now().getTime() + intervalMs)));

  return {
    on<P>(kind: string, handler: (payload: P) => Promise<void> | void) {
      handlers.set(kind, handler as Handler);
    },

    /** Runs `handler` every `intervalMs`, the first time `intervalMs` after the worker first runs. */
    every(kind: string, intervalMs: number, handler: () => Promise<void> | void) {
      handlers.set(kind, handler as Handler);
      recurring.set(kind, intervalMs);
    },

    async schedule(kind: string, payload: object, runAt: Date = clock.now()) {
      await run(db, 'INSERT INTO tasks (kind, payload, run_at) VALUES (?, ?, ?)', kind, JSON.stringify(payload), iso(runAt));
    },

    /** Runs every task that is due, including tasks those tasks schedule. Returns the errors raised. */
    async runDue(): Promise<Error[]> {
      const errors: Error[] = [];
      // A recurring task is scheduled once here, then again each time it starts.
      for (const [kind, intervalMs] of recurring) {
        const waiting = await one(db, `SELECT 1 AS found FROM tasks WHERE kind = ? AND status IN ('pending', 'running') LIMIT 1`, kind);
        if (!waiting) await scheduleNext(kind, intervalMs);
      }
      for (;;) {
        // Claimed in one statement, so two worker runs at once never take the same task.
        const task = await one<{ id: number; kind: string; payload: string; attempts: number }>(
          db,
          `UPDATE tasks SET status = 'running'
           WHERE id = (SELECT id FROM tasks WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
           RETURNING id, kind, payload, attempts`,
          iso(clock.now()),
        );
        if (!task) return errors;
        const intervalMs = recurring.get(task.kind);
        if (intervalMs !== undefined && task.attempts === 0) await scheduleNext(task.kind, intervalMs);
        try {
          const handler = handlers.get(task.kind);
          if (!handler) throw new Error(`No handler for task ${task.kind}`);
          await handler(JSON.parse(task.payload) as never);
          await run(db, `UPDATE tasks SET status = 'done' WHERE id = ?`, task.id);
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          errors.push(error);
          const attempts = task.attempts + 1;
          const permanent = (error as { permanent?: unknown }).permanent === true;
          const retryAt = new Date(clock.now().getTime() + 60_000 * 2 ** attempts);
          await run(
            db,
            `UPDATE tasks SET status = ?, attempts = ?, run_at = ?, last_error = ? WHERE id = ?`,
            permanent || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            attempts,
            iso(retryAt),
            error.stack ?? error.message,
            task.id,
          );
        }
      }
    },
  };
}

export type Worker = ReturnType<typeof createWorker>;
