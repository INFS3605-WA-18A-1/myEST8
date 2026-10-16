// Browser tests against production's own entry point: api/index.ts served by
// scripts/prod-local.ts (`npm run prod:local`), on a fresh Postgres database
// with no demo data. `npm run test:e2e:prod-local`; see docs/testing.md,
// "Run it like production". The ordinary suite (playwright.config.ts) runs the demo.

import { defineConfig, devices } from '@playwright/test';
import { freePort, testDatabase } from './test/e2e/support/server.ts';

// As playwright.config.ts: chosen once by the runner, inherited by the workers,
// the database dropped by the same global teardown.
process.env.E2E_PORT ??= String(freePort());
process.env.E2E_DATABASE_URL ??= testDatabase();
const port = Number(process.env.E2E_PORT);
const baseURL = `http://localhost:${port}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'test/e2e/prod-local',
  testMatch: '**/*.spec.ts',
  globalTeardown: './test/e2e/support/teardown.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 30_000,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results/prod-local',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: [process.execPath, '--import', 'tsx', 'scripts/prod-local.ts'].map((part) => JSON.stringify(part)).join(' '),
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 90_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: String(port),
      SUPABASE_DB_URL: process.env.E2E_DATABASE_URL,
      DATABASE_SCHEMA: 'public',
      // Short, so the specs can watch the worker run; production pings every five minutes.
      PROD_LOCAL_CRON_SECONDS: '2',
    },
  },
});
