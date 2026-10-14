// The two pages a Tenant reaches by a no-login link (ADR-0002): the upload page for
// issue photos or an Urgent Repair receipt, and the progress tracker. Phone first.
// Both name who they are from (the Agency, in the bar) and where (the Property's
// address), because a stranger's link is only trustworthy if it says so. The upload
// page looks its link up before showing the form, so an unknown or expired link
// says so straight away rather than when the Tenant submits.

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { html, raw } from 'hono/html';
import type { App, Upload } from '../app.ts';
import { ActionError, type Trade } from '../shared.ts';
import { files, type FormValues } from './forms.ts';
import { shareButton, shareUrl } from './share.ts';
import { icon } from './icons.ts';
import { alert, button, card, formatWhen, publicPage, type Html } from './ui.ts';

const MB = 1024 * 1024;
const MAX_FILES = 10;
const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;

type UploadLink = NonNullable<Awaited<ReturnType<App['uploadLink']>>>;
type Tracker = Awaited<ReturnType<App['tracker']>>;

/** Tracker stages in the words a Tenant sees. "Repair approved", not "Approved", which reads as the owner's say-so. */
const STAGE_LABEL: Record<string, string> = {
  reported: 'Reported',
  confirmed: 'Confirmed',
  getting_quotes: 'Getting quotes',
  approved: 'Repair approved',
  booked: 'Booked',
  fixed: 'Fixed',
  closed: 'Closed',
};

/** Who is coming, for the booked stage: "a plumber" from Drip Doctors. */
const TRADESPERSON: Record<Trade, string> = {
  plumbing: 'a plumber',
  electrical: 'an electrician',
  carpentry: 'a carpenter',
  roofing: 'a roofer',
  appliances: 'an appliance technician',
  locksmith: 'a locksmith',
  pest_control: 'a pest controller',
  general_handyman: 'a handyman',
};

