import { dropDatabase, testServerUrl } from '../../../scripts/local-postgres.ts';

/** Drops the run's throwaway database. */
export default async function teardown() {
  const url = process.env.E2E_DATABASE_URL;
  if (url) await dropDatabase(testServerUrl(), decodeURIComponent(new URL(url).pathname.slice(1)));
}
