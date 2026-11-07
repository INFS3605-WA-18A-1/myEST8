// WorkOS AuthKit (ADR 0020): the one hosted page where Property Managers sign in
// and sign up, and the invitation email a colleague gets. AuthKit only says who
// someone is; myEST8 keeps its own sessions and its own Property Managers.

import { WorkOS } from '@workos-inc/node';

/** Someone AuthKit has just signed in. */
export type AuthKitUser = {
  email: string;
  emailVerified: boolean;
  /** Their name as AuthKit has it, or '' when it has none. */
  name: string;
  /** The AuthKit session, so signing out of myEST8 ends it too; null when the token carries none. */
  sessionId: string | null;
};

/** What myEST8 asks of AuthKit. `secret` signs the short-lived cookies of a sign-in in progress. */
export interface AuthKit {
  /** The hosted sign-in page. `screenHint: 'sign-up'` opens it on creating an account. */
  signInUrl(o: { state: string; redirectUri: string; screenHint?: 'sign-up'; loginHint?: string; invitationToken?: string }): string;
  /** Exchanges the callback's code for who signed in. Throws when AuthKit refuses it. */
  authenticate(code: string): Promise<AuthKitUser>;
  /** Where to send the browser to end an AuthKit session. It comes back to the Sign-out URI set in WorkOS. */
  signOutUrl(sessionId: string): string;
  /** Emails `email` an invitation to create their sign-in. */
  invite(email: string): Promise<void>;
  secret: string;
}

/**
 * AuthKit from WORKOS_API_KEY, WORKOS_CLIENT_ID and WORKOS_COOKIE_PASSWORD, or null
 * when none is set. A partial set, or a cookie password under 32 characters, refuses to start.
 */
export function authKitFromEnv(env: Record<string, string | undefined>): AuthKit | null {
  const names = ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'WORKOS_COOKIE_PASSWORD'] as const;
  const [apiKey, clientId, secret] = names.map((name) => env[name]?.trim() ?? '');
  const set = names.filter((_, i) => [apiKey, clientId, secret][i]);
  if (!set.length) return null;
  if (set.length < names.length) throw new Error(`WorkOS sign-in needs all of ${names.join(', ')}; missing ${names.filter((n) => !set.includes(n)).join(', ')}.`);
  if (secret!.length < 32) throw new Error('WORKOS_COOKIE_PASSWORD must be at least 32 characters (`openssl rand -base64 32`).');
  return createAuthKit(new WorkOS(apiKey!, { clientId: clientId! }), clientId!, secret!);
}

export function createAuthKit(workos: WorkOS, clientId: string, secret: string): AuthKit {
  const users = workos.userManagement;
  return {
    secret,
    signInUrl: (o) => users.getAuthorizationUrl({ provider: 'authkit', clientId, ...o }),
    async authenticate(code) {
      const { user, accessToken } = await users.authenticateWithCode({ clientId, code });
      const name = user.name?.trim() || [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
      return { email: user.email, emailVerified: user.emailVerified, name, sessionId: sessionIdOf(accessToken) };
    },
    signOutUrl: (sessionId) => users.getLogoutUrl({ sessionId }),
    async invite(email) {
      await users.sendInvitation({ email });
    },
  };
}

/** The `sid` claim of an access token straight from WorkOS. Read, not verified: it is only used to end that session. */
function sessionIdOf(accessToken: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof claims.sid === 'string' ? claims.sid : null;
  } catch {
    return null;
  }
}
