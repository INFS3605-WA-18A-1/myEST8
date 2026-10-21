// Importing from a spreadsheet, under /setup: the CSV templates, the upload, and
// the review page where the Property Manager checks each row before it's added.
//
//   GET  /setup/templates/<kind>.csv     the template: our headings and an example row
//   POST /setup/import/<kind>            upload an .xlsx or .csv, then go to its review
//   GET  /setup/imports/<token>          the review: columns, then every row and its status
//   POST /setup/imports/<token>/columns  change what a column holds
//   POST /setup/imports/<token>          "Check changes" (intent=check) or add the ticked rows (intent=add)
//   POST /setup/imports/<token>/discard  throw the upload away
//
// `from=welcome` keeps the step-by-step guide's place, so the review goes back to it.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { html } from 'hono/html';
import type { ImportPreview, ImportRow } from '../../imports.ts';
import { IMPORT_KINDS, importTemplate, type ImportKind } from '../../imports.ts';
import { ActionError, TRADES } from '../../shared.ts';
import { MAX_SHEET_BYTES } from '../../spreadsheet.ts';
import type { WebEnv } from '../env.ts';
import { files, list, text, type FormValues } from '../forms.ts';
import { icon } from '../icons.ts';
import { shellInfo } from '../shell.ts';
import { alert, badge, button, flashFrom, humanise, linkButton, page, section, type Html, type Tone } from '../ui.ts';
import { IMPORT_NOUNS, templatePath, type ImportFrom } from './onboarding-forms.ts';

const SETUP_AREA: Record<ImportKind, string> = {
  owners: 'people',
  'building-managers': 'people',
  tradies: 'tradies',
  properties: 'properties',
  tenants: 'tenants',
};

const WELCOME_STEP: Record<ImportKind, string> = {
  owners: '/welcome/property',
  'building-managers': '/welcome/property',
  tradies: '/welcome/tradies',
  properties: '/welcome/property',
  tenants: '/welcome/property',
};

const STATUS: Record<ImportRow['status'], { label: string; tone: Tone }> = {
  ready: { label: 'Ready', tone: 'success' },
  needs_fix: { label: 'Needs a fix', tone: 'warning' },
  duplicate: { label: 'Duplicate', tone: 'neutral' },
};

const isKind = (value: string): value is ImportKind => (IMPORT_KINDS as readonly string[]).includes(value);
const fromOf = (value: string | undefined): ImportFrom => (value === 'welcome' ? 'welcome' : 'setup');

/** Where an upload starts and ends: its area of /setup, or its step of the guide. */
function homeOf(kind: ImportKind, from: ImportFrom) {
  return from === 'welcome' ? `${WELCOME_STEP[kind]}?form=import-${kind}` : `/setup?form=import-${kind}`;
}

/** `path` showing a flash message, keeping any #fragment at the end. */
function flashTo(path: string, kind: 'ok' | 'error', message: string, fragment = '') {
  return `${path}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(message)}${fragment}`;
}

const count = (n: number, kind: ImportKind) => `${n} ${n === 1 ? IMPORT_NOUNS[kind].one : IMPORT_NOUNS[kind].many}`;

