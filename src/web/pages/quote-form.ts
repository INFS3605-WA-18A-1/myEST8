// The Tradie's no-login quote page at /q/:token, linked from their Quote Request
// (ADR 0009; ADR 0002 still holds: the token is the only access). Phone first, like
// the Tenant pages. It shows the Job (Trade, suburb and the issue, never the Tenant),
// then the step the Tradie is at:
//
//   1. the Estimate: a ballpark price, optionally the earliest time, and "I need to
//      inspect the site before I can give a firm price" with its Call-out Fee;
//   2. while a Site Inspection is needed: waiting for the Property Manager to book it,
//      then its time and the address;
//   3. the Firm Quote: a fixed price, the scope of work, how many days it takes, up to
//      three dates they can start, and optionally a PDF;
//   4. after it: what they gave, read only;
//   5. once their Quote is chosen: Offer visit times, then the times they offered.
//
// A closed, declined or passed-over request says so, as does one waiting on the
// Property Owner (theirs, or another Tradie's quote). Every field is checked again by
// the core, which refuses field by field; the page shows each message by its field.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { html, raw } from 'hono/html';
import type { App } from '../../app.ts';
import type { FirmQuoteInput } from '../../quotes.ts';
import { ActionError } from '../../shared.ts';
import { files, isoToLocal, list, localToIso, text, type FormValues } from '../forms.ts';
import { formatDay, formatVisit } from '../../zoned-time.ts';
import { alert, button, card, dl, doneBox, field, formatMoney, formatWhen, humanise, publicPage, type Html } from '../ui.ts';

const KB = 1024;
const MB = 1024 * KB;
const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;
/** The most start dates a Firm Quote lists (the core says the same). */
export const DATE_INPUTS = 3;

type QuotePage = NonNullable<Awaited<ReturnType<App['quotePage']>>>;
/** What the Tradie typed, to show again with the refusal. */
type Posted = Record<string, string | string[]>;
type Refusal = { message: string; fields: Readonly<Record<string, string>>; posted: Posted };

