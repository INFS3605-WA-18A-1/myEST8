#!/usr/bin/env bash
# Throws away the QA data, and only that: drops the Postgres schema "qa" and leaves "live"
# and everything else alone. The next QA workflow run (or `systemctl --user start myest8-qa`,
# then deploy/qa-exec.sh npx tsx scripts/qa-seed.ts) makes it again.
#
# Don't use `npm run db:reset` for this: with the default database it drops the whole
# `myest8` database, which holds the live schema too. See docs/qa.md.
set -euo pipefail

systemctl --user stop myest8-qa || true
docker exec myest8-postgres psql -U postgres -d myest8 -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS qa CASCADE'
echo "The QA data is gone. Schema live was not touched."
