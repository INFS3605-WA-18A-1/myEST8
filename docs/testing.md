# Testing myEST8

How we test, from the fast in-process tests up to production, and how each
environment keeps its own data. Every test that runs on a laptop or in CI uses
its own throwaway database and mocked external APIs, so tests never need
secrets and never touch real data.

## Run it

```sh
npm test               # unit and integration tests (vitest) on Postgres, ~2 min
npm run test:e2e       # browser tests (Playwright + Chromium) against the real server, ~20 s
npm run check          # typecheck + unit + e2e: what CI runs (alias: npm run test:all)
npm run dev            # the app for manual testing, data kept in the Postgres schema "dev"
```

First time on a machine: `npm ci && npx playwright install chromium` (add `--with-deps` on a fresh Linux box). You need Docker: the tests and the demo run on a local Postgres (`postgres:17` in a container called `myest8-postgres`, port 54340), which they start themselves if nothing answers there. `npm run db:start` / `db:stop` / `db:reset` manage it by hand. To use a Postgres you run yourself, set `TEST_DATABASE_URL` (tests) and `SUPABASE_DB_URL` (dev and demo); both must be on this machine.

How the tests get their databases: the vitest global setup (`test/support/global-setup.ts`) makes one database per run on that Postgres and drops it at the end. Each test gets its own schema in it with every migration applied (`testDb()` in `test/support/db.ts`, which `createHarness` and the demo tests use), so tests run in parallel without seeing each other's data, and no test cleans up after another. The Playwright config does the same per run (`myest8_e2e_*`), with one schema per server.

Debugging a browser test: `npx playwright test --headed`, `npx playwright test --ui`, or open the trace of a failure with `npx playwright show-trace test-results/<test>/trace.zip`.

## The layers

| Layer | What it proves | Where | Runs |
| --- | --- | --- | --- |
| Domain and workflow (integration) | The maintenance workflow end to end through `createApp`: inbound messages, guided questions, Quotes, approvals, Work Orders, reminders, and two of the same thing at once (`test/concurrency.test.ts`). Fakes at every port (`test/support/fakes.ts`), a `FakeClock`, a Postgres schema of its own. | `test/*.test.ts` via `test/support/harness.ts` | `npm test`, every commit |
| Data layer | Values round-trip as on SQLite (ids, cents and counts as numbers, times as ISO text, files as bytes), transactions commit together on one connection and run one at a time, migrations apply. | `test/db.test.ts` | `npm test` |
| HTTP routes | Each page and webhook through the Hono app: status codes, redirects, what the page says, sign-in and same-origin checks, Twilio/SendGrid signatures. | `test/web/*.test.ts`, `test/http.test.ts` via `test/support/web.ts` | `npm test` |
| Adapters (contract) | Each adapter sends the request the provider expects and reads its response, against a stubbed `fetch` (`test/adapters/stub-fetch.ts`). | `test/adapters/*.test.ts` | `npm test` |
| Demo runtime | The demo wiring, its stories, the mock APIs, and reopening a kept schema. | `test/demo/*.test.ts` | `npm test` |
| Browser end to end | Critical journeys in Chromium against the real server process: sign up, sign in, a Tenant's text becoming a Maintenance Request via the phone simulator and the upload page, data surviving a restart, keyboard access. | `test/e2e/*.spec.ts`, `playwright.config.ts` | `npm run test:e2e`, every commit |
| Staging | Real Twilio sandbox, real Jev/Places keys, a real Postgres: the parts fakes can't prove. | a deployed staging app | before each release (not set up yet) |
| Production smoke | The live app is up and its webhooks answer. | a deployed production app | after each deploy (not set up yet) |

Most tests belong in the bottom three layers: they are fast, deterministic and
say exactly what broke. Add a browser test only for a journey a Property
Manager or Tenant can't do without, or for behaviour only a browser shows
(JavaScript, focus, file uploads).

### Writing browser tests

- Find things the way a person does: `getByRole`, `getByLabel`, visible text. Never CSS classes or `data-*` hooks that pages are free to change; the suite must survive redesigns.
- Keep each test independent. The tests share one server, so make what you create unique (`unique()` in `test/e2e/support/actions.ts`) and don't assume counts on shared pages.
- A test that needs its own server (restarts, a different seed) starts one with `startDemo()` from `test/e2e/support/server.ts` on its own port and schema.
- The background worker runs every 2 seconds; wait for its effects with `expect(...).toPass()`, never fixed sleeps.

### Still to add

- **Recorded contract tests.** Today's adapter tests use hand-written responses. When we have real Jev, Twilio, SendGrid and Places accounts, record one real response per call into `test/adapters/fixtures/` (keys scrubbed) and run the adapters against them, so a provider changing its format fails a test instead of production. Re-record on purpose, never automatically.
- **Staging** and **production smoke tests** (below), once there is a production entry point (issue 10) and a hosted database (issue 14).