/** GET /q/:token and its two posts: the Estimate and the Firm Quote. */
export function quoteFormPages(app: App) {
  const pages = new Hono();

  pages.get('/q/:token', async (c) => {
    const page = await app.quotePage(c.req.param('token'));
    if (!page) return c.html(unknownLinkPage(), 404);
    const sent = c.req.query('sent');
    return c.html(quotePage(c.req.param('token'), page, { thanks: sent === 'estimate' || sent === 'firm' || sent === 'times' ? sent : undefined }));
  });

  pages.post(
    '/q/:token/estimate',
    // A few short fields: anything bigger is not an Estimate.
    bodyLimit({
      maxSize: 64 * KB,
      onError: async (c) => {
        const token = c.req.param('token') ?? '';
        const page = await app.quotePage(token);
        if (!page) return c.html(unknownLinkPage(), 404);
        return c.html(quotePage(token, page, { refusal: { message: 'That is too much to send. Give your Estimate in the fields below.', fields: {}, posted: {} } }), 413);
      },
    }),
    async (c) => {
      const token = c.req.param('token');
      const page = await app.quotePage(token);
      if (!page) return c.html(unknownLinkPage(), 404);
      const form = (await c.req.parseBody({ all: true }).catch(() => ({}))) as FormValues;
      const needsInspection = text(form, 'needsInspection') === 'yes';
      const fee = text(form, 'calloutFee');
      try {
        await app.submitEstimate(token, {
          priceCents: dollarsToCents(text(form, 'price')),
          proposedTime: text(form, 'proposedTime') ? localTime(text(form, 'proposedTime'), page.timeZone, 'proposedTime') : null,
          needsInspection,
          calloutFeeCents: needsInspection && fee ? dollarsToCents(fee) : null,
        });
      } catch (error) {
        return refused(c, token, page, error, form, ['price', 'proposedTime', 'needsInspection', 'calloutFee']);
      }
      return c.redirect(`/q/${encodeURIComponent(token)}?sent=estimate`, 303);
    },
  );

  pages.post(
    '/q/:token/firm',
    // A PDF of up to 10 MB, plus the form.
    bodyLimit({
      maxSize: 11 * MB,
      onError: async (c) => {
        const token = c.req.param('token') ?? '';
        const page = await app.quotePage(token);
        if (!page) return c.html(unknownLinkPage(), 404);
        return c.html(quotePage(token, page, { refusal: { message: 'That PDF is too big. Attach one under 10 MB.', fields: { pdf: 'Under 10 MB, please' }, posted: {} } }), 413);
      },
    }),
    async (c) => {
      const token = c.req.param('token');
      const page = await app.quotePage(token);
      if (!page) return c.html(unknownLinkPage(), 404);
      const form = (await c.req.parseBody({ all: true }).catch(() => ({}))) as FormValues;
      try {
        await app.submitFirmQuote(token, await firmQuoteFrom(form, page.timeZone));
      } catch (error) {
        return refused(c, token, page, error, form, ['price', 'scopeOfWork', 'durationDays', 'availableDates', 'proposedTime']);
      }
      return c.redirect(`/q/${encodeURIComponent(token)}?sent=firm`, 303);
    },
  );

  pages.post('/q/:token/times', async (c) => {
    const token = c.req.param('token');
    const page = await app.quotePage(token);
    if (!page) return c.html(unknownLinkPage(), 404);
    const form = (await c.req.parseBody({ all: true }).catch(() => ({}))) as FormValues;
    try {
      const raw = form.starts;
      const posted = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((value): value is string => typeof value === 'string');
      if (!posted[0]?.trim()) throw new ActionError('invalid', 'Enter a preferred time', { starts: 'Enter a preferred time' });
      const starts = [posted[0], ...posted.slice(1).filter((value) => value.trim())].map((value) => localTime(value, page.timeZone, 'starts'));
      await app.offerVisitTimes(token, starts);
    } catch (error) {
      return refused(c, token, page, error, form, ['starts']);
    }
    return c.redirect(`/q/${encodeURIComponent(token)}?sent=times`, 303);
  });

  // Confirm pages linked from the Tradie's emails. Opening one, including a mail
  // scanner's GET, only shows the page. The button's POST is what changes anything.
  pages.get('/q/:token/decline', async (c) => {
    const token = c.req.param('token');
    const page = await app.quotePage(token);
    if (!page) return c.html(unknownLinkPage(), 404);
    return c.html(declinePage(token, page));
  });

  pages.post('/q/:token/decline', async (c) => {
    const token = c.req.param('token');
    try {
      await app.declineQuoteRequest(token);
    } catch (error) {
      return actionFailed(c, error, async (message) => {
        const page = await app.quotePage(token);
        return page ? declinePage(token, page, message) : null;
      });
    }
    return c.redirect(`/q/${encodeURIComponent(token)}/decline`, 303);
  });

  pages.get('/q/:token/done', (c) => showVisit(c, app, 'repair', 'done'));
  pages.post('/q/:token/done', (c) => postVisit(c, app, 'repair', 'done'));
  pages.get('/q/:token/another', (c) => showVisit(c, app, 'repair', 'another'));
  pages.post('/q/:token/another', (c) => postVisit(c, app, 'repair', 'another'));
  pages.get('/q/:token/inspection-done', (c) => showVisit(c, app, 'inspection', 'done'));
  pages.post('/q/:token/inspection-done', (c) => postVisit(c, app, 'inspection', 'done'));
  pages.get('/q/:token/inspection-another', (c) => showVisit(c, app, 'inspection', 'another'));
  pages.post('/q/:token/inspection-another', (c) => postVisit(c, app, 'inspection', 'another'));

  return pages;
}

type VisitKind = 'repair' | 'inspection';
type VisitStep = 'done' | 'another';
type TradieVisit = NonNullable<Awaited<ReturnType<App['tradieVisit']>>>;

const CAN_DECLINE = new Set(['sent', 'reminded', 'estimated', 'inspection_booked', 'inspected']);

function visitPath(kind: VisitKind, step: VisitStep) {
  if (kind === 'inspection') return step === 'done' ? 'inspection-done' : 'inspection-another';
  return step === 'done' ? 'done' : 'another';
}

async function showVisit(c: Context, app: App, kind: VisitKind, step: VisitStep) {
  const token = c.req.param('token') ?? '';
  const page = await app.tradieVisit(token, kind);
  if (!page) return c.html(unknownLinkPage(), 404);
  return c.html(visitPage(token, kind, step, page));
}

