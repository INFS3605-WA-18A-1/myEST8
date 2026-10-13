// The front door at / for anyone not signed in: what myEST8 does for a small
// Agency, the way in (create the Agency's account, or sign in), and one repair
// played through myEST8 from the Tenant's text to the finished Job. A signed-in
// Property Manager gets their dashboard at / instead.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { SIGNED_OUT_FOOTER, signedInId, type Sessions } from '../auth.ts';
import { icon } from '../icons.ts';
import { badge, chatBubble, docket, linkButton, publicPage, steps, urgencyBadge, type Html } from '../ui.ts';

/** The demo Agency's sign-ins, shown on the landing page when the app runs as the demo. */
export const DEMO_LOGINS = { emails: ['alice@harbour.example', 'bob@harbour.example'], password: 'demo1234' };

/**
 * GET / for a signed-out visitor. A signed-in Property Manager falls through to
 * the routes mounted after this one (the dashboard). `demo` adds the demo sign-ins.
 */
export function landingRoutes(app: App, sessions: Sessions, o: { demo: boolean }) {
  const routes = new Hono();
  routes.get('/', async (c, next) => {
    if ((await signedInId(app, sessions, c)) !== null) return next();
    return c.html(landingPage(o));
  });
  return routes;
}

const HEADLINE = 'From a Tenant’s first text to the finished repair.';

/** The landing page: the headline (publicPage's h1), one line under it, the two ways in, then the workflow. */
export function landingPage(o: { demo: boolean }): Html {
  return publicPage({
    title: HEADLINE,
    titleSize: 'hero',
    width: 'wide',
    footer: SIGNED_OUT_FOOTER,
    body: html`<div class="landing-intro">
        <p class="landing-lead">
          For Property Managers at small Agencies. Tenants text as they already do. myEST8 turns each message into a Maintenance Request for
          you to confirm, collects Quotes and books the Tradie.
        </p>
        <div class="landing-actions">
          ${linkButton('Create your Agency’s account', '/signup', { variant: 'primary', size: 'lg' })} ${linkButton('Sign in', '/login', { size: 'lg' })}
        </div>
      </div>
      ${workflow()} ${o.demo ? demoNote() : ''}`,
  });
}

/**
 * One repair through myEST8, as the stages it really goes through. Each stage
 * has a title and a small picture of what the Property Manager or Tenant sees
 * then. The pictures hold no links or buttons: they are illustrations.
 */
const STAGES: { title: string; picture: () => Html; decision?: boolean }[] = [
  {
    title: 'A Tenant texts the problem',
    picture: () =>
      chatBubble({
        side: 'end',
        header: html`<span class="font-semibold">Tenant</span>${badge('SMS')}`,
        text: 'The kitchen tap is dripping',
        footer: '7:42 am',
      }),
  },
  {
    title: 'It becomes a Maintenance Request',
    picture: () =>
      html`<div class="flow-card">
        <p class="font-semibold">12 King St, Newtown</p>
        <p>Kitchen tap dripping under the sink</p>
        <p class="flow-badges">${urgencyBadge('routine')}${badge('Plumbing')}</p>
      </div>`,
  },
  {
    title: 'The Property Manager confirms',
    decision: true,
    picture: () =>
      html`<div class="flow-card is-decision">
        <div class="min-w-0">
          <p class="flow-card-title">Kitchen tap dripping</p>
          <p class="text-muted">12 King St, Newtown</p>
          <p class="flow-badges">${urgencyBadge('routine')}${badge('Plumbing')}</p>
        </div>
        <span class="flow-confirm">Confirm</span>
      </div>`,
  },
  {
    title: 'It becomes a Ticket',
    picture: () =>
      docket({ number: 12, urgency: 'routine', address: '12 King St, Newtown', issue: 'Kitchen tap dripping', meta: [html`Plumbing`, html`Quoting`] }),
  },
  {
    title: 'Quote Requests go to Tradies',
    picture: () =>
      html`<div class="flow-card">
        <p class="font-semibold">Quote Requests sent to 3 Tradies</p>
        <ul class="flow-rows">
          ${['Flow Bros Plumbing', 'Drip Doctors', 'Inner West Plumbing'].map(
            (name) => html`<li>${icon('paper-plane-tilt', { size: 'size-4' })}<span>${name}</span></li>`,
          )}
        </ul>
      </div>`,
  },
  {
    title: 'A Quote comes back',
    picture: () =>
      html`<div class="flow-card">
        <p class="flow-quote"><span class="font-semibold">Drip Doctors</span><span class="num flow-amount">$180</span></p>
        <p class="text-muted">New washer and cartridge. Tue 14 Oct, 9:00 am</p>
      </div>`,
  },
  {
    title: 'The Work Order goes out',
    picture: () =>
      html`<div class="flow-card">
        <p class="flow-sent">${icon('check-circle', { weight: 'fill', size: 'size-5' })}<span class="font-semibold">Work Order sent</span></p>
        <p class="text-muted">Drip Doctors, Tue 14 Oct, 9:00 am</p>
      </div>`,
  },
  {
    title: 'The Job is done, and the Tenant sees it',
    picture: () =>
      html`<div class="flow-card">
        <p class="font-semibold">Now: Done</p>
        ${steps(
          ['Reported', 'Confirmed', 'Booked', 'Done'].map((label) => ({ label, done: true })),
          { horizontal: true },
        )}
      </div>`,
  },
];

/**
 * The workflow: an ordered list, so it reads in order without CSS or animation and
 * to screen readers. app.css plays it one stage at a time (the titles down the
 * left, the stage's picture beside them) and shows every stage at once under
 * prefers-reduced-motion. The pause button only appears with JavaScript (app.js).
 */
function workflow(): Html {
  return html`<section class="flow" aria-labelledby="workflow" data-flow>
    <div class="flow-head">
      <h2 id="workflow" class="flow-heading">One repair, start to finish</h2>
      <button type="button" class="btn btn-ghost btn-sm flow-pause" data-flow-pause hidden>
        <span class="flow-pause-icon">${icon('pause', { size: 'size-4' })}</span><span class="flow-play-icon">${icon('play', { size: 'size-4' })}</span>
        <span data-flow-pause-label>Pause</span><span class="sr-only"> the animation</span>
      </button>
    </div>
    <ol class="flow-stages" aria-labelledby="workflow">
      ${STAGES.map(
        (stage, i) => html`<li class="flow-stage${stage.decision ? ' is-decision' : ''}" style="--i: ${i}">
          <span class="flow-num num" aria-hidden="true">${i + 1}</span>
          <span class="flow-title">${stage.title}</span>
          <div class="flow-picture">${stage.picture()}</div>
        </li>`,
      )}
    </ol>
  </section>`;
}

/** The demo sign-ins, as quiet text under a hairline. */
function demoNote(): Html {
  return html`<aside aria-labelledby="demo" class="landing-demo">
    <h2 id="demo" class="flow-heading">Try the demo Agency</h2>
    <p>
      Sign in as <strong>${DEMO_LOGINS.emails[0]}</strong> or <strong>${DEMO_LOGINS.emails[1]}</strong> with the password
      <strong>${DEMO_LOGINS.password}</strong> to look around Harbour Realty. The phone simulator lets you message in as a Tenant, Tradie or
      Property Owner.
    </p>
  </aside>`;
}
