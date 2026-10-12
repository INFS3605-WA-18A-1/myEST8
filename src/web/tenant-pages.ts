// The two pages a Tenant reaches by a no-login link (ADR-0002): the upload page for
// issue photos or an Urgent Repair receipt, and the progress tracker. Phone first,
// no JavaScript. The upload page can't tell an issue link from a receipt link
// before it's used, so it is worded for both, and an unknown or expired link only
// shows up when the Tenant submits.

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { html } from 'hono/html';
import type { App, Upload } from '../app.ts';
import { ActionError } from '../shared.ts';
import { files, type FormValues } from './forms.ts';
import { shareButton, shareUrl } from './share.ts';
import { icon } from './icons.ts';
import { alert, button, card, formatWhen, publicPage, type Html } from './ui.ts';

const MB = 1024 * 1024;
const MAX_FILES = 10;
const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;
const TRACKER_FOOTER = 'Questions? Reply to any of our messages.';

/** Tracker stages in the words a Tenant sees. */
const STAGE_LABEL: Record<string, string> = {
  reported: 'Reported',
  confirmed: 'Confirmed',
  getting_quotes: 'Getting quotes',
  approved: 'Approved',
  booked: 'Booked',
  done: 'Done',
  closed: 'Closed',
};

/** The no-login pages: GET/POST /u/:token (upload) and GET /t/:token (progress tracker). */
export function tenantPages(app: App) {
  const pages = new Hono();

  pages.get('/u/:token', (c) => {
    const token = c.req.param('token');
    const ok = c.req.query('ok');
    return c.html(uploadPage(token, ok === undefined ? {} : { thanks: thanks(Number(ok)) }));
  });

  pages.post(
    '/u/:token',
    // Ten files of up to 10 MB each, plus the multipart framing.
    bodyLimit({
      maxSize: (MAX_FILES * 10 + 5) * MB,
      onError: (c) =>
        c.html(uploadPage(c.req.param('token') ?? '', { error: 'That was too much in one go. Send up to 10 files at a time, each under 10 MB.' }), 413),
    }),
    async (c) => {
      const token = c.req.param('token');
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
        const message =
          error.code === 'not_found'
            ? "This upload link doesn't work. Check you opened the whole link from our message, or simply reply to that message."
            : error.message;
        return c.html(uploadPage(token, { error: message }), STATUS[error.code]);
      }
      return c.redirect(`/u/${encodeURIComponent(token)}?ok=${uploads.length}`, 303);
    },
  );

  pages.get('/t/:token', async (c) => {
    let progress: Awaited<ReturnType<App['tracker']>>;
    try {
      progress = await app.tracker(c.req.param('token'));
    } catch (error) {
      if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
      return c.html(
        publicPage({
          title: "We couldn't find that link",
          body: html`<p>Check you opened the whole link from our message. If it still doesn't work, reply to any of our messages and we'll help.</p>`,
        }),
        404,
      );
    }
    return c.html(trackerPage(progress, shareUrl(c)));
  });

  return pages;
}

function thanks(sent: number) {
  const count = Number.isInteger(sent) && sent > 0 && sent <= MAX_FILES ? `your ${sent === 1 ? 'file' : `${sent} files`}` : 'your upload';
  return `Thanks, we've got ${count}. You can add more below if you need to.`;
}

/**
 * The upload page. `thanks` is set after a successful upload (the ok query), and
 * `error` is the refusal shown above the form. The thank-you is a block on the page
 * rather than a flash, because a flash fades away on its own.
 */
function uploadPage(token: string, o: { error?: string; thanks?: string } = {}): Html {
  const sent = o.thanks !== undefined;
  return publicPage({
    title: 'Upload photos or your receipt',
    body: html`
      ${o.thanks ? doneBox(o.thanks) : ''}
      ${card({
        title: sent ? 'Add more' : 'Choose your files',
        body: html`${o.error ? alert(o.error, 'error') : ''}
          <form method="post" action="/u/${encodeURIComponent(token)}" enctype="multipart/form-data" class="space-y-4">
            <p>No account needed: this link is just for the issue you told us about.</p>
            ${dropZone()}
            ${button(sent ? 'Upload more' : 'Upload', { block: true })}
          </form>`,
      })}
      ${card({
        title: 'Tips',
        body: html`<ul class="list-disc space-y-2 pl-5">
          <li>Take photos from a few angles, and one from further back so we can see where it is.</li>
          <li>Photos straight from your camera keep their details, like when they were taken, which helps us act faster.</li>
          <li>For an Urgent Repair receipt, send a photo or a PDF of it.</li>
        </ul>`,
      })}
    `,
  });
}

