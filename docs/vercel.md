# Hosting on Vercel and Supabase

myEST8 runs as one Vercel function (`api/index.ts`) over a Supabase Postgres
database, with uploaded files in Supabase Storage. This replaces the home server
and Cloudflare Tunnel in `docs/hosting.md`, which still works for self-hosting.

## How it fits together

- **Web and webhooks**: every path is rewritten to `api/index.ts` (`vercel.json`), which serves the same Hono app as `npm start` (`src/hosted.ts`, hosted mode of `src/demo/runtime.ts`).
- **Background tasks** have no daemon. A POST (webhook, upload) runs the worker once the response is sent. `GET /api/cron/worker` (bearer `CRON_SECRET`) drains due tasks in a 45 s budget. It is called daily by Vercel Cron and every five minutes by `.github/workflows/worker-ping.yml`, because Hobby cron is once a day. A task whose run died is retried after ten minutes.
- **Region**: the function runs in `icn1` (Seoul, `vercel.json` `regions`), next to the database in `ap-northeast-2`. A page makes several queries one after another, so a function in another region pays a cross-ocean round trip for each; Vercel's default `iad1` made every page take seconds. Move both together.
- **Database**: Supabase's transaction pooler (port 6543, no prepared statements), schema `public`, two connections per function instance (`DB_POOL_MAX`). The app connects as the table owner, so row-level security (on, no policies) does not apply to it, and the public API sees nothing.
- **Files**: with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set, new files go to the private `files` bucket and the row keeps only the object path. Tenant photos upload from the browser straight to the bucket through signed URLs (the function accepts about 4.5 MB per request); the ordinary form still works without JavaScript for small files. Files saved earlier stay in the database and keep working.
- **Migrations are never run by the app.** Apply them with the Supabase CLI.

## Set up

1. **Database**: create the Supabase project, then `supabase link --project-ref <ref>` and `supabase db push`. Check `supabase migration list` and the project's advisors afterwards.
2. **Bucket**: create a private bucket named `files` (Storage in the dashboard, or `insert into storage.buckets (id, name, public) values ('files', 'files', false)`).
3. **Vercel project**: import the GitHub repository, production branch `master`. Framework preset: Other.
4. **Environment variables** (Vercel, Production scope; never committed): everything in the Vercel block of `.env.example`, plus the provider keys in `docs/channels-setup.md` (`RESEND_*`, `ANTHROPIC_API_KEY`, `META_*`, `TWILIO_*`), `FILE_LINK_SECRET` (32+ random characters) and `TOKEN_ENCRYPTION_KEY` if Gmail is used. `PUBLIC_URL` is the production domain: providers and Tenant links use it.
5. **Worker ping**: in GitHub, add the secret `CRON_SECRET` (same value as on Vercel) and the variable `APP_URL`.
6. **Point providers at the new address**: Resend (`/webhooks/resend`), Meta WhatsApp (`/webhooks/whatsapp`), Twilio (`/webhooks/twilio`), and the Google OAuth redirect (`/oauth/google/callback`).
7. **Rate limiting**: the limiter on the no-login Tenant links counts per function instance. For a hard limit add a Vercel Firewall rate-limit rule on `/u/*`, `/t/*`, `/api/u/*` and `/api/t/*`.

## Limits to know

- Any non-local `SUPABASE_DB_URL` connects with TLS required (a URL `sslmode=require`/`verify-*` is honoured), and `DATABASE_SCHEMA` must stay `public` on the :6543 transaction pooler, which ignores `search_path`; the app refuses to start otherwise.
- Hobby cron is daily and the plan is for non-commercial use; Pro allows per-minute cron.
- The SendGrid inbound webhook (`/webhooks/sendgrid`, up to 40 MB) cannot work on Vercel. Email comes in through Resend (ADR 0006).
- All writes take one per-schema advisory lock (`src/db.ts`), so write throughput is serialised across instances.
- A staged upload that is never completed stays in `staging/` in the bucket; clear it now and then.

## CI/CD

`.github/workflows/ci.yml` runs on free GitHub-hosted runners (the repository is public, so the minutes are unlimited). It never runs on a home server: on a public repository a pull request from a fork could run its code there.

**Vercel's own Git integration is off.** `vercel.json` sets `"git": {"deploymentEnabled": false}`, so a push never makes Vercel build and deploy by itself. Otherwise Vercel could ship a commit before `test` and `migrate-prod` have finished, running new code on an old schema. Every production deploy goes through `deploy-prod` (or `Rollback`) in GitHub Actions.

| Event | Jobs |
| --- | --- |
| Pull request | `test` and `build`, with no secrets (forks included). There are no previews: the single Supabase project is production, and a preview would use its data. Instead `build` runs production's `vercel build` without deploying, and `scripts/check-vercel-function.ts` checks the function holds every file the app reads at run time. |
| Push to `master` | `test` and `build`, then `migrate-prod` (`supabase db push`), `deploy-prod`, and `smoke` (landing page 200, worker route 401 without the secret and 200 with it). |
| Manual | `Rollback`: give it an earlier deployment's address or id (`vercel ls --prod`). |

Migrations only ever add (new tables, new nullable columns); anything that removes something is a separate, deliberate change. That is what lets Rollback run older code on the newer database.

**Set up once**

- The `files` bucket in the Supabase project (Storage, private).
- GitHub **secrets**: `VERCEL_TOKEN`, `SUPABASE_DB_URL` (the *session pooler* address on port 5432, which works over IPv4), `CRON_SECRET`.
- GitHub **variables**: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (both in `.vercel/project.json` after `vercel link`), `APP_URL`.
- A GitHub Environment named `production`; add required reviewers to it to approve each production deploy.
- Vercel environment variables for the *Production* scope. The running app uses the *transaction pooler* address (port 6543) as `SUPABASE_DB_URL`; the pipeline uses the session pooler's.
- Branch protection on `master`: require a pull request and the `test` check.

## Backups

`.github/workflows/backup.yml` dumps the database every week, encrypts it with age, and keeps it as an artifact for 30 days. It needs the secrets `SUPABASE_DB_URL` (the same session pooler address as above) and `BACKUP_AGE_RECIPIENT` (a public key). Storage files are not included. Setup, restore commands and the restore drill are in [backup-restore.md](backup-restore.md).
