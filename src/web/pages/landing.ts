// The front door at / for anyone not signed in. It says who myEST8 is for and
// shows what it does with one repair: a Tenant's text and the Maintenance Request
// myEST8 makes of it (the hero), the repair played through to the finished Job
// (the workflow), and which calls stay with the Property Manager. The ways in are
// creating the Agency's account or signing in; the demo adds one-click sign-ins.
// A signed-in Property Manager gets their dashboard at / instead.
//
// The page builds its own document (head() and logo() from ui.ts) so its bands can
// run the full width. Its styles are in static/landing.css.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { SIGNED_OUT_FOOTER, signedInId, type Sessions } from '../auth.ts';
import { icon } from '../icons.ts';
import { badge, button, docket, head, linkButton, logo, steps, urgencyBadge, type Html } from '../ui.ts';

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

const SIGN_UP = 'Create your Agency’s account';

/** The landing page: the hero, the demo sign-ins (demo only), the workflow, who does what, and the way in again. */
export function landingPage(o: { demo: boolean }): Html {
  return html`<!doctype html>
    <html lang="en-AU" data-theme="myest8">
      <head>
        ${head('Maintenance for small Agencies', { css: ['landing.css'] })}
      </head>
      <body class="lp">
        <a href="#main" class="skip-link">Skip to content</a>
        <header class="lp-bar">
          <div class="lp-wrap lp-bar-inner">
            <span class="logotype">${logo()}</span>
            <nav class="lp-bar-actions" aria-label="Account">
              ${linkButton('Sign in', '/login', { variant: 'ghost', size: 'sm' })}
              <span class="lp-bar-signup">${linkButton(SIGN_UP, '/signup', { variant: 'primary', size: 'sm' })}</span>
            </nav>
          </div>
        </header>
        <main id="main">
          ${hero()} ${o.demo ? demoSignIns() : ''}
          <div class="lp-band is-paper">${workflow()}</div>
          ${whoDoesWhat()} ${closing()}
        </main>
        <footer class="lp-footer"><div class="lp-wrap">${SIGNED_OUT_FOOTER}</div></footer>
      </body>
    </html>`;
}

/* ----- The hero ----- */

/**
 * The headline, in three short sentences, one to a line: the Tenant's part, the
 * Property Manager's, myEST8's. "You decide." carries the Wattle stripe a decision
 * row has on the dashboard. Beside it (under it on phones), one repair from the
 * Tenant's text to the Ticket it becomes.
 */
function hero(): Html {
  return html`<section class="lp-hero" aria-labelledby="lp-title">
    <div class="lp-wrap lp-hero-grid">
      <div class="lp-intro">
        <h1 id="lp-title" class="lp-headline">
          <span class="lp-line">Tenants text the problem.</span>
          <span class="lp-line is-you">You decide.</span>
          <span class="lp-line">myEST8 does the chasing.</span>
        </h1>
        <p class="lp-lead">
          A maintenance desk for Property Managers at small Agencies. Tenants report repairs by SMS or email. myEST8 asks the follow-up questions,
          checks the photos, writes the summary and gets the Quotes. You confirm the repair and choose the Quote.
        </p>
        <div class="lp-actions">${linkButton(SIGN_UP, '/signup', { variant: 'primary', size: 'lg' })} ${linkButton('Sign in', '/login', { size: 'lg' })}</div>
        <p class="lp-note">Tenants, Tradies and Property Owners never need an account. They reply by text or a link.</p>
      </div>
      ${scene()}
    </div>
  </section>`;
}

/** A Tenant's words, marked where myEST8 found the Trade or the Urgency in them. */
const found = (words: string) => html`<mark class="lp-found">${words}</mark>`;

/**
 * The hero's picture, top to bottom: a Tenant's SMS thread with myEST8 (its
 * follow-up question settles the Urgency), the Maintenance Request it makes,
 * waiting for the Property Manager, and the Ticket it becomes once confirmed.
 * An illustration: nothing in it is a link or a control.
 */
