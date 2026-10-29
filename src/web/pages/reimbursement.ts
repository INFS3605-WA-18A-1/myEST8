// One Reimbursement Request under /reimbursements/:id (the Urgent Repair's id): the
// Tenant's claim to be paid back for an Urgent Repair they arranged. Its header, where
// it stands (Reported, Receipt received, Forwarded to Property Owner, Reimbursed), the
// one thing to do next (send the link again, check and forward the receipt, mark it
// reimbursed), the receipts, the timeline and the messages on its issue. Reads and
// changes go only through c.var.actions, and every POST goes back to the page.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError, notFound } from '../../shared.ts';
import type { UrgentRepairStatus } from '../../tickets.ts';
import type { WebEnv } from '../env.ts';
import { cents, formAction, text, type FormValues } from '../forms.ts';
import { collapsible, messageLog } from '../messages.ts';
import { shellInfo } from '../shell.ts';
import {
  alert,
  badge,
  button,
  card,
  contactLink,
  emptyState,
  entityLink,
  field,
  flashFrom,
  formatAge,
  formatMoney,
  formatWhen,
  linkButton,
  page,
  photoGrid,
  postButton,
  steps,
  timeline,
  type Html,
  type Tone,
} from '../ui.ts';

type Reimbursement = Awaited<ReturnType<PropertyManagerActions['reimbursement']>>;
type Receipt = Reimbursement['receipts'][number];
type TimelineEvent = Reimbursement['timeline'][number];

/** Each status in the words every screen uses (Approvals, the dashboard, this page), with its badge tone. */
const REIMBURSEMENT_STATUS: Record<UrgentRepairStatus, [string, Tone]> = {
  reminder_sent: ['Awaiting receipt', 'neutral'],
  receipt_received: ['Awaiting your review', 'warning'],
  receipt_forwarded: ['With Property Owner', 'info'],
  reimbursed: ['Reimbursed', 'success'],
};

/** A Reimbursement Request's status as a badge. */
export function reimbursementBadge(status: UrgentRepairStatus, o: { wrap?: boolean } = {}): Html {
  const [label, tone] = REIMBURSEMENT_STATUS[status];
  return badge(label, tone, o);
}

/** Receipts that open as a picture; the rest (PDFs) are links. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif']);
const nothing = html``;

/** The Reimbursement Request page and its actions. */
export function reimbursementPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', (c) => c.redirect('/approvals#reimbursements', 303));

  pages.get('/:id', async (c) => {
    const { actions, pm } = c.var;
    const flash = flashFrom(c.req.url);
    const request = await find(actions, c.req.param('id'));
    if (!request) {
      const body = emptyState('There is no such Reimbursement Request in your Agency.', linkButton('Back to Approvals', '/approvals'));
      return c.html(page({ title: 'Reimbursement Request not found', pm, active: 'approvals', flash, body, shell: await shellInfo(c) }), 404);
    }
    const { timeZone } = actions.agency();
    return c.html(
      page({
        title: `Reimbursement Request #${request.urgentRepairId}`,
        pm,
        active: 'approvals',
        flash,
        shell: await shellInfo(c),
        subtitle: html`An Urgent Repair ${request.tenant.name} arranged. <a class="link" href="/approvals#reimbursements">All Reimbursement Requests</a>`,
        body: body(request, timeZone, actions.now()),
      }),
    );
  });

  onPost(pages, '/:id/forward', async (actions, request, form) => {
    const typed = text(form, 'amount');
    const amountCents = typed ? cents(form, 'amount', 'the amount') : null;
    await actions.forwardReimbursement(request.urgentRepairId, { amountCents });
    const after = await actions.reimbursement(request.urgentRepairId);
    const over = after.overLimit ? ` The amount is over the ${formatMoney(after.limitCents)} limit for an Urgent Repair.` : '';
    return `Forwarded to ${after.owner.name}, the Property Owner, with you copied in.${over}`;
  });

  onPost(pages, '/:id/reimbursed', async (actions, request) => {
    await actions.markReimbursed(request.urgentRepairId);
    return `Marked reimbursed. ${request.tenant.name} has been told.`;
  });

  onPost(pages, '/:id/resend', async (actions, request) => {
    await actions.resendReceiptLink(request.urgentRepairId);
    return `Receipt link sent to ${request.tenant.name} again`;
  });

  onPost(pages, '/:id/read', async (actions, request) => {
    await actions.markReimbursementRead(request.urgentRepairId);
    return 'Messages marked read';
  });

  return pages;
}

