// The front door at / for anyone not signed in: what myEST8 does for a Property
// Manager, how it works, and the way in (sign in, or create the Agency's
// account). A signed-in Property Manager gets their dashboard at / instead.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { SIGNED_OUT_FOOTER, signedInId, type Sessions } from '../auth.ts';
import { badge, chatBubble, docket, linkButton, publicPage, type Html } from '../ui.ts';

/** The demo Agency's sign-ins, shown on the landing page when the app runs as the demo. */
export const DEMO_LOGINS = { emails: ['alice@harbour.example', 'bob@harbour.example'], password: 'demo1234' };

/** The four steps from a Tenant's text to a booked Work Order, in order. */
const HOW_IT_WORKS: { title: string; text: string }[] = [
  { title: 'A Tenant texts the problem', text: 'By SMS, WhatsApp or email, as they already do. No app and no account for the Tenant.' },
  {
    title: 'The intake agent asks its questions',
    text: 'It asks a few short questions, checks the photos and ranks the Urgency, then sends you a Maintenance Request to confirm.',
  },
  {
    title: 'You confirm, and Tradies quote',
    text: 'Quote Requests go to your Tradies. The Property Owner approves any Repair Cost over the Max Repair Cost.',
  },
  {
    title: 'The Work Order is booked',
    text: 'The Tradie goes onto a shared calendar, so two Property Managers never book the same Tradie.',
  },
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
  return publicPage({
    title: 'Maintenance dispatch for Property Managers',
    wide: true,
    headerActions: html`<a class="btn btn-ghost btn-sm" href="/login">Sign in</a>`,
    footer: SIGNED_OUT_FOOTER,
    body: html`${hero()}
      ${howItWorks()}
      ${o.demo ? demoNote() : ''}`,
  });
}

/** The headline and lead on the left; the text message and the docket it becomes on the right. */
function hero(): Html {
  return html`<section aria-labelledby="hero" class="grid items-center gap-10 md:grid-cols-2">
    <div class="space-y-5">
      <h2 id="hero" class="text-[32px] leading-[1.15] font-semibold text-ink md:text-[40px]">Every repair request, from the first text to the finished job.</h2>
      <p class="max-w-[60ch] text-base">
        For Property Managers at small Agencies. Tenants' messages become Maintenance Requests for you to confirm, and Quotes, Property Owner
        approval and bookings run from there.
      </p>
      <div class="flex flex-col gap-3 sm:flex-row">
        <a href="/signup" class="btn btn-primary" style="color: var(--color-primary-content)">Create your Agency's account</a>
        ${linkButton('Sign in', '/login')}
      </div>
    </div>
    ${illustration()}
  </section>`;
}

/** A Tenant's text message beside the Ticket docket it becomes. Pure markup. */
function illustration(): Html {
  return html`<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
    <div class="w-full max-w-64 shrink-0 rounded-[24px] border border-line bg-surface p-4 sm:w-56" style="box-shadow: 0 8px 24px rgb(50 50 51 / 0.18)">
      ${chatBubble({
        side: 'start',
        header: html`<span class="font-semibold">Tenant</span>${badge('SMS')}`,
        text: 'The kitchen tap is dripping',
        footer: '7:42 am',
      })}
    </div>
    <div class="min-w-0 flex-1">
      ${docket({
        number: 12,
        href: '/signup',
        urgency: 'routine',
        address: '12 King St, Newtown',
        issue: 'Kitchen tap dripping',
        meta: [html`Plumbing`, html`3 Quotes`],
      })}
    </div>
  </div>`;
}

/** The four steps as a numbered sequence. */
function howItWorks(): Html {
  return html`<section aria-labelledby="how" class="space-y-3">
    <h2 id="how" class="text-base font-semibold text-ink">How it works</h2>
    <ol class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      ${HOW_IT_WORKS.map(
        (step, i) => html`<li class="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
          <span class="num flex size-6 items-center justify-center rounded-full bg-action text-[13px] font-semibold text-white"><span class="sr-only">Step </span>${i + 1}</span>
          <p class="font-semibold text-ink">${step.title}</p>
          <p class="text-muted">${step.text}</p>
        </li>`,
      )}
    </ol>
  </section>`;
}

/** The demo sign-ins, as a quiet bordered note rather than an alert. */
function demoNote(): Html {
  return html`<aside aria-labelledby="demo" class="space-y-2 rounded-lg border border-line bg-surface p-4 text-sm">
    <h2 id="demo" class="text-base font-semibold text-ink">Try the demo Agency</h2>
    <p>
      Sign in as <strong>${DEMO_LOGINS.emails[0]}</strong> or <strong>${DEMO_LOGINS.emails[1]}</strong> with the password
      <strong>${DEMO_LOGINS.password}</strong> to look around Harbour Realty, or create your own Agency.
    </p>
    <p>The phone simulator lets you message in as a Tenant, Tradie or Property Owner.</p>
  </aside>`;
}
