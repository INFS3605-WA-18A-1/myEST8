// The front door at / for anyone not signed in. It says who myEST8 is for and
// shows what it does with one repair: a Tenant's text and what myEST8 makes of it
// (pick one of three messages), the repair as one bar from report to done, whose
// Wattle seams are the Property Manager's two decisions, what myEST8 does without
// being asked, and the way in. The photographs are real Sydney rental streets and
// tradies at work, found in Wikimedia Commons and credited in the footer; none of
// them is presented as a customer's Property or a Tradie on myEST8.
// A signed-in Property Manager gets their dashboard at / instead.
//
// The page builds its own document (head() and logo() from ui.ts) so its bands can
// run the full width. Its styles are in static/landing.css; its one script (the
// sections rising into view) is the `landing` block of static/app.js.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { App } from '../../app.ts';
import { SIGNED_OUT_FOOTER, signedInId, type Sessions } from '../auth.ts';
import { icon } from '../icons.ts';
import { badge, button, head, linkButton, logo, urgencyBadge, type Html } from '../ui.ts';

/** The demo Agency's sign-ins, shown on the landing page when the app runs as the demo. */
const DEMO_LOGINS = { emails: ['alice@harbour.example', 'bob@harbour.example'], password: 'demo1234' };

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

/** One of the landing page's photographs, served from /assets/landing-<name>. */
const photo = (name: string, alt: string, width: number, height: number, o: { eager?: boolean; immediate?: boolean; className?: string } = {}) =>
  html`<img
    src="/assets/landing-${name}"
    alt="${alt}"
    width="${width}"
    height="${height}"
    class="${o.className ?? ''}"
    ${o.eager ? html`fetchpriority="high"` : o.immediate ? '' : html`loading="lazy"`}
    decoding="${o.immediate ? 'sync' : 'async'}"
  />`;

/** The landing page: the hero, the demo sign-ins (demo only), the live example, the repair, the chores, the way in, the credits. */
function landingPage(o: { demo: boolean }): Html {
  return html`<!doctype html>
    <html lang="en-AU" data-theme="myest8">
      <head>
        ${head('Maintenance for small Agencies', { css: ['landing.css'] })}
      </head>
      <body class="lp">
        <a href="#main" class="skip-link">Skip to content</a>
        <header class="lp-bar">
          <div class="lp-wrap lp-bar-inner">
            <a href="/" class="logotype lp-home" aria-label="myEST8 home">${logo()}</a>
            <nav class="lp-bar-links" aria-label="Page">
              ${linkButton('Their words, your request', '#example', { variant: 'ghost', size: 'sm' })}
              ${linkButton('One leak, report to done', '#repair', { variant: 'ghost', size: 'sm' })}
              ${linkButton('What myEST8 handles', '#handled', { variant: 'ghost', size: 'sm' })}
            </nav>
            <nav class="lp-bar-actions" aria-label="Account">
              ${linkButton('Sign in', '/login', { variant: 'ghost', size: 'sm' })}
              <span class="lp-bar-signup">${linkButton(SIGN_UP, '/signup', { variant: 'primary', size: 'sm' })}</span>
            </nav>
          </div>
        </header>
        <main id="main">${hero()} ${o.demo ? demoSignIns() : ''} ${example()} ${repair()} ${handled()} ${closing()}</main>
        ${footer()}
      </body>
    </html>`;
}

/* ----- The hero ----- */

/**
 * "Narrow talk, wide headline": the headline wide on the right, two lines, the
 * second carrying the Wattle decision stripe a decision row has on the dashboard.
 * The narrow left column says what myEST8 is, holds the ways in, and ends on the
 * count of decisions a repair asks of the Property Manager. Under the headline,
 * a Newtown terrace street.
 */
