# QA: the home-server environment and its email test

A second copy of the app runs on the home server (port 4100, Postgres schema `qa`, its own secrets) and a workflow sends it a real email every night. The reasons and limits are in [ADR 0011](adr/0011-qa-environment-and-live-email-test.md). This page is the one-time setup, then how to use it.

Replace `example.com` with your domain on Cloudflare. In the examples QA is at `qa-myest8.example.com` (one label, starting `qa-`: Cloudflare's free certificate doesn't cover `qa.myest8.example.com`, and the test refuses any other shape of address) and mail comes in at `qa-mail.example.com`.

Nothing here can be done for you: each step needs one of your accounts.

## 1. The test Gmail account

Create a new Gmail account used for nothing else (`myest8.qa.test@gmail.com`, say). It plays the Tenant. Don't use your own: the journey sends from it and moves its mail to the trash.

## 2. Gmail access for the journey

Signed in as the **test account**, at [console.cloud.google.com](https://console.cloud.google.com). Google renames these screens now and then; the words in bold are what to look for.

1. Project picker, **New project**, name it `myEST8 QA`, **Create**.
2. **APIs & Services**, **Library**, search **Gmail API**, **Enable**.
3. **Google Auth Platform** (or **APIs & Services, OAuth consent screen**): **Get started**. App name `myEST8 QA`, user support email and contact email the test account. **Audience: External**. Accept the policy, **Create**.
4. **Audience**, then **Publish app** and confirm, so the status reads **In production**. Do this *before* getting the token: while the status is *Testing*, Google expires the token after 7 days, and one issued then keeps expiring. (The app stays "unverified", which is fine for one account you own.)
5. **Clients**, **Create client**, type **Desktop app**, name `qa`, **Create**. Copy the **Client ID** and **Client secret**.
6. On your own computer, in this repository (`npm ci` once), run the one command below with those two values and the test account's address. It prints a link: open it in a browser on that computer, sign in as the test account, click **Advanced**, **Go to myEST8 QA (unsafe)**, tick every box, **Continue**. The terminal then prints `QA_GMAIL_REFRESH_TOKEN=...`.

   ```sh
   QA_GMAIL_CLIENT_ID=... QA_GMAIL_CLIENT_SECRET=... QA_GMAIL_ADDRESS=myest8.qa.test@gmail.com npx tsx scripts/qa-gmail-token.ts
   ```

   It refuses to print the token if you signed in as any other account. The token goes nowhere but the terminal: copy it into `qa.env` (step 5), not into a chat or a file in the repository.

The token stops working if you change the test account's password or revoke the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), or after six months unused. A run then fails saying so; repeat step 6.

## 3. Resend, on a second free account

QA can't share production's Resend team: the free plan has one webhook endpoint per team, and sent and received mail both count against 100 a day (checked 2026-10-21, see the ADR). Sign up at [resend.com](https://resend.com) with the **test Gmail address** (a second team in your account would need a paid plan). Then:

1. **Domains**, **Add domain**: `qa-mail.example.com`. Add the records Resend shows to the domain's DNS in Cloudflare, with the proxy off (grey cloud), and wait until sending **and receiving** are verified. The MX for receiving must have the lowest priority number on that subdomain. [channels-setup.md](channels-setup.md#1-resend-email) has the detail; the records are the ones Resend shows, not copies of production's.
2. **API Keys**, **Create API key**, permission **Full access** (reading a received email needs it). Copy it for `RESEND_API_KEY`.
3. **Webhooks**, **Add webhook**: endpoint `https://qa-myest8.example.com/webhooks/resend`, event **`email.received`**. Copy the signing secret (`whsec_...`) for `RESEND_WEBHOOK_SECRET`.

## 4. The tunnel hostname

On the home server, from the repository checkout:

```sh
cloudflared tunnel route dns mytunnel qa-myest8.example.com
$EDITOR deploy/cloudflared.yml                     # the qa- hostname in the second ingress rule
systemctl --user restart myest8-tunnel-named
```

`deploy/cloudflared.yml` sends it to port 4100, and the live hostname to 4000. Nothing answers at the QA address until step 7 has run once.

## 5. `qa.env`

```sh
mkdir -p ~/.config/myest8
cp deploy/qa.env.example ~/.config/myest8/qa.env && chmod 600 ~/.config/myest8/qa.env
$EDITOR ~/.config/myest8/qa.env
```

Fill in every line, using the comments in the file. Where the values come from:

| Variable | From |
| --- | --- |
| `PUBLIC_URL` | `https://qa-myest8.example.com` |
| `DEMO_SEND_TO`, `QA_GMAIL_ADDRESS` | the test Gmail address (both the same) |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | step 3 |
| `RESEND_INBOUND_DOMAIN` | `qa-mail.example.com` |
| `QA_INBOUND_ADDRESS` | any name on that domain: `qa@qa-mail.example.com` |
| `QA_PM_EMAIL`, `QA_PM_PASSWORD` | make them up (`openssl rand -hex 16` for the password); they only open the QA app |
| `QA_GMAIL_CLIENT_ID`, `QA_GMAIL_CLIENT_SECRET`, `QA_GMAIL_REFRESH_TOKEN` | step 2 |
| `ANTHROPIC_API_KEY` | optional: set it to also test Claude's reading of the email (a few cents a night); empty uses the free classifier |

Don't copy anything from `live.env`, and don't set `SUPABASE_*`: QA has its own Resend account and keeps its data in the local Postgres.

## 6. The runner

On the home server. The runner is what lets GitHub's workflow reach the QA files and secrets, so it runs only this repository's QA workflow.

1. On GitHub: repository **Settings**, **Actions**, **Runners**, **New self-hosted runner**, **Linux**. Follow its download and extract commands in `~/actions-runner`.
2. Register it with the label (use the token that page shows, which expires in an hour):

   ```sh
   cd ~/actions-runner
   ./config.sh --url <the repository URL that page shows> --token <token> --labels home-qa --name home-qa --unattended
   ```

3. Run it as a user service, so it survives logouts and reboots and can restart the QA app (`node` 22.13 or newer and `docker` must work for your user):

   ```sh
   ln -sf "$PWD"/deploy/actions-runner-qa.service "$PWD"/deploy/myest8-qa.service ~/.config/systemd/user/   # from the repo checkout
   systemctl --user daemon-reload
   systemctl --user enable --now actions-runner-qa
   systemctl --user enable myest8-qa                # the workflow starts it; this brings it back after a reboot
   loginctl enable-linger "$USER"
   ```

   The runner shows as **Idle** under Settings, Actions, Runners. If a job can't find `node`, add the directory that holds it to `PATH` in `~/actions-runner/.path` and restart the service. `myest8-qa.service` expects the runner in `~/actions-runner` and the repository named `myEST8`: edit its two paths if yours differ.
4. Keep forks off the server: **Settings**, **Actions**, **General**, **Fork pull request workflows from outside collaborators**, choose **Require approval for all outside collaborators**. Before approving a pull request from outside, read any change to `.github/workflows/`: a workflow that names the `home-qa` label would run on this machine.

## 7. The `qa` branch, and the first run

```sh
git push origin dev:qa
```

Do this once the QA pieces have been merged into `dev`: the workflow file has to be on the branch you push. The push starts the **QA** workflow: **Actions**, **QA**. It stops the QA app, checks the commit out in the runner's folder, installs, migrates the `qa` schema, restarts the app, waits for it at `localhost:4100` and at its public address, seeds the QA Agency, and runs the journey. The first run takes a few minutes; later ones are faster. The nightly run (`0 16 * * *` UTC, 03:00 in Sydney in summer and 02:00 in winter) tests whatever `qa` holds, but GitHub only starts scheduled workflows from the default branch, so it begins once `qa.yml` has reached `master` in a release.

## Using it for a release

1. Push `dev` to `qa`: `git push origin dev:qa` (a plain fast-forward; it fails if someone pushed to `qa` something `dev` lacks, in which case ask why).
2. Wait for the **QA** run on that push to go green (**Actions**, **QA**). A red run has the journey's log attached (**qa-journey-logs**); the app's own log is on the server: `journalctl --user -u myest8-qa -n 200`.
3. Open the release PR from `dev` to `master` ([AGENTS.md](../AGENTS.md#releasing-dev-to-master)).

A run by hand: **Actions**, **QA**, **Run workflow**, or on the server `deploy/qa-exec.sh npx tsx scripts/qa-email-journey.ts` (it prints what each step saw and how long it took; exit 0 passed, 1 failed, 2 refused to start). `deploy/qa-exec.sh` loads `qa.env` and sets the schema, so every QA command goes through it.

## When it fails

| The run says | Usually |
| --- | --- |
| `Refusing to run: set ...` | a variable is missing or empty in `qa.env` |
| `Google refused the test account's refresh token` | the token lapsed or was revoked: step 2, part 6 |
| `Timed out ... waiting for the acknowledgement email` | the log then says where the email went. "never arrived": the Resend webhook or the tunnel (Resend's **Webhooks** page shows each delivery and its status). "in the dashboard Inbox": the classifier didn't take it for a new report |
| `... landed in the Spam folder` | Resend's DNS records for `qa-mail` (SPF, DKIM, DMARC) |
| `... the QA tunnel` timeout | the tunnel isn't routing the `qa-` hostname to port 4100 (step 4) |
| `refused the Property Manager sign-in` | `QA_PM_PASSWORD` changed after the seed: put the old one back, or start the QA data again |
| `... for an urgent repair` | the classifier judged a dripping tap urgent |

To start the QA data again (and only that): `deploy/qa-reset.sh`. Don't use `npm run db:reset` for it: with the default database that drops `live` too.

## Without any account

`npm run qa:dry-run` starts the app on mocks in a throwaway database and runs the seed and the journey twice, with the app's phone simulator playing the Tenant instead of Gmail. It needs no secrets and checks the script and the app's side of the journey, not Gmail, Resend, Claude or the tunnel.
