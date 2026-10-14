import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { exchangeGmailCode, GmailReconnectRequired, gmailAuthorizationUrl, newPkce, refreshGmailAccessToken } from '../../src/adapters/gmail-oauth.ts';
import { json, stubFetch } from './stub-fetch.ts';

const jwt = (claims: object) => ['{"alg":"RS256"}', JSON.stringify(claims), 'signature'].map((part) => Buffer.from(part).toString('base64url')).join('.');
const SCOPES = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const client = { clientId: 'client-id.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' };
const redirectUri = 'https://myest8.example/oauth/google/callback';

describe('Gmail authorization URL', () => {
  const url = new URL(gmailAuthorizationUrl({ clientId: client.clientId, redirectUri, state: 'state-123', codeChallenge: 'challenge-abc' }));

  test('goes to Google and asks for a refresh token with consent', () => {
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: redirectUri,
      scope: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
      access_type: 'offline',
      prompt: 'consent',
      state: 'state-123',
      code_challenge: 'challenge-abc',
      code_challenge_method: 'S256',
    });
  });

  test('never asks to modify or delete mail', () => {
    expect(url.searchParams.get('scope')).not.toMatch(/gmail\.modify|mail\.google\.com|gmail\.compose/);
  });
});

describe('PKCE', () => {
  test('the challenge is the SHA-256 of the verifier, and each pair is new', () => {
    const a = newPkce();
    expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'));
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(newPkce().verifier).not.toBe(a.verifier);
  });
});

describe('Gmail code exchange', () => {
  const tokens = (overrides: Record<string, unknown> = {}) => ({
    access_token: 'ya29.access',
    expires_in: 3599,
    refresh_token: '1//refresh',
    scope: SCOPES,
    token_type: 'Bearer',
    id_token: jwt({ email: 'Alice@Harbour.example', email_verified: true }),
    ...overrides,
  });
  const exchange = (body: Record<string, unknown>, status = 200) => {
    const stub = stubFetch(() => json(body, status));
    return { stub, result: exchangeGmailCode({ ...client, redirectUri, code: 'auth-code', codeVerifier: 'verifier-xyz', fetch: stub.fetch }) };
  };

  test('posts the code and verifier to Google and returns the tokens and the mailbox address', async () => {
    const { stub, result } = exchange(tokens());
    expect(await result).toEqual({ refreshToken: '1//refresh', accessToken: 'ya29.access', expiresInSeconds: 3599, email: 'alice@harbour.example' });
    const request = stub.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://oauth2.googleapis.com/token');
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      code_verifier: 'verifier-xyz',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
    });
  });

  test('refuses a response with no refresh token', async () => {
    const { refresh_token: _omitted, ...without } = tokens();
    await expect(exchange(without).result).rejects.toThrow(/refresh token/);
  });

  test('refuses when the person unticked reading or sending mail', async () => {
    const noSend = SCOPES.replace(' https://www.googleapis.com/auth/gmail.send', '');
    const noRead = SCOPES.replace(' https://www.googleapis.com/auth/gmail.readonly', '');
    await expect(exchange(tokens({ scope: noSend })).result).rejects.toThrow(/gmail\.send/);
    await expect(exchange(tokens({ scope: noRead })).result).rejects.toThrow(/gmail\.readonly/);
  });

  test('refuses an unverified email address', async () => {
    await expect(exchange(tokens({ id_token: jwt({ email: 'alice@harbour.example', email_verified: false }) })).result).rejects.toThrow(/verified/);
  });

  test('a failed exchange throws without the client secret or the code in the message', async () => {
    const error = await exchange({ error: 'invalid_grant', error_description: 'Bad Request' }, 400).result.catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(client.clientSecret);
    expect((error as Error).message).not.toContain('auth-code');
  });
});

describe('Gmail access token refresh', () => {
  const refresh = (response: Response) => {
    const stub = stubFetch(() => response);
    return { stub, result: refreshGmailAccessToken({ ...client, refreshToken: '1//refresh', fetch: stub.fetch }) };
  };

  test('trades the refresh token for a fresh access token', async () => {
    const { stub, result } = refresh(json({ access_token: 'ya29.fresh', expires_in: 3599, scope: SCOPES, token_type: 'Bearer' }));
    expect(await result).toEqual({ accessToken: 'ya29.fresh', expiresInSeconds: 3599 });
    expect(Object.fromEntries(new URLSearchParams(await stub.requests[0]!.text()))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: '1//refresh',
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
  });

  test('an expired or revoked token means the Agency has to reconnect', async () => {
    const { result } = refresh(json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400));
    await expect(result).rejects.toBeInstanceOf(GmailReconnectRequired);
  });

  test('an outage is an ordinary error that is retried, never a reconnect', async () => {
    const error = await refresh(new Response('unavailable', { status: 503 })).result.catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GmailReconnectRequired);
    expect((error as Error).message).not.toContain('1//refresh');
    expect((error as Error).message).not.toContain(client.clientSecret);
  });
});