async function postVisit(c: Context, app: App, kind: VisitKind, step: VisitStep) {
  const token = c.req.param('token') ?? '';
  const path = visitPath(kind, step);
  try {
    if (step === 'done') await app.markTradieVisitDone(token, kind);
    else await app.tradieNeedsAnotherTime(token, kind);
  } catch (error) {
    return actionFailed(c, error, async (message) => {
      const page = await app.tradieVisit(token, kind);
      if (!page) return null;
      return visitPage(token, kind, step, page, message);
    });
  }
  return c.redirect(`/q/${encodeURIComponent(token)}/${path}`, 303);
}

async function actionFailed(c: Context, error: unknown, again: (message: string) => Promise<Html | null>) {
  if (!(error instanceof ActionError)) throw error;
  if (error.code === 'not_found') return c.html(unknownLinkPage(), 404);
  const page = await again(error.message);
  if (!page) return c.html(unknownLinkPage(), 404);
  return c.html(page, STATUS[error.code]);
}

/**
 * A posted Firm Quote form (price, scopeOfWork, durationDays, availableDates, proposedTime
 * and an optional pdf) as the core's input. Shared with the Ticket page, where the Property
 * Manager enters a Firm Quote a Tradie sent another way; the core checks every field.
 */
export async function firmQuoteFrom(form: FormValues, timeZone: string): Promise<FirmQuoteInput> {
  const [pdf] = files(form, 'pdf');
  return {
    priceCents: dollarsToCents(text(form, 'price')),
    scopeOfWork: text(form, 'scopeOfWork'),
    durationDays: text(form, 'durationDays') ? Number(text(form, 'durationDays')) : NaN,
    availableDates: list(form, 'availableDates'),
    proposedTime: text(form, 'proposedTime') ? localTime(text(form, 'proposedTime'), timeZone, 'proposedTime') : null,
    pdf: pdf ? { filename: pdf.name, contentType: pdf.type || 'application/octet-stream', content: new Uint8Array(await pdf.arrayBuffer()) } : null,
  };
}

/** Dollars typed by a person ("1,250.50") as cents; NaN when it isn't an amount, which the core refuses. */
function dollarsToCents(typed: string): number {
  const value = Number(typed.replace(/[$,\s]/g, ''));
  return typed && Number.isFinite(value) ? Math.round(value * 100) : NaN;
}

/** A datetime-local value in the Agency's zone, as an ISO instant; refused against its field when it isn't one. */
function localTime(value: string, timeZone: string, field: string): string {
  try {
    return localToIso(value, timeZone);
  } catch {
    throw new ActionError('invalid', 'Enter a date and time', { [field]: 'Enter a date and time' });
  }
}

/** The page again with the refusal by its field, keeping what was typed; or the unknown-link page. */
function refused(c: Context, token: string, page: QuotePage, error: unknown, form: FormValues, names: string[]) {
  if (!(error instanceof ActionError)) throw error;
  if (error.code === 'not_found') return c.html(unknownLinkPage(), 404);
  const posted: Posted = Object.fromEntries(names.map((n) => [n, n === 'availableDates' || n === 'starts' ? list(form, n) : text(form, n)]));
  return c.html(quotePage(token, page, { refusal: { message: error.message, fields: error.fields, posted } }), STATUS[error.code]);
}

function unknownLinkPage(): Html {
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    title: "This link isn't right",
    body: html`<p>Check you opened the whole link from the Quote Request we sent you.</p>
      <p>If it still doesn't work, reply to that message and ask for a new link.</p>`,
  });
}

/** A confirm page from a Tradie's email: the green block of what they chose, if they have, then the card. */
function actionPage(title: string, brand: string, body: Html, done: Html | string = ''): Html {
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    width: 'narrow',
    brand,
    title,
    footer: replyTo(brand),
    body: html`${done}${card({ body })}`,
  });
}

