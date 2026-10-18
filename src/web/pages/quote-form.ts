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
//   4. after it: what they gave, read only.
//
// A closed, declined or passed-over request says so. Every field is checked again by
// the core, which refuses field by field; the page shows each message by its field.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { html, raw } from 'hono/html';
import type { App } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import { files, list, localToIso, text, type FormValues } from '../forms.ts';
import { alert, button, card, dl, field, formatMoney, formatWhen, humanise, publicPage, type Html } from '../ui.ts';

const MB = 1024 * 1024;
const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;
/** The most start dates a Firm Quote lists (the core says the same). */
const DATE_INPUTS = 3;

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
    return c.html(quotePage(c.req.param('token'), page, { thanks: sent === 'estimate' || sent === 'firm' ? sent : undefined }));
  });

  pages.post('/q/:token/estimate', async (c) => {
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
  });

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
      const [pdf] = files(form, 'pdf');
      try {
        await app.submitFirmQuote(token, {
          priceCents: dollarsToCents(text(form, 'price')),
          scopeOfWork: text(form, 'scopeOfWork'),
          durationDays: text(form, 'durationDays') ? Number(text(form, 'durationDays')) : NaN,
          availableDates: list(form, 'availableDates'),
          proposedTime: text(form, 'proposedTime') ? localTime(text(form, 'proposedTime'), page.timeZone, 'proposedTime') : null,
          pdf: pdf ? { filename: pdf.name, contentType: pdf.type || 'application/octet-stream', content: new Uint8Array(await pdf.arrayBuffer()) } : null,
        });
      } catch (error) {
        return refused(c, token, page, error, form, ['price', 'scopeOfWork', 'durationDays', 'availableDates', 'proposedTime']);
      }
      return c.redirect(`/q/${encodeURIComponent(token)}?sent=firm`, 303);
    },
  );

  return pages;
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
  const posted: Posted = Object.fromEntries(names.map((n) => [n, n === 'availableDates' ? list(form, n) : text(form, n)]));
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

const replyTo = (agencyName: string) => `Questions? Reply to any message from ${agencyName}.`;

/** The page at the step the Tradie is at. `thanks` follows a successful post; `refusal` shows a refused one. */
function quotePage(token: string, p: QuotePage, o: { thanks?: 'estimate' | 'firm'; refusal?: Refusal } = {}): Html {
  const job = `${humanise(p.trade)} job in ${p.suburb}`;
  return publicPage({
    css: ['tenant.css'],
    runtime: false,
    brand: p.agencyName,
    title: p.next === 'firm_quote' ? 'Give your Firm Quote' : p.next === 'estimate' ? 'Give your Estimate' : `Your quote for the ${humanise(p.trade).toLowerCase()} job`,
    subtitle: `${job}, for ${p.tradieName}`,
    footer: replyTo(p.agencyName),
    body: html`
      ${o.thanks ? html`<div role="status" class="tenant-done">${o.thanks === 'estimate' ? `Thanks, ${p.agencyName} has your Estimate.` : `Thanks, ${p.agencyName} has your Firm Quote.`}</div>` : ''}
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
    `,
  });
}

/** How the request ended for the Tradie, when it has. */
function outcomeNote(p: QuotePage): Html | string {
  switch (p.outcome) {
    case 'chosen':
      return alert(`${p.agencyName} has gone with your quote. A Work Order with the visit time will follow.`, 'success');
    case 'not_chosen':
      return alert(`${p.agencyName} has gone with another quote this time. Thanks for quoting.`, 'info');
    case 'declined':
      return alert('You declined this Quote Request, so it no longer takes a quote.', 'info');
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

/** An ISO date ("2026-10-20") as "Tue 20 Oct". */
function dateWords(date: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
}

