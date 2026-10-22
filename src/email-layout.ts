// Every email's HTML, built from the template's plain text (docs/design-system.md,
// "Emails"). One renderer covers every template: no template writes HTML.

export interface EmailContent {
  agencyName: string;
  subject: string;
  text: string;
}

// The design system's tokens as hex: an email can't resolve a CSS variable.
const NIGHT = '#13212E';
const HARBOUR = '#1F5C8B';
const SAND = '#F4EFE6';
const SURFACE = '#FFFFFF';
const SLATE = '#55636F';
const LINE = '#D8DEE4';
// Wattle only ever marks, here as the edge of what needs the Tenant: never text, never a button.
const WATTLE = '#FFC233';

// The brand fonts won't load in most mail clients.
const FONT = "-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** The text's blocks, split at blank lines, each as its trimmed, non-empty lines. */
const blocksOf = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length);

const NUMBERED = /^(\d+)\.\s+(.+)$/;

type Block = { kind: 'paragraph'; lines: string[] } | { kind: 'list'; start: number; items: string[] };

/** A block's lines as paragraphs and ordered lists: a run of numbered lines is one list. */
function blocksIn(lines: string[]): Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const numbered = NUMBERED.exec(line);
    const last = blocks.at(-1);
    if (numbered && last?.kind === 'list') last.items.push(numbered[2]!);
    else if (numbered) blocks.push({ kind: 'list', start: Number(numbered[1]), items: [numbered[2]!] });
    else if (last?.kind === 'paragraph') last.lines.push(line);
    else blocks.push({ kind: 'paragraph', lines: [line] });
  }
  return blocks;
}

/** A web address, without the full stop, comma or bracket that ends the sentence around it. */
const URL_PATTERN = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]']/g;

/** Escaped text with its line breaks, and any web address in it as a link. */
function inline(text: string) {
  let html = '';
  let end = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    html += escapeHtml(text.slice(end, match.index)) + `<a href="${escapeHtml(match[0])}" style="color:${HARBOUR};text-decoration:underline;">${escapeHtml(match[0])}</a>`;
    end = match.index + match[0].length;
  }
  return (html + escapeHtml(text.slice(end))).replaceAll('\n', '<br>');
}

const paragraph = (text: string, margin = '0') =>
  `<p style="margin:${margin};font-family:${FONT};font-size:16px;line-height:24px;color:${NIGHT};">${inline(text)}</p>`;

// The button's label comes from the sentence the link finishes, then from the text before it.
const BUTTON_LABELS: [RegExp, string][] = [
  [/receipt/i, 'Upload receipt'],
  [/\b(quote|estimate)\b/i, 'Give your quote'],
  [/photos?/i, 'Upload photos'],
  [/progress/i, 'Follow progress'],
];

function buttonLabel(before: string) {
  const lastSentence = before.split(/(?<=[.!?])\s+/).at(-1)!;
  for (const text of [lastSentence, before]) {
    const label = BUTTON_LABELS.find(([pattern]) => pattern.test(text));
    if (label) return label[1];
  }
  return 'Open link';
}

/** The button for a link, with its address as text under it. */
const button = (url: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${HARBOUR}" style="background-color:${HARBOUR};border-radius:6px;">` +
  `<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${SURFACE};text-decoration:none;">${label}</a>` +
  '</td></tr></table>' +
  `<p style="margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${SLATE};word-break:break-all;"><a href="${escapeHtml(url)}" style="color:${SLATE};text-decoration:underline;">${escapeHtml(url)}</a></p>`;

/**
 * A paragraph's rows. A link alone, at the end, or after a colon or the end of a
 * sentence is a button on a Wattle edge, and what follows it is a paragraph of
 * its own. A link in the middle of a sentence stays a link.
 */
function paragraphRows(lines: string[]) {
  const text = lines.join('\n');
  const rows: string[] = [];
  let start = 0;
  const flush = (end: number) => {
    const run = text.slice(start, end).trim();
    if (run) rows.push(row(paragraph(run)));
  };
  for (const match of text.matchAll(URL_PATTERN)) {
    const lead = text.slice(start, match.index).trim();
    const end = match.index + match[0].length;
    const endsParagraph = /^[\s.,;:!?)]*$/.test(text.slice(end));
    if (lead && !/[:.!?]$/.test(lead) && !endsParagraph) continue;
    flush(match.index);
    rows.push(row(button(match[0], buttonLabel(lead)), { wattle: true }));
    start = end + text.slice(end).match(/^[.,;:!?)]*/)![0].length;
  }
  flush(text.length);
  return rows;
}

const list = (start: number, items: string[]) =>
  `<ol${start === 1 ? '' : ` start="${start}"`} style="margin:0;padding:0 0 0 24px;font-family:${FONT};font-size:16px;line-height:24px;color:${NIGHT};">` +
  items.map((item, i) => `<li style="margin:0${i === items.length - 1 ? '' : ' 0 8px'};padding:0 0 0 4px;">${inline(item)}</li>`).join('') +
  '</ol>';

const SPACER = '<tr><td colspan="5" height="16" style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr>';

/** The columns are the left inset (24px: 8px, the 4px Wattle edge, then 12px), the content and the right inset (24px). */
const row = (content: string, { wattle = false } = {}) =>
  `<tr><td width="8"></td><td width="4"${wattle ? ` bgcolor="${WATTLE}" style="background-color:${WATTLE};"` : ''}></td><td width="12"></td><td>${content}</td><td width="24"></td></tr>`;

/** The first sentence, for the inbox preview. */
const preheaderOf = (text: string) => text.replace(/\s+/g, ' ').trim().match(/^.*?[.!?](?=\s|$)|^.*/)![0];

export function renderEmail({ agencyName, subject, text }: EmailContent): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${SAND};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheaderOf(text))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${SAND}" style="background-color:${SAND};">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${SURFACE}" style="max-width:600px;background-color:${SURFACE};border:1px solid ${LINE};border-radius:8px;border-collapse:separate;overflow:hidden;">
<tr><td colspan="5" bgcolor="${NIGHT}" style="background-color:${NIGHT};padding:16px 24px;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${SURFACE};text-align:left;">${escapeHtml(agencyName)}</td></tr>
<tr><td colspan="5" height="32" style="height:32px;font-size:0;line-height:0;">&nbsp;</td></tr>
${blocksOf(text)
  .flatMap(blocksIn)
  .flatMap((block) => (block.kind === 'list' ? [row(list(block.start, block.items), { wattle: true })] : paragraphRows(block.lines)))
  .join(SPACER + '\n')}
<tr><td colspan="5" height="32" style="height:32px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:16px 25px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${SLATE};text-align:left;">Reply to this email to answer or ask a question.<br>Sent through myEST8</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}
