# Move the data layer to Supabase Postgres, with separate test and production databases

Status: needs-triage

## Goal

Run myEST8 on Supabase Postgres so production data lives in a hosted, backed-up database, while every other environment (CI, staging, local dev) uses its own database and can never reach production's.

## Background

- The data layer is `node:sqlite` (`src/db.ts`): synchronous `one`, `all`, `run`, and `transaction(db, fn)` where `fn` must be synchronous. Each module creates its own tables with `CREATE TABLE IF NOT EXISTS`.
- Supabase is Postgres. Every Postgres driver for Node is async, so this is a port of the whole data layer, not a configuration change: about 140 data calls across 10 modules and 15 transaction call sites, plus everything that calls them up through `createApp`, the worker and the web routes.
- Today: tests use in-memory SQLite; `npm run dev` and the browser tests use SQLite files via `DATABASE_PATH` (see `docs/testing.md`). A Supabase project exists (ref in `.mcp.json`); nothing in the app uses it yet. `.env.example` has empty `SUPABASE_URL` and `SUPABASE_DB_URL` placeholders.
- `docs/testing.md` (Moving to Supabase) has the environment plan and the risks.

## Decisions a human must make

- [ ] **Go or wait.** Port now, or keep SQLite (a file database on a host with a persistent disk, backed up with Litestream or similar) until there are paying Agencies. The port touches most of the code; doing it before the production entry point (issue 10) avoids wiring production twice.
- [ ] **How the test/staging database is separated.** Supabase branching on the production project (paid plan; branches get their own Postgres and credentials, and can be created per pull request) or a second free project for staging. CI uses a local Postgres either way.
- [ ] **Driver.** `postgres` (postgres.js) or `pg` with a pool, talking SQL directly, or `@supabase/supabase-js` (REST, row-level security). Recommended: a SQL driver over the pooled connection string; the app does its own authorisation per Agency.
- [ ] **Where files go.** Photos, receipts and PDF Quotes are `BLOB`s in the `files` table today: keep them as `bytea`, or move them to Supabase Storage.
- [ ] **One engine or two.** Drop SQLite entirely (tests run on Postgres; slower, one dialect) or keep SQLite for unit tests behind a shared interface (fast, but two dialects to keep in step).
- [ ] **Region and data residency.** Tenants' names, phone numbers and addresses are personal information: pick the Sydney region and confirm the Australian Privacy Principles obligations.

## Acceptance criteria

- [ ] `src/db.ts` exposes an async interface (`one`, `all`, `run`, `transaction(async (tx) => ...)`) over a Postgres pool; every module uses it, and transactions use one connection each.
- [ ] Schema lives in SQL migration files (`supabase/migrations/`), applied by the Supabase CLI; no `CREATE TABLE` in application code.
- [ ] The app reads its connection string from `SUPABASE_DB_URL` and refuses to start without one (except the demo, which may keep an in-process option).
- [ ] CI runs every test against a local Postgres (`supabase start` or a `postgres` service container) with migrations applied at the start; no CI job has a hosted database's credentials.
- [ ] Each test is isolated (its own schema, or a transaction rolled back after it) and the suite stays under a few minutes.
- [ ] Staging and production are separate databases with separate credentials; migrations are applied to staging before production.
- [ ] `npm run dev` works against a local Postgres (`supabase start`), documented in `docs/demo.md` and `docs/testing.md`.
- [ ] Every existing test passes, including `npm run test:e2e`.

## Testing

- Port one module at a time behind the existing functions and keep `npm run check` green after each.
- Add tests for what Postgres changes: concurrent requests interleaving inside what used to be one synchronous transaction (two Quotes chosen at once, two webhooks for the same message), and ids and timestamps round-tripping.
