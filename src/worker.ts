import { one, run, type Db } from './db.ts';
import type { Clock } from './ports.ts';
import { iso } from './shared.ts';

type Handler = (payload: never) => Promise<void> | void;

const MAX_ATTEMPTS = 5;
/** A task still `running` this long after it was claimed belongs to a run that died (a serverless function is killed mid-task). */
const STALE_RUNNING_MS = 10 * 60_000;

/**
 * The background worker: runs tasks now or at a later time on the clock, and
 * recurring tasks every so often. A failing task is retried with backoff, then
 * left as failed; a task that fails with a permanent error (`error.permanent`,
 * such as an UndeliverableError) is left as failed straight away. A task left
 * `running` by a run that died is put back to pending, counting as an attempt.
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

    /**
     * Runs every task that is due, including tasks those tasks schedule. Returns the
     * errors raised. With `budgetMs` it stops starting tasks once that much real time
     * has passed (a function has a time limit); what is left runs on the next call.
     */
    async runDue(options: { budgetMs?: number } = {}): Promise<Error[]> {
      const errors: Error[] = [];
      const started = Date.now();
      // A claim stamps run_at, so run_at on a running task says when it was claimed.
      await run(
        db,
        `UPDATE tasks SET status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END, attempts = attempts + 1,
                last_error = 'The run that claimed this task stopped before it finished.'
         WHERE status = 'running' AND run_at < ?`,
        MAX_ATTEMPTS,
        iso(new Date(clock.now().getTime() - STALE_RUNNING_MS)),
      );
      // A recurring task is scheduled once here, then again each time it starts.
      for (const [kind, intervalMs] of recurring) {
        const waiting = await one(db, `SELECT 1 AS found FROM tasks WHERE kind = ? AND status IN ('pending', 'running') LIMIT 1`, kind);
        if (!waiting) await scheduleNext(kind, intervalMs);
      }
      for (;;) {
        if (options.budgetMs !== undefined && Date.now() - started >= options.budgetMs) return errors;
        // Claimed in one statement, so two worker runs at once never take the same task.
        const now = iso(clock.now());
        const task = await one<{ id: number; kind: string; payload: string; attempts: number }>(
          db,
          `UPDATE tasks SET status = 'running', run_at = ?
           WHERE id = (SELECT id FROM tasks WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
           RETURNING id, kind, payload, attempts`,
          now,
          now,
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
