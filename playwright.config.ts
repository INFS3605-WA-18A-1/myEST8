// Browser end-to-end tests: Playwright drives Chromium against the real demo
// server process, started on a free port with a throwaway Postgres database
// and every external API mocked. `npm run test:e2e`; see docs/testing.md.

import { defineConfig, devices } from '@playwright/test';
import { DEMO_COMMAND, MOCKED_APIS, freePort, testDatabase } from './test/e2e/support/server.ts';

// The config is loaded by the runner and again by each worker. The port and
// database are chosen once, by the runner, and reach the workers through the
// environment they inherit. The database is this run's own, on the test
// Postgres (TEST_DATABASE_URL, default the local Docker one, started if need
// be), and is dropped by the global teardown.
process.env.E2E_PORT ??= String(freePort());
process.env.E2E_DATABASE_URL ??= testDatabase();
const port = Number(process.env.E2E_PORT);
const baseURL = `http://localhost:${port}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  // The production-like specs run under playwright.prod-local.config.ts.
  testIgnore: '**/prod-local/**',
  globalTeardown: './test/e2e/support/teardown.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 30_000,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: DEMO_COMMAND.map((part) => JSON.stringify(part)).join(' '),
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ...MOCKED_APIS,
      PORT: String(port),
      PUBLIC_URL: baseURL,
      SUPABASE_DB_URL: process.env.E2E_DATABASE_URL,
      DATABASE_SCHEMA: 'e2e',
      // One shared address for every worker: the upload and quote cap is 20 a minute.
      RATE_LIMIT_UPLOADS: '1000',
      // Just the seeded Agency: fast to start, and nothing in flight to trip over.
      DEMO_DATA: 'empty',
    },
  },
});
