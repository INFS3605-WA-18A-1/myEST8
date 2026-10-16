// Maintenance Requests waiting for review: the list at /requests, and one request
// at /requests/:issueId. The review page reads like the Ticket's docket: what the
// Tenant reported first, then the address; the Checks and the decision sit beside it
// (above the answers and photos on a phone). The forms post to the dashboard's
// /requests endpoints, with a `return` path so Reject and Change Urgency come back here.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { URGENCIES } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { doubtsPhotos, passedChecks, photoCaption, requestFlags, type Check } from '../request-checks.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import { badge, button, countStrip, emptyState, field, flashFrom, formatAge, formatWhen, humanise, linkButton, page, photoGrid, postButton, queueRow, section, segmented, urgencyBadge, type Html } from '../ui.ts';

type MaintenanceRequest = Awaited<ReturnType<PropertyManagerActions['requests']>>[number];

/** The Maintenance Request review page under /requests. */
export function requestPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const all = c.req.query('filter') === 'all';
    const requests = byUrgency(await actions.requests({ filter: all ? 'all' : 'mine' }));
    const now = actions.now();
    return c.html(
      page({
        title: 'Requests',
        pm,
        active: 'requests',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        subtitle: 'Maintenance Requests that passed the automatic checks and are waiting for you to confirm or reject.',
        controls: segmented([
          { label: 'Mine', href: '/requests', active: !all },
          { label: 'All', href: '/requests?filter=all', active: all },
        ]),
        body: html`
          ${countStrip([
            { label: 'Maintenance Requests to review', count: requests.length, href: '#requests', decision: true },
            { label: 'Check Urgency', count: requests.filter((r) => r.checkUrgency).length, href: '#requests' },
            { label: 'No photos', count: requests.filter((r) => r.noPhotos).length, href: '#requests' },
          ])}
          ${section({ title: 'Waiting for review', id: 'requests', body: requestList(requests, now) })}
        `,
      }),
    );
  });

  pages.get('/:issueId{[0-9]+}', async (c) => {
    const { actions, pm } = c.var;
    const issueId = Number(c.req.param('issueId'));
    const request = await actions.request(issueId);
    const flash = flashFrom(c.req.url);
    if (!request) {
      const body = emptyState('There is no Maintenance Request waiting for you with that number.', linkButton('Back to Requests', '/requests'));
      return c.html(page({ title: 'Maintenance Request not found', pm, active: 'requests', flash, shell: await shellInfo(c), body }), 404);
    }
    const { timeZone } = actions.agency();
    return c.html(
      page({
        title: 'Maintenance Request',
        pm,
        active: 'requests',
        flash,
        shell: await shellInfo(c),
        actions: html`${linkButton('Back to Requests', '/requests', { variant: 'ghost', size: 'sm' })}${shareButton({
          title: `Maintenance Request: ${request.description}`,
          text: `Maintenance Request at ${request.propertyAddress}, waiting for review: ${request.description}`,
          url: shareUrl(c, `/requests/${issueId}`),
          note: COLLEAGUES_ONLY,
        })}`,
        body: review(request, timeZone),
      }),
    );
  });

  return pages;
}

/** Urgent before High before Routine, then oldest first within an Urgency. */
export function byUrgency<T extends { urgency: string; reportedAt: string }>(requests: T[]): T[] {
  const rank = (u: string) => (URGENCIES as readonly string[]).indexOf(u);
  return [...requests].sort((a, b) => rank(a.urgency) - rank(b.urgency) || a.reportedAt.localeCompare(b.reportedAt));
}

/** Each request read like a docket: the issue, the address, then its badges, who reported it and when, with Confirm or Review. */
function requestList(requests: MaintenanceRequest[], now: Date): Html {
  if (!requests.length) return emptyState('No Maintenance Requests waiting for you.');
  return html`<div class="request-list grid gap-2">
    ${requests.map((r) =>
      queueRow({
        href: `/requests/${r.issueId}`,
        title: r.description,
        detail: r.propertyAddress,
        badges: [urgencyBadge(r.urgency), badge(humanise(r.trade)), ...requestFlags(r).map((f) => badge(f.label, f.tone))],
        meta: `${r.tenantName}, ${formatAge(r.reportedAt, now)}`,
        decision: true,
        actions: html`${postButton(`/requests/${r.issueId}/confirm`, 'Confirm', { size: 'sm' })}${linkButton('Review', `/requests/${r.issueId}`, { variant: 'secondary', size: 'sm' })}`,
      }),
    )}
  </div>`;
}

/**
 * The review: what the Tenant reported leads; Checks and Decide sit beside it from
 * 1024px (sticky) and straight under it on phones, before the answers and photos.
 */
