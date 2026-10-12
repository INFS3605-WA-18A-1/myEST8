// One Maintenance Request for review at /requests/:issueId: the Tenant's answers,
// photos and checks, with Confirm, Reject and Change Urgency. The forms post to the
// dashboard's /requests endpoints, which redirect back to the dashboard.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { URGENCIES } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { COLLEAGUES_ONLY, shareButton, shareUrl } from '../share.ts';
import { shellInfo } from '../shell.ts';
import { badge, button, dl, emptyState, field, flashFrom, formatWhen, humanise, linkButton, page, photoGrid, postButton, section, urgencyBadge, type Html, type Tone } from '../ui.ts';
import { PHOTO_FLAG } from './dashboard.ts';

type Dashboard = Awaited<ReturnType<PropertyManagerActions['dashboard']>>;
type MaintenanceRequest = Dashboard['maintenanceRequests'][number];
type Photo = MaintenanceRequest['photos'][number];

const IMAGE_CHECK: Record<NonNullable<MaintenanceRequest['imageMatch']>['result'], [string, Tone]> = {
  matches: ['Photos match the description', 'success'],
  does_not_match: ["Photos don't match the description", 'error'],
  unclear: ['Photo check unclear', 'warning'],
};

/** The Maintenance Request review page under /requests. */
export function requestPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/:issueId{[0-9]+}', async (c) => {
    const { actions, pm } = c.var;
    const issueId = Number(c.req.param('issueId'));
    const request = (await actions.dashboard({ filter: 'all' })).maintenanceRequests.find((r) => r.issueId === issueId);
    const flash = flashFrom(c.req.url);
    if (!request) {
      const body = emptyState('There is no Maintenance Request waiting for you with that number.', linkButton('Back to the dashboard', '/'));
      return c.html(page({ title: 'Maintenance Request not found', pm, active: 'dashboard', flash, shell: shellInfo(c), body }), 404);
    }
    const { timeZone } = actions.agency();
    return c.html(
      page({
        title: 'Maintenance Request',
        pm,
        active: 'dashboard',
        flash,
        shell: shellInfo(c),
        actions: html`${linkButton('Back to the dashboard', '/', { variant: 'ghost', size: 'sm' })}${shareButton({
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

function review(r: MaintenanceRequest, timeZone: string): Html {
  const answer = (value: string | null) => value ?? 'Not answered';
  return html`
    ${section({
      title: 'The report',
      id: 'request',
      body: dl([
        ['Property', r.propertyAddress],
        ['Tenant', r.tenantName],
        ['Property Manager', r.propertyManager],
        ['Reported', formatWhen(r.reportedAt, timeZone)],
        ['Trade', humanise(r.trade)],
        ['Urgency', urgencyBadge(r.urgency)],
        ['Description', r.description],
      ]),
    })}
    ${section({
      title: 'Answers',
      body: dl([
        ['Where', answer(r.answers.location)],
        ['Started', answer(r.answers.started)],
        ['Getting worse', r.answers.worsening ? humanise(r.answers.worsening) : 'Not answered'],
        ['Usually home', r.answers.availability ? humanise(r.answers.availability) : 'Not answered'],
      ]),
    })}
    ${section({
      title: 'Photos',
      body: r.photos.length
        ? photoGrid(r.photos.map((p) => ({ src: `/files/${p.fileId}`, caption: photoCaption(p) })))
        : emptyState(r.noPhotos ? 'No photos: the Tenant sent none within 48 hours.' : 'No photos yet.'),
    })}
    ${section({ title: 'Checks', body: checks(r) })}
    ${section({ title: 'Decide', body: decide(r) })}
  `;
}

/** What the metadata check found, in words. Missing metadata never counts against the Tenant. */
function photoCaption(p: Photo): string {
  if (p.metadata === 'no_metadata') return 'No metadata';
  if (p.metadata === 'ok') return 'Metadata matches the report';
  return `Flagged: ${p.reasons.map((r) => PHOTO_FLAG[r] ?? humanise(r)).join(', ')}`;
}

function checks(r: MaintenanceRequest): Html {
  const flags = [
    ...(r.checkUrgency ? [badge('Check urgency', 'warning')] : []),
    ...(r.checkTrade ? [badge('Check trade', 'warning')] : []),
    ...(r.noPhotos ? [badge('No photos', 'warning')] : []),
  ];
  return html`<div class="flex flex-wrap gap-1">${flags.length ? flags : html`<span class="text-sm text-muted">Nothing to check.</span>`}</div>
    ${imageCheck(r.imageMatch)}`;
}

function imageCheck(match: MaintenanceRequest['imageMatch']): Html {
  if (!match) return html``;
  const [label, tone] = IMAGE_CHECK[match.result];
  return html`<p class="mt-2">${badge(label, tone)} ${match.reason}</p>`;
}

/** Confirm, Reject and Change Urgency: the same endpoints and field names as the dashboard used. */
function decide(r: MaintenanceRequest): Html {
  const base = `/requests/${r.issueId}`;
  return html`<div class="grid gap-4 md:grid-cols-3">
    <div>${postButton(`${base}/confirm`, 'Confirm')}</div>
    <form method="post" action="${base}/reject">
      ${field({ label: 'Reason for the Tenant', name: 'reason', id: `reason-${r.issueId}`, required: true, placeholder: 'Why this is rejected' })}
      ${button('Reject', { variant: 'danger', size: 'sm' })}
    </form>
    <form method="post" action="${base}/urgency">
      ${field({
        label: 'Urgency',
        name: 'urgency',
        id: `urgency-${r.issueId}`,
        type: 'select',
        value: r.urgency,
        options: URGENCIES.map((u) => ({ value: u, label: humanise(u) })),
        hint: "Choosing Urgent turns this into an Urgent Repair: the Tenant is reminded to arrange it with a Nominated Tradie and claim it back from the Property Owner. It won't become a Ticket.",
      })}
      ${button('Change Urgency', { variant: 'secondary', size: 'sm' })}
    </form>
  </div>`;
}
