// Sign-up at /signup: a Property Manager creates their Agency's account, is
// signed in straight away, and goes on to the onboarding wizard at /welcome.
// Only Property Managers have accounts (ADR-0002).

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { MIN_PASSWORD_LENGTH } from '../../profiles.ts';
import { ActionError } from '../../shared.ts';
import { SIGNED_OUT_FOOTER, sameOrigin, signedInId, startSession, type Sessions } from '../auth.ts';
import { text, type FormValues } from '../forms.ts';
import { button, field, publicPage, type Flash } from '../ui.ts';
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

  routes.get('/signup', (c) => {
    if (signedInId(app, sessions, c) !== null) return c.redirect('/', 303);
    return c.html(signUpPage({}));
  });

  routes.post('/signup', async (c) => {
    if (!sameOrigin(c)) return c.text('Cross-site request refused', 403);
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const values = valuesOf(form);
    const password = rawText(form, 'password');
    const refused = (errors: Errors) =>
      c.html(signUpPage({ values, errors, flash: { kind: 'error', message: 'Check the highlighted fields and try again.' } }), 400);

    const timeZone = text(form, 'timeZone');
    if (!TIME_ZONES.some((z) => z.value === timeZone)) return refused({ timeZone: 'Choose a time zone' });
    if (password && password !== rawText(form, 'confirmPassword')) {
      return refused({ confirmPassword: "The passwords don't match. Type the same password twice." });
    }

    let propertyManagerId: number;
    try {
      propertyManagerId = app.signUp({
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
    startSession(c, sessions, propertyManagerId);
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

function signUpPage(o: { values?: Values; errors?: Errors; flash?: Flash }) {
  const { values, errors = {} } = o;
  return publicPage({
    title: "Create your Agency's account",
    subtitle: 'You become its first Property Manager. A short guide then helps you set up the rest.',
    flash: o.flash ?? null,
    headerActions: html`<a class="link text-sm" href="/">Home</a>`,
    footer: SIGNED_OUT_FOOTER,
    body: html`<form method="post" action="/signup" class="space-y-2">
        <fieldset class="space-y-1">
          <legend class="text-base font-semibold">About you</legend>
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
        </fieldset>
        <fieldset class="mt-6 space-y-1">
          <legend class="text-base font-semibold">Your Agency</legend>
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
        </fieldset>
        <div class="pt-2">${button("Create your Agency's account", { block: true })}</div>
      </form>
      <p class="text-center text-sm">Already have an account? <a class="link" href="/login">Sign in</a></p>`,
  });
}
