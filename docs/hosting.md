# Hosting a shared copy

The shared copy is the demo runtime (there is no separate production entry point yet; see [testing.md](testing.md)) run as two systemd user services on this server, so it survives logouts and reboots:

| Service | What it does |
| --- | --- |
| `myest8-tunnel` | A Cloudflare quick tunnel to `127.0.0.1:4000`. Writes its public URL to `~/.local/state/myest8/public-url`, then restarts `myest8`. |
| `myest8` | `deploy/serve.sh`: the demo on port 4000, data kept in the Postgres schema `live` (seeded with the demo stories on first start, never replayed), `PUBLIC_URL` set to the tunnel URL. |

Files: `deploy/serve.sh`, `deploy/tunnel.sh`, `deploy/*.service` (symlinked into `~/.config/systemd/user/`). Postgres is the `myest8-postgres` Docker container, set to restart with Docker.

```sh
cat ~/.local/state/myest8/public-url            # the link to share
systemctl --user status myest8 myest8-tunnel
journalctl --user -u myest8 -f                  # app log, including every simulated message
journalctl --user -u myest8-tunnel -f           # tunnel log
```

## What people can do with the link

Everyone with the URL can sign in as Alice or Bob (`demo1234`, shown on the landing page), sign up their own Agency, and use the phone simulator at `/demo`. All external APIs are mocked and nothing is really sent, because no Twilio, SendGrid or `DEMO_SEND_TO` values are set. The URL is random, but it is not a secret once shared. Don't put real data in it.

A quick tunnel gets a **new URL every time `myest8-tunnel` restarts** (a server reboot, or `systemctl --user restart myest8-tunnel`). Restarting only `myest8` keeps the URL. For a fixed address you need a named tunnel on a domain in your Cloudflare account; that is a change to `deploy/tunnel.sh` plus a DNS route. The existing `~/.cloudflared/config.yml` belongs to the other tunnel, so `tunnel.sh` ignores it (`--config /dev/null`).

## Making changes on this server

The live app does not watch files: editing the code never changes it until you restart it. Work like this:

1. **Edit** the code in `/home/kevin_he/apps/myEST8` (VS Code Remote-SSH or Claude Code on the server).
2. **Try it** on a second instance with its own data, so the shared copy is untouched:
   ```sh
   PORT=4001 npm run dev      # schema "dev", restarts on every save
   ```
   Open it from your laptop with an SSH forward (`ssh -L 4001:localhost:4001 <server>`) or VS Code's Ports panel, then browse to `http://localhost:4001`.
3. **Check it:** `npm run check` (typecheck, unit tests, browser tests). They use their own throwaway database and a free port, so they can run while the shared copy is up.
4. **Commit**, then **release** to the shared copy:
   ```sh
   systemctl --user restart myest8     # a few seconds of downtime; same URL
   journalctl --user -u myest8 -n 20   # confirm it came up
   ```
   Don't restart in the middle of an edit: `Restart=on-failure` would also pick up a half-written tree after a crash.

If a change adds a migration (`supabase/migrations/`), the restart applies it to the `live` schema; the data is kept. A change the old data can't take (for example a new required seed field) needs a fresh schema: `psql` into the container and `DROP SCHEMA live CASCADE`, or run once with `DATABASE_SCHEMA=live2` in `deploy/serve.sh`. `npm run db:reset` empties the local database, including `live`.

## Setting up again

```sh
mkdir -p ~/.config/systemd/user
ln -sf "$PWD"/deploy/myest8.service "$PWD"/deploy/myest8-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now myest8-tunnel   # starts myest8 too
loginctl enable-linger "$USER"                # keeps both running when nobody is logged in
docker update --restart unless-stopped myest8-postgres
```

## A fixed address

Real Gmail and WhatsApp need an address that does not change ([channels-setup.md](channels-setup.md#0-a-stable-public-address-first)). With a hostname on a domain in your Cloudflare account:

```sh
cp deploy/live.env.example ~/.config/myest8/live.env && chmod 600 ~/.config/myest8/live.env   # then fill it in, PUBLIC_URL included
$EDITOR deploy/cloudflared.yml                         # your hostname
cloudflared tunnel route dns mytunnel <your hostname>
ln -sf "$PWD"/deploy/myest8-tunnel-named.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user disable --now myest8-tunnel           # the quick tunnel, if it was on
systemctl --user enable --now myest8-tunnel-named myest8
```

`PUBLIC_URL` in `live.env` wins over the quick tunnel's address, so `myest8` no longer waits for one. The existing `~/.cloudflared/config.yml` belongs to another site and is not used.
