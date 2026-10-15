# Backup and restore

`.github/workflows/backup.yml` runs every Sunday (and on demand from the Actions tab). It takes a `pg_dump` of the production database's `public` schema, encrypts it with [age](https://age-encryption.org) to a public key, and uploads the encrypted file as a workflow artifact kept for 30 days.

**The repository is public, so every artifact is world-readable.** That is why the dump goes straight from `pg_dump` into `age` and never exists unencrypted on disk or in an artifact. Only someone holding the private key can read a backup. The private key never goes into GitHub.

## One-time setup

1. On your own machine, install age (`sudo apt install age`, `brew install age`) and make a key pair:

   ```bash
   age-keygen -o myest8-backup.key
   ```

   It prints `Public key: age1...`. The file `myest8-backup.key` holds the private key (`AGE-SECRET-KEY-...`).

2. **Keep the private key offline**: a password manager entry and a copy on an encrypted USB stick or on paper, in a place that is not this repository, not GitHub and not Vercel. If you lose it, every backup is unreadable. If it leaks, make a new pair, replace the secret in step 3, and treat the old backups as exposed.

3. In GitHub (Settings, Secrets and variables, Actions), add the secret `BACKUP_AGE_RECIPIENT` with the **public** `age1...` value only. `SUPABASE_DB_URL` is already there for the migration job (the session pooler address, port 5432). The workflow refuses to run if `BACKUP_AGE_RECIPIENT` is empty or is not an `age1...` public key.

4. Run it once by hand: Actions, Backup, Run workflow. Then do the restore drill below.

The workflow asks the database for its Postgres major version and installs a `pg_dump` of exactly that major (from the PGDG apt repository if the runner image's client is older), because `pg_dump` will not dump a newer server. Its errors from `pg_dump` and `psql` are hidden on purpose, since they can name the pooler host and project user in a public log. If a run fails, run the same `pg_dump` from your own machine to see the message.

GitHub turns off scheduled workflows in a public repository after 60 days without repository activity. If the repository goes quiet, re-enable the workflow in the Actions tab, or run it by hand now and then.

## Where the backup is

Actions tab, the **Backup** workflow, a run, **Artifacts** at the bottom: `db-backup-<run id>`. It holds one file, `myest8-<UTC timestamp>.sql.age`. Artifacts are deleted after 30 days. You must be signed in to GitHub to download one. With the GitHub CLI:

```bash
gh run list --workflow=backup.yml
gh run download <run id> --name db-backup-<run id>
```

For a longer history, download the file now and then and keep it somewhere safe. It is already encrypted.

## Restore

Restore into a **fresh** Supabase project, never over the live one.

1. Create the new Supabase project and note its **session pooler** address (port 5432) as `NEW_DB_URL`. Use the same Postgres major version as the backup (Supabase's default is the one in `supabase/config.toml`, `major_version`). Use a `psql` of that major or newer.

2. Decrypt and load. The dump is the `public` schema: tables, data, indexes, constraints, row-level security and grants.

   ```bash
   export NEW_DB_URL='postgresql://postgres.<new-ref>:<password>@<pooler-host>:5432/postgres'

   age -d -i myest8-backup.key myest8-<timestamp>.sql.age \
     | psql --set ON_ERROR_STOP=on --single-transaction "$NEW_DB_URL"
   ```

   Nothing is written to disk in plain text. If it fails, the transaction rolls back and the project is still empty.

3. Tell the Supabase CLI the migrations are already in, or the next `supabase db push` will try to apply them again to tables that exist:

   ```bash
   supabase link --project-ref <new-ref>
   for f in supabase/migrations/*.sql; do
     v=$(basename "$f" | cut -d_ -f1)
     supabase migration repair --status applied "$v"
   done
   supabase migration list
   ```

   Local and remote columns of `supabase migration list` should match.

4. Create the private `files` bucket (Storage in the dashboard) and put the Storage files back, as below.

5. Point the app at the new project: Vercel (Production) `SUPABASE_DB_URL` (transaction pooler, port 6543), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; and the GitHub secret `SUPABASE_DB_URL` (session pooler, port 5432). Redeploy through the pipeline (`docs/vercel.md`).

## Storage files are not in the backup

The dump covers the database only. Files that live in the private `files` bucket (everything uploaded since files moved to Storage) are **not included**. Files saved earlier are stored in the database and **are** in the dump.

To download the bucket with the Supabase dashboard: open the project, **Storage**, the `files` bucket, select the folders or files you want (tick the boxes), and choose **Download**. Do this on the same schedule as you keep database backups, and keep the download somewhere private: these are tenants' photos and quotes, and unlike the database backup they are not encrypted for you. Encrypt them first (for example `tar c files | age -r <your public key> > files.tar.age`).

To restore, create the private `files` bucket in the new project and upload the folders back in the dashboard (**Upload folder**), keeping the same names. Rows keep only the object path, so paths must match exactly. You can skip `staging/`: it only holds uploads that were never completed.

## Restore drill

Do this after setup, then every quarter, so you know the backup works before you need it. Use a throwaway Supabase project and delete it afterwards.

- [ ] The latest Backup run is green and its artifact is under 30 days old.
- [ ] You can find the private key (offline copy) without touching GitHub.
- [ ] Download the artifact; it is a single `.sql.age` file.
- [ ] `head -c 21 <file>` prints `age-encryption.org/v1` (it is encrypted, not plain SQL).
- [ ] Create a fresh Supabase project and its session pooler address.
- [ ] `age -d -i <key> <file> | psql --set ON_ERROR_STOP=on --single-transaction "$NEW_DB_URL"` finishes without an error.
- [ ] Row counts look right: `select count(*) from issues;` (and `tickets`, `jobs`, `files`) matches production.
- [ ] `supabase migration repair` for every file in `supabase/migrations`; `supabase migration list` matches.
- [ ] Optional: start the app against the new database (`SUPABASE_DB_URL` in your local environment) and open an Issue.
- [ ] Download a few files from the `files` bucket and check you can open them.
- [ ] Delete the throwaway project, and note the date of the drill.
