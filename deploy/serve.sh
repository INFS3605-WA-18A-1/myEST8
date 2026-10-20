#!/usr/bin/env bash
# Runs the app via src/main.ts (npm start). With no arguments it is the live app: port
# 4000, data in the Postgres schema "live", PUBLIC_URL the named tunnel's address from
# live.env or the quick tunnel's URL. `serve.sh <port> <schema>` runs another copy; the
# QA unit (myest8-qa.service) is `serve.sh 4100 qa`, and its address must come from
# qa.env. src/main.ts delivers through real providers: DEMO_SEND_TO defaults to "*"
# when unset, and the process exits while any API is mocked unless ALLOW_MOCKS=1.
# src/demo/main.ts does neither. See docs/hosting.md and docs/qa.md.
set -euo pipefail
cd "$(dirname "$0")/.."

port="${1:-4000}"
schema="${2:-live}"

if [[ "$schema" != live ]]; then
  # Another copy has its own address and its own data: it never takes the live tunnel's URL
  # (below), and it never uses a hosted database or hosted file storage.
  [[ "$schema" =~ ^qa(_[a-z0-9_]+)?$ ]] || { echo "serve.sh only runs the schemas live and qa, not \"$schema\"" >&2; exit 1; }
  [[ -n "${PUBLIC_URL:-}" ]] || { echo "PUBLIC_URL is not set: put the QA address in qa.env (deploy/qa.env.example)" >&2; exit 1; }
  [[ "$PUBLIC_URL" =~ ^https://qa[.-] ]] || { echo "PUBLIC_URL ($PUBLIC_URL) is not a QA address: its hostname must start with qa- (deploy/qa.env.example)" >&2; exit 1; }
  [[ -z "${SUPABASE_URL:-}${SUPABASE_SERVICE_ROLE_KEY:-}" ]] || { echo "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is set: QA never uses Supabase" >&2; exit 1; }
  # src/main.ts emails anyone when DEMO_SEND_TO is unset or "*". QA may email the test account only.
  [[ -n "${DEMO_SEND_TO:-}" && "${DEMO_SEND_TO}" != *'*'* ]] || { echo "DEMO_SEND_TO must name the test Gmail address (and not be * or empty): QA may only email that account" >&2; exit 1; }
fi

# A fixed PUBLIC_URL comes from live.env (named tunnel). Otherwise it is the quick tunnel's, which changes on every restart.
if [[ -z "${PUBLIC_URL:-}" ]]; then
  url_file="${XDG_STATE_HOME:-$HOME/.local/state}/myest8/public-url"
  for _ in $(seq 60); do
    [[ -s "$url_file" ]] && break
    sleep 1
  done
  [[ -s "$url_file" ]] || { echo "No tunnel URL in $url_file: is myest8-tunnel running?" >&2; exit 1; }
  export PUBLIC_URL="$(cat "$url_file")"
fi

export PORT="$port"
export DATABASE_SCHEMA="$schema"
export NODE_ENV=production

node_modules/.bin/tsx scripts/db.ts start --quiet
exec node_modules/.bin/tsx src/main.ts