/** Statuses where replying NO still declines. A Firm Quote, or a closed request, does not. Once declined, the decline shows in green. */
function declinePage(token: string, page: QuotePage, error?: string): Html {
  const declined = page.outcome === 'declined';
  const open = CAN_DECLINE.has(page.status) && !declined;
  const title = open ? "Can't take this job" : 'Quote Request';
  const body = declined
    ? html`<p>${page.agencyName} asked you to quote for the ${humanise(page.trade).toLowerCase()} job in ${page.suburb}.</p>${disabledButton('Decline this job')}`
    : open
      ? html`<p>${page.agencyName} asked you to quote for the ${humanise(page.trade).toLowerCase()} job in ${page.suburb}.</p>
          <form method="post" action="/q/${encodeURIComponent(token)}/decline" class="tenant-form">
            ${button('Decline this job', { block: true })}
          </form>`
      : html`<p>This Quote Request no longer takes a decline.</p>${disabledButton('Decline this job')}`;
  return actionPage(title, page.agencyName, html`${error ? alert(error, 'error') : ''}${body}`, declined ? doneBox('You declined this Quote Request.') : '');
}

/** One of an email's buttons that no longer applies. */
const disabledButton = (label: string, variant: 'primary' | 'secondary' = 'primary') =>
  html`<div class="tenant-buttons">${button(label, { block: true, variant, disabled: true, type: 'button' })}</div>`;

/**
 * The page a Work Order's or Site Inspection's Mark done or Need another time? opens.
 * Before the Tradie answers, the link's own button. Once they have, both links show
 * the answer in green and both buttons, disabled where they no longer apply.
 */
function visitPage(token: string, kind: VisitKind, step: VisitStep, page: TradieVisit, error?: string): Html {
  const visit = page.visit;
  const mark = kind === 'inspection' ? 'Mark inspection done' : 'Mark job done';
  const what = kind === 'inspection' ? 'The Site Inspection' : 'The job';
  const stays = kind === 'inspection' ? `until it moves` : `until the Tenant picks a new one`;
  const when = visit ? formatVisit(visit.start, page.timeZone) : '';
  const done = visit?.status === 'done';
  const asked = visit?.status === 'active' && visit.rescheduleRequestedBy === 'tradie';
  const settled = !!visit && (visit.status !== 'active' || asked);
  const canMark = visit?.status === 'active' && visit.started;
  const canAsk = visit?.status === 'active' && !visit.rescheduleRequestedBy;
  const title = done
    ? kind === 'inspection' ? 'Inspection done' : 'Job done'
    : step === 'done'
      ? canMark ? mark : 'Not done yet'
      : canAsk ? 'Need another time?' : 'Another time';
  const line = !visit
    ? html`<p>This visit isn't booked.</p>`
    : visit.status === 'cancelled'
      ? html`<p>This visit is cancelled.</p>`
      : done
        ? html`<p>${what} at ${page.address} was booked for ${when}.</p>`
        : visit.rescheduleRequestedBy
          ? html`<p>${asked ? '' : 'A new time has been asked for. '}This visit stays booked for ${when} ${stays}.</p>`
          : step === 'done'
            ? canMark
              ? html`<p>${what} at ${page.address} is booked for ${when}.</p>`
              : html`<p>This visit is booked for ${when}, so it can't be marked done yet.</p>`
            : html`<p>This visit stays booked for ${when} ${stays}.</p>`;
  const showMark = settled || (step === 'done' && canMark);
  const showAsk = settled || (!!visit && step === 'another');
  const box = done
    ? doneBox(`Marked done on ${formatDay(visit.doneAt ?? visit.start, page.timeZone)}`)
    : asked
      ? doneBox('Asked for another time')
      : '';
  return actionPage(
    title,
    page.agencyName,
    html`${error ? alert(error, 'error') : ''}${line}
      ${showMark ? (canMark ? visitButton(token, kind, 'done', mark) : disabledButton(mark)) : ''}
      ${showAsk ? (canAsk ? visitButton(token, kind, 'another', 'Need another time?') : disabledButton('Need another time?', 'secondary')) : ''}`,
    box,
  );
}

function visitButton(token: string, kind: VisitKind, step: VisitStep, label: string): Html {
  return html`<form method="post" action="/q/${encodeURIComponent(token)}/${visitPath(kind, step)}" class="tenant-form">
    ${button(label, { block: true, variant: step === 'done' ? 'primary' : 'secondary' })}
  </form>`;
}