function hero(): Html {
  return html`<section class="lp-hero" aria-labelledby="lp-title">
    <div class="lp-wrap lp-hero-grid">
      <h1 id="lp-title" class="lp-headline">
        <span class="lp-line"><span>Tenants text.</span></span>
        <span class="lp-line is-you"><span>You decide.</span></span>
      </h1>
      <div class="lp-intro" data-rise>
        <p class="lp-lead">
          myEST8 is the maintenance desk for Property Managers at small Agencies. It asks the follow-up questions and chases the Quotes. You make the calls.
        </p>
        <div class="lp-actions">${linkButton(SIGN_UP, '/signup', { variant: 'primary', size: 'lg' })} ${linkButton('Sign in', '/login', { size: 'lg' })}</div>
        <p class="lp-note">Tenants, Tradies and Property Owners never need an account. They reply by text or email.</p>
        <p class="lp-figure-block"><span class="lp-figure-num num">2</span><span>decisions on a typical repair. myEST8 chases the rest.</span></p>
      </div>
      <figure class="lp-hero-figure">
        <div class="lp-hero-photo">${photo('newtown-terraces.jpg', 'A row of rendered terrace houses with iron lace balconies in Newtown, Sydney', 1339, 1200, { eager: true })}</div>
        <figcaption class="lp-caption">Terrace houses in Newtown, Sydney.</figcaption>
      </figure>
    </div>
  </section>`;
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

/* ----- The live example ----- */

/** A Tenant's words, marked where myEST8 found the Trade or the Urgency in them. */
const found = (words: string) => html`<mark class="lp-found">${words}</mark>`;

type Example = {
  id: string;
  label: string;
  /** The Tenant's first message, with the words that settled the Trade and Urgency marked. */
  message: Html;
  /** myEST8's replies and the Tenant's answers after that first message, in the words the templates send. */
  thread: { from: 'in' | 'out'; text: Html }[];
  /** What the Property Manager sees: a Maintenance Request waiting for them, or an Urgent Repair that never becomes a Ticket. */
  result: Html;
};

const UPLOAD_LINK = 'myest8.vercel.app/u/4kTq9';

/** A Maintenance Request as the Property Manager sees it, waiting for them. An illustration: its buttons are not controls. */
function request(o: { issue: string; trade: string; tradeFrom: string; urgency: string; urgencyFrom: string; photo?: Html }): Html {
  return html`<div class="lp-request" data-ui>
    <p class="lp-request-kind"><span>Maintenance Request</span><span class="lp-request-age">Waiting for you</span></p>
    <p class="lp-request-address">12 King St, Newtown</p>
    <p class="lp-request-issue">${o.issue}</p>
    <p class="lp-ai"><span class="lp-ai-tag">Filled in by AI</span> You can edit it before you confirm.</p>
    <div class="lp-request-body">
      <dl class="lp-request-fields">
        <div>
          <dt>Trade</dt>
          <dd>${badge(o.trade)}<span class="lp-from">from “${o.tradeFrom}”</span></dd>
        </div>
        <div>
          <dt>Urgency</dt>
          <dd>${urgencyBadge(o.urgency)}<span class="lp-from">from “${o.urgencyFrom}”</span></dd>
        </div>
      </dl>
      ${o.photo ?? ''}
    </div>
    <p class="lp-request-actions" aria-hidden="true"><span class="lp-fake-btn is-primary">Confirm</span><span class="lp-fake-btn">Change</span></p>
  </div>`;
}

/**
 * Three things a Tenant might text, and what myEST8 does with each. The follow-up
 * questions, the upload link and the Urgent Repair advice are the words
 * src/templates.ts sends; the Urgency follows the definitions the classifier is
 * given (src/intake.ts): a leak is High, no hot water is Urgent.
 */
const EXAMPLES: Example[] = [
  {
    id: 'leak',
    label: 'A dripping tap',
    message: html`hi the ${found('tap under the kitchen sink')} keeps dripping, there’s a ${found('puddle in the cupboard')}`,
    thread: [
      {
        from: 'out',
        text: html`Thanks, Priya. To get this sorted we just need:<br />1. When did it start?<br />2. Is it getting worse? (yes or no)<br />3. When are you usually
          home: weekday mornings, weekday afternoons, Saturdays or any time?`,
      },
      { from: 'in', text: html`sunday. yes its getting worse. weekday mornings` },
      { from: 'out', text: html`Thanks. Please upload a few photos of the issue here, straight from your phone: <span class="lp-link-text">${UPLOAD_LINK}</span>` },
    ],
    result: request({
      issue: 'Kitchen tap dripping under the sink since Sunday, getting worse.',
      trade: 'Plumbing',
      tradeFrom: 'tap under the kitchen sink',
      urgency: 'high',
      urgencyFrom: 'puddle in the cupboard',
      photo: html`<figure class="lp-request-photo">
        ${photo('dripping-tap.jpg', 'Photo sent with the request: water dripping from a tap', 1200, 798)}
      </figure>`,
    }),
  },
  {
    id: 'hinge',
    label: 'A loose cupboard door',
    message: html`the ${found('pantry door has come off its top hinge')}, it still closes so ${found('no rush')}`,
    thread: [
      {
        from: 'out',
        text: html`Thanks, Priya. To get this sorted we just need:<br />1. When did it start?<br />2. When are you usually home: weekday mornings, weekday
          afternoons, Saturdays or any time?`,
      },
      { from: 'in', text: html`last week. saturdays are best` },
      { from: 'out', text: html`Thanks. Please upload a few photos of the issue here, straight from your phone: <span class="lp-link-text">${UPLOAD_LINK}</span>` },
    ],
    result: request({
      issue: 'Pantry door off its top hinge since last week. Still closes.',
      trade: 'Carpentry',
      tradeFrom: 'pantry door has come off its top hinge',
      urgency: 'routine',
      urgencyFrom: 'no rush',
    }),
  },
  {
    id: 'hot-water',
    label: 'No hot water',
    message: html`${found('no hot water')} at all ${found('since this morning')}, the shower is freezing`,
    thread: [
      {
        from: 'out',
        text: html`This sounds urgent. You can arrange the repair yourself straight away and claim up to $1,000 back from the property owner. Please use one
          of the property’s nominated tradies where possible: Flow Bros Plumbing 0412 555 019. When it’s done, send us the receipt (a photo or PDF) here,
          and we’ll pass your Reimbursement Request to the property owner: <span class="lp-link-text">${UPLOAD_LINK}</span>`,
      },
    ],
    result: html`<div class="lp-request is-urgent" data-ui>
      <p class="lp-request-kind"><span>Urgent Repair</span><span class="lp-request-age">Tenant told what to do</span></p>
      <p class="lp-request-address">12 King St, Newtown</p>
      <p class="lp-request-issue">No hot water since this morning.</p>
      <dl class="lp-request-fields">
        <div>
          <dt>Trade</dt>
          <dd>${badge('Plumbing')}<span class="lp-from">from “no hot water”</span></dd>
        </div>
        <div>
          <dt>Urgency</dt>
          <dd>${urgencyBadge('urgent')}<span class="lp-from">from “since this morning”</span></dd>
        </div>
      </dl>
      <p class="lp-urgent-note">
        It never waits on Quotes or becomes a Ticket. Priya calls the Nominated Tradie and sends the receipt, and her Reimbursement Request goes to the
        Property Owner.
      </p>
    </div>`,
  },
];

/**
 * "Input half, output half": on the Night field, what a Tenant texts and what
 * myEST8 replies; on the light field, what the Property Manager gets. The three
 * messages are radio buttons, and CSS (:has) shows the thread and the result for
 * the one chosen. Without :has every example shows, one under another.
 */
function example(): Html {
  return html`<section class="lp-example" id="example" aria-labelledby="example-title">
    <h2 id="example-title" class="lp-split-title"><span>Their words,</span> <span>your request</span></h2>
    <div class="lp-example-in">
      <fieldset class="lp-choices">
        <legend class="lp-choices-legend">What the Tenant texts</legend>
        ${EXAMPLES.map(
          (e, i) => html`<label class="lp-choice">
            <input type="radio" name="lp-example" value="${e.id}" ${i === 0 ? 'checked' : ''} />
            <span class="lp-choice-label">${e.label}</span>
          </label>`,
        )}
      </fieldset>
      ${EXAMPLES.map(
        (e) => html`<ol class="lp-thread" data-example="${e.id}" aria-label="${e.label}: the messages">
          <li class="lp-msg is-in">
            <p class="lp-bubble">${e.message}</p>
            <p class="lp-msg-meta">Priya, by SMS</p>
          </li>
          ${e.thread.map(
            (m) => html`<li class="lp-msg is-${m.from}">
              <p class="lp-bubble">${m.text}</p>
              <p class="lp-msg-meta">${m.from === 'out' ? 'myEST8' : 'Priya'}</p>
            </li>`,
          )}
        </ol>`,
      )}
    </div>
    <div class="lp-example-out">
      <p class="lp-example-label">What myEST8 makes of it</p>
      <div class="lp-example-body">
        ${EXAMPLES.map((e) => html`<div class="lp-result" data-example="${e.id}">${e.result}</div>`)}
        <p class="lp-caption">The marked words are where myEST8 found the Trade and the Urgency.</p>
      </div>
      <p class="lp-example-close">One Confirm, and myEST8 chases the Quotes.</p>
    </div>
  </section>`;
}

/* ----- One repair ----- */

type Stretch = { length: string; minutes: number; tone: string; summary: string; stages: { when: string; what: string }[] };

/**
 * One repair as the time it really takes, in three stretches whose widths follow
 * their durations: Monday 7:42 am to 9:10 am, 9:10 am to 3:24 pm, then to Wednesday
 * 9:35 am. Between them, the two decisions the Property Manager made.
 */
const STRETCHES: Stretch[] = [
  {
    length: 'An hour and a half',
    minutes: 88,
    tone: 'is-light',
    summary: 'First, myEST8 gets the full story from the Tenant.',
    stages: [
      { when: 'Mon 7:42 am', what: 'Priya texts that the kitchen tap is dripping.' },
      { when: 'Mon 7:43 am', what: 'myEST8 asks when it started, if it’s getting worse and when she’s home, then sends the upload link.' },
      { when: 'Mon 7:46 am', what: 'Her photo is checked and the summary, Trade and Urgency are filled in.' },
    ],
  },
  {
    length: 'Six hours',
    minutes: 374,
    tone: 'is-action',
    summary: 'Then the Ticket goes out for Quotes.',
    stages: [
      { when: 'Mon 9:10 am', what: 'You confirm the Maintenance Request. It becomes Ticket #12.' },
      { when: 'Mon 9:11 am', what: 'Quote Requests go to three plumbers. Anyone who hasn’t quoted in 48 hours gets a reminder.' },
      { when: 'Mon 3:20 pm', what: 'Drip Doctors quote $180, Flow Bros $240. Both are under the $500 Max Repair Cost.' },
    ],
  },
  {
    length: 'Two days',
    minutes: 2531,
    tone: 'is-night',
    summary: 'Last, the Tradie does the Job.',
    stages: [
      { when: 'Mon 3:24 pm', what: 'You choose Drip Doctors. The Work Order goes out and Priya is told when to expect them.' },
      { when: 'Wed 8:00 am', what: 'The plumber arrives, at a time Priya is home.' },
      { when: 'Wed 9:35 am', what: 'The Job is done, and Priya sees it marked Done.' },
    ],
  },
];

/**
 * "Stages as one bar": the repair's progress bar, enlarged until it spans the page.
 * Its three stretches are exactly as wide as the minutes they took (88, 374 and
 * 2531), so the two days fill most of it and the hour and a half is a sliver. The
 * bar holds no text: the key above it gives each colour its duration, the caption
 * names the Wattle seams, and the ordered list below holds every stage.
 * The bar is a picture (data-ui, hidden from screen readers, which read the key
 * and the ordered list).
 */
function repair(): Html {
  return html`<section class="lp-repair lp-wrap" id="repair" aria-labelledby="repair-title">
    <h2 id="repair-title" class="lp-h2" data-rise>One leak, report to done</h2>
    <p class="lp-repair-lead" data-rise>Reported on Monday at 7:42 am, fixed on Wednesday morning. The Property Manager made two decisions.</p>
    <ul class="lp-bar-key" role="list" data-rise>
      ${STRETCHES.map((s) => html`<li><span class="lp-bar-chip ${s.tone}" aria-hidden="true"></span>${s.length}</li>`)}
    </ul>
    <div class="lp-bar-chart" data-ui data-rise aria-hidden="true">
      ${STRETCHES.map(
        (s, i) => html`${i > 0 ? html`<span class="lp-seam"></span>` : ''}
          <span class="lp-segment ${s.tone}" style="--grow: ${s.minutes}"></span>`,
      )}
    </div>
    <p class="lp-bar-caption" data-rise>To scale. The Wattle seams are your two decisions: you confirm the Request, then choose the Quote.</p>
    <ol class="lp-stretches" role="list">
      ${STRETCHES.map(
        (s) => html`<li class="lp-stretch" data-rise>
          <p class="lp-stretch-summary">${s.summary}</p>
          <ol class="lp-stages">
            ${s.stages.map((st) => html`<li><span class="lp-when num">${st.when}</span><span>${st.what}</span></li>`)}
          </ol>
        </li>`,
      )}
    </ol>
  </section>`;
}

/* ----- What myEST8 handles ----- */

/** The calls that stay with the Property Manager. */
const DECISIONS = [
  {
    title: 'Confirm each Maintenance Request',
    text: 'Check the summary, Trade and Urgency myEST8 filled in, edit them if you need to, and confirm. It becomes a Ticket.',
  },
  {
    title: 'Sometimes: book a Site Inspection',
    text: 'Each Tradie gives an Estimate and says if they need to see the issue before a Firm Quote. Book their visit, or go ahead on an Estimate for a cheap routine Job.',
  },
  {
    title: 'Choose the Firm Quote',
    text: 'Pick one. If it takes the Repair Cost over the Property’s Max Repair Cost, myEST8 asks the Property Owner first.',
  },
];

/** What myEST8 does without being asked. */
const CHORES = [
  { icon: 'chat-circle-dots', text: 'Asks the Tenant the follow-up questions, checks the photos when they arrive, and fills in a summary of the issue with AI.' },
  { icon: 'siren', text: 'Spots an Urgent Repair and tells the Tenant to arrange it with a Nominated Tradie, so it never waits on Quotes.' },
  { icon: 'paper-plane-tilt', text: 'Suggests up to four Tradies for the Trade, sends Quote Requests to at least two, and reminds them after 48 hours.' },
  { icon: 'signature', text: 'Asks the Property Owner to approve a Quote over the Max Repair Cost, and reminds them after a day.' },
  { icon: 'calendar-check', text: 'Sends the Work Order, books the visit and tells the Tenant when the Tradie is coming.' },
];

/** The people who never sign in, and how myEST8 reaches them. */
const PEOPLE = [
  { who: 'Tenants', text: 'Report by SMS or email, in their own words, and upload photos from a link.' },
  { who: 'Tradies', text: 'Get Quote Requests and Work Orders by text or email, and reply with a price and a time.' },
  { who: 'Property Owners', text: 'Approve a Quote over the Max Repair Cost by replying YES or NO.' },
];

/**
 * The statement's three photographs as one clean strip under it: the Tenant's tap,
 * a Tradie under a sink, the Owner's terrace. Decorative (the sentence beside them
 * carries the meaning), so each has an empty alt.
 */
function statementPhotos(): Html {
  const shot = (name: string, w: number, h: number, crop: string) =>
    html`<span class="lp-statement-photo ${crop}">${photo(name, '', w, h, { immediate: true })}</span>`;
  return html`<div class="lp-statement-photos" data-rise>
    ${shot('dripping-tap.jpg', 1200, 798, 'is-tap')} ${shot('plumber-under-sink.jpg', 1400, 1084, 'is-plumber')}
    ${shot('ultimo-terrace.jpg', 900, 1304, 'is-terrace')}
  </div>`;
}

/**
 * "A statement, then the work": one statement in display type with its three
 * photographs in a strip under it. Under them, the calls that wait for the Property
 * Manager (each with the Wattle stripe), what myEST8 does, and who never signs in.
 */
function handled(): Html {
  return html`<section class="lp-handled" id="handled" aria-labelledby="handled-title">
    <div class="lp-wrap">
      <h2 id="handled-title" class="sr-only">What myEST8 handles</h2>
      <p class="lp-statement" data-rise>myEST8 texts the Tenant, chases Tradies for Quotes, and asks the Owner before going over budget.</p>
      ${statementPhotos()}
      <div class="lp-handled-grid">
        <div data-rise>
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
        <div data-rise>
          <h3 class="lp-h3">Handled by myEST8</h3>
          <ul class="lp-chores" role="list">
            ${CHORES.map((c) => html`<li>${icon(c.icon, { size: 'size-5' })}<p>${c.text}</p></li>`)}
          </ul>
        </div>
      </div>
      <div class="lp-people" data-rise>
        <h3 class="lp-h3">Nobody else needs an account</h3>
        <dl>
          ${PEOPLE.map(
            (p) => html`<div>
              <dt>${p.who}</dt>
              <dd>${p.text}</dd>
            </div>`,
          )}
        </dl>
      </div>
    </div>
  </section>`;
}

/* ----- The way in, again ----- */

/** "Three photographs, then a field": Sydney rental streets and a tradie at work, then the way in on Night. */
function closing(): Html {
  return html`<section class="lp-close" aria-labelledby="lp-close-title">
    <div class="lp-strip">
      ${photo('king-street.jpg', 'Shops and terraces along King Street, Newtown', 1000, 1333, { immediate: true })}
      ${photo('wattle-street.jpg', 'Painted iron lace on a terrace balcony in Wattle Street, Ultimo', 1920, 1083, { immediate: true })}
      ${photo('plumber-wrenches.jpg', 'A plumber tightening a fitting with two wrenches', 1096, 894, { immediate: true })}
    </div>
    <div class="lp-close-field">
      <div class="lp-wrap lp-close-inner">
        <h2 id="lp-close-title" class="lp-h2">Put your Agency’s repairs on one desk</h2>
        <div class="lp-close-copy">
          <p>Create the Agency’s account, add your Properties and Tradies, and give Tenants the number to text.</p>
          <div class="lp-actions">${linkButton(SIGN_UP, '/signup', { variant: 'primary', size: 'lg' })} ${linkButton('Sign in', '/login', { size: 'lg' })}</div>
        </div>
      </div>
    </div>
  </section>`;
}

/* ----- The footer ----- */

/**
 * The landing page's photographs, credited as their Wikimedia Commons pages ask:
 * the title (the file's name there), the author and the licence. Public pages hold
 * no text links (test/web/public-links.test.ts), so the credits are text. The file
 * names are in static/landing/README.md with each source page.
 */
const CREDITS = [
  { title: 'Terraced Houses in Newtown', by: 'Michael Coghlan', licence: 'CC BY-SA 2.0' },
  { title: 'And The Kitchen Sink Too', by: 'Jan Bambach', licence: 'CC BY-SA 3.0' },
  { title: 'Plumber at work (retouched)', by: 'rick on Flickr', licence: 'CC BY 2.0' },
  { title: 'Terraced house Ultimo Sydney 001', by: 'Sardaka', licence: 'CC BY-SA 4.0' },
  { title: '2024-07-16 King Street, Newtown, Sydney 03', by: '源義信', licence: 'CC BY 4.0' },
  { title: 'Terraced house Wattle Street 001', by: 'Sardaka', licence: 'CC BY-SA 4.0' },
  { title: 'Plumber uses two wrenches to tighten a fitting', by: 'Tomwsulcer', licence: 'CC0' },
];

/** "Name first": the wordmark at full width, what myEST8 is and the terms, then the photo credits. */
function footer(): Html {
  return html`<footer class="lp-footer">
    <div class="lp-wrap">
      <p class="lp-footer-name" aria-hidden="true">${logo()}</p>
      <div class="lp-footer-row">
        <div class="lp-footer-ways">
          <p>${SIGNED_OUT_FOOTER}</p>
          <nav class="lp-footer-links" aria-label="Terms and privacy">
            ${linkButton('Terms of use', '/terms', { variant: 'ghost', size: 'sm' })}
            ${linkButton('Privacy Policy', '/privacy', { variant: 'ghost', size: 'sm' })}
          </nav>
        </div>
        <div class="lp-credits">
          <h2 class="lp-credits-title">Photographs</h2>
          <p>
            From Wikimedia Commons:
            ${CREDITS.map((c, i) => html`${i ? '; ' : ' '}“${c.title}” by ${c.by}, ${c.licence}`)}.
          </p>
        </div>
      </div>
    </div>
  </footer>`;
}