function scene(): Html {
  return html`<figure class="lp-scene">
    <div class="lp-thread">
      <div class="lp-thread-head">
        <span class="lp-avatar" aria-hidden="true">PS</span>
        <p class="lp-thread-who"><span class="lp-thread-name">Priya Shah</span><span class="lp-thread-meta">Tenant at 12 King St, Newtown</span></p>
        ${badge('SMS')}
      </div>
      <ol class="lp-msgs">
        <li class="lp-msg is-in">
          <p class="lp-bubble">hi the ${found('tap under the kitchen sink')} keeps dripping, there’s a puddle in the cupboard</p>
          <p class="lp-msg-meta">Priya, 7:42 am</p>
        </li>
        <li class="lp-msg is-out">
          <p class="lp-bubble">Thanks Priya. Is the water near any power points? A photo of the tap would help.</p>
          <p class="lp-msg-meta">myEST8, 7:43 am</p>
        </li>
        <li class="lp-msg is-in">
          <p class="lp-bubble">no ${found('just the cupboard')}, nowhere near power. pic attached</p>
          <p class="lp-msg-meta">Priya, 7:45 am</p>
        </li>
      </ol>
    </div>
    <div class="lp-request">
      <p class="lp-request-kind"><span>Maintenance Request</span><span class="lp-request-age">Waiting for you</span></p>
      <p class="lp-request-address">12 King St, Newtown</p>
      <p class="lp-request-issue">Kitchen tap dripping under the sink since Sunday.</p>
      <p class="lp-ai"><span class="lp-ai-tag">Filled in by AI</span> You can edit the summary before you confirm.</p>
      <div class="lp-request-body">
        <dl class="lp-request-fields">
          <div>
            <dt>Trade</dt>
            <dd>${badge('Plumbing')}<span class="lp-from">from “tap under the kitchen sink”</span></dd>
          </div>
          <div>
            <dt>Urgency</dt>
            <dd>${urgencyBadge('routine')}<span class="lp-from">from “just the cupboard”</span></dd>
          </div>
        </dl>
        ${tapPhoto()}
      </div>
      <p class="lp-request-actions" aria-hidden="true"><span class="lp-fake-btn is-primary">Confirm</span><span class="lp-fake-btn">Change</span></p>
    </div>
    <div class="lp-became">
      <p class="lp-became-note">Confirmed at 9:10 am. Now it’s a Ticket.</p>
      ${docket({
        number: 12,
        urgency: 'routine',
        address: '12 King St, Newtown',
        issue: 'Kitchen tap dripping under the sink',
        meta: [html`Plumbing`, html`Quoting`],
        age: 'just now',
      })}
    </div>
    <figcaption class="lp-caption">The marked words are where myEST8 found the Trade and the Urgency.</figcaption>
  </figure>`;
}

/** The Tenant's photo: the tap under the sink, a drip and the puddle, drawn flat in the palette. */
function tapPhoto(): Html {
  return html`<svg class="lp-photo" viewBox="0 0 160 112" role="img" aria-label="Photo: the dripping tap under the sink">
    <rect class="p-wall" width="160" height="112" />
    <rect class="p-shelf" x="0" y="86" width="160" height="26" />
    <rect class="p-pipe" x="74" y="0" width="12" height="34" />
    <rect class="p-pipe" x="52" y="30" width="56" height="12" rx="3" />
    <rect class="p-valve" x="88" y="22" width="22" height="8" rx="2" />
    <path class="p-pipe" d="M52 30 h12 v30 a6 6 0 0 1 -12 0 Z" />
    <path class="p-drop" d="M58 70 q-5 8 0 11 q5 -3 0 -11 Z" />
    <path class="p-drop" d="M58 52 q-3 5 0 7 q3 -2 0 -7 Z" opacity="0.7" />
    <ellipse class="p-puddle" cx="66" cy="94" rx="38" ry="5" />
    <ellipse class="p-puddle-hi" cx="58" cy="93" rx="14" ry="1.6" />
  </svg>`;
}