function review(r: MaintenanceRequest, timeZone: string): Html {
  return html`<div class="request-review">
    <section class="section request-lead" id="request" aria-labelledby="request-title">
      <h2 class="section-title" id="request-title">What the Tenant reported</h2>
      <p class="request-issue">${r.description}</p>
      <p class="request-address"><a href="/properties/${r.propertyId}" class="link">${r.propertyAddress}</a></p>
      ${facts(
        [
          ['Tenant', r.tenantName],
          ['Reported', formatWhen(r.reportedAt, timeZone)],
          ['Property Manager', r.propertyManager],
        ],
        'request-meta',
      )}
    </section>
    <div class="request-side">
      ${section({ title: 'Checks', id: 'checks', body: checks(r) })}
      ${section({ title: 'Decide', id: 'decide', body: decide(r) })}
    </div>
    <div class="request-details">
      ${section({ title: "The Tenant's answers", id: 'answers', body: answers(r) })}
      ${section({ title: 'Photos', id: 'photos', body: photos(r) })}
    </div>
  </div>`;
}

/** Short label and value pairs, the value right beside its label. */
function facts(items: [string, Html | string][], className = ''): Html {
  return html`<dl class="request-facts ${className}">
    ${items.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}
  </dl>`;
}

function answers(r: MaintenanceRequest): Html {
  const answer = (value: string | null, word = (v: string) => v) => (value ? word(value) : html`<span class="text-muted">Not answered</span>`);
  return facts([
    ['Where', answer(r.answers.location)],
    ['Started', answer(r.answers.started)],
    ['Getting worse', answer(r.answers.worsening, humanise)],
    ['Usually home', answer(r.answers.availability, humanise)],
  ]);
}

/** The photos, each with what its metadata check found. A flagged photo's caption stands out. */
function photos(r: MaintenanceRequest): Html {
  if (!r.photos.length) return emptyState(r.noPhotos ? 'No photos: the Tenant sent none within 48 hours.' : 'No photos yet.');
  return photoGrid(
    r.photos.map((p) => ({
      src: `/files/${p.fileId}`,
      caption: p.metadata === 'flagged' ? html`<span class="request-photo-flagged">${photoCaption(p)}</span>` : photoCaption(p),
    })),
  );
}

/**
 * The flags to look at, prominent, then the checks that passed as quiet lines.
 * "Nothing to check." only when the checks found nothing either way.
 */
function checks(r: MaintenanceRequest): Html {
  const flags = requestFlags(r);
  const passed = passedChecks(r);
  if (!flags.length && !passed.length) return html`<p class="text-muted">Nothing to check.</p>`;
  return html`<ul class="request-checks" role="list">
    ${flags.map((f) => checkLine(f, false))}
    ${passed.map((f) => checkLine(f, true))}
  </ul>`;
}

function checkLine(c: Check, passed: boolean): Html {
  return html`<li class="${passed ? 'request-check-passed' : `request-flag is-${c.tone}`}">
    ${icon(passed ? 'check-circle' : 'warning', { size: 'size-[18px]' })}
    <div class="min-w-0">
      <p class="request-check-label">${c.label}</p>
      ${c.detail ? html`<p class="request-check-detail">${c.detail}</p>` : ''}
    </div>
  </li>`;
}

/**
 * Confirm is the one primary action, with the Urgency (changeable) and Trade it will
 * be confirmed with right above it. When the photos are in doubt, Confirm asks first
 * in a disclosure, so it works without JavaScript. Reject, with its reason, is folded
 * away below. The forms post to the dashboard's endpoints with their field names.
 */
function decide(r: MaintenanceRequest): Html {
  const base = `/requests/${r.issueId}`;
  const hintId = `urgency-${r.issueId}-hint`;
  const confirm = doubtsPhotos(r)
    ? html`<details class="request-confirm-check">
        <summary class="btn btn-primary btn-block">Confirm</summary>
        <div class="request-confirm-body">
          <p>The photos were flagged by the checks. Look at them before you confirm.</p>
          ${postButton(`${base}/confirm`, 'Confirm anyway')}
        </div>
      </details>`
    : html`<form method="post" action="${base}/confirm">${button('Confirm', { block: true })}</form>`;
  return html`<div class="request-decide">
    <form method="post" action="${base}/urgency" class="request-urgency">
      <input type="hidden" name="return" value="${base}" />
      <label for="urgency-${r.issueId}" class="field-label">Urgency</label>
      <div class="request-urgency-row">
        <select id="urgency-${r.issueId}" name="urgency" class="select" aria-describedby="${hintId}">
          ${URGENCIES.map((u) => html`<option value="${u}" ${u === r.urgency ? 'selected' : ''}>${humanise(u)}</option>`)}
        </select>
        ${button('Change Urgency', { variant: 'secondary', size: 'sm' })}
      </div>
      <p id="${hintId}" class="field-hint">Urgent makes this an Urgent Repair, not a Ticket: the Tenant is reminded to call a Nominated Tradie.</p>
    </form>
    ${facts([['Trade', badge(humanise(r.trade))]])}
    ${confirm}
    <details class="request-reject">
      <summary>Reject this Maintenance Request…</summary>
      <form method="post" action="${base}/reject" class="request-reject-form">
        <input type="hidden" name="return" value="/requests" />
        ${field({ label: 'Reason for the Tenant', name: 'reason', id: `reason-${r.issueId}`, type: 'textarea', rows: 3, required: true, placeholder: 'Why this is rejected' })}
        ${button('Reject', { variant: 'danger', size: 'sm' })}
      </form>
    </details>
  </div>`;
}
