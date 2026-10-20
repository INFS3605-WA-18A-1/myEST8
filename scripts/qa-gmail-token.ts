// Gets the refresh token the QA email journey signs in to the test Gmail account with
// (QA_GMAIL_REFRESH_TOKEN). Run it once on your own computer, in this repository, with the
// OAuth client's id and secret from docs/qa.md step 2:
//
//   QA_GMAIL_CLIENT_ID=... QA_GMAIL_CLIENT_SECRET=... QA_GMAIL_ADDRESS=... npx tsx scripts/qa-gmail-token.ts
//
// It starts a one-shot web server on 127.0.0.1 (a "loopback" redirect, which Google allows
// for Desktop app clients), prints a Google sign-in link, and when you have allowed access
// in the browser it prints the token. The token goes to your terminal and nowhere else:
// not a file, not a log. Paste it into qa.env on the home server.
//
// The scope is gmail.modify: it reads and sends mail and moves it to the trash, which is
// all the journey does (it can't delete mail for good or change settings). That is a
// restricted scope, so Google marks the app unverified: that is fine for one account you
// own, and docs/qa.md says how to keep the token from lapsing after seven days.

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createGmailClient } from '../src/adapters/gmail.ts';

const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WAIT_MS = 5 * 60_000;

function fail(problem: string): never {
  console.error(`\n${problem}`);
  process.exit(1);
}

const env = (name: string) => process.env[name]?.trim() || undefined;
const clientId = env('QA_GMAIL_CLIENT_ID') ?? fail('Set QA_GMAIL_CLIENT_ID and QA_GMAIL_CLIENT_SECRET (docs/qa.md, step 2).');
const clientSecret = env('QA_GMAIL_CLIENT_SECRET') ?? fail('Set QA_GMAIL_CLIENT_SECRET (docs/qa.md, step 2).');
const expected = env('QA_GMAIL_ADDRESS')?.toLowerCase();
if (!expected) console.warn('QA_GMAIL_ADDRESS is not set, so nothing will check that you sign in to the test account and not your own. Set it.');

const state = randomBytes(16).toString('hex');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

/** Waits for Google to send the browser back to the loopback address with `?code=...`. */
function waitForCode(): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/') return void response.writeHead(404).end();
      const reply = (status: number, text: string) => response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(text);
      if (url.searchParams.get('state') !== state) return reply(400, 'Wrong state: this is not the sign-in the script started. Close this tab and run it again.');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      reply(code ? 200 : 400, code ? 'Done. You can close this tab and go back to the terminal.' : `Google said: ${error ?? 'no code'}. Go back to the terminal.`);
      clearTimeout(timer);
      server.close();
      if (code) resolve({ code, redirectUri });
      else reject(new Error(`Google refused: ${error ?? 'no code came back'}`));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Nobody signed in within five minutes.'));
    }, WAIT_MS);
    let redirectUri = '';
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      redirectUri = `http://127.0.0.1:${port}`;
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        // offline + consent: without both, Google can answer with an access token and no refresh token.
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...(expected ? { login_hint: expected } : {}),
      }).toString();
      console.log(`Open this link in a browser on this computer, sign in as ${expected ?? 'the test account'}, and allow access:\n\n${url}\n\nWaiting for Google (five minutes)...`);
    });
    server.on('error', reject);
  });
}

try {
  const { code, redirectUri } = await waitForCode();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!response.ok || !body.access_token) fail(`Google's token request failed (${response.status}): ${body.error_description ?? body.error ?? 'no detail'}. A "client secret is missing" or "invalid_client" means the id or secret is wrong.`);
  if (!body.refresh_token) fail('Google returned no refresh token. Remove the app at https://myaccount.google.com/permissions (signed in as the test account) and run this again.');
  if (!body.scope?.includes('gmail.modify')) fail('Access was granted without the Gmail permission. Run it again and tick every box on the consent screen.');

  const { emailAddress } = await createGmailClient({ clientId, clientSecret, redirectUri }).profile(body.access_token);
  if (expected && emailAddress.toLowerCase() !== expected) {
    fail(`You signed in as ${emailAddress}, not ${expected}. Nothing was printed: the token would give QA access to the wrong mailbox. Run it again and choose the test account.`);
  }
  console.log(`\nSigned in as ${emailAddress}. Put these in ~/.config/myest8/qa.env on the home server (nowhere else):\n`);
  console.log(`QA_GMAIL_ADDRESS=${emailAddress}`);
  console.log(`QA_GMAIL_REFRESH_TOKEN=${body.refresh_token}`);
  console.log('\nThe token is as good as the account password for Gmail: don\'t paste it into a chat, an issue or a commit.');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
