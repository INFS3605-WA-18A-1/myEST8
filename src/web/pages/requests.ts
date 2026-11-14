// One Maintenance Request waiting for review, at /requests/:issueId; the list of them is
// on /tickets, and /requests sends the Property Manager there. The review reads Summary
// first (tinted "Filled in by AI" while the AI wrote it, with a pencil to edit), then one
// photo strip, then the Tenant's answers; Decide and the follow-up panel sit beside it from
// 1024px and under the Summary on a phone. The confirm, reject and urgency forms post to the
// dashboard's /requests endpoints with a `return` path; editing the Summary posts to
// /requests/:issueId/summary. The follow-up panel posts to /requests/:issueId/follow-up/draft
// (which shows the page again with the draft) and /follow-up/send (which redirects).

import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, URGENCIES } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { icon } from '../icons.ts';
import { doubtsPhotos, passedChecks, photoCaption, requestFlags, type Check } from '../request-checks.ts';
import { formAction, text, type FormValues } from '../forms.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import { aiFilled, alert, button, editSwap, emptyState, entityLink, field, flashFrom, formatAge, formatWhen, humanise, inlineEdit, linkButton, page, photoGrid, section, urgencyBadge, withFlash, type Html } from '../ui.ts';
import { saveDetails, valueOf, type DetailsEdit } from './onboarding-forms.ts';

type MaintenanceRequest = Awaited<ReturnType<PropertyManagerActions['requests']>>[number];

/**
 * The follow-up panel after a post: the notes as typed, the draft once there is one (`byAI` says
 * whether the model wrote it), and why a field was refused. Text kept after a refused send has no
 * `byAI`: the Property Manager has been editing it, so it is theirs.
 */
type FollowUp = { notes: string; text?: string; byAI?: boolean; errors?: Record<string, string> };

const NO_AI_DRAFT = "AI drafting isn't available right now. Your notes are below: edit them and send, or try again.";

/** The Maintenance Request review page under /requests, and /requests itself sending on to /tickets. */
export function requestPages() {
  const pages = new Hono<WebEnv>();

  // The list moved to /tickets, with the open Tickets under it.
  pages.get('/', (c) => c.redirect(`/tickets${new URL(c.req.url).search}`, 303));

  pages.get('/:issueId{[0-9]+}', (c) => reviewPage(c, Number(c.req.param('issueId'))));

  // Edit the Summary without confirming. Blank or over 160 characters is refused: the page comes
  // back with the Summary open as typed and the reason under it.
  pages.post('/:issueId{[0-9]+}/summary', async (c) => {
    const issueId = Number(c.req.param('issueId'));
    return saveDetails(c, {
      profile: `/requests/${issueId}`,
      ok: 'Summary saved.',
      save: (form) => c.var.actions.editSummary({ issueId }, text(form, 'summary')),
      show: (refused) => reviewPage(c, issueId, { summary: refused, status: 400 }),
    });
  });

  // Draft the follow-up from the notes. The page comes back with the draft (and the notes still in
  // their field) rather than redirecting, so a refusal under a field is shown there too.
  pages.post('/:issueId{[0-9]+}/follow-up/draft', async (c) => {
    const issueId = Number(c.req.param('issueId'));
    const notes = text((await c.req.parseBody({ all: true })) as FormValues, 'notes');
    try {
      const { text: draft, byAI } = await c.var.actions.draftFollowUp(issueId, notes);
      return await reviewPage(c, issueId, { followUp: { notes, text: draft, byAI } });
    } catch (error) {
      return refusedFollowUp(c, issueId, error, { notes });
    }
  });

  // Send the text as it is in the field. Blank or too long comes back under the field with the text kept.
  pages.post('/:issueId{[0-9]+}/follow-up/send', async (c) => {
    const issueId = Number(c.req.param('issueId'));
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const [notes, sending] = [text(form, 'notes'), text(form, 'text')];
    try {
      const tenant = await c.var.actions.sendFollowUp(issueId, sending);
      return c.redirect(withFlash(`/requests/${issueId}`, 'ok', `Follow-up sent to ${tenant}`), 303);
    } catch (error) {
      return refusedFollowUp(c, issueId, error, { notes, text: sending });
    }
  });

  return pages;
}

/** The review page itself, with the follow-up panel in the state a post left it in. */
async function reviewPage(c: Context<WebEnv>, issueId: number, o: { followUp?: FollowUp; summary?: DetailsEdit; status?: 200 | 400 } = {}) {
  const { actions, pm } = c.var;
  const request = await actions.request(issueId);
  const flash = flashFrom(c.req.url);
  if (!request) {
    const body = emptyState('There is no Maintenance Request waiting for you with that number.', linkButton('Back to Tickets', '/tickets'));
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
      back: { label: 'Tickets', href: '/tickets' },
      titleExtra: urgencyBadge(request.urgency),
      subtitle: `${humanise(request.trade)} at ${request.propertyAddress} · reported ${formatAge(request.reportedAt, actions.now())} by ${request.tenantName}`,
      actions: shareButton({
        title: `Maintenance Request: ${lead}`,
        text: `Maintenance Request at ${request.propertyAddress}, waiting for review: ${lead}`,
        url: shareUrl(c, `/requests/${issueId}`),
        note: COLLEAGUES_ONLY,
      }),
      body: review(request, timeZone, { editing: !!o.summary || c.req.query('edit') === 'summary', refused: o.summary }, o.followUp),
    }),
    o.status ?? 200,
  );
}