/**
 * The file picker: a large zone that is a label for the native file input. The
 * input is visually hidden but still focusable and named; the zone shows the
 * focus ring when the input has focus.
 */
function dropZone(): Html {
  // A secondary control, so the page's one primary button is Upload.
  return html`<label for="field-files" class="block cursor-pointer rounded-lg border border-control bg-page p-4 text-center has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-action">
    <span class="block text-base font-semibold text-ink">Photos or receipt</span>
    <span class="mt-3 flex min-h-14 items-center justify-center rounded-md border border-control bg-surface px-4 text-base font-semibold text-ink">Choose photos or a PDF</span>
    <span id="field-files-hint" class="field-hint mt-3 block">Up to 10 files at a time, each under 10 MB.</span>
    <input id="field-files" name="files" type="file" multiple required accept="image/*,application/pdf" aria-describedby="field-files-hint" class="sr-only" />
  </label>`;
}

/** The confirmation after an upload: a `--done` block that stays on the page. */
function doneBox(message: string): Html {
  return html`<div role="status" class="rounded-lg border border-done bg-done-bg p-4 text-base font-semibold text-done">${message}</div>`;
}

function trackerPage(progress: Awaited<ReturnType<App['tracker']>>, link: string): Html {
  const last = progress.stages.findLastIndex((s) => s.reached);
  const current = progress.stages[last];
  return publicPage({
    title: progress.description,
    footer: TRACKER_FOOTER,
    body: html`
      ${current ? html`<p class="text-2xl leading-snug font-semibold">Now: ${STAGE_LABEL[current.stage] ?? current.stage}</p>` : ''}
      ${card({ title: 'Progress', body: progressList(progress.stages, last, progress.timeZone) })}
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

/**
 * The stages as a vertical list. Done stages are a --done circle with a tick, the
 * current stage is an --action ring with its number, and stages still to come are
 * muted numbers. A line is coloured up to the current stage. Times are in the
 * Agency's zone. Written here rather than with ui.ts `steps`, whose fixed row
 * heights clip stages that have a detail line.
 */
function progressList(stages: Awaited<ReturnType<App['tracker']>>['stages'], current: number, timeZone: string): Html {
  return html`<ol class="m-0 list-none p-0">
    ${stages.map((s, i) => {
      const label = STAGE_LABEL[s.stage] ?? s.stage;
      const detail = s.visitStart ? `Visit ${formatWhen(s.visitStart, timeZone)}` : s.at ? formatWhen(s.at, timeZone) : '';
      const reached = s.reached;
      const isCurrent = i === current;
      const lineDone = i < current;
      const circle = isCurrent
        ? 'border-action bg-surface text-action'
        : reached
          ? 'border-done bg-done text-[var(--surface)]'
          : 'border-control bg-surface text-muted';
      const status = isCurrent ? 'Now' : reached ? 'Done' : 'To come';
      const mark = reached && !isCurrent ? CHECK : i + 1;
      return html`<li class="relative flex gap-3 pb-6 last:pb-0" ${isCurrent ? html`aria-current="step"` : ''}>
        ${i < stages.length - 1 ? html`<span aria-hidden="true" class="absolute top-6 bottom-0 left-[11px] w-0.5 ${lineDone ? 'bg-done' : 'bg-line'}"></span>` : ''}
        <span aria-hidden="true" class="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${circle}">${mark}</span>
        <div class="min-w-0 pt-0.5">
          <p class="${reached ? 'font-semibold text-ink' : 'text-muted'}">${label}<span class="sr-only"> (${status})</span></p>
          ${detail ? html`<p class="text-sm text-muted">${detail}</p>` : ''}
        </div>
      </li>`;
    })}
  </ol>`;
}

const CHECK = icon('check', { weight: 'bold', size: 'size-3.5' });