const replyTo = (agencyName: string) => `Questions? Reply to any message from ${agencyName}.`;

/** The page at the step the Tradie is at. `thanks` follows a successful post; `refusal` shows a refused one. */
function quotePage(token: string, p: QuotePage, o: { thanks?: 'estimate' | 'firm' | 'times'; refusal?: Refusal } = {}): Html {
  const job = `${humanise(p.trade)} job in ${p.suburb}`;
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    brand: p.agencyName,
    title: p.next === 'firm_quote' ? 'Give your Firm Quote' : p.next === 'estimate' ? 'Give your Estimate' : `Your quote for the ${humanise(p.trade).toLowerCase()} job`,
    subtitle: `${job}, for ${p.tradieName}`,
    footer: replyTo(p.agencyName),
    body: html`
      ${o.thanks ? doneBox(thanksLine(o.thanks, p.agencyName)) : ''}
      ${card({
        title: 'The job',
        body: html`<div class="tenant-issue">
            <p class="tenant-issue-label">The issue the Tenant reported</p>
            <p class="tenant-issue-text">${p.issue}</p>
          </div>
          ${dl([
            ['Trade', humanise(p.trade)],
            ['Urgency', humanise(p.urgency)],
            [p.propertyAddress ? 'Address' : 'Suburb', p.propertyAddress ?? p.suburb],
          ])}`,
      })}
      ${outcomeNote(p)}
      ${p.estimate ? estimateSummary(p) : ''}
      ${inspectionNote(p)}
      ${p.next === 'estimate' ? estimateForm(token, o.refusal) : ''}
      ${p.next === 'firm_quote' ? firmQuoteForm(token, p, o.refusal) : ''}
      ${p.firmQuote ? firmQuoteSummary(p) : ''}
      ${p.offeredVisit ? offeredTimes(p) : ''}
      ${p.offerTimes ? offerTimesForm(token, p, o.refusal) : ''}
    `,
  });
}

/** How the request ended for the Tradie, when it has. */
function outcomeNote(p: QuotePage): Html | string {
  switch (p.outcome) {
    case 'chosen':
      return alert(
        p.offerTimes
          ? p.offerTimes.reschedule
            ? 'The visit needs a new time. Offer a preferred time, and up to 2 more. The current visit stays booked until the Tenant picks one.'
            : `${p.agencyName} has gone with your quote. Offer a preferred time, and up to 2 more.`
          : p.offeredVisit
            ? `${p.agencyName} has your times. The Tenant is choosing one.`
            : `${p.agencyName} has gone with your quote. A Work Order with the visit time will follow.`,
        'success',
      );
    case 'with_owner':
      return alert(`${p.agencyName} would like to go with your quote and has asked the Property Owner to approve it. If they do, a Work Order with the visit time will follow.`, 'info');
    case 'on_hold':
      return alert(`Still open: ${p.agencyName} is waiting on the Property Owner about another quote, so it can't take yours just now. If the Owner says no, ${p.agencyName} may come back to you.`, 'info');
    case 'not_chosen':
      return alert(`${p.agencyName} has gone with another quote this time. Thanks for quoting.`, 'info');
    case 'declined':
      // The same green block as the decline page, which the email's other button opens.
      return doneBox('You declined this Quote Request, so it no longer takes a quote.');
    case 'closed':
      return alert(`This Quote Request has closed: ${p.agencyName} is no longer taking quotes for this job.`, 'info');
    default:
      return '';
  }
}

/** Where the Site Inspection stands, for a Tradie who needs one. */
function inspectionNote(p: QuotePage): Html | string {
  if (p.outcome !== 'open') return '';
  if (p.next === 'wait_for_booking') {
    return alert(`Waiting for ${p.agencyName} to book your Site Inspection. We'll message you the time and address.`, 'info', { title: 'Site Inspection' });
  }
  if (p.inspection && p.next === 'wait_for_inspection') {
    return alert(
      html`Your Site Inspection is booked for <strong>${formatWhen(p.inspection.start, p.timeZone)}</strong>. Reply DONE to our message after your visit, and give your Firm Quote here.`,
      'info',
      { title: 'Site Inspection' },
    );
  }
  return '';
}

