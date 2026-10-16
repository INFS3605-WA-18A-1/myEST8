// Sign-up at /signup: a Property Manager creates their Agency's account, is
// signed in straight away, and goes on to the onboarding wizard at /welcome.
// Only Property Managers have accounts (ADR-0002).

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { MIN_PASSWORD_LENGTH } from '../../profiles.ts';
import { ActionError } from '../../shared.ts';
import { authPage, otherWay } from '../auth-card.ts';
import { SIGNED_OUT_FOOTER, sameOrigin, signedInId, startSession, type Sessions } from '../auth.ts';
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

/** GET/POST /signup. */
export function signupRoutes(app: App, sessions: Sessions) {
  const routes = new Hono();

  routes.get('/signup', async (c) => {
    if ((await signedInId(app, sessions, c)) !== null) return c.redirect('/', 303);
    return c.html(signUpPage({ shareLink: shareUrl(c, '/signup') }));
  });

  routes.post('/signup', async (c) => {
    if (!sameOrigin(c)) return c.text('Cross-site request refused', 403);
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const values = valuesOf(form);
    const password = rawText(form, 'password');
    const refused = (errors: Errors) =>
      c.html(
        signUpPage({ values, errors, flash: { kind: 'error', message: 'Check the highlighted fields and try again.' }, shareLink: shareUrl(c, '/signup') }),
        400,
      );

    const timeZone = text(form, 'timeZone');
    if (!TIME_ZONES.some((z) => z.value === timeZone)) return refused({ timeZone: 'Choose a time zone' });
    if (password && password !== rawText(form, 'confirmPassword')) {
      return refused({ confirmPassword: "The passwords don't match. Type the same password twice." });
    }

    let propertyManagerId: number;
    try {
      propertyManagerId = await app.signUp({
        agencyName: text(form, 'agencyName'),
        timeZone,
        name: text(form, 'name'),
        email: text(form, 'email'),
        password,
      });
    } catch (error) {
      if (error instanceof ActionError) return refused(Object.keys(error.fields).length ? { ...error.fields } : { email: error.message });
      throw error;
    }
    await startSession(c, sessions, propertyManagerId);
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

function signUpPage(o: { values?: Values; errors?: Errors; flash?: Flash; shareLink: string }) {
  const { values, errors = {} } = o;
  return authPage({
    title: 'Create your Agency’s account',
    subtitle: 'You become its first Property Manager. A short guide then helps you set up the rest.',
    flash: o.flash ?? null,
    size: 'signup',
    footer: SIGNED_OUT_FOOTER,
    form: html`<form method="post" action="/signup" class="au-form">
        <fieldset class="au-fieldset">
          <legend class="au-legend">About you</legend>
          <div class="au-pair">
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
          <div class="au-pair">
            ${field({
              label: 'Password',
              name: 'password',
              type: 'password',
              required: true,
              autocomplete: 'new-password',
              hint: `At least ${MIN_PASSWORD_LENGTH} characters.`,
              error: errors.password,
            })}
            ${field({ label: 'Confirm password', name: 'confirmPassword', type: 'password', required: true, autocomplete: 'new-password', error: errors.confirmPassword })}
          </div>
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
        ${button('Create account', { size: 'lg', block: true })}
      </form>
      ${otherWay({ text: 'Already have an account?', button: linkButton('Sign in', '/login', { variant: 'secondary', block: true }) })}
      <aside class="au-share" aria-label="Someone else setting up the Agency">
        <p class="au-other-text">One Property Manager creates the account, then adds the rest of the Agency from the setup guide. Is someone else doing that?</p>
        ${shareButton({
          title: 'Set up myEST8 for our Agency',
          text: 'Here’s the sign-up page for myEST8. One of us creates the Agency’s account, then adds the rest of us as Property Managers.',
          url: o.shareLink,
          label: 'Send this page to them',
          align: 'start',
        })}
      </aside>`,
    steps: [
      { text: 'Your account and your Agency are created, and you are signed in.' },
      { text: 'The setup guide adds your team, connects SMS, WhatsApp and email, then adds your Tradies and your first Property.' },
      { text: 'Tenants can then text in a repair, and it reaches you as a Maintenance Request to confirm.', request: true },
    ],
  });
}
