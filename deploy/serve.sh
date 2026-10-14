#!/usr/bin/env bash
# Runs the live app via src/main.ts (npm start) on port 4000, data in the Postgres
# schema "live". PUBLIC_URL is the named tunnel's address from live.env, or the
# quick tunnel's URL. src/main.ts delivers through real providers: DEMO_SEND_TO
# defaults to "*" when unset, and the process exits while any API is mocked
# unless ALLOW_MOCKS=1. src/demo/main.ts does neither. See docs/hosting.md.
set -euo pipefail
cd "$(dirname "$0")/.."

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

export PORT=4000
export DATABASE_SCHEMA=live
export NODE_ENV=production

node_modules/.bin/tsx scripts/db.ts start --quiet
exec node_modules/.bin/tsx src/main.ts