function estimateSummary(p: QuotePage): Html {
  const e = p.estimate!;
  return card({
    title: p.firmQuote ? 'Your Estimate (superseded by your Firm Quote)' : 'Your Estimate',
    body: dl([
      ['Estimate', formatMoney(e.priceCents)],
      ['Earliest time', e.proposedTime ? formatWhen(e.proposedTime, p.timeZone) : 'Not given'],
      ['Site Inspection', e.needsInspection ? `Needed${e.calloutFeeCents ? `, Call-out Fee ${formatMoney(e.calloutFeeCents)}` : ''}` : 'Not needed'],
      ...(e.notToExceedCents !== null ? [['Not-to-exceed Cap', formatMoney(e.notToExceedCents)] as [string, string]] : []),
    ]),
  });
}

function firmQuoteSummary(p: QuotePage): Html {
  const f = p.firmQuote!;
  return card({
    title: 'Your Firm Quote',
    body: dl([
      ['Price', formatMoney(f.priceCents)],
      ['Scope of work', f.scopeOfWork ?? 'Not given'],
      ['Takes', f.durationDays ? `${f.durationDays} ${f.durationDays === 1 ? 'day' : 'days'}` : 'Not given'],
      ['Can start', f.availableDates.length ? f.availableDates.map(dateWords).join(', ') : 'Not given'],
      ['Proposed time', f.proposedTime ? formatWhen(f.proposedTime, p.timeZone) : 'Not given'],
      ...(f.hasPdf ? [['PDF', 'Attached'] as [string, string]] : []),
    ]),
  });
}

const value = (r: Refusal | undefined, name: string) => {
  const v = r?.posted[name];
  return typeof v === 'string' ? v : '';
};

function refusalAlert(r: Refusal | undefined): Html | string {
  return r ? alert(r.message, 'error') : '';
}

function estimateForm(token: string, r: Refusal | undefined): Html {
  const ticked = value(r, 'needsInspection') === 'yes';
  return card({
    title: 'Your Estimate',
    body: html`${refusalAlert(r)}
      <form method="post" action="/q/${encodeURIComponent(token)}/estimate" class="tenant-form" novalidate>
        <p class="field-hint">An Estimate is your ballpark from the description, not binding. If you can, you'll give a Firm Quote, your fixed price, next.</p>
        ${field({ label: 'Estimate ($)', name: 'price', value: value(r, 'price'), required: true, placeholder: '250', error: r?.fields.price })}
        ${field({
          label: 'Earliest time you could do it',
          name: 'proposedTime',
          type: 'datetime-local',
          value: value(r, 'proposedTime'),
          hint: 'Optional.',
          error: r?.fields.proposedTime,
        })}
        ${field({
          label: 'I need to inspect the site before I can give a firm price',
          name: 'needsInspection',
          type: 'checkbox',
          value: 'yes',
          checked: ticked,
          id: 'field-needs-inspection',
        })}
        <div id="callout-fee" ${ticked ? '' : 'hidden'}>
          ${field({
            label: 'Call-out Fee for the Site Inspection ($)',
            name: 'calloutFee',
            value: value(r, 'calloutFee'),
            hint: 'What you charge to inspect, whether or not you get the job. Leave empty if none.',
            error: r?.fields.calloutFee,
          })}
        </div>
        ${CALLOUT_SCRIPT}
        ${button('Send Estimate', { block: true })}
      </form>`,
  });
}

/** Shows the Call-out Fee only while the inspection box is ticked. Without script it stays hidden until ticked and posted again. */
const CALLOUT_SCRIPT = raw(`<script>
(() => {
  const box = document.getElementById('field-needs-inspection');
  const fee = document.getElementById('callout-fee');
  if (!box || !fee) return;
  fee.hidden = !box.checked;
  box.addEventListener('change', () => { fee.hidden = !box.checked; });
})();
</script>`);

