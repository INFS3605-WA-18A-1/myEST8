#!/usr/bin/env bash
# Runs the live app: the demo runtime on port 4000 with its data kept in the
# Postgres schema "live", and PUBLIC_URL set to the tunnel's URL. See docs/hosting.md.
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
exec node_modules/.bin/tsx src/demo/main.ts