/** Spreadsheet import routes, mounted under /setup. */
export function importPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/templates/:file', (c) => {
    const kind = c.req.param('file').replace(/\.csv$/, '');
    if (!c.req.param('file').endsWith('.csv') || !isKind(kind)) return c.notFound();
    return c.body(importTemplate(kind), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="myest8-${kind}.csv"`,
    });
  });

  pages.post(
    '/import/:kind',
    bodyLimit({
      // Room for the multipart framing around the file.
      maxSize: MAX_SHEET_BYTES + 64 * 1024,
      onError: (c) => {
        const kind = c.req.param('kind') ?? 'owners';
        return c.redirect(flashTo(homeOf(isKind(kind) ? kind : 'owners', fromOf(c.req.query('from'))), 'error', 'That file is over 2 MB. Split the sheet, or save it as .csv.'), 303);
      },
    }),
    async (c) => {
      const kind = c.req.param('kind');
      if (!isKind(kind)) return c.notFound();
      const form = (await c.req.parseBody({ all: true })) as FormValues;
      const from = fromOf(c.req.query('from') ?? text(form, 'from'));
      const [file] = files(form, 'file');
      try {
        if (!file) throw new ActionError('invalid', 'Choose a spreadsheet to upload');
        const { token } = await c.var.actions.importSheet(kind, {
          filename: file.name,
          contentType: file.type,
          content: new Uint8Array(await file.arrayBuffer()),
        });
        return c.redirect(`/setup/imports/${token}${from === 'welcome' ? '?from=welcome' : ''}`, 303);
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        return c.redirect(flashTo(homeOf(kind, from), 'error', error.message, `#import-${kind}`), 303);
      }
    },
  );

  pages.get('/imports/:token', async (c) => {
    const from = fromOf(c.req.query('from'));
    try {
      const preview = await c.var.actions.importPreview(c.req.param('token'));
      return c.html(reviewPage(c, preview, from));
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.redirect(flashTo(from === 'welcome' ? '/welcome' : '/setup', 'error', error.message), 303);
    }
  });

  pages.post('/imports/:token/columns', async (c) => {
    const token = c.req.param('token');
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const from = fromOf(text(form, 'from'));
    const back = `/setup/imports/${token}${from === 'welcome' ? '?from=welcome' : ''}`;
    try {
      const { columns } = await c.var.actions.importPreview(token);
      await c.var.actions.remapImport(
        token,
        columns.map((col) => text(form, `column-${col.index}`) || null),
      );
      return c.redirect(flashTo(back, 'ok', 'Columns updated. Check the rows again.'), 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.redirect(flashTo(from === 'welcome' ? '/welcome' : '/setup', 'error', error.message), 303);
    }
  });

  pages.post('/imports/:token/discard', async (c) => {
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const from = fromOf(text(form, 'from'));
    const token = c.req.param('token');
    try {
      const { kind } = await c.var.actions.importPreview(token);
      await c.var.actions.discardImport(token);
      return c.redirect(flashTo(homeOf(kind, from), 'ok', 'Upload discarded. Nothing was added.', `#import-${kind}`), 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.redirect(flashTo(from === 'welcome' ? '/welcome' : '/setup', 'error', error.message), 303);
    }
  });

  pages.post('/imports/:token', async (c) => {
    const token = c.req.param('token');
    const form = (await c.req.parseBody({ all: true })) as FormValues;
    const from = fromOf(text(form, 'from'));
    const back = `/setup/imports/${token}${from === 'welcome' ? '?from=welcome' : ''}`;
    try {
      const changes = changesFrom(form);
      if (text(form, 'intent') !== 'add') {
        await c.var.actions.reviseImport(token, changes);
        return c.redirect(flashTo(back, 'ok', 'Changes checked.', '#rows'), 303);
      }
      const result = await c.var.actions.confirmImport(token, changes);
      let added = result.added ? `Added ${count(result.added, result.kind)}.` : `No ${IMPORT_NOUNS[result.kind].many} added.`;
      // Imported Properties are not geocoded. Dispatch places them, a few at a time.
      if (result.kind === 'properties' && result.added) added += ' Look up missing addresses on Dispatch places them, at most 10 a press.';
      if (result.finished) {
        const home = from === 'welcome' ? WELCOME_STEP[result.kind] : '/setup';
        return c.redirect(flashTo(home, 'ok', added, from === 'welcome' ? '' : `#${SETUP_AREA[result.kind]}`), 303);
      }
      const left = result.failed.length;
      const message = `${added} ${left === 1 ? '1 row needs' : `${left} rows need`} a fix: see below.`;
      return c.redirect(flashTo(back, result.added ? 'ok' : 'error', message, '#rows'), 303);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return c.redirect(flashTo(from === 'welcome' ? '/welcome' : '/setup', 'error', error.message), 303);
    }
  });

  return pages;
}

/** The ticked rows ("include") and the retyped cells ("row-<index>-<field>"). */
function changesFrom(form: FormValues) {
  const edits: Record<number, Record<string, string>> = {};
  for (const name of Object.keys(form)) {
    const match = /^row-(\d+)-([A-Za-z]+)$/.exec(name);
    if (!match) continue;
    (edits[Number(match[1])] ??= {})[match[2]!] = text(form, name);
  }
  return { included: list(form, 'include').map(Number), edits };
}

// The review page

function reviewPage(c: Context<WebEnv>, preview: ImportPreview, from: ImportFrom): Html {
  const { kind, rows } = preview;
  const nouns = IMPORT_NOUNS[kind];
  const counts = {
    ready: rows.filter((r) => r.status === 'ready').length,
    needsFix: rows.filter((r) => r.status === 'needs_fix').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
  };
  const adding = rows.filter((r) => r.included && r.status !== 'needs_fix').length;
  const home = from === 'welcome' ? WELCOME_STEP[kind] : `/setup#${SETUP_AREA[kind]}`;

  return page({
    title: `Review ${nouns.many}`,
    pm: c.var.pm,
    active: 'settings',
    shell: shellInfo(c),
    flash: flashFrom(c.req.url),
    subtitle: html`<span class="flex flex-wrap gap-x-4"><span>From ${preview.filename}</span>${preview.added
        ? html`<span>${count(preview.added, kind)} added so far</span>`
        : ''}</span>`,
    actions: linkButton(`Back to ${from === 'welcome' ? 'the guide' : 'Setup'}`, home, { variant: 'ghost', size: 'sm' }),
    body: html`
      <p class="import-summary" role="status">
        <span>${rows.length} ${rows.length === 1 ? 'row' : 'rows'} to review:</span>
        ${badge(`${counts.ready} ready`, 'success')} ${badge(`${counts.needsFix} ${counts.needsFix === 1 ? 'needs' : 'need'} a fix`, counts.needsFix ? 'warning' : 'neutral')}
        ${badge(`${counts.duplicate} ${counts.duplicate === 1 ? 'duplicate' : 'duplicates'}`, 'neutral')}
      </p>
      ${columnsSection(preview, from)}
      ${rowsSection(preview, from, adding)}
    `,
  });
}

const HOW: Record<ImportPreview['columns'][number]['by'], (col: ImportPreview['columns'][number], label: (key: string) => string) => Html> = {
  header: () => badge('Matched by name', 'neutral'),
  ai: () => aiMark('Matched by AI'),
  pm: () => badge('You chose', 'neutral'),
  empty: () => badge('Empty, ignored', 'neutral'),
  unsure: (col, label) =>
    html`${badge('AI not sure', 'warning')}<span class="import-note">${col.suggestion
        ? `Its guess: ${label(col.suggestion.field)}. Choose what this column holds.`
        : "Choose what this column holds, or leave it ignored."}</span>`,
};

function columnsSection(preview: ImportPreview, from: ImportFrom): Html {
  const label = (key: string) => preview.fields.find((f) => f.key === key)?.label ?? key;
  const unsure = preview.columns.filter((c) => c.by === 'unsure').length;
  return section({
    id: 'columns',
    title: 'Columns',
    body: html`
      ${unsure
        ? alert(
            `The AI wasn't sure about ${unsure === 1 ? 'one column' : `${unsure} columns`}, so ${unsure === 1 ? "it's" : "they're"} ignored until you choose.`,
            'warning',
          )
        : html`<p class="text-sm text-muted">Each column of your sheet and where it goes. Change one if it's wrong.</p>`}
      <details class="import-columns" ${unsure ? 'open' : ''}>
        <summary class="cursor-pointer font-semibold text-action">${unsure ? 'Choose columns' : `Show the ${preview.columns.length} columns`}</summary>
        <form method="post" action="/setup/imports/${preview.token}/columns" class="mt-3 flex flex-col gap-3">
          <input type="hidden" name="from" value="${from}" />
          <div class="table-frame import-stack">
            <table class="table table-sm">
              <caption class="sr-only">Columns in your sheet</caption>
              <thead>
                <tr><th scope="col">Your column</th><th scope="col">Sample values</th><th scope="col">Goes to</th><th scope="col">How</th></tr>
              </thead>
              <tbody>
                ${preview.columns.map(
                  (col) => html`<tr ${col.by === 'unsure' ? html`data-flagged` : ''}>
                    <th scope="row" class="font-semibold">${col.header}</th>
                    <td class="import-samples" data-label="Sample values">${col.samples.slice(0, 3).join(', ') || '—'}</td>
                    <td class="min-w-44" data-label="Goes to">
                      <label class="sr-only" for="column-${col.index}">Where ${col.header} goes</label>
                      <select id="column-${col.index}" name="column-${col.index}" class="select select-sm w-full">
                        <option value="">Ignore this column</option>
                        ${preview.fields.map((f) => html`<option value="${f.key}" ${col.field === f.key ? 'selected' : ''}>${f.label}</option>`)}
                      </select>
                    </td>
                    <td data-label="How"><div class="import-how">${HOW[col.by](col, label)}</div></td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>
          <div>${button('Use these columns', { variant: 'secondary', size: 'sm' })}</div>
        </form>
      </details>
    `,
  });
}

/** "Filled in by AI": the one mark for anything the classifier supplied. */
function aiMark(text = 'Filled in by AI'): Html {
  return html`<span class="import-ai">${icon('sparkle', { size: 'size-3.5', weight: 'fill' })}<span>${text}</span></span>`;
}

/** A value as the review shows it: Trades in words, empty as a dash. */
function shown(field: string, value: string | undefined): string {
  if (!value) return '—';
  if (field === 'trades') return value.split(', ').filter((t) => (TRADES as readonly string[]).includes(t)).map(humanise).join(', ') || value;
  return value;
}

function rowsSection(preview: ImportPreview, from: ImportFrom, adding: number): Html {
  const { kind, rows } = preview;
  const nouns = IMPORT_NOUNS[kind];
  // The fields with a value or a problem in some row, in the template's order.
  const fields = preview.fields.filter((f) => rows.some((r) => r.values[f.key] !== undefined || r.problems[f.key]));
  const addLabel = `Add ${adding} ${adding === 1 ? nouns.one : nouns.many}`;
  const fixing = rows.filter((r) => r.included && r.status === 'needs_fix').length;
  // A rule that filled in a field on every row is said once, under its heading.
  const shared: Record<string, string> = {};
  for (const f of fields) {
    const notes = rows.map((r) => (r.filled[f.key]?.by === 'rule' ? r.filled[f.key]!.note : null));
    if (rows.length > 1 && notes[0] && notes.every((n) => n === notes[0])) shared[f.key] = notes[0];
  }
  return section({
    id: 'rows',
    title: 'Rows',
    body: html`
      <p class="text-sm text-muted">
        Ticked rows are added. Fix the flagged cells here, or untick a row to leave it out. Duplicates start unticked.
        <a class="link" href="${templatePath(kind)}" download>Download the template</a> to see the columns myEST8 expects.
      </p>
      <form method="post" action="/setup/imports/${preview.token}" class="flex flex-col gap-3" data-import-rows data-noun-one="${nouns.one}" data-noun-many="${nouns.many}">
        <input type="hidden" name="from" value="${from}" />
        ${rows.length
          ? html`<div class="table-frame import-stack">
              <table class="table table-sm import-table">
                <caption class="sr-only">Rows from ${preview.filename}</caption>
                <thead>
                  <tr>
                    <th scope="col">Add</th>
                    <th scope="col">Row</th>
                    <th scope="col">Status</th>
                    <th scope="col">Notes</th>
                    ${fields.map((f) => html`<th scope="col">${f.label}${shared[f.key] ? html`<span class="import-note">${shared[f.key]}</span>` : ''}</th>`)}
                  </tr>
                </thead>
                <tbody>
                  ${rows.map((row) => rowHtml(preview, row, fields.map((f) => f.key), shared))}
                </tbody>
              </table>
            </div>`
          : html`<p>Every row from this upload has been added.</p>`}
        <div class="import-actions">
          <button type="submit" name="intent" value="add" class="btn btn-primary" data-import-add>${addLabel}</button>
          ${button('Check changes', { variant: 'secondary', name: 'intent', value: 'check' })}
          <button type="submit" class="btn btn-ghost" formaction="/setup/imports/${preview.token}/discard" formnovalidate>Discard upload</button>
          <span class="text-sm text-muted" aria-live="polite" data-import-count>${fixing
            ? `Plus ${fixing} ticked ${fixing === 1 ? 'row that needs' : 'rows that need'} a fix: fill in the flagged cells to add ${fixing === 1 ? 'it' : 'them'} too.`
            : ''}</span>
        </div>
      </form>
    `,
  });
}

function rowHtml(preview: ImportPreview, row: ImportRow, fields: string[], shared: Record<string, string>): Html {
  const status = STATUS[row.status];
  const id = (field: string) => `row-${row.index}-${field}`;
  const rowProblem = row.problems.row;
  const labelOf = (field: string) => preview.fields.find((f) => f.key === field)?.label ?? field;
  return html`<tr data-status="${row.status}">
    <td class="w-10 import-include">
      <input type="checkbox" class="checkbox checkbox-primary checkbox-sm" name="include" value="${row.index}" id="include-${row.index}" ${row.included ? 'checked' : ''} />
      <label class="sr-only" for="include-${row.index}">Add row ${row.line}</label>
    </td>
    <td class="num" data-label="Row">${row.line}</td>
    <td data-label="Status">${badge(status.label, status.tone)}</td>
    <td class="import-notes" data-label="Notes">
      ${row.duplicateOf ? html`<span>Already added: ${row.duplicateOf}</span>` : ''}
      ${rowProblem ? html`<span class="field-error">${rowProblem}</span>` : ''}
      ${row.notes.map((n) => html`<span>${n}</span>`)}
    </td>
    ${fields.map((field) => {
      const problem = row.problems[field];
      const filled = row.filled[field];
      if (problem) return html`<td class="import-fix" data-field="${field}" data-label="${labelOf(field)}">${fixControl(preview, row, field, id(field), problem)}</td>`;
      return html`<td data-field="${field}" data-label="${labelOf(field)}">
        <span>${shown(field, row.values[field])}</span>
        ${filled ? (filled.by === 'ai' ? aiMark() : shared[field] ? '' : html`<span class="import-note">${filled.note}</span>`) : ''}
      </td>`;
    })}
  </tr>`;
}

/** A flagged cell: its problem, and a control to fix it. Links to a record are a choice of the Agency's records. */
function fixControl(preview: ImportPreview, row: ImportRow, field: string, id: string, problem: string): Html {
  const label = `${preview.fields.find((f) => f.key === field)?.label ?? field}, row ${row.line}`;
  const value = row.values[field] ?? '';
  const choices = preview.choices[field];
  const errorId = `${id}-error`;
  const control = choices?.length
    ? html`<select id="${id}" name="${id}" class="select select-sm w-full" aria-invalid="true" aria-describedby="${errorId}">
        <option value="">Choose</option>
        ${choices.map((choice) => html`<option value="${choice}" ${choice === value ? 'selected' : ''}>${choice}</option>`)}
      </select>`
    : field === 'tenancyStart'
      ? html`<input id="${id}" name="${id}" type="date" class="input input-sm w-full" aria-invalid="true" aria-describedby="${errorId}" />`
      : html`<input id="${id}" name="${id}" class="input input-sm w-full" value="${value}" aria-invalid="true" aria-describedby="${errorId}" ${field === 'trades'
            ? html`placeholder="Plumbing, electrical"`
            : ''} />`;
  return html`<label class="sr-only" for="${id}">${label}</label>${control}<p id="${errorId}" class="field-error">${problem}</p>`;
}

