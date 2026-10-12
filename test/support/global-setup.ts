// Before any test file: makes sure a Postgres is up (starting the local Docker
// one if need be) and creates this run's own database, dropped at the end.
// Each test then gets its own schema in it (test/support/db.ts).

import type { TestProject } from 'vitest/node';
import { createDatabase, dropDatabase, ensurePostgres, testServerUrl, withDatabase } from '../../scripts/local-postgres.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** This run's database: test/support/db.ts makes a schema in it per test. */
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const server = testServerUrl();
  await ensurePostgres(server, (line) => console.log(line));
  const name = `myest8_test_${Date.now().toString(36)}_${process.pid}`;
  await createDatabase(server, name);
  project.provide('databaseUrl', withDatabase(server, name));
  return () => dropDatabase(server, name);
}