/** A refused follow-up: back on the page with the reason under its field, or with the reason as the flash when it isn't about one. */
function refusedFollowUp(c: Context<WebEnv>, issueId: number, error: unknown, followUp: FollowUp) {
  if (!(error instanceof ActionError)) throw error;
  if (Object.keys(error.fields).length) return reviewPage(c, issueId, { followUp: { ...followUp, errors: error.fields }, status: 400 });
  return c.redirect(withFlash(`/requests/${issueId}`, 'error', error.message), 303);
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

/**
 * The review: the Summary leads, then the photo strip and the Tenant's answers. Decide
 * (with any Urgency or Trade to check) and the follow-up panel sit beside them from
 * 1024px and under the Summary on phones.
 */
function review(r: MaintenanceRequest, timeZone: string, edit: SummaryEdit, followUp?: FollowUp): Html {
  const toCheck = sideChecks(r);
  return html`<div class="request-review">
    <section class="ticket-hero request-lead" id="summary" aria-labelledby="summary-title">
      <div class="ticket-hero-card request-lead-card">
        <div class="ticket-hero-text">
          <h2 class="sr-only" id="summary-title">Summary</h2>
          ${summary(r, edit)}
          <p class="ticket-hero-meta">
            <span class="ticket-chip">${entityLink('property', r.propertyAddress, `/properties/${r.propertyId}`)}</span>
            <span class="ticket-state is-waiting">Waiting for you</span>
          </p>
        </div>
        <div class="ticket-ring-wrap">
          <div class="ticket-ring" style="--pct:0"><span class="ticket-ring-label">To confirm</span></div>
          <p class="ticket-ring-note">Step 1 of 2<br />Then it opens as a Ticket</p>
        </div>
      </div>
      ${tiles(
        [
          ['Tenant', entityLink('tenant', r.tenantName, `/tenants/${r.tenantId}`)],
          ['Reported', formatWhen(r.reportedAt, timeZone)],
          ['Property Manager', r.propertyManager],
        ],
        'request-meta',
      )}
    </section>
    <div class="request-side">
      ${peopleCard(r)}
      ${toCheck ? section({ title: 'To check', id: 'checks', body: toCheck }) : ''}
      ${section({ title: 'Decide', id: 'decide', actions: html`<span class="request-needs">Needs you</span>`, body: decide(r) })}
      ${section({ title: `Follow up with ${firstName(r.tenantName)}`, id: 'follow-up', body: followUpForm(r, followUp) })}
    </div>
    <div class="request-details">
      ${section({ title: 'Photos', id: 'photos', body: photoStrip(r) })}
      ${section({ title: "The Tenant's answers", id: 'answers', body: answers(r) })}
    </div>
  </div>`;
}

/** Two letters for an avatar: the first letters of the first two words ("Lena Le" is LL). */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** Who is on the request: the Tenant who reported it and the Property Manager who decides. */
function peopleCard(r: MaintenanceRequest): Html {
  const people = [
    { name: r.tenantName, role: 'Tenant' },
    { name: r.propertyManager, role: 'Property Manager' },
  ];
  return html`<section class="ticket-people-card" aria-label="People on this Maintenance Request">
    <h2 class="ticket-people-title">People on this request</h2>
    <ul class="ticket-avatars" role="list">
      ${people.map((p) => html`<li class="ticket-avatar" title="${p.name}, ${p.role}"><span aria-hidden="true">${initials(p.name)}</span><span class="sr-only">${p.name}, ${p.role}</span></li>`)}
    </ul>
  </section>`;
}

/** Whether the Summary's editor is open, and the refused save it shows again. */
type SummaryEdit = { editing: boolean; refused?: DetailsEdit };

/**
 * The Summary, or the Tenant's description until there is one, editing in place: the pen turns the
 * line into a textarea in the same type. Tinted "Filled in by AI" only while the AI wrote it. The form
 * is also the one Confirm sends, so an edited Summary goes with it; while it is closed its textarea is
 * disabled and Confirm sends no Summary. A save swaps "The Tenant's answers" too (their own words move
 * there once a Summary leads).
 */
function summary(r: MaintenanceRequest, edit: SummaryEdit): Html {
  const id = `summary-${r.issueId}`;
  const error = edit.refused ? (edit.refused.errors.summary ?? edit.refused.message) : undefined;
  const control = field({
    label: 'Summary',
    name: 'summary',
    id,
    type: 'textarea',
    rows: 2,
    required: true,
    bare: true,
    className: 'inline-edit-headline',
    value: edit.refused ? valueOf(edit.refused.values, 'summary') : (r.summary ?? ''),
    placeholder: r.description,
    hint: 'One plain line, up to 160 characters. Say only what the Tenant told us.',
    error,
  });
  const line = html`<label class="sr-only" for="${id}">Summary</label>${editSwap(html`<p class="request-issue">${headline(r)}</p>`, control)}`;
  const ai = r.summary && r.summaryBy === 'ai';
  return inlineEdit({
    id: summaryBlockId(r),
    tag: 'div',
    label: 'Summary',
    formId: summaryFormId(r),
    action: `/requests/${r.issueId}/summary`,
    edit: { label: 'Edit Summary', href: `/requests/${r.issueId}?edit=summary#summary` },
    cancel: `/requests/${r.issueId}#summary`,
    save: 'Save Summary',
    editing: edit.editing,
    refresh: ['answers'],
    view: (tools) =>
      ai
        ? aiFilled(line, { edit: tools })
        : html`<div class="request-summary-plain"><div class="min-w-0 flex-1">${line}</div>${tools}</div>
            ${r.summary ? '' : html`<p class="field-hint inline-edit-read">The Tenant's own words. No Summary has been written yet.</p>`}`,
  });
}

const summaryBlockId = (r: Pick<MaintenanceRequest, 'issueId'>) => `summary-edit-${r.issueId}`;
const summaryFormId = (r: Pick<MaintenanceRequest, 'issueId'>) => `summary-form-${r.issueId}`;

/** Label and value pairs as small tiles, the label quiet above its value. */
function tiles(items: [string, Html | string][], className = ''): Html {
  return html`<dl class="request-facts ${className}">
    ${items.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}
  </dl>`;
}

function answers(r: MaintenanceRequest): Html {
  const answer = (value: string | null, word = (v: string) => v) => (value ? word(value) : html`<span class="text-muted">Not answered</span>`);
  return tiles([
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
function decide(r: MaintenanceRequest): Html {
  const base = `/requests/${r.issueId}`;
  const hintId = `urgency-${r.issueId}-hint`;
  // Confirm sends the Summary's form, so a Summary being edited goes with it (closed, it sends none).
  const confirmButton = (label: string, block: boolean) =>
    html`<button type="submit" form="${summaryFormId(r)}" formaction="${base}/confirm" class="btn btn-success${block ? ' btn-block' : ''}">${label}</button>`;
  const confirm = doubtsPhotos(r)
    ? html`<details class="request-confirm-check">
        <summary class="btn btn-success btn-block">Confirm</summary>
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
    ${tiles([['Trade', humanise(r.trade)]], 'request-trade')}
    ${confirm}
    <details class="request-reject">
      <summary>Reject this Maintenance Request…</summary>
      <form method="post" action="${base}/reject" class="request-reject-form">
        <input type="hidden" name="return" value="/tickets" />
        ${field({ label: 'Reason for the Tenant', name: 'reason', id: `reason-${r.issueId}`, type: 'textarea', rows: 3, required: true, placeholder: 'Why this is rejected' })}
        ${button('Reject', { variant: 'destructive', size: 'sm' })}
      </form>
    </details>
  </div>`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0]!;

/**
 * Notes, then Draft with AI; the draft appears under it once there is one, in its own field with
 * Send. One form, so the notes stay put for a redraft: Send posts the same fields to /send.
 * Drafting by AI is marked and says to check it; with no AI the notes are the draft, and the
 * note says so. Both buttons are Secondary: Confirm stays the page's one primary action.
 */
function followUpForm(r: MaintenanceRequest, followUp: FollowUp = { notes: '' }): Html {
  const base = `/requests/${r.issueId}/follow-up`;
  const name = firstName(r.tenantName);
  const message = field({
    label: `Message to ${name}`,
    name: 'text',
    id: `follow-up-text-${r.issueId}`,
    type: 'textarea',
    rows: 8,
    value: followUp.text,
    error: followUp.errors?.text,
  });
  const draft =
    followUp.text === undefined
      ? ''
      : html`${followUp.byAI === false ? alert(NO_AI_DRAFT) : ''}
        ${followUp.byAI ? aiFilled(message, { label: 'Written by AI. Check it before you send.' }) : message}
        <div>${button(`Send to ${name}`, { variant: 'secondary', formaction: `${base}/send#follow-up` })}</div>`;
  return html`<form method="post" action="${base}/draft#follow-up" class="request-follow-up">
    ${field({
      label: `What do you want to say to ${name}?`,
      name: 'notes',
      id: `follow-up-notes-${r.issueId}`,
      type: 'textarea',
      rows: 4,
      value: followUp.notes,
      hint: 'In your own words, up to 1000 characters. AI writes it up as a message, and nothing is sent until you press Send.',
      error: followUp.errors?.notes,
    })}
    <div>${button('Draft with AI', { variant: 'secondary', icon: 'sparkle' })}</div>
    ${draft}
  </form>`;
}
