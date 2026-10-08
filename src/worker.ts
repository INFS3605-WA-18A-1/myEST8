import { all, run, type Db } from './db.ts';
import type { Clock } from './ports.ts';
import { iso } from './shared.ts';

type Handler = (payload: never) => Promise<void> | void;

const MAX_ATTEMPTS = 5;

/**
 * The background worker: runs tasks now or at a later time on the clock.
 * A failing task is retried with backoff, then left as failed.
 */
export function createWorker(db: Db, clock: Clock) {
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    run_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  )`);
  const handlers = new Map<string, Handler>();

  return {
    on<P>(kind: string, handler: (payload: P) => Promise<void> | void) {
      handlers.set(kind, handler as Handler);
    },

    schedule(kind: string, payload: object, runAt: Date = clock.now()) {
      run(db, 'INSERT INTO tasks (kind, payload, run_at) VALUES (?, ?, ?)', kind, JSON.stringify(payload), iso(runAt));
    },

    /** Runs every task that is due, including tasks those tasks schedule. Returns the errors raised. */
    async runDue(): Promise<Error[]> {
      const errors: Error[] = [];
      for (;;) {
        const [task] = all<{ id: number; kind: string; payload: string; attempts: number }>(
          db,
          `SELECT id, kind, payload, attempts FROM tasks WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT 1`,
          iso(clock.now()),
        );
        if (!task) return errors;
        run(db, `UPDATE tasks SET status = 'running' WHERE id = ?`, task.id);
        try {
          const handler = handlers.get(task.kind);
          if (!handler) throw new Error(`No handler for task ${task.kind}`);
          await handler(JSON.parse(task.payload) as never);
          run(db, `UPDATE tasks SET status = 'done' WHERE id = ?`, task.id);
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          errors.push(error);
          const attempts = task.attempts + 1;
          const retryAt = new Date(clock.now().getTime() + 60_000 * 2 ** attempts);
          run(
            db,
            `UPDATE tasks SET status = ?, attempts = ?, run_at = ?, last_error = ? WHERE id = ?`,
            attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
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
