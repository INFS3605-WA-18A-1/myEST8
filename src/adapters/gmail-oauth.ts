// Connecting an Agency's Gmail (docs/adr/0004): the Google sign-in URL, trading
// the code for tokens, and refreshing the access token. Plain fetch against
// Google's OAuth endpoints; no SDK.

import { createHash, randomBytes } from 'node:crypto';
import { isObject, malformed } from './json-api.ts';

const SERVICE = 'Google';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 15_000;
const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND = 'https://www.googleapis.com/auth/gmail.send';
/** Reading and sending only. Never gmail.modify, which could change or delete the Agency's mail. */
const SCOPES = ['openid', 'email', READ, SEND];

/** Google no longer accepts the stored connection (revoked, expired in Testing mode, password changed). The Agency has to connect again. */
export class GmailReconnectRequired extends Error {
  constructor() {
    super('Google no longer accepts this Gmail connection: the Agency needs to reconnect Gmail.');
    this.name = 'GmailReconnectRequired';
  }
}

/** A PKCE pair: send the challenge with the sign-in, keep the verifier for the code exchange. */
export function newPkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function gmailAuthorizationUrl(o: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: o.state,
    code_challenge: o.codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

interface ClientConfig {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  tokenUrl?: string;
}

/** Posts to the token endpoint. A failure never carries the request or the response body, which hold secrets. */
async function tokenRequest(config: ClientConfig, params: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await (config.fetch ?? fetch)(config.tokenUrl ?? TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const parsed: unknown = await response.json().catch(() => null);
  return { status: response.status, body: isObject(parsed) ? parsed : {} };
}

const failure = (status: number, body: Record<string, unknown>) =>
  new Error(`${SERVICE} token endpoint returned ${status}${typeof body.error === 'string' ? ` (${body.error})` : ''}`);

/**
 * Trades the sign-in code for tokens. Throws when Google gave no refresh token, when
 * the person unticked reading or sending mail, or when the address isn't verified.
 */
export async function exchangeGmailCode(
  config: ClientConfig & { redirectUri: string; code: string; codeVerifier: string },
): Promise<{ refreshToken: string; accessToken: string; expiresInSeconds: number; email: string }> {
  const { status, body } = await tokenRequest(config, {
    grant_type: 'authorization_code',
    code: config.code,
    code_verifier: config.codeVerifier,
    redirect_uri: config.redirectUri,
  });
  if (status !== 200) throw failure(status, body);
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, scope, id_token: idToken } = body;
  if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') return malformed(SERVICE, 'no access token', Object.keys(body));
  if (typeof refreshToken !== 'string') throw new Error('Google did not return a refresh token: connect again and allow access when asked.');
  const granted = typeof scope === 'string' ? scope.split(' ') : [];
  const missing = [READ, SEND].filter((s) => !granted.includes(s)).map((s) => s.split('/').pop());
  if (missing.length) throw new Error(`Google did not grant ${missing.join(' and ')}: tick every box when connecting Gmail.`);
  // The id token came straight from Google over TLS in this exchange, so its claims are read, not re-verified.
  const claims: unknown = typeof idToken === 'string' ? JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) : null;
  if (!isObject(claims) || typeof claims.email !== 'string' || claims.email_verified !== true) throw new Error('Google did not return a verified email address for this account.');
  return { refreshToken, accessToken, expiresInSeconds: expiresIn, email: claims.email.toLowerCase() };
}

/** A fresh access token. Throws GmailReconnectRequired when the refresh token is no longer valid. */
export async function refreshGmailAccessToken(config: ClientConfig & { refreshToken: string }): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const { status, body } = await tokenRequest(config, { grant_type: 'refresh_token', refresh_token: config.refreshToken });
  if (status === 400 && body.error === 'invalid_grant') throw new GmailReconnectRequired();
  if (status !== 200) throw failure(status, body);
  if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') return malformed(SERVICE, 'no access token', Object.keys(body));
  return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
}
