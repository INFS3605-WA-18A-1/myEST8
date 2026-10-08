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
import { button, card, field, formatWhen, publicPage, steps, type Flash, type Html } from './ui.ts';

const MB = 1024 * 1024;
const MAX_FILES = 10;
const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;

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
    const ok = c.req.query('ok');
    const sent = ok === undefined ? null : Number(ok);
    return c.html(uploadPage(c.req.param('token'), sent === null ? null : { kind: 'ok', message: thanks(sent) }, sent !== null));
  });

  pages.post(
    '/u/:token',
    // Ten files of up to 10 MB each, plus the multipart framing.
    bodyLimit({
      maxSize: (MAX_FILES * 10 + 5) * MB,
      onError: (c) =>
        c.html(uploadPage(c.req.param('token') ?? '', { kind: 'error', message: 'That was too much in one go. Send up to 10 files at a time, each under 10 MB.' }), 413),
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
        return c.html(uploadPage(token, { kind: 'error', message }), STATUS[error.code]);
      }
      return c.redirect(`/u/${encodeURIComponent(token)}?ok=${uploads.length}`, 303);
    },
  );

  pages.get('/t/:token', (c) => {
    let progress: ReturnType<App['tracker']>;
    try {
      progress = app.tracker(c.req.param('token'));
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
    return c.html(trackerPage(progress));
  });

  return pages;
}

function thanks(sent: number) {
  const count = Number.isInteger(sent) && sent > 0 && sent <= MAX_FILES ? `your ${sent === 1 ? 'file' : `${sent} files`}` : 'your upload';
  return `Thanks, we've got ${count}. You can add more below if you need to.`;
}

function uploadPage(token: string, flash: Flash | null, sent = false): Html {
  return publicPage({
    title: 'Upload photos or your receipt',
    flash,
    body: html`
      <p>No account needed: this link is just for the issue you told us about.</p>
      ${card({
        title: sent ? 'Add more' : 'Choose your files',
        body: html`<form method="post" action="/u/${encodeURIComponent(token)}" enctype="multipart/form-data" class="space-y-3">
          ${field({
            label: 'Photos or receipt',
            name: 'files',
            type: 'file',
            multiple: true,
            required: true,
            accept: 'image/*,application/pdf',
            hint: 'Up to 10 files at a time, each under 10 MB.',
          })}
          ${button(sent ? 'Upload more' : 'Upload')}
        </form>`,
      })}
      ${card({
        title: 'Tips',
        body: html`<ul class="list-disc space-y-1 pl-5">
          <li>Take photos from a few angles, and one from further back so we can see where it is.</li>
          <li>Photos straight from your camera keep their details, like when they were taken, which helps us act faster.</li>
          <li>For an Urgent Repair receipt, send a photo or a PDF of it.</li>
        </ul>`,
      })}
    `,
  });
}

function trackerPage(progress: ReturnType<App['tracker']>): Html {
  const current = progress.stages.filter((s) => s.reached).at(-1);
  return publicPage({
    title: 'Your repair progress',
    body: html`
      ${card({ title: 'What you reported', body: html`<p class="whitespace-pre-line">${progress.description}</p>` })}
      ${current ? html`<p>Now: <strong>${STAGE_LABEL[current.stage] ?? current.stage}</strong></p>` : ''}
      ${steps(
        progress.stages.map((s) => ({
          label: STAGE_LABEL[s.stage] ?? s.stage,
          done: s.reached,
          detail: s.visitStart ? `Visit ${formatWhen(s.visitStart)}` : s.at ? formatWhen(s.at) : undefined,
        })),
      )}
      <p class="text-sm">Times are Sydney time. Questions? Reply to any of our messages.</p>
    `,
  });
}
