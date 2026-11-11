// The two public pages a Property Manager agrees to at /signup: /terms and
// /privacy. Short, plain copy for a university project, on the public page frame
// every signed-out visitor already sees (publicPage in ui.ts), with the same bar
// and a single prose column. Every link is a button (docs/design-system.md).

import { Hono } from 'hono';
import { html } from 'hono/html';
import { SIGNED_OUT_FOOTER } from '../auth.ts';
import { linkButton, publicPage, type Html } from '../ui.ts';

/** GET /terms and GET /privacy. Both are public: no session, no app data. */
export function legalRoutes() {
  const routes = new Hono();
  routes.get('/terms', (c) => c.html(termsPage()));
  routes.get('/privacy', (c) => c.html(privacyPage()));
  return routes;
}

const HEADER_ACTIONS = html`${linkButton('Home', '/', { variant: 'ghost', size: 'sm' })}
  ${linkButton('Sign in', '/login', { variant: 'ghost', size: 'sm' })}`;

const FOOTER_LINKS = html`<p>${SIGNED_OUT_FOOTER}</p>
  <nav class="legal-footer-links" aria-label="Terms and privacy">
    ${linkButton('Terms of use', '/terms', { variant: 'ghost', size: 'sm' })}
    ${linkButton('Privacy Policy', '/privacy', { variant: 'ghost', size: 'sm' })}
  </nav>`;

/** One legal document: the public bar, the title, then its sections. */
function legalPage(o: { title: string; subtitle: string; body: Html }): Html {
  return publicPage({
    css: ['legal.css'],
    title: o.title,
    subtitle: o.subtitle,
    headerActions: HEADER_ACTIONS,
    body: o.body,
    footer: FOOTER_LINKS,
  });
}

/** A section of a legal document: a heading and its paragraphs. */
function part(heading: string, ...body: Html[]): Html {
  return html`<section class="legal-section">
    <h2>${heading}</h2>
    ${body}
  </section>`;
}

/** The quiet way back into the product at the end of either document. */
function ending(): Html {
  return html`<div class="legal-end">
    <p>Ready to put your Agency’s repairs on one desk?</p>
    <div class="legal-end-actions">
      ${linkButton('Create your Agency’s account', '/signup', { variant: 'primary' })} ${linkButton('Sign in', '/login', { variant: 'secondary' })}
    </div>
  </div>`;
}

function termsPage(): Html {
  return legalPage({
    title: 'Terms of use',
    subtitle: 'Short and plain. Last updated November 2026.',
    body: html`<div class="legal">
      ${part(
        'What myEST8 is',
        html`<p>
          myEST8 is a maintenance desk for small property management Agencies. It turns a Tenant’s text or email into a Maintenance Request, gets
          Quotes from Tradies and keeps the Property Manager’s decisions in one place. It is a university project, not a commercial service.
        </p>`,
      )}
      ${part(
        'Use it for what it is',
        html`<p>
          Don’t rely on myEST8 for an emergency or a safety-critical repair. If something is unsafe, call the emergency services or a licensed Tradie
          yourself. Keep your own record of a repair until it is finished.
        </p>`,
      )}
      ${part(
        'Your Agency’s account',
        html`<p>
          Only Property Managers have accounts. Give an email address you can receive mail at, and keep your password to yourself. Anything done with the
          Agency’s account is the Agency’s responsibility.
        </p>`,
      )}
      ${part(
        'People your Agency adds',
        html`<p>
          myEST8 texts and emails Tenants, Tradies and Owners using the contact details your Agency enters. Only add people who expect to hear
          from the Agency, and tell them what it is.
        </p>`,
      )}
      ${part(
        'What it promises',
        html`<p>
          This is a student project: it may be unavailable, may lose data, or may send a message twice. It comes as it is, with no warranty. Nothing here
          limits a right the law gives you and cannot be excluded.
        </p>`,
      )}
      ${part(
        'Ending it',
        html`<p>Stop using myEST8 at any time. To delete an Agency’s account and its data, ask the Property Manager who created it.</p>
          <p>The demo Agencies are fictional. Don’t put real personal information in them.</p>`,
      )}
      ${part('Changes', html`<p>These terms change as the project does. The date at the top says when they last changed.</p>`)}
      ${ending()}
    </div>`,
  });
}

function privacyPage(): Html {
  return legalPage({
    title: 'Privacy Policy',
    subtitle: 'What myEST8 keeps, and who sees it. Last updated November 2026.',
    body: html`<div class="legal">
      ${part(
        'What it keeps',
        html`<p>To run a repair, myEST8 keeps:</p>
          <ul>
            <li>the Property Manager’s name, work email, password (stored only as a hash), Agency name and time zone;</li>
            <li>the Properties, Tenants, Tradies, Owners and Building Managers the Agency adds, with their contact details;</li>
            <li>the messages and photos people send to the Agency’s numbers and upload links;</li>
            <li>the Maintenance Requests, Tickets, Quotes, visits and approvals made from them.</li>
          </ul>`,
      )}
      ${part(
        'Why it keeps it',
        html`<p>
          To show the Property Manager what needs a decision, to send the messages a repair needs, and to keep the repair’s record for the Agency.
        </p>`,
      )}
      ${part(
        'Who sees it',
        html`<p>
          The Agency’s Property Managers see its records. The Tenant, Tradie or Owner involved in a repair gets the messages about it. The text
          and email services the Agency connects (for example Twilio for texts, and SendGrid, Resend or Gmail for email) carry those messages and see the
          address they go to. The database and hosting providers that run myEST8 store the data. myEST8 does not sell it or use it for advertising.
        </p>`,
      )}
      ${part(
        'How long it keeps it',
        html`<p>
          For as long as the Agency’s account is open. Removing a person stops their contact details reaching the Agency, but their past Tickets stay on
          the repair’s record.
        </p>`,
      )}
      ${part(
        'Your choices',
        html`<p>
          Ask the Property Manager who added you to correct or delete your details, or for a copy of what the Agency holds. A Property Manager can remove
          a Tenant, Tradie or Owner from the Agency.
        </p>`,
      )}
      ${part(
        'Cookies',
        html`<p>
          One session cookie after a Property Manager signs in, so the next page knows them. It is HttpOnly and ends after 12 hours without a visit. There
          are no advertising or tracking cookies.
        </p>`,
      )}
      ${part(
        'Security',
        html`<p>
          Passwords are kept as hashes, and sessions expire. No system is perfectly secure, and this one is a student project: treat it with care, and
          don’t put sensitive personal information in a demo.
        </p>`,
      )}
      ${part(
        'Contact',
        html`<p>There is no support desk. Ask the Property Manager whose Agency you are dealing with.</p>`,
      )}
      ${ending()}
    </div>`,
  });
}
