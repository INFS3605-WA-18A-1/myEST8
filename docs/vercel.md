# Hosting on Vercel and Supabase

myEST8 runs as one Vercel function (`api/index.ts`) over a Supabase Postgres
database, with uploaded files in Supabase Storage. This replaces the home server
and Cloudflare Tunnel in `docs/hosting.md`, which still works for self-hosting.

## How it fits together

- **Web and webhooks**: every path is rewritten to `api/index.ts` (`vercel.json`), which serves the same Hono app as `npm start` (`src/hosted.ts`, hosted mode of `src/demo/runtime.ts`).
- **Background tasks** have no daemon. A POST (webhook, upload) runs the worker once the response is sent. `GET /api/cron/worker` (bearer `CRON_SECRET`) drains due tasks in a 45 s budget. It is called daily by Vercel Cron and every five minutes by `.github/workflows/worker-ping.yml`, because Hobby cron is once a day. A task whose run died is retried after ten minutes.
- **Database**: Supabase's transaction pooler (port 6543, no prepared statements), schema `public`, two connections per function instance (`DB_POOL_MAX`). The app connects as the table owner, so row-level security (on, no policies) does not apply to it, and the public API sees nothing.
- **Files**: with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set, new files go to the private `files` bucket and the row keeps only the object path. Tenant photos upload from the browser straight to the bucket through signed URLs (the function accepts about 4.5 MB per request); the ordinary form still works without JavaScript for small files. Files saved earlier stay in the database and keep working.
- **Migrations are never run by the app.** Apply them with the Supabase CLI.

## Set up

1. **Database**: create the Supabase project, then `supabase link --project-ref <ref>` and `supabase db push`. Check `supabase migration list` and the project's advisors afterwards.
2. **Bucket**: create a private bucket named `files` (Storage in the dashboard, or `insert into storage.buckets (id, name, public) values ('files', 'files', false)`).
3. **Vercel project**: import the GitHub repository, production branch `master`. Framework preset: Other.
4. **Environment variables** (Vercel, Production and Preview; never committed): everything in the Vercel block of `.env.example`, plus the provider keys in `docs/channels-setup.md` (`RESEND_*`, `ANTHROPIC_API_KEY`, `META_*`, `TWILIO_*`), `FILE_LINK_SECRET` (32+ random characters) and `TOKEN_ENCRYPTION_KEY` if Gmail is used. `PUBLIC_URL` is the production domain, not a preview URL: providers and Tenant links use it.
5. **Worker ping**: in GitHub, add the secret `CRON_SECRET` (same value as on Vercel) and the variable `APP_URL`.
6. **Point providers at the new address**: Resend (`/webhooks/resend`), Meta WhatsApp (`/webhooks/whatsapp`), Twilio (`/webhooks/twilio`), and the Google OAuth redirect (`/oauth/google/callback`).
7. **Rate limiting**: the limiter on the no-login Tenant links counts per function instance. For a hard limit add a Vercel Firewall rate-limit rule on `/u/*`, `/t/*`, `/api/u/*` and `/api/t/*`.

## Limits to know

- Hobby cron is daily and the plan is for non-commercial use; Pro allows per-minute cron.
- The SendGrid inbound webhook (`/webhooks/sendgrid`, up to 40 MB) cannot work on Vercel. Email comes in through Resend (ADR 0006).
- All writes take one per-schema advisory lock (`src/db.ts`), so write throughput is serialised across instances.
- A staged upload that is never completed stays in `staging/` in the bucket; clear it now and then.
