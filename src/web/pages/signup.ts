// Sign-up at /signup: a Property Manager creates their Agency's account, is
// signed in straight away, and goes on to the onboarding wizard at /welcome.
// Only Property Managers have accounts (ADR-0002). With WorkOS AuthKit (ADR 0020)
// the account itself is made on AuthKit's hosted page, so /signup only asks for
// the Agency, and without a pending AuthKit sign-up it goes to that page.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { MIN_PASSWORD_LENGTH } from '../../profiles.ts';
import { ActionError } from '../../shared.ts';
import { authPage, otherWay } from '../auth-card.ts';
import type { AuthKit } from '../../adapters/workos.ts';
import { SIGNED_OUT_FOOTER, sameOrigin, signedInId, startSession, type Sessions } from '../auth.ts';
import { pendingSignUp, startAuthKitSession, type PendingSignUp } from '../workos.ts';
import { text, type FormValues } from '../forms.ts';
import { shareButton, shareUrl } from '../share.ts';
import { button, field, linkButton, type Flash } from '../ui.ts';
import { valueOf, valuesOf, type Errors, type Values } from './onboarding-forms.ts';

/** The time zones an Australian Agency can choose, by IANA name. */
export const TIME_ZONES: { value: string; label: string }[] = [
  { value: 'Australia/Sydney', label: 'Sydney and Canberra (NSW, ACT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (VIC)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (QLD)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (SA)' },
  { value: 'Australia/Perth', label: 'Perth (WA)' },
  { value: 'Australia/Hobart', label: 'Hobart (TAS)' },
  { value: 'Australia/Darwin', label: 'Darwin (NT)' },
];

const DEFAULT_TIME_ZONE = 'Australia/Sydney';

/** Where AuthKit's hosted page opens on creating an account. */
const AUTHKIT_SIGN_UP = '/login?screen=sign-up';

/** GET/POST /signup. With `authKit`, only for someone AuthKit has just signed in who has no Property Manager yet. */
export function signupRoutes(app: App, sessions: Sessions, authKit: AuthKit | null = null) {
  const routes = new Hono();

  routes.get('/signup', async (c) => {
    if ((await signedInId(app, sessions, c)) !== null) return c.redirect('/', 303);
    const pending = authKit ? pendingSignUp(c, authKit) : null;
    if (authKit && !pending) return c.redirect(AUTHKIT_SIGN_UP, 303);
    return c.html(signUpPage({ pending, values: pending ? { name: pending.name } : undefined, shareLink: shareUrl(c, '/signup') }));
  });

  routes.post('/signup', async (c) => {
    if (!sameOrigin(c)) return c.text('Cross-site request refused', 403);
    const pending = authKit ? pendingSignUp(c, authKit) : null;
    if (authKit && !pending) return c.redirect(AUTHKIT_SIGN_UP, 303);
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const values = valuesOf(form);
    // AuthKit has the password; a password sign-up must choose one.
    const password = pending ? null : rawText(form, 'password');
    const refused = (errors: Errors) =>
      c.html(
        signUpPage({
          pending,
          values,
          errors,
          flash: { kind: 'error', message: 'Some details need fixing. Each one is explained beside its field.' },
          shareLink: shareUrl(c, '/signup'),
        }),
        400,
      );

    const timeZone = text(form, 'timeZone');
    if (!TIME_ZONES.some((z) => z.value === timeZone)) return refused({ timeZone: 'Choose a time zone' });

    let propertyManagerId: number;
    try {
      propertyManagerId = await app.signUp({
        agencyName: text(form, 'agencyName'),
        timeZone,
        name: text(form, 'name'),
        email: pending?.email ?? text(form, 'email'),
        password,
      });
    } catch (error) {
      if (error instanceof ActionError) return refused(Object.keys(error.fields).length ? { ...error.fields } : { email: error.message });
      throw error;
    }
    if (pending) await startAuthKitSession(c, sessions, propertyManagerId, pending.sessionId);
    else await startSession(c, sessions, propertyManagerId);
    return c.redirect('/welcome', 303);
  });

  return routes;
}

