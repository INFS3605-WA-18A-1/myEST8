// The data layer: Postgres (Supabase in production) through postgres.js, behind
// four async calls: `one`, `all`, `run` and `transaction`. SQL is written with
// `?` placeholders, numbered for Postgres here. The schema lives in SQL
// migrations (supabase/migrations/), never in application code; see
// src/migrate.ts for how local, test and CI databases get them.

import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';

export type Param = string | number | bigint | boolean | null | Uint8Array;

/** A connection pool to one schema of one Postgres database. */
export interface Db {
  readonly sql: postgres.Sql;
  /** The schema every unqualified table name resolves to (the connection's search_path). */
  readonly schema: string;
  /** Whether the server is on this machine (localhost), where migrations may be applied. */
  readonly local: boolean;
  /** Ends every connection, after the queries in flight. */
  close(): Promise<void>;
}

/** The local Postgres `npm run db:start` runs in Docker, and the demo's default. */
export const LOCAL_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:54340/myest8';

/**
 * The connection string from SUPABASE_DB_URL. Refuses to go on without one, so
 * a deployed app never falls back to some other database.
 */
export function requireDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL is not set: give the Postgres connection string for this environment (see .env.example).');
  return url;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Whether a connection string points at this machine. */
export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Quotes a Postgres identifier, such as a schema name. */
export function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Whether `url` goes through Supabase's transaction pooler (port 6543). */
function isTransactionPooler(url: string): boolean {
  try {
    return new URL(url).port === '6543';
  } catch {
    return /:6543(\/|\?|$)/.test(url);
  }
}

/** sslmode values that make postgres.js insist on TLS (or stricter); the rest can fall back to plain text. */
const TLS_SSLMODES = new Set(['require', 'verify-ca', 'verify-full', 'no-verify']);

/**
 * The postgres.js options that depend on where `url` points and which `schema`
 * it is for. Keys are left out (not set to undefined) when postgres.js's own
 * default, or the URL, should decide, because an option beats the URL.
 *
 * - A database that isn't on this machine requires TLS, so a Supabase pooler URL
 *   without `sslmode` can't connect in plain text. A URL `sslmode` that demands
 *   TLS (`require`, `verify-ca`, `verify-full`, `no-verify`) is left to decide;
 *   `disable`, `allow` and `prefer` are not honoured there. A local database
 *   is left as it was.
 * - A hosted database skips the type lookup at connect (`fetch_types`): it only
 *   finds array types, and the app uses none, so it saves a round trip per
 *   connection on a serverless cold start.
 * - The transaction pooler (port 6543) keeps no prepared statements and ignores
 *   the `search_path` start-up parameter, so it only serves schema `public`.
 */
export function connectionOptions(url: string, schema: string) {
  const pooled = isTransactionPooler(url);
  if (pooled && schema !== 'public') {
    throw new Error(
      `DATABASE_SCHEMA "${schema}" can't be used through Supabase's transaction pooler (port 6543): it ignores the search_path start-up parameter, so queries would run on the wrong schema. Use schema public, or connect through the session pooler (port 5432) or directly.`,
    );
  }
  const local = isLocalUrl(url);
  let sslmode: string | null = null;
  try {
    sslmode = new URL(url).searchParams.get('sslmode');
  } catch {
    // An unparseable URL has no sslmode.
  }
  return {
    ...(!local && !(sslmode && TLS_SSLMODES.has(sslmode)) ? { ssl: 'require' as const } : {}),
    ...(!local ? { fetch_types: false } : {}),
    prepare: !pooled,
    connection: schema === 'public' ? {} : { search_path: ident(schema) },
  };
}

/**
 * Opens a pool on `url`. With `schema`, unqualified table names resolve to that
 * schema (tests and the demo each keep their data in their own schema).
 */