/** POST `path`: loads the Reimbursement Request, runs `run`, and redirects back with its message or the refusal. */
function onPost(
  pages: Hono<WebEnv>,
  path: string,
  run: (actions: PropertyManagerActions, request: Reimbursement, form: FormValues) => Promise<string>,
) {
  pages.post(path, (c) => {
    const back = backAfter(c.req.param('id'), c.req.query('from') === 'approvals', c.req.query('filter') === 'all');
    return formAction(c, back, async (form) => {
      const actions = c.var.actions;
      return { ok: await run(actions, await load(actions, c.req.param('id')), form), redirect: back };
    });
  });
}

/** Where an action returns to: its Reimbursement Request page, or Approvals when it was forwarded from its row there. */
function backAfter(id: string | undefined, fromApprovals: boolean, all: boolean) {
  if (!fromApprovals) return `/reimbursements/${encodeURIComponent(id ?? '')}`;
  return `/approvals${all ? '?filter=all' : ''}#reimbursements`;
}

async function load(actions: PropertyManagerActions, raw: string | undefined): Promise<Reimbursement> {
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound('Reimbursement Request');
  return actions.reimbursement(id);
}

async function find(actions: PropertyManagerActions, raw: string | undefined): Promise<Reimbursement | null> {
  try {
    return await load(actions, raw);
  } catch (error) {
    if (error instanceof ActionError && error.code === 'not_found') return null;
    throw error;
  }
}

function body(r: Reimbursement, timeZone: string, now: Date): Html {
  return html`${header(r, now)} ${progress(r, timeZone)}
    ${r.overLimit
      ? alert(
          `${formatMoney(r.amountCents)} is over the ${formatMoney(r.limitCents)} a Tenant can claim for an Urgent Repair. You can still forward it; the Property Owner decides what to pay.`,
          'warning',
          { title: 'Over the limit' },
        )
      : nothing}
    <div class="reimbursement-layout">
      <div class="reimbursement-main">
        ${nextCard(r, timeZone)} ${receiptsCard(r)} ${timelineCard(r, timeZone)}
      </div>
      <div class="reimbursement-side">
        ${detailsCard(r)} ${messageLog(r.messages, { timeZone, markRead: `/reimbursements/${r.urgentRepairId}/read` })}
      </div>
    </div>`;
}

/** The issue first, then the Property, then the Tenant, the status, the amount against the limit and how long ago it was reported. */
function header(r: Reimbursement, now: Date): Html {
  const amount =
    r.amountCents === null
      ? html`<span class="text-muted">No amount yet</span>`
      : html`<span class="num ${r.overLimit ? 'text-high' : ''}">Amount <strong>${formatMoney(r.amountCents)}</strong> of the ${formatMoney(r.limitCents)} limit</span>`;
  return html`<header class="reimbursement-head">
    <h2 class="reimbursement-issue">${r.summary ?? r.description}</h2>
    <p>${entityLink('property', r.propertyAddress, `/properties/${r.propertyId}`)}</p>
    <p class="reimbursement-meta">
      <span>Tenant ${entityLink('tenant', r.tenant.name, `/tenants/${r.tenant.personId}`)}</span>
      <span>${reimbursementBadge(r.status)}</span>
      ${amount}
      <time datetime="${r.reportedAt}">Reported ${formatAge(r.reportedAt, now)}</time>
    </p>
  </header>`;
}

/**
 * Where it stands. A step is ticked only once it happened; the current one is
 * where the status is, which can be a ticked step (a new receipt after forwarding
 * waits for review again).
 */