/** A posted field exactly as typed: passwords keep their spaces. */
function rawText(form: FormValues, name: string) {
  const value = form[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : '';
}

/** The sign-up form. With `pending`, AuthKit has made the account: the form asks only for a name and the Agency. */
function signUpPage(o: { pending?: PendingSignUp | null; values?: Values; errors?: Errors; flash?: Flash; shareLink: string }) {
  const { values, errors = {}, pending } = o;
  return authPage({
    title: pending ? 'Set up your Agency' : 'Create your Agency’s account',
    subtitle: pending
      ? `You’re signed in as ${pending.email}. Name your Agency and you become its first Property Manager. A short guide then helps you set up the rest.`
      : 'You become its first Property Manager. A short guide then helps you set up the rest.',
    flash: o.flash ?? null,
    size: 'signup',
    footer: SIGNED_OUT_FOOTER,
    form: html`<form method="post" action="/signup" class="au-form">
        <fieldset class="au-fieldset">
          <legend class="au-legend">About you</legend>
          ${pending
            ? html`<div class="au-pair is-single">
                ${field({ label: 'Your name', name: 'name', required: true, autocomplete: 'name', value: valueOf(values, 'name'), error: errors.name })}
              </div>`
            : html`<div class="au-pair">
            ${field({ label: 'Your name', name: 'name', required: true, autocomplete: 'name', value: valueOf(values, 'name'), error: errors.name })}
            ${field({
              label: 'Work email',
              name: 'email',
              type: 'email',
              required: true,
              autocomplete: 'email',
              value: valueOf(values, 'email'),
              hint: 'You sign in with this.',
              error: errors.email,
            })}
          </div>
          <div class="au-pair is-single">
            ${field({
              label: 'Password',
              name: 'password',
              type: 'password',
              required: true,
              autocomplete: 'new-password',
              hint: `At least ${MIN_PASSWORD_LENGTH} characters.`,
              error: errors.password,
              suffix: html`<button type="button" class="password-toggle" data-reveal="field-password" aria-label="Show password">Show</button>`,
            })}
          </div>`}
        </fieldset>
        <fieldset class="au-fieldset">
          <legend class="au-legend">Your Agency</legend>
          <div class="au-pair">
            ${field({
              label: 'Agency name',
              name: 'agencyName',
              required: true,
              autocomplete: 'organization',
              value: valueOf(values, 'agencyName'),
              error: errors.agencyName,
            })}
            ${field({
              label: 'Time zone',
              name: 'timeZone',
              type: 'select',
              required: true,
              value: valueOf(values, 'timeZone') || DEFAULT_TIME_ZONE,
              options: TIME_ZONES,
              hint: 'Bookings, reminders and the calendar use this time.',
              error: errors.timeZone,
            })}
          </div>
        </fieldset>
        <div class="au-submit">
          ${button('Create account', { size: 'lg', block: true })}
          <p class="au-consent">By creating an account you agree to the Terms of use and Privacy Policy.</p>
          <div class="au-consent-links">
            ${linkButton('Terms of use', '/terms', { variant: 'ghost', size: 'sm' })}
            ${linkButton('Privacy Policy', '/privacy', { variant: 'ghost', size: 'sm' })}
          </div>
        </div>
      </form>
      ${pending ? '' : otherWay({ text: 'Already have an account?', button: linkButton('Sign in', '/login', { variant: 'secondary', size: 'sm' }) })}
      <aside class="au-share" aria-label="Someone else setting up the Agency">
        <p class="au-other-text">One Property Manager creates the account, then adds the rest of the Agency from the setup guide. Is someone else doing that?</p>
        <p class="au-other-text">Send them the sign-up link: the button opens a panel to copy it, or send it by email or text.</p>
        ${shareButton({
          title: 'Set up myEST8 for our Agency',
          text: 'Here’s the sign-up page for myEST8. One of us creates the Agency’s account, then adds the rest of us as Property Managers.',
          url: o.shareLink,
          label: 'Send them the sign-up link',
          align: 'start',
        })}
      </aside>`,
    steps: [
      { text: 'Create your account and your Agency. myEST8 signs you in.' },
      { text: 'Connect the Agency’s email (required, about 2 minutes) so myEST8 can read what Tenants send.' },
      { text: 'Add your team, your Tradies and your first Property.' },
      { text: 'The first Tenant text arrives as a Maintenance Request to confirm.', request: true },
    ],
    stepsNote: 'The whole setup guide takes about 10 minutes.',
  });
}
