// STUB — the auth agent replaces this file. Exported names are the contract.
import { Hono, type MiddlewareHandler } from 'hono';
import type { App } from '../app.ts';
import type { Db } from '../db.ts';
import type { Clock } from '../ports.ts';
import type { WebEnv } from './env.ts';

export function createSessions(_db: Db, _clock: Clock) {
  return {
    start(_propertyManagerId: number): string {
      throw new Error('not built');
    },
    find(_token: string): number | null {
      return null;
    },
    end(_token: string) {},
  };
}
export type Sessions = ReturnType<typeof createSessions>;

/** GET/POST /login and POST /logout. */
export function authRoutes(_app: App, _sessions: Sessions) {
  return new Hono();
}

/** Lets a request through only with a valid session; sets `pm` and `actions`. Otherwise redirects to /login. */
export function requirePropertyManager(_app: App, _sessions: Sessions): MiddlewareHandler<WebEnv> {
  return async (c) => c.redirect('/login');
}
