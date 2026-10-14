#!/usr/bin/env bash
# Opens a Cloudflare quick tunnel to the live app and saves its public URL where
# deploy/serve.sh reads it. A quick tunnel gets a new random URL every time this
# starts. See docs/hosting.md.
set -euo pipefail

port=4000
state="${XDG_STATE_HOME:-$HOME/.local/state}/myest8"
mkdir -p "$state"
rm -f "$state/public-url"

# --config /dev/null: ignore ~/.cloudflared/config.yml, whose ingress rules would override --url.
cloudflared --config /dev/null tunnel --no-autoupdate --url "http://127.0.0.1:$port" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ ! -s "$state/public-url" && $line =~ https://[a-z0-9-]+\.trycloudflare\.com ]]; then
    printf '%s' "${BASH_REMATCH[0]}" > "$state/public-url"
  fi
done
