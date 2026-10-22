// Every email's HTML, built from the template's plain text (docs/design-system.md,
// "Emails"). One renderer covers every template: no template writes HTML.

export interface EmailContent {
  agencyName: string;
  subject: string;
  text: string;
}

// The design system's tokens as hex: an email can't resolve a CSS variable.
const NIGHT = '#13212E';
const SAND = '#F4EFE6';
const SURFACE = '#FFFFFF';
const SLATE = '#55636F';
const LINE = '#D8DEE4';

// The brand fonts won't load in most mail clients.
const FONT = '-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** The text's blocks, split at blank lines, each as its trimmed, non-empty lines. */
const blocksOf = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length);

const paragraph = (lines: string[]) =>
  `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:24px;color:${NIGHT};">${lines.map(escapeHtml).join('<br>')}</p>`;

const SPACER = '<tr><td colspan="4" height="16" style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr>';

/** The columns are the Wattle edge (4px), a gap (20px), the content and the right inset (24px). */
const row = (content: string) => `<tr><td width="4"></td><td width="20"></td><td>${content}</td><td width="24"></td></tr>`;

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
<tr><td colspan="4" bgcolor="${NIGHT}" style="background-color:${NIGHT};padding:16px 24px;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${SURFACE};text-align:left;">${escapeHtml(agencyName)}</td></tr>
<tr><td colspan="4" height="32" style="height:32px;font-size:0;line-height:0;">&nbsp;</td></tr>
${blocksOf(text).map((lines) => row(paragraph(lines))).join(SPACER + '\n')}
<tr><td colspan="4" height="32" style="height:32px;font-size:0;line-height:0;">&nbsp;</td></tr>
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