export function openDb(url: string, options: { schema?: string; max?: number } = {}): Db {
  const schema = options.schema ?? 'public';
  const sql = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
    ...connectionOptions(url, schema),
    types: {
      // Ids, counts and cents are bigint; they come back as JS numbers, as they did from SQLite.
      int8: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      // sum() and avg() can return numeric.
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      // Files come back as plain Uint8Arrays, not Buffers.
      bytea: {
        to: 17,
        from: [17],
        serialize: (x: Uint8Array) => `\\x${Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString('hex')}`,
        parse: (x: string) => new Uint8Array(Buffer.from(x.slice(2), 'hex')),
      },
    },
  });
  return { sql, schema, local: isLocalUrl(url), close: () => sql.end({ timeout: 5 }) };
}

/** The transaction the current async call chain is inside, per pool. */
const current = new AsyncLocalStorage<{ db: Db; sql: postgres.TransactionSql; open: boolean }>();

/** Where a query on `db` goes: the open transaction this call is inside, or the pool. */
function connectionFor(db: Db): postgres.Sql | postgres.TransactionSql {
  const tx = current.getStore();
  return tx && tx.db === db && tx.open ? tx.sql : db.sql;
}

const numbered = new Map<string, string>();

/** Rewrites `?` placeholders as `$1`, `$2`, ..., leaving quoted text and comments alone. */
function toPostgres(sql: string): string {
  let out = numbered.get(sql);
  if (out !== undefined) return out;
  out = '';
  let n = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"') {
      const end = sql.indexOf(ch, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop - 1;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop - 1;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  numbered.set(sql, out);
  return out;
}

/** SQLite stored NaN and infinities as NULL; so do we, rather than fail on them. */
function toParam(value: Param): Param {
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

async function query<T>(db: Db, sql: string, params: Param[]): Promise<T[]> {
  const rows = await connectionFor(db).unsafe(toPostgres(sql), params.map(toParam) as postgres.ParameterOrJSON<never>[]);
  return [...rows] as T[];
}

/** The first row, or undefined. */
export async function one<T>(db: Db, sql: string, ...params: Param[]): Promise<T | undefined> {
  return (await query<T>(db, sql, params))[0];
}

export async function all<T>(db: Db, sql: string, ...params: Param[]): Promise<T[]> {
  return query<T>(db, sql, params);
}

/** Runs a statement. Returns the `id` it returns (`INSERT ... RETURNING id`), or 0. */
export async function run(db: Db, sql: string, ...params: Param[]): Promise<number> {
  const [row] = await query<{ id?: number }>(db, sql, params);
  return row?.id ?? 0;
}

/** A small number from a schema name, for the lock that serialises its transactions. */
function lockKey(schema: string): number {
  let hash = 0x811c9dc5;
  for (const ch of schema) hash = Math.imul(hash ^ ch.codePointAt(0)!, 0x01000193);
  return hash | 0;
}

/**
 * Runs `fn` in a transaction on one connection: every `one`, `all` and `run`
 * on `db` inside it (directly or through any module) goes to that connection,
 * and all of it commits or none does.
 *
 * Transactions on a schema run one at a time, like SQLite's single writer:
 * each takes a lock on its schema first, so a check made inside one ("is this
 * Job still choosing a Quote?") still holds when it writes. Keep them short and
 * never wait on an external API inside one. A transaction inside a transaction
 * becomes a savepoint.
 */
export async function transaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  const outer = current.getStore();
  if (outer && outer.db === db && outer.open) {
    return (await outer.sql.savepoint((sql) => within(db, sql, fn))) as T;
  }
  return (await db.sql.begin(async (sql) => {
    await sql.unsafe('SELECT pg_advisory_xact_lock($1)', [lockKey(db.schema)]);
    return within(db, sql, fn);
  })) as T;
}

async function within<T>(db: Db, sql: postgres.TransactionSql, fn: (tx: Db) => Promise<T>): Promise<T> {
  const tx = { db, sql, open: true };
  try {
    return await current.run(tx, () => fn(db));
  } finally {
    // Anything left running after the transaction ends goes back to the pool.
    tx.open = false;
  }
}