/* ----- The demo ----- */

/** One demo Property Manager: who they are, their login in plain text, and a button that signs in as them. */
const DEMO_PEOPLE = [
  { name: 'Alice Archer', email: DEMO_LOGINS.emails[0] },
  { name: 'Bob Baker', email: DEMO_LOGINS.emails[1] },
];

/**
 * The demo sign-ins: each Property Manager is a small form that posts their login
 * to /login, so one click signs in. The logins stay readable as text beside it.
 */
function demoSignIns(): Html {
  return html`<aside class="lp-demo" aria-labelledby="demo">
    <div class="lp-wrap lp-demo-inner">
      <div class="lp-demo-copy">
        <h2 id="demo" class="lp-h3">Try the demo Agency</h2>
        <p>
          Harbour Realty has two Property Managers. Sign in as either, then use the Phone simulator to message in as a Tenant, Tradie or
          Property Owner.
        </p>
        <p>The password for both is <span class="num lp-demo-password">${DEMO_LOGINS.password}</span>.</p>
      </div>
      <ul class="lp-demo-people" role="list">
        ${DEMO_PEOPLE.map(
          (person) => html`<li>
            <p class="lp-demo-person">
              <span class="lp-demo-name">${person.name}</span>
              <span class="lp-demo-email">${person.email}</span>
            </p>
            <form method="post" action="/login">
              <input type="hidden" name="email" value="${person.email}" />
              <input type="hidden" name="password" value="${DEMO_LOGINS.password}" />
              <input type="hidden" name="next" value="/" />
              ${button(`Sign in as ${person.name}`, { variant: 'secondary' })}
            </form>
          </li>`,
        )}
      </ul>
    </div>
  </aside>`;
}

/* ----- The workflow ----- */

type Stage = { when: string; who: string; title: string; picture: () => Html; decision?: boolean };

/**
 * One repair through myEST8, as the stages it really goes through, with when each
 * happened and who acted. The pictures are what the Property Manager or Tenant
 * sees then. They hold no links or buttons: they are illustrations.
 */
