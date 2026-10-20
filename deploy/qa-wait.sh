#!/usr/bin/env bash
# Waits until the QA app answers: first on this machine, then through the tunnel at
# PUBLIC_URL, which is the path Resend's webhook takes. Run it as
# `deploy/qa-exec.sh deploy/qa-wait.sh` so PUBLIC_URL is QA's. Exits 1 on a timeout.
set -euo pipefail

port=4100
: "${PUBLIC_URL:?PUBLIC_URL is not set: run this through deploy/qa-exec.sh}"

wait_for() {
  local what="$1" url="$2" seconds="$3" deadline=$((SECONDS + $3))
  until curl --silent --output /dev/null --fail --max-time 5 "$url"; do
    if ((SECONDS >= deadline)); then
      echo "Timed out after ${seconds}s waiting for $what ($url)" >&2
      return 1
    fi
    sleep 2
  done
  echo "$what answers"
}

wait_for "the QA app" "http://127.0.0.1:$port/login" 90
wait_for "the QA tunnel" "${PUBLIC_URL%/}/login" 60 || {
  echo "The app is up, but not at its public address: is the tunnel running (systemctl --user status myest8-tunnel-named) and does it route this hostname to port $port (deploy/cloudflared.yml)?" >&2
  exit 1
}
