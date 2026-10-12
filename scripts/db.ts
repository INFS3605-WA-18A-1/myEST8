// The local Postgres for development, tests and the demo. See docs/testing.md.
//
//   npm run db:start     start Postgres in Docker (created the first time) and the dev database
//   npm run db:stop      stop the container; its data stays in the myest8-pgdata volume
//   npm run db:migrate   apply supabase/migrations to the dev schema (`npm run dev` does this itself)
//   npm run db:reset     throw away the dev database (`npm run dev`'s data and any demo leftovers)
//
// It works on SUPABASE_DB_URL when set (a local Postgres only), else on the
// Docker one at LOCAL_DATABASE_URL. It never touches a hosted database.

import { ident, isLocalUrl, LOCAL_DATABASE_URL, openDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { createDatabase, dropDatabase, ensurePostgres, redact, stopContainer, testServerUrl, withDatabase } from './local-postgres.ts';

const url = process.env.SUPABASE_DB_URL || LOCAL_DATABASE_URL;
const schema = process.env.DATABASE_SCHEMA || 'dev';
const database = decodeURIComponent(new URL(url).pathname.slice(1)) || 'postgres';
const quiet = process.argv.includes('--quiet');
const say = (line: string) => quiet || console.log(line);

if (!isLocalUrl(url)) {
  console.error(`${redact(url)} isn't a local database. scripts/db.ts only manages a Postgres on this machine; use the Supabase CLI for hosted ones.`);
  process.exit(1);
}

async function start() {
  await ensurePostgres(url, say);
  await createDatabase(url, database);
  say(`Postgres is up: ${redact(url)}`);
}

const commands: Record<string, () => Promise<void>> = {
  start,

  async stop() {
    await stopContainer();
    say('Stopped. The data is kept; `npm run db:start` brings it back.');
  },

  async migrate() {
    await start();
    const db = openDb(url, { schema, max: 1 });
    try {
      const applied = await migrate(db);
      say(applied.length ? `Applied ${applied.join(', ')} to schema ${schema}` : `Schema ${schema} is up to date`);
    } finally {
      await db.close();
    }
  },

  async reset() {
    await ensurePostgres(url, say);
    if (database === 'postgres') {
      const db = openDb(url, { max: 1 });
      await db.sql.unsafe(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
      await db.close();
      say(`Dropped schema ${schema}`);
      return;
    }
    await dropDatabase(url, database);
    await createDatabase(url, database);
    say(`Emptied the ${database} database: the next \`npm run dev\` seeds afresh.`);
  },

  /** For the Playwright config, which can't await: makes a fresh database for one run and prints its URL. */
  async 'test-database'() {
    const server = testServerUrl();
    await ensurePostgres(server);
    const name = process.argv[3]!;
    await dropDatabase(server, name);
    await createDatabase(server, name);
    process.stdout.write(withDatabase(server, name));
  },

  async 'drop-test-database'() {
    await dropDatabase(testServerUrl(), process.argv[3]!);
  },
};

const command = commands[process.argv[2] ?? ''];
if (!command) {
  console.error(`Usage: tsx scripts/db.ts ${Object.keys(commands).join('|')}`);
  process.exit(1);
}
try {
  await command();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
