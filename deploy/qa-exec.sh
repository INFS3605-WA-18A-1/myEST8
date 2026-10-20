#!/usr/bin/env bash
# Runs a command with QA's settings: the variables in ~/.config/myest8/qa.env (see
# deploy/qa.env.example) and DATABASE_SCHEMA=qa. The QA workflow and every manual QA
# command go through it, so none of them can pick up another environment's settings:
#
#   deploy/qa-exec.sh npx tsx scripts/qa-seed.ts
#   deploy/qa-exec.sh npx tsx scripts/qa-email-journey.ts
#
# QA_ENV_FILE points it at another file (the file may not be live.env). See docs/qa.md.
set -euo pipefail
cd "$(dirname "$0")/.."

env_file="${QA_ENV_FILE:-$HOME/.config/myest8/qa.env}"
[[ $# -gt 0 ]] || { echo "Usage: deploy/qa-exec.sh <command> [args...]" >&2; exit 2; }
[[ "$(basename "$env_file")" != live.env ]] || { echo "$env_file is the live app's settings. QA has its own: deploy/qa.env.example" >&2; exit 2; }
[[ -r "$env_file" ]] || { echo "No QA settings at $env_file. Copy deploy/qa.env.example there and fill it in (docs/qa.md)." >&2; exit 2; }

# A database or storage address left in the shell or the runner's environment must not reach
# QA: only the QA file may set one (and the app and seed refuse any that isn't a local Postgres).
unset SUPABASE_DB_URL POSTGRES_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

export DATABASE_SCHEMA=qa
exec "$@"
