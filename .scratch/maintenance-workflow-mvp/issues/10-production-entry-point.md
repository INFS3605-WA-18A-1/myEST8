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
