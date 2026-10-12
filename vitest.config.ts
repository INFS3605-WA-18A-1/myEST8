import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Browser tests run under Playwright (npm run test:e2e), not vitest.
    exclude: [...configDefaults.exclude, 'test/e2e/**'],
    // Starts Postgres if need be and makes this run's database; each test gets a schema in it (test/support/db.ts).
    globalSetup: ['test/support/global-setup.ts'],
    // Every test talks to Postgres, so allow more than the 5 s default.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