const STAGES: Stage[] = [
  {
    when: 'Mon 7:42 am',
    who: 'Tenant',
    title: 'A Tenant texts the problem',
    picture: () =>
      html`<div class="lp-mini-thread">
        <p class="lp-bubble">The kitchen tap is dripping, there’s a puddle in the cupboard</p>
        <p class="lp-msg-meta">Priya, by SMS</p>
      </div>`,
  },
  {
    when: 'Mon 7:46 am',
    who: 'myEST8',
    title: 'Photos are checked and a summary is written',
    picture: () =>
      html`<div class="lp-card">
        <p class="lp-card-title">12 King St, Newtown</p>
        <p>Kitchen tap dripping under the sink</p>
        <p class="lp-badges">${urgencyBadge('routine')}${badge('Plumbing')}</p>
        <p class="lp-card-meta">One photo, checked on arrival. Summary filled in by AI.</p>
      </div>`,
  },
  {
    when: 'Mon 9:10 am',
    who: 'You',
    title: 'The Property Manager confirms',
    decision: true,
    picture: () =>
      html`<div class="lp-card is-decision is-row">
        <div class="lp-card-main">
          <p class="lp-card-title">Kitchen tap dripping</p>
          <p class="lp-card-meta">12 King St, Newtown</p>
          <p class="lp-badges">${urgencyBadge('routine')}${badge('Plumbing')}</p>
        </div>
        <span class="lp-fake-btn is-primary">Confirm</span>
      </div>`,
  },
  {
    when: 'Mon 9:10 am',
    who: 'myEST8',
    title: 'It becomes a Ticket',
    picture: () =>
      docket({ number: 12, urgency: 'routine', address: '12 King St, Newtown', issue: 'Kitchen tap dripping', meta: [html`Plumbing`, html`Quoting`] }),
  },
  {
    when: 'Mon 9:11 am',
    who: 'myEST8',
    title: 'Quote Requests go to at least two Tradies',
    picture: () =>
      html`<div class="lp-card">
        <p class="lp-card-title">Quote Requests sent to 3 Tradies</p>
        <ul class="lp-rows">
          ${['Flow Bros Plumbing', 'Drip Doctors', 'Inner West Plumbing'].map(
            (name) => html`<li>${icon('paper-plane-tilt', { size: 'size-4' })}<span>${name}</span></li>`,
          )}
        </ul>
        <p class="lp-card-meta">Up to four suggested. Anyone who hasn’t quoted in 48 hours gets a reminder.</p>
      </div>`,
  },
  {
    when: 'Mon 3:20 pm',
    who: 'Tradies, then you',
    title: 'A Quote comes back',
    decision: true,
    picture: () =>
      html`<div class="lp-card is-decision">
        <p class="lp-quote">
          <span><span class="lp-card-title">Drip Doctors</span><span class="lp-card-meta">New washer and cartridge, Wed 8:00 am</span></span>
          <span class="num lp-amount">$180</span>
        </p>
        <p class="lp-quote is-other">
          <span><span class="lp-card-title">Flow Bros Plumbing</span><span class="lp-card-meta">Replace the mixer, Thu 1:00 pm</span></span>
          <span class="num lp-amount">$240</span>
        </p>
        <p class="lp-card-meta">Under the Property’s $500 Max Repair Cost, so no Property Owner approval needed</p>
      </div>`,
  },
  {
    when: 'Mon 3:24 pm',
    who: 'myEST8',
    title: 'The Work Order goes out',
    picture: () =>
      html`<div class="lp-card">
        <p class="lp-sent">${icon('check-circle', { weight: 'fill', size: 'size-5' })}<span class="lp-card-title">Work Order sent</span></p>
        <p>Drip Doctors, Wed 8:00 am</p>
        <p class="lp-card-meta">Priya has been told when to expect them</p>
      </div>`,
  },
  {
    when: 'Wed 9:35 am',
    who: 'Tradie',
    title: 'The Job is done, and the Tenant sees it',
    picture: () =>
      html`<div class="lp-card">
        <p class="lp-card-title">Now: Done</p>
        ${steps(
          ['Reported', 'Confirmed', 'Booked', 'Done'].map((label) => ({ label, done: true })),
          { horizontal: true },
        )}
      </div>`,
  },
];

/**
 * The workflow: an ordered list, so it reads in order without CSS or animation and
 * to screen readers. Every stage and its picture is always shown; landing.css moves
 * a "now" marker down the stages, one at a time, and holds still under
 * prefers-reduced-motion. The pause button only appears with JavaScript (app.js).
 */
function workflow(): Html {
  return html`<section class="flow lp-wrap" aria-labelledby="workflow" data-flow>
    <div class="flow-head">
      <div class="flow-head-copy">
        <h2 id="workflow" class="lp-h2">One repair, start to finish</h2>
        <p class="flow-summary">Reported on Monday at 7:42 am, fixed on Wednesday morning. The Property Manager made two decisions.</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm flow-pause" data-flow-pause hidden>
        <span class="flow-pause-icon">${icon('pause', { size: 'size-4' })}</span><span class="flow-play-icon">${icon('play', { size: 'size-4' })}</span>
        <span data-flow-pause-label>Pause</span><span class="sr-only"> the animation</span>
      </button>
    </div>
    <ol class="flow-stages" aria-labelledby="workflow">
      ${STAGES.map(
        (stage, i) => html`<li class="flow-stage${stage.decision ? ' is-decision' : ''}" style="--i: ${i}">
          <span class="flow-node num" aria-hidden="true">${i + 1}</span>
          <div class="flow-text">
            <p class="flow-when num">${stage.when}</p>
            <p class="flow-title">${stage.title}</p>
            <p class="flow-who${stage.decision ? ' is-you' : ''}">${stage.who}</p>
          </div>
          <div class="flow-picture">${stage.picture()}</div>
        </li>`,
      )}
    </ol>
  </section>`;
}

/* ----- Who does what ----- */