function firmQuoteForm(token: string, p: QuotePage, r: Refusal | undefined): Html {
  const dates = r?.posted.availableDates;
  const typedDates = Array.isArray(dates) ? dates : [];
  return card({
    title: 'Your Firm Quote',
    body: html`${refusalAlert(r)}
      <form method="post" action="/q/${encodeURIComponent(token)}/firm" enctype="multipart/form-data" class="tenant-form" novalidate>
        <p class="field-hint">A Firm Quote is your fixed price for the work described. It is binding once ${p.agencyName} accepts it.</p>
        ${field({ label: 'Firm price ($)', name: 'price', value: value(r, 'price'), required: true, error: r?.fields.price })}
        ${field({
          label: 'Scope of work',
          name: 'scopeOfWork',
          type: 'textarea',
          rows: 4,
          value: value(r, 'scopeOfWork'),
          required: true,
          hint: 'What you will do for this price.',
          error: r?.fields.scopeOfWork,
        })}
        ${field({ label: 'How many days it takes', name: 'durationDays', type: 'number', min: 1, step: '1', value: value(r, 'durationDays'), required: true, error: r?.fields.durationDays })}
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Dates you can start</legend>
          ${Array.from({ length: DATE_INPUTS }, (_, i) =>
            html`<input id="field-available-date-${i + 1}" name="availableDates" type="date" class="input w-full${r?.fields.availableDates ? ' input-error' : ''}" value="${typedDates[i] ?? ''}" aria-label="Start date ${i + 1}" ${i === 0 ? 'required' : ''} />`,
          )}
          ${r?.fields.availableDates ? html`<p class="field-error">${r.fields.availableDates}</p>` : ''}
          <p class="field-hint">At least one, up to three.</p>
        </fieldset>
        ${field({
          label: 'Proposed start time',
          name: 'proposedTime',
          type: 'datetime-local',
          value: value(r, 'proposedTime'),
          hint: 'Optional.',
          error: r?.fields.proposedTime,
        })}
        ${field({ label: 'Your quote as a PDF', name: 'pdf', type: 'file', accept: 'application/pdf', hint: 'Optional, under 10 MB.', error: r?.fields.pdf })}
        ${button('Send Firm Quote', { block: true })}
      </form>`,
  });
}

const thanksLine = (thanks: 'estimate' | 'firm' | 'times', agencyName: string) =>
  thanks === 'times' ? `Thanks. ${agencyName} will ask the Tenant to pick a time.` : thanks === 'estimate' ? `Thanks, ${agencyName} has your Estimate.` : `Thanks, ${agencyName} has your Firm Quote.`;

/** The times the Tradie offered, while the Tenant chooses. */
function offeredTimes(p: QuotePage): Html {
  return card({
    title: 'Times you offered',
    body: html`<ul class="tenant-times">
      ${p.offeredVisit!.starts.map((start) => html`<li>${formatWhen(start, p.timeZone)}</li>`)}
    </ul>`,
  });
}

/** The chosen Tradie offers a preferred time and up to two more. The length comes from the Quote; the times start from it. */
function offerTimesForm(token: string, p: QuotePage, r: Refusal | undefined): Html {
  const offer = p.offerTimes!;
  const posted = r?.posted.starts;
  const typed = Array.isArray(posted) ? posted : [];
  const times = [
    { label: 'Preferred time', required: true, hint: undefined },
    { label: 'Another time', required: false, hint: 'Optional.' },
    { label: 'A third time', required: false, hint: 'Optional.' },
  ];
  return card({
    title: 'Offer visit times',
    body: html`${refusalAlert(r)}
      <form method="post" action="/q/${encodeURIComponent(token)}/times" class="tenant-form" novalidate>
        <p>The visit is at ${offer.address}.</p>
        <p>The Tenant is usually home ${offer.availability}.</p>
        ${offer.note ? html`<p>The Tenant said: ${offer.note}.</p>` : ''}
        <p>The visit takes ${offer.durationLabel}.</p>
        ${times.map((time, i) =>
          field({
            label: time.label,
            name: 'starts',
            id: `field-start-${i + 1}`,
            type: 'datetime-local',
            value: typed.length ? (typed[i] ?? '') : offer.starts[i] ? isoToLocal(offer.starts[i]!, p.timeZone) : '',
            required: time.required,
            hint: time.hint,
            error: i === 0 ? r?.fields.starts : undefined,
          }),
        )}
        ${button('Offer visit times', { block: true })}
      </form>`,
  });
}

/** An ISO date ("2026-10-20") as "Tue 20 Oct". */
function dateWords(date: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
}

