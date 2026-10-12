# Production entry point

Status: ready-for-agent
Blocked by: 05, 06, 07, 08, 09

## Goal

A runnable server: `src/main.ts` that wires the app to real services and serves HTTP.

## What exists

- `createApp(deps)` in `src/app.ts` takes the ports, a database, a clock and settings.
- `openDb(path)` in `src/db.ts` (`node:sqlite`, WAL for file databases).
- `createHttpApp` in `src/http.ts` mounts the Twilio and SendGrid webhooks, the upload endpoint and the tracker.
- `app.runWorker()` runs due background tasks.

## Acceptance criteria

- [ ] `src/main.ts` reads configuration from the environment (database path, base URL, Twilio and SendGrid credentials, Jev, image matcher, quote reader and Places keys) and fails fast with a clear message when one is missing.
- [ ] Serves `createHttpApp` with `@hono/node-server`.
- [ ] Runs the worker on an interval with no overlapping runs; logs task failures.
- [ ] Graceful shutdown: stop the HTTP server and the worker loop, then close the database.
- [ ] A start script. The distro Node 22 on the dev machine has no TypeScript type stripping, so either add a build step (`tsc` emit or a bundler) or require a Node build with type stripping; document the choice.

## Testing

- A smoke test that starts the server with fake ports on a random port and posts a signed Twilio webhook. The full demo runs from the manual checklist.

## Comments

- Testing setup added (see `docs/testing.md`): `DATABASE_PATH` in the demo runtime (file database seeded once, reopened on restart), `npm run dev`, Playwright browser tests against the real server process (`npm run test:e2e`, `test/e2e/support/server.ts` shows how to start the server on a free port with its own database and stop it cleanly with SIGTERM), and CI in `.github/workflows/ci.yml`. The smoke test for this issue can follow `test/e2e/persistence.spec.ts`. Every env var is listed in `.env.example`. If the data layer moves to Postgres first (issue 14), read the connection string from `SUPABASE_DB_URL` instead of a database path.
