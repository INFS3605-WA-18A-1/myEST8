// The document shared by the sign-in and sign-up pages: the whole viewport, split
// in two from 1024px. On the left a full-height Night panel, where the app's rail
// will sit once the Property Manager is in, carrying the landing page's thesis and
// "what happens next" with the Maintenance Request they will be asked to confirm.
// On the right, on white, the page's h1 and its form. On phones the form comes
// first and the Night panel follows it, then the footer. Every link is a button
// (docs/design-system.md). Styles are in static/auth.css, loaded only here.

import { html } from 'hono/html';
import { badge, flashMessage, head, linkButton, logo, urgencyBadge, type Flash, type Html } from './ui.ts';

/** One "what happens next" step. `request` shows the Maintenance Request that step leads to, under its sentence. */
export type NextStep = { text: string; request?: boolean };

/**
 * A full-page sign-in or sign-up document. `title` is the h1 and the tab's title;
 * `form` is the form and the other way in under it; `steps` fill the Night panel.
 * `size` sets how wide the form column runs: a sign-in form is short, the sign-up
 * form needs room for its two-column fields.
 */
export function authPage(o: {
  title: string;
  subtitle: string;
  flash?: Flash | null;
  size: 'login' | 'signup';
  form: Html;
  steps: NextStep[];
  footer: string;
}): Html {
  return html`<!doctype html>
    <html lang="en-AU" data-theme="myest8">
      <head>
        ${head(o.title, { css: ['auth.css'] })}
      </head>
      <body class="au">
        <a href="#main" class="skip-link">Skip to content</a>
        <div class="au-frame is-${o.size}">
          <header class="au-bar">
            <span class="logotype au-logo">${logo()}</span>
            <div class="au-bar-actions">${linkButton('Home', '/', { variant: 'ghost', size: 'sm' })}</div>
          </header>
          <main id="main" class="au-main">
            <div class="au-form-col">
              ${o.flash ? flashMessage(o.flash) : ''}
              <div class="au-head">
                <h1 class="au-title">${o.title}</h1>
                <p class="au-lead">${o.subtitle}</p>
              </div>
              ${o.form}
            </div>
          </main>
          ${panel(o.steps)}
          <footer class="au-footer">${o.footer}</footer>
        </div>
      </body>
    </html>`;
}

/**
 * The Night panel: the landing page's three-line thesis, where "You decide."
 * carries the Wattle decision stripe, then the steps in order.
 */
function panel(steps: NextStep[]): Html {
  return html`<aside class="au-panel" aria-labelledby="next-heading">
    <div class="au-panel-inner">
      <p class="au-thesis">
        <span class="au-line">Tenants text the problem.</span>
        <span class="au-line is-you">You decide.</span>
        <span class="au-line">myEST8 does the chasing.</span>
      </p>
      <div class="au-next">
        <h2 id="next-heading" class="au-next-title">What happens next</h2>
        <ol class="au-steps" role="list">
          ${steps.map(
            (step, i) => html`<li class="au-step">
              <span class="au-step-num num" aria-hidden="true">${i + 1}</span>
              <div class="au-step-body">
                <p>${step.text}</p>
                ${step.request ? request() : ''}
              </div>
            </li>`,
          )}
        </ol>
      </div>
    </div>
  </aside>`;
}

/**
 * The Maintenance Request a Tenant's text becomes, as a decision row on the
 * dashboard: the Wattle stripe, the address, the issue, Trade and Urgency, and
 * Confirm. An illustration: nothing in it is a link or a control.
 */
function request(): Html {
  return html`<div class="au-request">
    <p class="au-request-kind"><span>Maintenance Request</span><span class="au-request-age">Waiting for you</span></p>
    <p class="au-request-address">12 King St, Newtown</p>
    <p class="au-request-issue">Kitchen tap dripping under the sink</p>
    <p class="au-request-foot">
      <span class="au-badges">${badge('Plumbing')}${urgencyBadge('routine')}</span>
      <span class="au-fake-btn" aria-hidden="true">Confirm</span>
    </p>
  </div>`;
}

/** The secondary way in under a hairline, at the foot of a form: a sentence, then a full-width button. */
export function otherWay(o: { text: string; button: Html }): Html {
  return html`<div class="au-other">
    <p class="au-other-text">${o.text}</p>
    ${o.button}
  </div>`;
}
