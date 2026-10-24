import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { renderEmail } from '../src/email-layout.ts';

const AGENCY = 'Harbour Realty';
const render = (text: string, overrides: { agencyName?: string; subject?: string } = {}) =>
  renderEmail({ agencyName: AGENCY, subject: 'We got your message', text, ...overrides });

/** The inner HTML of each paragraph in the body. */
const paragraphsOf = (html: string) => [...html.matchAll(/<p [^>]*>(.*?)<\/p>/gs)].map((m) => m[1]);

describe('the document', () => {
  test('is Australian English and heads the email with the Agency, not myEST8', () => {
    const html = render("Hi Kevin, this is Harbour Realty. We've got your message.");
    expect(html).toMatch(/^<!doctype html>\s*<html lang="en-AU"/i);
    expect(html).toContain('<title>We got your message</title>');
    // The header band holds the Agency's name; myEST8 is only the quiet footer line.
    expect(html).toMatch(/<td[^>]*background-color:#13212E[^>]*>\s*Harbour Realty\s*<\/td>/);
    expect(html).toContain('Sent through myEST8');
  });
});

describe('well-formed HTML', () => {
  test('every tag closes its attribute quotes, so a style never swallows the tag', () => {
    const html = render('Hi Kevin.\n\n1. One\n2. Two\n\nOpen it here: https://example.com/a?b=1&c=2');
    for (const [tag] of html.matchAll(/<[a-z][^>]*>/g)) expect(tag.match(/"/g)?.length ?? 0, tag).toSatisfy((n: number) => n % 2 === 0);
    expect(html).not.toMatch(/style="[^"]*"[^\s>\/]/);
  });
});

describe('paragraphs', () => {
  test('a blank line starts a paragraph and a single line break stays a line break', () => {
    const html = render("Hi Kevin, this is Harbour Realty.\n\nThanks for letting us know about an issue at 12 King St, Newtown.\nWe've got your message.");
    expect(paragraphsOf(html)).toEqual([
      'Hi Kevin, this is Harbour Realty.',
      'Thanks for letting us know about an issue at 12 King St, Newtown.<br>We&#39;ve got your message.',
    ]);
  });

  test('extra blank lines and trailing spaces make no empty paragraphs', () => {
    expect(paragraphsOf(render('One.  \n\n\n\nTwo.\n\n'))).toEqual(['One.', 'Two.']);
  });
});

describe('escaping', () => {
  test('a script tag and an ampersand in the text are written as text', () => {
    const html = render('Reply from Tom & Jerry: <script>alert("hi")</script>');
    expect(paragraphsOf(html)).toEqual(['Reply from Tom &amp; Jerry: &lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt;']);
    expect(html).not.toContain('<script');
  });

  test('the Agency name and subject are escaped too', () => {
    const html = render('Hello.', { agencyName: 'Smith & Co <Property>', subject: 'Re: <b>keys</b>' });
    expect(html).toContain('<title>Re: &lt;b&gt;keys&lt;/b&gt;</title>');
    expect(html).toContain('>Smith &amp; Co &lt;Property&gt;</td>');
    expect(html).not.toContain('<Property>');
    expect(html).not.toContain('<b>keys');
  });
});

describe('the preheader', () => {
  const preheaderOf = (html: string) => html.match(/<div style="display:none[^>]*>(.*?)<\/div>/s)?.[1];

  test('is the first sentence, hidden, for the inbox preview', () => {
    const html = render("Hi Kevin, this is Harbour Realty. Thanks for letting us know about an issue at 12 King St.\nWe've got your message.");
    expect(preheaderOf(html)).toBe('Hi Kevin, this is Harbour Realty.');
  });

  test('is the whole text when it has no full stop, and is escaped', () => {
    expect(preheaderOf(render('Is the tap <b>still</b> dripping & worse'))).toBe('Is the tap &lt;b&gt;still&lt;/b&gt; dripping &amp; worse');
  });

  test('keeps a link in a sentence whole', () => {
    expect(preheaderOf(render('Follow it here: https://myest8.test/t/abc.def Thanks.'))).toBe('Follow it here: https://myest8.test/t/abc.def Thanks.');
  });
});

describe('numbered questions', () => {
  const MISSING_DETAILS =
    'Thanks, Kevin. To get this sorted we just need:\n' +
    '1. Is it getting worse? (yes or no)\n' +
    '2. When are you usually home: weekday mornings, weekday afternoons, Saturdays or any time?\n\n' +
    'Reply to this email with your answers.';
  const itemsOf = (html: string) => [...html.matchAll(/<li [^>]*>(.*?)<\/li>/gs)].map((m) => m[1]);

  test('lines starting 1. and 2. are an ordered list between the paragraphs around them', () => {
    const html = render(MISSING_DETAILS);
    expect(html.match(/<ol[ >]/g)).toHaveLength(1);
    expect(itemsOf(html)).toEqual([
      'Is it getting worse? (yes or no)',
      'When are you usually home: weekday mornings, weekday afternoons, Saturdays or any time?',
    ]);
    expect(paragraphsOf(html)).toEqual(['Thanks, Kevin. To get this sorted we just need:', 'Reply to this email with your answers.']);
    // The list sits between the two paragraphs, in the order the text had them.
    expect(html.indexOf('To get this sorted')).toBeLessThan(html.indexOf('<ol'));
    expect(html.indexOf('</ol>')).toBeLessThan(html.indexOf('Reply to this email with'));
  });

  test('the numbers stay the ones in the text when a list starts part-way', () => {
    expect(render('3. Fix the tap\n4. Fix the sink')).toContain('<ol start="3"');
    expect(render('1. Fix the tap')).not.toContain('start=');
  });

  test('a list item is escaped', () => {
    expect(itemsOf(render('1. Is it <b>worse</b> & wet?'))).toEqual(['Is it &lt;b&gt;worse&lt;/b&gt; &amp; wet?']);
  });

  test('a line that starts with a decimal is not a list', () => {
    const html = render('12.5 litres leaked overnight.\n2.5 more this morning.');
    expect(html).not.toContain('<ol');
    expect(paragraphsOf(html)).toEqual(['12.5 litres leaked overnight.<br>2.5 more this morning.']);
  });

  test('the questions have a Wattle edge, because they need the Tenant', () => {
    const html = render(MISSING_DETAILS);
    expect(html.match(/<td width="4" bgcolor="#FFC233"/g)).toHaveLength(1);
    // The edge is on the list's row only.
    const edged = html.match(/<tr><td width="8"><\/td><td width="4" bgcolor="#FFC233"[^>]*><\/td>.*?<\/tr>/s)![0];
    expect(edged).toContain('<ol');
    expect(edged).not.toContain('<p ');
  });

  test('an email that asks for nothing has no Wattle', () => {
    expect(render("Hi Kevin, this is Harbour Realty. We've got your message.")).not.toContain('#FFC233');
  });
});

describe('links', () => {
  const linksOf = (html: string) => [...html.matchAll(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ href: m[1], text: m[2] }));
  const UPLOAD = 'https://myest8.test/upload/Ab12Cd34';

  test('the photo upload link is a button labelled by what it does, with the address shown under it', () => {
    const html = render(`Thanks. Please upload a few photos of the issue here, straight from your phone: ${UPLOAD}`);
    expect(paragraphsOf(html)).toEqual(['Thanks. Please upload a few photos of the issue here, straight from your phone:', expect.stringContaining(UPLOAD)]);
    expect(linksOf(html)).toEqual([
      { href: UPLOAD, text: 'Upload photos' },
      { href: UPLOAD, text: UPLOAD },
    ]);
    // The button is the one Harbour fill, white on it.
    expect(html).toMatch(/<td bgcolor="#1F5C8B"[^>]*><a href="[^"]*"[^>]*color:#FFFFFF[^>]*>Upload photos<\/a>/);
  });

  test('a button sits on the same Wattle edge as the questions, with its address', () => {
    const html = render(`Thanks, we have your 2 photos. Add more here if it helps: ${UPLOAD}`);
    const edged = html.match(/<tr><td width="8"><\/td><td width="4" bgcolor="#FFC233".*?<td width="24"><\/td><\/tr>/s)![0];
    expect(edged).not.toContain('Thanks, we have');
    expect(edged).toContain('>Upload photos<');
    expect(edged).toContain(`>${UPLOAD}</a>`);
  });

  test.each([
    ['photos already sent', 'Upload photos', `Thanks, we have your 2 photos. Add more here if it helps: ${UPLOAD}`],
    ['the receipt for an urgent repair', 'Upload receipt', `When it's done, send us the receipt (a photo or PDF) here, and we'll pass your Reimbursement Request to the property owner: ${UPLOAD}`],
    ['a quote request', 'Give your quote', `Give your Estimate (a ballpark from the description and photos) here: ${UPLOAD}`],
    ['a Firm Quote request', 'Give your quote', `Please give Harbour Realty your Firm Quote: your fixed price, the scope of work: ${UPLOAD}`],
    ['a reminder to quote', 'Give your quote', `Reminder from Harbour Realty: can you give an Estimate for the plumbing job in Newtown? ${UPLOAD}`],
    ['the progress tracker', 'Follow progress', `Your maintenance request is confirmed. Follow its progress here: ${UPLOAD}`],
    ['wording that says nothing about it', 'Open link', `Details are in the document we sent you yesterday afternoon: ${UPLOAD}`],
  ])('%s: the button says "%s"', (_, label, text) => {
    expect(linksOf(render(text))[0]).toEqual({ href: UPLOAD, text: label });
  });

  test("a description with 'receipt' in it doesn't relabel a quote button", () => {
    const text = `Quote request: plumbing job (routine). Issue: receipt printer leaking. Give your Estimate here: ${UPLOAD}`;
    expect(linksOf(render(text))[0]!.text).toBe('Give your quote');
  });

  test('a link in the middle of the text is a button, with the words after it in their own paragraph', () => {
    const html = render(`Give your Estimate here (your fixed price): ${UPLOAD} Or reply with a ballpark price, or NO to decline.`);
    expect(paragraphsOf(html)).toEqual([
      'Give your Estimate here (your fixed price):',
      expect.stringContaining(UPLOAD),
      'Or reply with a ballpark price, or NO to decline.',
    ]);
    expect(linksOf(html)[0]).toEqual({ href: UPLOAD, text: 'Give your quote' });
  });

  test('an address on its own line is a button', () => {
    const html = render(`Your code is ready.\n\n${UPLOAD}`);
    expect(paragraphsOf(html)[0]).toBe('Your code is ready.');
    expect(linksOf(html)[0]).toEqual({ href: UPLOAD, text: 'Open link' });
  });

  test('a line that is only a short label, a colon and an address is a button labelled with that text, and the label is not also a paragraph', () => {
    const html = render(
      "Pete's Plumbing (plumbing) can visit. Pick a time.\n\n" +
        'Tue 27 Oct, 9:00 am: https://myest8.test/v/abc?pick=1\n\n' +
        'Wed 28 Oct, 1:00 pm: https://myest8.test/v/abc?pick=2\n\n' +
        'None of these work: https://myest8.test/v/abc?pick=none',
    );
    const buttons = linksOf(html).filter((_, i) => i % 2 === 0);
    expect(buttons).toEqual([
      { href: 'https://myest8.test/v/abc?pick=1', text: 'Tue 27 Oct, 9:00 am' },
      { href: 'https://myest8.test/v/abc?pick=2', text: 'Wed 28 Oct, 1:00 pm' },
      { href: 'https://myest8.test/v/abc?pick=none', text: 'None of these work' },
    ]);
    // The label became the button, so it is not printed again above it.
    expect(paragraphsOf(html).filter((p) => !p.startsWith('<a '))).toEqual(["Pete&#39;s Plumbing (plumbing) can visit. Pick a time."]);
    expect(html).not.toContain('Tue 27 Oct, 9:00 am:');
    expect(html).not.toContain('None of these work:');
  });

  test("a preferred time is a Harbour button, with Tradie's preferred time under it and not in the label", () => {
    const html = render('Tue 27 Oct, 9:00 am (preferred): https://myest8.test/v/abc?pick=1');
    expect(linksOf(html)[0]).toEqual({ href: 'https://myest8.test/v/abc?pick=1', text: 'Tue 27 Oct, 9:00 am' });
    expect(html).toContain('Tradie&#39;s preferred time');
    expect(html).toMatch(/<td bgcolor="#1F5C8B"[^>]*>\s*<a [^>]*color:#FFFFFF[^>]*>Tue 27 Oct, 9:00 am<\/a>/);
    expect(html).not.toContain('>(preferred)<');
  });

  test('Need another time? is an outlined Harbour button on white, decided from the label', () => {
    const html = render('Need another time?: https://myest8.test/v/confirm/abc?another=1');
    expect(linksOf(html)[0]).toEqual({ href: 'https://myest8.test/v/confirm/abc?another=1', text: 'Need another time?' });
    expect(html).toMatch(/<td bgcolor="#FFFFFF"[^>]*border:1px solid #1F5C8B[^>]*>\s*<a [^>]*color:#1F5C8B[^>]*>Need another time\?<\/a>/);
    expect(html).not.toMatch(/<td bgcolor="#1F5C8B"[^>]*>\s*<a [^>]*>Need another time\?<\/a>/);
  });

  test('a time is a Harbour button, and None of these work is an outlined Harbour button on white', () => {
    const html = render(
      'Tue 27 Oct, 9:00 am: https://myest8.test/v/abc?pick=1\n\n' +
        'None of these work: https://myest8.test/v/abc?pick=none',
    );
    expect(html).toMatch(/<td bgcolor="#1F5C8B"[^>]*>\s*<a [^>]*color:#FFFFFF[^>]*>Tue 27 Oct, 9:00 am<\/a>/);
    expect(html).toMatch(/<td bgcolor="#FFFFFF"[^>]*border:1px solid #1F5C8B[^>]*>\s*<a [^>]*color:#1F5C8B[^>]*>None of these work<\/a>/);
  });

  test('a label of 40 characters names the button, and one of 41 falls back to Open link', () => {
    const forty = 'a'.repeat(40);
    const fortyOne = 'a'.repeat(41);
    expect(linksOf(render(`${forty}: ${UPLOAD}`))[0]).toEqual({ href: UPLOAD, text: forty });
    expect(linksOf(render(`${fortyOne}: ${UPLOAD}`))[0]).toEqual({ href: UPLOAD, text: 'Open link' });
  });

  test('a short label is escaped, so a name with an ampersand stays text', () => {
    const html = render('Tom & Co: https://example.com/x');
    expect(linksOf(html)[0]).toEqual({ href: 'https://example.com/x', text: 'Tom &amp; Co' });
    expect(html).not.toContain('>Tom & Co<');
  });

  test('an address inside a sentence stays a link in that sentence', () => {
    const html = render('The warranty terms are at https://example.com/warranty if you need them.');
    expect(paragraphsOf(html)).toEqual([expect.stringMatching(/^The warranty terms are at <a href="https:\/\/example\.com\/warranty"[^>]*>https:\/\/example\.com\/warranty<\/a> if you need them\.$/)]);
    expect(linksOf(html)).toEqual([{ href: 'https://example.com/warranty', text: 'https://example.com/warranty' }]);
    expect(html).not.toContain('#FFC233');
  });

  test('a full stop or bracket after an address is not part of it', () => {
    expect(linksOf(render('Details at https://example.com/guide.'))[0]!.href).toBe('https://example.com/guide');
    expect(linksOf(render('Use the form (https://example.com/form) today.'))[0]!.href).toBe('https://example.com/form');
  });

  test('an ampersand in an address is escaped in the link and in the text', () => {
    const html = render('Open it here: https://example.com/a?b=1&c=2');
    expect(linksOf(html)).toEqual([
      { href: 'https://example.com/a?b=1&amp;c=2', text: 'Open it here' },
      { href: 'https://example.com/a?b=1&amp;c=2', text: 'https://example.com/a?b=1&amp;c=2' },
    ]);
  });

  test('only web addresses become links', () => {
    const html = render('Click javascript:alert(1) or ftp://example.com/file or mailto:kev@example.com');
    expect(html).not.toContain('<a ');
  });
});

describe('the design tokens', () => {
  // An email can't use var(), so the renderer holds the tokens' hex values: the app's CSS is the source.
  const css = readFileSync(new URL('../src/web/static/app.css', import.meta.url), 'utf8');
  const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))![1]!.toUpperCase();

  test.each([
    ['ink', 'Night'],
    ['page', 'Sand'],
    ['surface', 'white'],
    ['muted', 'Slate'],
    ['line', 'Line'],
    ['action', 'Harbour'],
    ['hivis', 'Wattle'],
  ])('--%s (%s) is the colour the email uses', (name) => {
    const html = render('Hi.\n\n1. One\n\nOpen it here: https://example.com/a');
    expect(html).toContain(token(name));
  });

  test('the email uses no other colour', () => {
    const html = render('Hi.\n\n1. One\n\nOpen it here: https://example.com/a');
    const allowed = ['ink', 'page', 'surface', 'muted', 'line', 'action', 'hivis'].map(token);
    for (const [hex] of html.matchAll(/#[0-9a-f]{3,8}\b/gi)) expect(allowed).toContain(hex.toUpperCase());
  });
});