function progress(r: Reimbursement, timeZone: string): Html {
  const when = (at: string | null) => (at ? formatWhen(at, timeZone) : undefined);
  const forwarded = r.forwardedAt !== null || r.status === 'receipt_forwarded' || r.status === 'reimbursed';
  const items = [
    { label: 'Reported', done: true, detail: when(r.reportedAt) },
    { label: 'Receipt received', done: r.receipts.length > 0, detail: when(r.receivedAt) },
    { label: 'Forwarded to Property Owner', done: forwarded, detail: when(r.forwardedAt) },
    { label: 'Reimbursed', done: r.status === 'reimbursed', detail: when(r.reimbursedAt) },
  ].map(({ detail, ...item }) => (detail ? { ...item, detail } : item));
  const current = { reminder_sent: 1, receipt_received: 2, receipt_forwarded: 3, reimbursed: undefined }[r.status];
  // Named only when it isn't simply the first step not done (a new receipt after forwarding).
  const named = current !== undefined && current !== items.findIndex((item) => !item.done);
  return html`<nav class="reimbursement-steps" aria-label="Where the Reimbursement Request stands">
    ${steps(items, { horizontal: true, ...(named ? { current } : {}) })}
  </nav>`;
}

/** The one thing to do now, by status. */
function nextCard(r: Reimbursement, timeZone: string): Html {
  const owner = r.owner.name;
  const tenant = r.tenant.name;
  switch (r.status) {
    case 'reminder_sent':
      return card({
        title: 'Waiting for the receipt',
        body: html`<div class="space-y-3">
          <p>${tenant} arranges the repair and sends the receipt, a photo or PDF, through the link in our message. Nothing goes to ${owner} until you forward it.</p>
          ${postButton(`/reimbursements/${r.urgentRepairId}/resend`, 'Send the link again', { variant: 'secondary', size: 'sm' })}
        </div>`,
      });
    case 'receipt_received':
      return card({
        title: 'Check the receipt and forward it',
        body: html`<div class="space-y-3">
          <p>Check the receipts below match the repair and the amount. Forwarding emails them to ${owner}, the Property Owner, with you copied in.</p>
          ${reimbursementForwardForm(r, `/reimbursements/${r.urgentRepairId}/forward`)}
        </div>`,
      });
    case 'receipt_forwarded':
      return card({
        title: 'With the Property Owner',
        body: html`<div class="space-y-3">
          <p>Forwarded to ${owner}${r.forwardedAt ? ` on ${formatWhen(r.forwardedAt, timeZone)}` : ''}. Once they have paid ${tenant} back, mark it reimbursed and ${tenant} is told.</p>
          ${postButton(`/reimbursements/${r.urgentRepairId}/reimbursed`, 'Mark reimbursed', { confirm: `Mark this reimbursed? ${tenant} will be told.` })}
          <details class="reimbursement-again">
            <summary>Forward again</summary>
            ${reimbursementForwardForm(r, `/reimbursements/${r.urgentRepairId}/forward`)}
          </details>
        </div>`,
      });
    case 'reimbursed':
      return card({
        title: 'Reimbursed',
        body: html`<p>${owner} reimbursed ${tenant}${r.amountCents === null ? '' : ` ${formatMoney(r.amountCents)}`}${r.reimbursedAt ? `, marked on ${formatWhen(r.reimbursedAt, timeZone)}` : ''}.</p>`,
      });
  }
}

/** What forwarding needs from a Reimbursement Request: the row on Approvals has these too. */
type Forwardable = Pick<Reimbursement, 'urgentRepairId' | 'amountCents' | 'limitCents'>;

/**
 * The amount, filled in with the Tenant's (or the last forwarded) amount, and Forward.
 * `action` says where to post (the request page, or Approvals with a way back); `compact`
 * drops the hint and shortens the label for a table row.
 */
export function reimbursementForwardForm(r: Forwardable, action: string, o: { compact?: boolean } = {}): Html {
  const amount = r.amountCents === null ? 'The Tenant gave no amount: enter the total on the receipt.' : 'As the Tenant entered it; correct it to match the receipt.';
  return html`<form method="post" action="${action}" class="reimbursement-forward">
    <div class="${o.compact ? 'min-w-32 flex-1' : 'min-w-48 flex-1'}">
      ${field({
        id: o.compact ? `amount-approvals-${r.urgentRepairId}` : `amount-${r.urgentRepairId}`,
        label: o.compact ? 'Amount ($)' : 'Amount to reimburse ($)',
        name: 'amount',
        type: 'text',
        value: r.amountCents === null ? '' : (r.amountCents / 100).toFixed(2),
        required: true,
        placeholder: '0.00',
        ...(o.compact ? {} : { hint: `${amount} Up to ${formatMoney(r.limitCents)} can be claimed; more is warned about, not refused.` }),
      })}
    </div>
    ${button(o.compact ? 'Forward to Owner' : 'Forward to Property Owner', o.compact ? { size: 'sm' } : {})}
  </form>`;
}

