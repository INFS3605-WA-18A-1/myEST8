// The front door at / for anyone not signed in: what myEST8 does for a Property
// Manager, how it works, and the way in (sign in, or create the Agency's
// account). A signed-in Property Manager gets their dashboard at / instead.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { SIGNED_OUT_FOOTER, signedInId, type Sessions } from '../auth.ts';
import { alert, card, linkButton, publicPage, type Html } from '../ui.ts';

/** The demo Agency's sign-ins, shown on the landing page when the app runs as the demo. */
export const DEMO_LOGINS = { emails: ['alice@harbour.example', 'bob@harbour.example'], password: 'demo1234' };

const VALUE: { title: string; text: string }[] = [
  {
    title: 'Tenants report the way they already do',
    text: 'By SMS, WhatsApp or email. No app to download and no account to create, for Tenants, Tradies or Property Owners.',
  },
  {
    title: 'An intake agent does the first pass',
    text: 'It works out who wrote and which Property it is about, asks a few short questions, collects and checks photos, ranks the Urgency, and hands you a Maintenance Request to confirm.',
  },
  {
    title: 'Quotes, approval and bookings in one place',
    text: "Quote Requests go to your Tradies, the Property Owner approves by replying YES when a Repair Cost would go over the Max Repair Cost, and a shared calendar stops two Property Managers booking the same Tradie.",
  },
];

const HOW_IT_WORKS: { title: string; text: string }[] = [
  { title: "Create your Agency's account", text: 'Then connect your SMS number, WhatsApp and email inbox, with a test message for each.' },
  { title: 'Add your Properties and people', text: 'Each Property with its Property Owner, Tenants and Max Repair Cost, and the Tradies you already use.' },
  { title: 'Confirm what comes in', text: 'Tenants message as usual. You confirm each Maintenance Request and it becomes a Ticket.' },
  { title: 'Let the follow-up run itself', text: 'myEST8 gathers Quotes, asks the Property Owner when it must, books the Tradie and keeps everyone updated on their own channel.' },
];

/**
 * GET / for a signed-out visitor. A signed-in Property Manager falls through to
 * the routes mounted after this one (the dashboard). `demo` adds the demo sign-ins.
 */
export function landingRoutes(app: App, sessions: Sessions, o: { demo: boolean }) {
  const routes = new Hono();
  routes.get('/', async (c, next) => {
    if (signedInId(app, sessions, c) !== null) return next();
    return c.html(landingPage(o));
  });
  return routes;
}

/** The landing page. */
export function landingPage(o: { demo: boolean }): Html {
  const ctas = html`<div class="flex flex-col gap-3 sm:flex-row">
    ${linkButton("Create your Agency's account", '/signup', { variant: 'primary' })} ${linkButton('Sign in', '/login')}
  </div>`;
  return publicPage({
    title: "From a Tenant's message to a finished Job, in one place",
    subtitle: 'myEST8 is the maintenance desk for Property Managers at small Agencies.',
    wide: true,
    headerActions: html`<a class="btn btn-ghost btn-sm" href="/login">Sign in</a>`,
    footer: SIGNED_OUT_FOOTER,
    body: html`
      <section aria-label="Get started" class="space-y-4">
        <p class="max-w-prose text-base">
          Tenants report issues on SMS, WhatsApp or email. An intake agent turns their messages into Maintenance Requests for you to confirm. Quotes,
          Property Owner approval and a shared calendar of Tradie bookings sit together, so nothing lives only in someone's inbox.
        </p>
        ${ctas}
      </section>
      ${o.demo ? demoHint() : ''}
      <section aria-labelledby="why" class="space-y-3">
        <h2 id="why" class="text-lg font-semibold tracking-tight">Why Property Managers use it</h2>
        <div class="grid gap-4 md:grid-cols-3">${VALUE.map((v) => card({ title: v.title, body: html`<p>${v.text}</p>` }))}</div>
      </section>
      <section aria-labelledby="how" class="space-y-3">
        <h2 id="how" class="text-lg font-semibold tracking-tight">How it works</h2>
        <ol class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          ${HOW_IT_WORKS.map(
            (step, i) => html`<li class="rounded-box border border-base-300 bg-base-100 p-4">
              <p class="text-sm font-semibold text-primary">Step ${i + 1}</p>
              <p class="font-semibold">${step.title}</p>
              <p class="text-sm text-base-content/80">${step.text}</p>
            </li>`,
          )}
        </ol>
      </section>
      <section aria-label="Start now" class="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 sm:p-6">
        <p class="font-semibold">Setting up takes about 5 minutes, and a guide walks you through it.</p>
        ${ctas}
      </section>
    `,
  });
}

function demoHint(): Html {
  return alert(
    html`<p>
        Sign in as <strong>${DEMO_LOGINS.emails[0]}</strong> or <strong>${DEMO_LOGINS.emails[1]}</strong> with the password
        <strong>${DEMO_LOGINS.password}</strong> to look around Harbour Realty, or create your own Agency.
      </p>
      <p>The phone simulator lets you message in as a Tenant, Tradie or Property Owner.</p>`,
    'info',
    { title: 'Try the demo Agency' },
  );
}