## Environments

| Environment | Database | External APIs | Messages | How it starts |
| --- | --- | --- | --- | --- |
| Unit / integration tests | Local Postgres: a database per run, a schema per test, dropped afterwards | Fakes at the ports | `FakeMessenger` | `npm test` |
| Browser tests (local and CI) | Local Postgres: a database per run (`SUPABASE_DB_URL` and `DATABASE_SCHEMA` set by `playwright.config.ts`), dropped afterwards | In-process mocks (`src/demo/mock-apis.ts`); real-API env vars are blanked | Simulated | `npm run test:e2e` |
| CI | A `postgres:17` service container (`.github/workflows/ci.yml`), the same as local; no hosted credentials | As above | As above | every push |
| Local dev | Local Postgres, schema `dev` in the `myest8` database, kept across restarts (`npm run dev:reset` to start again) | Mocks, or real ones you opt into with env vars (`.env.example`) | Simulated | `npm run dev` |
| Demo / presenting | Local Postgres, a throwaway schema, fresh seed and stories every start | Mocks | Simulated | `npm run demo` |
| Staging (planned) | Its own Supabase Postgres database, never production's | Real: Twilio test credentials or sandbox numbers, Jev/Places test keys, SendGrid to a test domain | Real, to team phones only | the production entry point with staging env vars |
| Production (planned) | The production Supabase project | Real | Real | the production entry point (issue 10) |

The rule that holds everywhere: **a database belongs to exactly one
environment**. Tests create their own and throw it away; nothing but production
ever has the production connection string.

## Postgres and Supabase

The data layer is Postgres through postgres.js (`src/db.ts`, issue 14): async
`one`, `all` and `run`, and `transaction(db, async () => ...)`, over a pool.
SQL keeps SQLite's `?` placeholders; `src/db.ts` numbers them for Postgres.

- **Schema:** SQL migrations in `supabase/migrations/<timestamp>_<name>.sql`, named as `supabase migration new` names them. No module creates tables. Locally (tests, `npm run dev`, the demo, CI) `src/migrate.ts` applies them, records each in the schema's `schema_migrations` table, and refuses any database that isn't on this machine. Hosted databases get them from the Supabase CLI only: `supabase db push --db-url "$SUPABASE_DB_URL"`, staging before production.
- **Types:** as on SQLite. Ids and integers are `bigint` and come back as JS numbers; `REAL` is `double precision`; files stay in the database as `bytea` and come back as `Uint8Array`; times stay ISO 8601 UTC text, compared and sorted as text; JSON stays JSON text. The local Postgres sorts text by code point (`C.UTF-8`), as SQLite did.
- **Transactions** run on one connection each, and every `one`/`all`/`run` on `db` inside one (in any module) goes to that connection. They take a lock on their schema first, so they run one at a time, like SQLite's single writer: a check made inside one ("is this Job still choosing a Quote?") still holds when it writes. Actions that used to be one synchronous step (choosing a Quote, confirming a Maintenance Request, recording a reply, signing up) check and write inside one transaction, and send their messages after it commits. The worker claims each task in one statement, so two worker runs never take the same task. A transaction inside a transaction is a savepoint. Keep transactions short: never wait on an external API inside one.
- **Connection string:** `SUPABASE_DB_URL`. A production entry point (issue 10) reads it with `requireDatabaseUrl()` and refuses to start without one. The demo and `npm run dev` default to the local Postgres. Behind Supabase's transaction pooler (port 6543) prepared statements are turned off.
- **Row level security** is on for every table with no policies, so Supabase's REST API (anon key) can read nothing; the app connects as the tables' owner and does its own authorisation per Agency.

### Still to do

- **Hosted environments.** One Supabase project per long-lived environment. Production is its own project. Staging is either a [Supabase branch](https://supabase.com/docs/guides/deployment/branching) of the production project (needs a paid plan; each branch is a separate Postgres with its own connection string) or a second free project. Either way, a different database with different credentials. Pick the Sydney region (tenants' personal information).
- **`SUPABASE_DB_URL` per environment.** Each environment's deploy has its own; the production value lives only in the production host's secret store.
- **Staging gets realistic data, never a copy of production.** Seed it with the demo seed (`src/demo/seed.ts`) or an anonymised fixture; Tenants' phone numbers and addresses stay in production.
- **Production smoke test after each deploy:** `GET /login` answers 200, a signed test webhook from Twilio's console reaches `/webhooks/twilio`, and the worker's last run is recent. Read-only; it never creates data in production.
- **Times as `timestamptz`.** Times are text today, exactly as on SQLite. Moving them to `timestamptz` is a later migration plus reading them back as ISO strings.
