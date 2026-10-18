// Maintenance Requests waiting for review: the list at /requests, and one request
// at /requests/:issueId. The review reads Summary first (tinted "Filled in by AI" while
// the AI wrote it, with a pencil to edit), then one photo strip, then the Tenant's
// answers; Decide sits beside it from 1024px and under the Summary on a phone. The
// confirm, reject and urgency forms post to the dashboard's /requests endpoints with a
// `return` path; editing the Summary posts to /requests/:issueId/summary.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { URGENCIES } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { doubtsPhotos, passedChecks, photoCaption, requestFlags, type Check } from '../request-checks.ts';
import { formAction, text } from '../forms.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import { aiFilled, badge, button, countSentence, emptyState, field, flashFrom, formatAge, formatWhen, humanise, linkButton, page, photoGrid, postButton, queueRow, section, segmented, urgencyBadge, type Html } from '../ui.ts';

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
        active: 'tickets',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        subtitle: 'Maintenance Requests that passed the automatic checks and are waiting for you to confirm or reject.',
        controls: segmented([
          { label: 'Mine', href: '/requests', active: !all },
          { label: 'All', href: '/requests?filter=all', active: all },
        ]),
        body: html`
          ${countSentence([
            { label: 'Maintenance Requests to review', one: 'Maintenance Request to review', count: requests.length, href: '#requests', decision: true },
            { label: 'to check for Urgency', count: requests.filter((r) => r.checkUrgency).length, href: '#requests' },
            { label: 'without photos', one: 'without photos', count: requests.filter((r) => r.noPhotos).length, href: '#requests' },
          ])}
          ${section({ title: 'Waiting for review', id: 'requests', body: requestList(requests, now, all) })}
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
      return c.html(page({ title: 'Maintenance Request not found', pm, active: 'tickets', flash, shell: await shellInfo(c), body }), 404);
    }
    const { timeZone } = actions.agency();
    const lead = headline(request);
    return c.html(
      page({
        title: 'Maintenance Request',
        pm,
        active: 'tickets',
        flash,
        shell: await shellInfo(c),
        actions: html`${linkButton('Back to Requests', '/requests', { variant: 'ghost', size: 'sm' })}${shareButton({
          title: `Maintenance Request: ${lead}`,
          text: `Maintenance Request at ${request.propertyAddress}, waiting for review: ${lead}`,
          url: shareUrl(c, `/requests/${issueId}`),
          note: COLLEAGUES_ONLY,
        })}`,
        body: review(request, timeZone, c.req.query('edit') === 'summary'),
      }),
    );
  });

  // Edit the Summary without confirming. Blank or over 160 characters is refused with the reason.
  pages.post('/:issueId{[0-9]+}/summary', async (c) => {
    const issueId = Number(c.req.param('issueId'));
    return formAction(c, `/requests/${issueId}?edit=summary`, async (form) => {
      await c.var.actions.editSummary({ issueId }, text(form, 'summary'));
      return { ok: 'Summary saved.', redirect: `/requests/${issueId}` };
    });
  });

  return pages;
}

/** The line a request leads with: its Summary, or the Tenant's description when there is none yet. */
function headline(r: Pick<MaintenanceRequest, 'summary' | 'description'>): string {
  return r.summary?.trim() || r.description;
}

/** Urgent before High before Routine, then oldest first within an Urgency. */
export function byUrgency<T extends { urgency: string; reportedAt: string }>(requests: T[]): T[] {
  const rank = (u: string) => (URGENCIES as readonly string[]).indexOf(u);
  return [...requests].sort((a, b) => rank(a.urgency) - rank(b.urgency) || a.reportedAt.localeCompare(b.reportedAt));
}

/** Each request leads with its Summary, then the address, its badges, who reported it and when, with Confirm or Review. */
function requestList(requests: MaintenanceRequest[], now: Date, all: boolean): Html {
  if (!requests.length) {
    return emptyState(
      'No Maintenance Requests waiting for you. A Tenant’s report lands here once its photos are in, or after 48 hours without them.',
      all ? undefined : linkButton('Show all Maintenance Requests', '/requests?filter=all'),
    );
  }
  return html`<div class="request-list grid gap-2">
    ${requests.map((r) =>
      queueRow({
        href: `/requests/${r.issueId}`,
        thumb: r.photos[0] ? html`<img src="/files/${r.photos[0].fileId}" alt="Photo of the issue" width="56" height="56" loading="lazy" />` : undefined,
        title: headline(r),
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
 * The review: the Summary leads, then the photo strip and the Tenant's answers. Decide
 * (and any Urgency or Trade to check) sits beside them from 1024px, sticky, and under
 * the Summary on phones.
 */
function review(r: MaintenanceRequest, timeZone: string, editing: boolean): Html {
  const toCheck = sideChecks(r);
  return html`<div class="request-review">
    <section class="section request-lead" id="summary" aria-labelledby="summary-title">
      <h2 class="section-title" id="summary-title">Summary</h2>
      ${summary(r, editing)}
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
      ${toCheck ? section({ title: 'To check', id: 'checks', body: toCheck }) : ''}
      ${section({ title: 'Decide', id: 'decide', body: decide(r, editing) })}
    </div>
    <div class="request-details">
      ${section({ title: 'Photos', id: 'photos', body: photoStrip(r) })}
      ${section({ title: "The Tenant's answers", id: 'answers', body: answers(r) })}
    </div>
  </div>`;
}

/**
 * The Summary, or the Tenant's description until there is one. Tinted "Filled in by AI"
 * only while the AI wrote it. The pencil opens the edit form in the page (no JavaScript).
 */
function summary(r: MaintenanceRequest, editing: boolean): Html {
  const id = summaryFormId(r);
  if (editing) {
    return html`<form method="post" action="/requests/${r.issueId}/summary" id="${id}" class="request-summary-form">
      ${field({
        label: 'Summary',
        name: 'summary',
        id: `summary-${r.issueId}`,
        type: 'textarea',
        rows: 3,
        required: true,
        value: r.summary ?? '',
        placeholder: r.description,
        hint: 'One plain line, up to 160 characters. Say only what the Tenant told us.',
      })}
      <div class="request-summary-actions">${button('Save Summary')}${linkButton('Cancel', `/requests/${r.issueId}`, { variant: 'ghost' })}</div>
    </form>`;
  }
  const pencil = html`<a href="/requests/${r.issueId}?edit=summary#summary" class="icon-btn" aria-label="Edit Summary" title="Edit Summary">${icon('pencil-simple', { size: 'size-[18px]' })}</a>`;
  const line = html`<p class="request-issue">${headline(r)}</p>`;
  if (r.summary && r.summaryBy === 'ai') return aiFilled(line, { edit: pencil });
  return html`<div class="request-summary-plain">${line}${pencil}</div>
    ${r.summary ? '' : html`<p class="field-hint">The Tenant's own words. No Summary has been written yet.</p>`}`;
}

const summaryFormId = (r: Pick<MaintenanceRequest, 'issueId'>) => `summary-form-${r.issueId}`;

/** Short label and value pairs, the value right beside its label. */
function facts(items: [string, Html | string][], className = ''): Html {
  return html`<dl class="request-facts ${className}">
    ${items.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}
  </dl>`;
}

function answers(r: MaintenanceRequest): Html {
  const answer = (value: string | null, word = (v: string) => v) => (value ? word(value) : html`<span class="text-muted">Not answered</span>`);
  return facts([
    // The Summary leads, so the Tenant's own words are kept here.
    ...(r.summary ? ([['In their words', r.description]] as [string, string][]) : []),
    ['Where', answer(r.answers.location)],
    ['Started', answer(r.answers.started)],
    ['Getting worse', answer(r.answers.worsening, humanise)],
    ['Usually home', answer(r.answers.availability, humanise)],
  ]);
}

const photoCount = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`;

/**
 * One strip: the photos that came with the first message, then any uploaded since, each
 * with what its metadata check found; then what the image match found, in words.
 */
function photoStrip(r: MaintenanceRequest): Html {
  if (!r.photos.length) return emptyState(r.noPhotos ? 'No photos: the Tenant sent none within 48 hours.' : 'No photos yet.');
  const arrived = r.photos.slice(0, r.photosOnArrival);
  const uploaded = r.photos.slice(r.photosOnArrival);
  const group = (label: string, photos: typeof r.photos, offset: number) =>
    photos.length
      ? html`<div class="request-photo-group">
          <p class="request-photo-label">${label}</p>
          ${photoGrid(
            photos.map((p, i) => ({
              src: `/files/${p.fileId}`,
              alt: `Photo ${offset + i + 1} of ${r.photos.length}`,
              caption: p.metadata === 'flagged' ? html`<span class="request-photo-flagged">${photoCaption(p)}</span>` : photoCaption(p),
            })),
          )}
        </div>`
      : '';
  const results = [...requestFlags({ ...r, checkUrgency: false, checkTrade: false, noPhotos: false }), ...passedChecks(r)];
  return html`<div class="request-photos">
    ${group(`${photoCount(arrived.length)}, sent with the message`, arrived, 0)}
    ${group(`${photoCount(uploaded.length)}, uploaded`, uploaded, arrived.length)}
    ${results.length ? html`<ul class="request-checks" role="list">${results.map((c) => checkLine(c, c.tone === 'success'))}</ul>` : ''}
  </div>`;
}

/** The Urgency or Trade the classifier was unsure of, as flags. Null when there is neither. */
function sideChecks(r: MaintenanceRequest): Html | null {
  const flags = requestFlags({ ...r, noPhotos: false, photos: [], imageMatch: null });
  return flags.length ? html`<ul class="request-checks" role="list">${flags.map((f) => checkLine(f, false))}</ul>` : null;
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
 * be confirmed with right above it. While the Summary is being edited, Confirm submits
 * the edit with it. When the photos are in doubt, Confirm asks first in a disclosure,
 * so it works without JavaScript. Reject, with its reason, is folded away below.
 */
function decide(r: MaintenanceRequest, editing: boolean): Html {
  const base = `/requests/${r.issueId}`;
  const hintId = `urgency-${r.issueId}-hint`;
  const confirmButton = (label: string, block: boolean) =>
    editing
      ? html`<button type="submit" form="${summaryFormId(r)}" formaction="${base}/confirm" class="btn btn-primary${block ? ' btn-block' : ''}">${label}</button>`
      : html`<form method="post" action="${base}/confirm" class="${block ? 'block' : 'inline-flex'}">${button(label, { block })}</form>`;
  const confirm = doubtsPhotos(r)
    ? html`<details class="request-confirm-check">
        <summary class="btn btn-primary btn-block">Confirm</summary>
        <div class="request-confirm-body">
          <p>The photos were flagged by the checks. Look at them before you confirm.</p>
          ${confirmButton('Confirm anyway', false)}
        </div>
      </details>`
    : confirmButton('Confirm', true);
  return html`<div class="request-decide">
    <form method="post" action="${base}/urgency" class="request-urgency">
      <input type="hidden" name="return" value="${base}" />
      <label for="urgency-${r.issueId}" class="field-label">Urgency</label>
      <div class="request-urgency-row">
        <select id="urgency-${r.issueId}" name="urgency" class="select" aria-describedby="${hintId}">
          ${URGENCIES.map((u) => html`<option value="${u}" ${u === r.urgency ? 'selected' : ''}>${humanise(u)}</option>`)}
        </select>
        ${button('Change Urgency', { variant: 'secondary' })}
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