/** The receipts: photos as thumbnails that open in the viewer, PDFs and other files as links. */
function receiptsCard(r: Reimbursement): Html {
  if (!r.receipts.length) return card({ title: 'Receipt', body: emptyState('No receipt yet. It appears here when the Tenant sends it.') });
  const images = r.receipts.filter((f) => IMAGE_TYPES.has(f.contentType));
  const others = r.receipts.filter((f) => !IMAGE_TYPES.has(f.contentType));
  return card({
    title: r.receipts.length === 1 ? 'Receipt' : `Receipts (${r.receipts.length})`,
    body: html`<div class="space-y-4">
      ${images.length ? photoGrid(images.map((f, i) => ({ src: `/files/${f.fileId}`, caption: f.filename, alt: `Receipt photo ${i + 1} of ${images.length}` }))) : nothing}
      ${others.length ? html`<ul class="reimbursement-files">${others.map(fileLink)}</ul>` : nothing}
    </div>`,
  });
}

function fileLink(f: Receipt): Html {
  const kind = f.contentType === 'application/pdf' ? 'PDF' : 'file';
  return html`<li><a class="link" href="/files/${f.fileId}">${f.filename}</a> <span class="text-muted">(${kind})</span></li>`;
}

/** Who is involved and what the Tenant said. */
function detailsCard(r: Reimbursement): Html {
  const contact = (p: Reimbursement['owner']) =>
    html`<p>${p.name}</p>${p.email ? html`<p class="text-xs">${contactLink('email', p.email)}</p>` : nothing}${p.mobile ? html`<p class="text-xs">${contactLink('mobile', p.mobile)}</p>` : nothing}`;
  const rows: [string, Html | string][] = [
    ...(r.summary ? [["The Tenant's words", r.description] as [string, string]] : []),
    ['Tenant', contact(r.tenant)],
    ['Property Owner', contact(r.owner)],
    ['Property Manager', r.propertyManager],
  ];
  return card({
    title: 'Reimbursement details',
    body: html`<dl class="reimbursement-facts">${rows.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}</dl>`,
  });
}

function timelineCard(r: Reimbursement, timeZone: string): Html {
  return collapsible('Timeline', timeline(r.timeline.map((e) => ({ at: formatWhen(e.at, timeZone), ...describe(e) }))));
}

/** A timeline event in words, with the amount or how the receipt came. */
function describe(event: TimelineEvent): { title: string; detail?: string } {
  const d = event as Record<string, unknown>;
  const amount = typeof d.amountCents === 'number' ? formatMoney(d.amountCents) : undefined;
  switch (event.kind) {
    case 'reported':
      return { title: 'Reported by the Tenant' };
    case 'safety':
      return {
        title: 'Classified as a safety risk',
        ...(typeof d.confidence === 'number' ? { detail: `${Math.round(d.confidence * 100)}% sure` } : {}),
      };
    case 'reminder_sent':
      return { title: 'Tenant told to arrange the Urgent Repair and send the receipt' };
    case 'link_resent':
      return { title: 'Receipt link sent to the Tenant again' };
    case 'receipt_received': {
      const files = typeof d.files === 'number' ? d.files : 1;
      const how = d.via === 'upload' || d.via === undefined ? 'through the receipt link' : `by ${d.via === 'whatsapp' ? 'WhatsApp' : d.via === 'sms' ? 'SMS' : 'email'}`;
      return { title: `${files === 1 ? 'Receipt' : `${files} receipt files`} received ${how}`, ...(amount ? { detail: `Claimed ${amount}` } : {}) };
    }
    case 'forwarded':
      return { title: `${d.again ? 'Forwarded again' : 'Forwarded'} to ${typeof d.ownerName === 'string' ? d.ownerName : 'the Property Owner'}`, ...(amount ? { detail: amount } : {}) };
    case 'reimbursed':
      return { title: 'Marked reimbursed', ...(amount ? { detail: amount } : {}) };
    default:
      return { title: event.kind.replaceAll('_', ' ') };
  }
}