/** The calls that stay with the Property Manager. */
const DECISIONS = [
  {
    title: 'Confirm each Maintenance Request',
    text: 'Check the summary, Trade and Urgency myEST8 filled in, edit them if you need to, and confirm. It becomes a Ticket.',
  },
  {
    title: 'Book site quotes for a High repair',
    text: 'Once two Quotes are in on a High repair, have Tradies visit the Property and revise their price, or skip the visits.',
  },
  {
    title: 'Choose the Quote',
    text: 'Pick one. If it takes the Repair Cost over the Property’s Max Repair Cost, myEST8 asks the Property Owner first.',
  },
];

/** What myEST8 does without being asked. */
const CHORES = [
  { icon: 'chat-circle-dots', text: 'Asks the Tenant follow-up questions, checks the photos when they arrive, and fills in a summary of the issue with AI.' },
  { icon: 'siren', text: 'Spots an Urgent Repair and reminds the Tenant to arrange it with a Nominated Tradie, so it never waits on Quotes.' },
  { icon: 'paper-plane-tilt', text: 'Suggests up to four Tradies for the Trade, sends Quote Requests to at least two, and reminds them after 48 hours.' },
  { icon: 'signature', text: 'Asks the Property Owner to approve a Quote over the Max Repair Cost, and reminds them after a day.' },
  { icon: 'calendar-check', text: 'Sends the Work Order, books the visit and tells the Tenant when the Tradie is coming.' },
];

/** The people who never sign in, and how myEST8 reaches them. */
const PEOPLE = [
  { icon: 'user', who: 'Tenants', text: 'Report by SMS or email, in their own words and photos.' },
  { icon: 'wrench', who: 'Tradies', text: 'Get Quote Requests and Work Orders by text, and reply with a price and a time.' },
  { icon: 'house-line', who: 'Property Owners', text: 'Approve a Quote over the Max Repair Cost with a reply or a link.' },
];

function whoDoesWhat(): Html {
  return html`<section class="lp-band is-surface lp-roles" aria-labelledby="lp-roles-title">
    <div class="lp-wrap">
      <h2 id="lp-roles-title" class="lp-h2">What waits for you, and what doesn’t</h2>
      <div class="lp-roles-grid">
        <div>
          <h3 class="lp-h3">Waiting for your decision</h3>
          <ul class="lp-decisions" role="list">
            ${DECISIONS.map(
              (d) => html`<li>
                <p class="lp-decision-title">${d.title}</p>
                <p>${d.text}</p>
              </li>`,
            )}
          </ul>
        </div>
        <div>
          <h3 class="lp-h3">Handled by myEST8</h3>
          <ul class="lp-chores" role="list">
            ${CHORES.map((c) => html`<li>${icon(c.icon, { size: 'size-5' })}<p>${c.text}</p></li>`)}
          </ul>
        </div>
      </div>
      <div class="lp-people">
        <h3 class="lp-h3">Nobody else needs an account</h3>
        <ul role="list">
          ${PEOPLE.map(
            (p) => html`<li>
              <p class="lp-person-who">${icon(p.icon, { size: 'size-5' })}<span>${p.who}</span></p>
              <p>${p.text}</p>
            </li>`,
          )}
        </ul>
      </div>
    </div>
  </section>`;
}

/* ----- The way in, again ----- */

function closing(): Html {
  return html`<section class="lp-close" aria-labelledby="lp-close-title">
    <div class="lp-wrap lp-close-inner">
      <div class="lp-close-copy">
        <span class="lp-close-logo">${logo()}</span>
        <h2 id="lp-close-title" class="lp-h2">Put your Agency’s repairs on one desk</h2>
        <p>Create the Agency’s account, add your Properties and Tradies, and give Tenants the number to text.</p>
      </div>
      <div class="lp-actions">${linkButton(SIGN_UP, '/signup', { variant: 'primary', size: 'lg' })} ${linkButton('Sign in', '/login', { size: 'lg' })}</div>
    </div>
  </section>`;
}