/** The no-login pages: GET/POST /u/:token (upload) and GET /t/:token (progress tracker). */
export function tenantPages(app: App) {
  const pages = new Hono();

  pages.get('/u/:token', async (c) => {
    const token = c.req.param('token');
    const link = await app.uploadLink(token);
    if (!link) return c.html(badLinkPage(null), 404);
    if (!link.open) return c.html(badLinkPage(link), 410);
    const ok = c.req.query('ok');
    return c.html(uploadPage(token, link, ok === undefined ? {} : { thanks: thanks(Number(ok), link) }));
  });

  pages.post(
    '/u/:token',
    // Ten files of up to 10 MB each, plus the multipart framing.
    bodyLimit({
      maxSize: (MAX_FILES * 10 + 5) * MB,
      onError: async (c) => {
        const token = c.req.param('token') ?? '';
        const link = await app.uploadLink(token);
        if (!link) return c.html(badLinkPage(null), 404);
        return c.html(uploadPage(token, link, { error: 'That was too much in one go. Send up to 10 files at a time, each under 10 MB.' }), 413);
      },
    }),
    async (c) => {
      const token = c.req.param('token');
      const link = await app.uploadLink(token);
      if (!link) return c.html(badLinkPage(null), 404);
      if (!link.open) return c.html(badLinkPage(link), 410);
      const form = (await c.req.parseBody({ all: true }).catch(() => ({}))) as FormValues;
      const uploads: Upload[] = await Promise.all(
        files(form, 'files').map(async (f) => ({
          filename: f.name,
          contentType: f.type || 'application/octet-stream',
          content: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      try {
        await app.upload(token, uploads);
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        if (error.code === 'not_found') return c.html(badLinkPage(null), 404);
        return c.html(uploadPage(token, link, { error: error.message }), STATUS[error.code]);
      }
      return c.redirect(`/u/${encodeURIComponent(token)}?ok=${uploads.length}`, 303);
    },
  );

  pages.get('/t/:token', async (c) => {
    let progress: Tracker;
    try {
      progress = await app.tracker(c.req.param('token'));
    } catch (error) {
      if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
      return c.html(
        publicPage({
          title: "We couldn't find that link",
          body: html`<p>Check you opened the whole link from our message. If it still doesn't work, reply to that message and ask for a new link.</p>`,
        }),
        404,
      );
    }
    return c.html(trackerPage(progress, shareUrl(c)));
  });

  return pages;
}

function thanks(sent: number, link: UploadLink) {
  const noun = link.kind === 'photos' ? 'photo' : 'file';
  const count = Number.isInteger(sent) && sent > 0 && sent <= MAX_FILES ? `your ${sent === 1 ? noun : `${sent} ${noun}s`}` : 'your upload';
  return `Thanks, ${link.agencyName} has ${count}. You can add more below if you need to.`;
}

/** The footer on a page from an Agency: who to reply to. */
const replyTo = (agencyName: string) => `Questions? Reply to any message from ${agencyName}.`;

/**
 * The page for an upload link that doesn't work. `link` is null when the token is
 * unknown (a typo, or half a link), so the page can't say who it's from; otherwise
 * the link is known but no longer takes files.
 */
function badLinkPage(link: UploadLink | null): Html {
  if (!link) {
    return publicPage({
      title: "This link has expired or isn't right",
      body: html`<p>Check you opened the whole link from the message we sent you.</p>
        <p>If it still doesn't work, reply to that message and ask for a new link.</p>`,
    });
  }
  return publicPage({
    brand: link.agencyName,
    title: 'This link has expired',
    subtitle: link.address,
    footer: replyTo(link.agencyName),
    body: html`<p>${link.agencyName} has already dealt with this issue, so this link no longer takes photos.</p>
      <p>To send more, or if something has changed, reply to the message you got from ${link.agencyName}.</p>`,
  });
}

/**
 * The upload page, worded for what the link is for: photos of an issue, or an Urgent
 * Repair receipt (a photo or a PDF). `thanks` is set after a successful upload (the ok
 * query), and `error` is the refusal shown above the form. The thank-you is a block
 * on the page rather than a flash, because a flash fades away on its own.
 */
function uploadPage(token: string, link: UploadLink, o: { error?: string; thanks?: string } = {}): Html {
  const sent = o.thanks !== undefined;
  const photos = link.kind === 'photos';
  return publicPage({
    brand: link.agencyName,
    title: photos ? 'Send photos of the issue' : 'Send your Urgent Repair receipt',
    subtitle: link.address,
    footer: replyTo(link.agencyName),
    body: html`
      ${o.thanks ? doneBox(o.thanks) : ''}
      ${card({
        title: sent ? 'Add more' : photos ? 'Choose your photos' : 'Choose your receipt',
        body: html`${o.error ? alert(o.error, 'error') : ''}
          <form method="post" action="/u/${encodeURIComponent(token)}" enctype="multipart/form-data" class="space-y-4">
            <div class="tenant-issue">
              <p class="text-sm text-muted">The issue you told us about</p>
              <p class="font-semibold text-ink">${link.description}</p>
            </div>
            ${dropZone(link.kind)}
            ${button(sent ? 'Upload more' : 'Upload', { block: true })}
          </form>`,
      })}
      ${card({
        title: 'Tips',
        body: photos
          ? html`<ul class="list-disc space-y-2 pl-5">
              <li>Take photos from a few angles, and one from further back so we can see where it is.</li>
              <li>Photos straight from your camera keep their details, like when they were taken, which helps us act faster.</li>
            </ul>`
          : html`<ul class="list-disc space-y-2 pl-5">
              <li>Make sure the whole receipt is in the photo and the amount is easy to read.</li>
              <li>If the tradie emailed you a PDF, you can send that instead.</li>
            </ul>`,
      })}
    `,
  });
}

/**
 * The file picker: a large zone that is a label for the native file input. The
 * input is visually hidden but still focusable and named; the zone shows the
 * focus ring when the input has focus. A photo link takes photos only; a receipt
 * link also takes a PDF. Below it, a line that a few lines of script fill in with
 * what was chosen ("3 photos selected" and their names), since the hidden input
 * can't show that itself. Without script the form still works.
 */
function dropZone(kind: UploadLink['kind']): Html {
  const photos = kind === 'photos';
  // A secondary control, so the page's one primary button is Upload.
  return html`<div>
    <label for="field-files" class="block cursor-pointer rounded-lg border border-control bg-page p-4 text-center has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-action">
      <span class="block text-base font-semibold text-ink">${photos ? 'Photos of the issue' : 'Photos, or a PDF receipt'}</span>
      <span class="mt-3 flex min-h-14 items-center justify-center gap-2 rounded-md border border-control bg-surface px-4 text-base font-semibold text-ink">${icon('camera')}Take or choose photos</span>
      <span id="field-files-hint" class="field-hint mt-3 block">Up to 10 files at a time, each under 10 MB.</span>
      <input id="field-files" name="files" type="file" multiple required accept="${photos ? 'image/*' : 'image/*,application/pdf'}" aria-describedby="field-files-hint" data-noun="${photos ? 'photo' : 'file'}" class="sr-only" />
    </label>
    <div id="files-chosen" class="tenant-chosen" aria-live="polite"></div>
    ${CHOSEN_SCRIPT}
  </div>`;
}

/** Fills #files-chosen with the count and names of the files picked in #field-files. */
const CHOSEN_SCRIPT = raw(`<script>
(() => {
  const input = document.getElementById('field-files');
  const out = document.getElementById('files-chosen');
  if (!input || !out) return;
  input.addEventListener('change', () => {
    out.replaceChildren();
    const chosen = Array.from(input.files || []);
    if (!chosen.length) return;
    const noun = input.dataset.noun || 'file';
    const count = document.createElement('p');
    count.className = 'font-semibold text-ink';
    count.textContent = chosen.length + ' ' + noun + (chosen.length === 1 ? '' : 's') + ' selected';
    const names = document.createElement('ul');
    for (const f of chosen) {
      const li = document.createElement('li');
      li.textContent = f.name;
      names.append(li);
    }
    out.append(count, names);
  });
})();
</script>`);

/** The confirmation after an upload: a `--done` block that stays on the page. */
function doneBox(message: string): Html {
  return html`<div role="status" class="rounded-lg border border-done bg-done-bg p-4 text-base font-semibold text-done">${message}</div>`;
}

type Step = { stage: string; at: string | null; reached: boolean; visitStart?: string; tradie?: string; trade?: Trade };

/**
 * The stages a Tenant sees. The core keeps Done and Closed apart; here they are
 * one last step, Fixed, because closing the Ticket adds nothing for the Tenant.
 * A Ticket closed with no Job done (every Job cancelled) ends at Closed instead,
 * so the page never says something was fixed when it wasn't.
 */
function tenantSteps(stages: Tracker['stages']): Step[] {
  const done = stages.find((s) => s.stage === 'done');
  const closed = stages.find((s) => s.stage === 'closed');
  const last: Step =
    !done?.reached && closed?.reached
      ? { stage: 'closed', at: closed.at, reached: true }
      : { stage: 'fixed', at: done?.at ?? null, reached: done?.reached ?? false };
  return [...stages.filter((s) => s.stage !== 'done' && s.stage !== 'closed'), last];
}

/** Who is coming: "A plumber from Drip Doctors", "Drip Doctors", or "A tradie". */
function whoIsComing(s: Step) {
  if (s.tradie && s.trade) return `${capitalise(TRADESPERSON[s.trade])} from ${s.tradie}`;
  return s.tradie ?? 'A tradie';
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One plain sentence on where the repair is up to, for the step the Tenant is at. */
function statusLine(step: Step, agencyName: string, timeZone: string): string {
  switch (step.stage) {
    case 'reported':
      return `${agencyName} has your report and is looking at it.`;
    case 'confirmed':
      return `${agencyName} has confirmed the repair and is arranging a tradie.`;
    case 'getting_quotes':
      return `${agencyName} is asking tradies to quote for the repair.`;
    case 'approved':
      return `The repair is approved. ${agencyName} is booking a visit next.`;
    case 'booked':
      return step.visitStart
        ? `${whoIsComing(step)} is booked for ${formatWhen(step.visitStart, timeZone)}.`
        : `${whoIsComing(step)} is booked.`;
    case 'fixed':
      return 'The repair is done. Thanks for letting us know about it.';
    default:
      return `${agencyName} has closed this repair.`;
  }
}

function trackerPage(progress: Tracker, link: string): Html {
  const steps = tenantSteps(progress.stages);
  const last = steps.findLastIndex((s) => s.reached);
  const current = steps[last];
  return publicPage({
    brand: progress.agencyName,
    title: progress.description,
    subtitle: progress.address,
    footer: replyTo(progress.agencyName),
    body: html`
      ${current ? html`<p class="tracker-now">${statusLine(current, progress.agencyName, progress.timeZone)}</p>` : ''}
      ${card({ title: 'Progress', body: progressList(steps, last, progress.timeZone) })}
      <aside class="tracker-share" aria-label="Share this page">
        <p>Live with someone? Send them this page so they can follow the repair too.</p>
        ${shareButton({
          title: 'Follow our repair',
          text: `Here’s where our repair is up to: ${progress.description}`,
          url: link,
          label: 'Share this page',
          note: 'Anyone with this link can see this page, so only send it to people you live with.',
          align: 'start',
        })}
      </aside>
    `,
  });
}

/** The lines under a step: who is coming and when, for the visit, or else when it happened. */
function stepDetail(s: Step, timeZone: string): string[] {
  if (s.visitStart) return [...(s.tradie ? [s.tradie] : []), `Visit ${formatWhen(s.visitStart, timeZone)}`];
  return s.at ? [formatWhen(s.at, timeZone)] : [];
}

/**
 * The stages as a vertical list. Done stages are a --done circle with a tick, the
 * current stage is an --action ring with its number, and stages still to come are
 * muted numbers. A line is coloured up to the current stage. Times are in the
 * Agency's zone. Written here rather than with ui.ts `steps`, whose fixed row
 * heights clip stages that have a detail line.
 */
function progressList(steps: Step[], current: number, timeZone: string): Html {
  return html`<ol class="m-0 list-none p-0">
    ${steps.map((s, i) => {
      const label = STAGE_LABEL[s.stage] ?? s.stage;
      const detail = stepDetail(s, timeZone);
      const reached = s.reached;
      const isCurrent = i === current;
      const lineDone = i < current;
      // The last step, once reached, is finished rather than in progress.
      const finished = isCurrent && i === steps.length - 1;
      const circle =
        isCurrent && !finished
          ? 'border-action bg-surface text-action'
          : reached
            ? 'border-done bg-done text-[var(--surface)]'
            : 'border-control bg-surface text-muted';
      const status = isCurrent && !finished ? 'Now' : reached ? 'Done' : 'To come';
      const mark = reached && (!isCurrent || finished) ? CHECK : i + 1;
      return html`<li class="relative flex gap-3 pb-6 last:pb-0" ${isCurrent ? html`aria-current="step"` : ''}>
        ${i < steps.length - 1 ? html`<span aria-hidden="true" class="absolute top-6 bottom-0 left-[11px] w-0.5 ${lineDone ? 'bg-done' : 'bg-line'}"></span>` : ''}
        <span aria-hidden="true" class="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${circle}">${mark}</span>
        <div class="min-w-0 pt-0.5">
          <p class="${reached ? 'font-semibold text-ink' : 'text-muted'}">${label}<span class="sr-only"> (${status})</span></p>
          ${detail.map((line) => html`<p class="text-sm text-muted">${line}</p>`)}
        </div>
      </li>`;
    })}
  </ol>`;
}

const CHECK = icon('check', { weight: 'bold', size: 'size-3.5' });
