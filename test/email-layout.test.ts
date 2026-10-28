import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { renderEmail } from '../src/email-layout.ts';
import { templates, type TemplateData, type TemplateName } from '../src/templates.ts';

const AGENCY = 'Harbour Realty';
const render = (text: string, overrides: { agencyName?: string; subject?: string } = {}) =>
  renderEmail({ agencyName: AGENCY, subject: 'We got your message', text, ...overrides });

/** The inner HTML of each paragraph in the body. */
const paragraphsOf = (html: string) => [...html.matchAll(/<p [^>]*>(.*?)<\/p>/gs)].map((m) => m[1]);

/** What a reader sees, hidden preheader included: the HTML with its tags, and so their attributes, taken out. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replaceAll('&amp;', '&');

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

  test('stops before a web address, so the address never shows as text', () => {
    expect(preheaderOf(render('Follow it here: https://myest8.test/t/abc.def Thanks.'))).toBe('Follow it here:');
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

  test('the photo upload link is a button labelled by what it does, and the address is only in its href', () => {
    const html = render(`Thanks. Please upload a few photos of the issue here, straight from your phone: ${UPLOAD}`);
    // The sentence ending "here: <url>" is a paragraph, then the button.
    expect(paragraphsOf(html)).toEqual(['Thanks. Please upload a few photos of the issue here, straight from your phone:']);
    expect(html.indexOf('straight from your phone:')).toBeLessThan(html.indexOf(`<a href="${UPLOAD}"`));
    expect(linksOf(html)).toEqual([{ href: UPLOAD, text: 'Upload photos' }]);
    expect(textOf(html)).not.toContain(UPLOAD);
    // The button is the one Harbour fill, white on it.
    expect(html).toMatch(/<td bgcolor="#1F5C8B"[^>]*><a href="[^"]*"[^>]*color:#FFFFFF[^>]*>Upload photos<\/a>/);
  });

  test('a button sits on the same Wattle edge as the questions, with no address under it', () => {
    const html = render(`Thanks, we have your 2 photos. Add more here if it helps: ${UPLOAD}`);
    const edged = html.match(/<tr><td width="8"><\/td><td width="4" bgcolor="#FFC233".*?<td width="24"><\/td><\/tr>/s)![0];
    expect(edged).not.toContain('Thanks, we have');
    expect(edged).toContain('>Upload photos<');
    expect(edged).not.toContain(`>${UPLOAD}<`);
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
    expect(paragraphsOf(html)).toEqual(['Give your Estimate here (your fixed price):', 'Or reply with a ballpark price, or NO to decline.']);
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
    expect(linksOf(html)).toEqual([
      { href: 'https://myest8.test/v/abc?pick=1', text: 'Tue 27 Oct, 9:00 am' },
      { href: 'https://myest8.test/v/abc?pick=2', text: 'Wed 28 Oct, 1:00 pm' },
      { href: 'https://myest8.test/v/abc?pick=none', text: 'None of these work' },
    ]);
    // The label became the button, so it is not printed again above it.
    expect(paragraphsOf(html)).toEqual(["Pete&#39;s Plumbing (plumbing) can visit. Pick a time."]);
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

  test('an address inside a sentence is a button too: the sentence breaks around it and the address is never text', () => {
    const html = render('The warranty terms are at https://example.com/warranty if you need them.');
    expect(paragraphsOf(html)).toEqual(['The warranty terms are at', 'if you need them.']);
    expect(linksOf(html)).toEqual([{ href: 'https://example.com/warranty', text: 'Open link' }]);
    expect(textOf(html)).not.toContain('https://');
  });

  test('a numbered line with an address is a paragraph and a button, not a list item showing the address', () => {
    const html = render(`1. Please upload a few photos of the issue from your phone here: ${UPLOAD}`);
    expect(html).not.toContain('<ol');
    expect(linksOf(html)).toEqual([{ href: UPLOAD, text: 'Upload photos' }]);
    expect(textOf(html)).not.toContain(UPLOAD);
  });

  test('a full stop or bracket after an address is not part of it, and the brackets around it go', () => {
    expect(linksOf(render('Details at https://example.com/guide.'))[0]!.href).toBe('https://example.com/guide');
    const bracketed = render('Use the form (https://example.com/form) today.');
    expect(linksOf(bracketed)[0]!.href).toBe('https://example.com/form');
    expect(paragraphsOf(bracketed)).toEqual(['Use the form', 'today.']);
  });

  test('an ampersand in an address is escaped in the link', () => {
    const html = render('Open it here: https://example.com/a?b=1&c=2');
    expect(linksOf(html)).toEqual([{ href: 'https://example.com/a?b=1&amp;c=2', text: 'Open it here' }]);
  });

  test('only web addresses become links', () => {
    const html = render('Click javascript:alert(1) or ftp://example.com/file or mailto:kev@example.com');
    expect(html).not.toContain('<a ');
  });
});

describe('details', () => {
  const QUOTE =
    'Harbour Realty is asking for a quote.\n\n' +
    'Trade: Plumbing\n' +
    'Suburb: Newtown\n' +
    'Urgency: Routine\n' +
    'Issue: The kitchen tap is dripping\n\n' +
    'Give your quote: https://myest8.test/q/abc\n\n' +
    "Can't take this job: https://myest8.test/q/abc/decline";

  const cellsOf = (html: string) =>
    [...html.matchAll(/<td[^>]*font-size:14px[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>/gs)].map((m) => ({ label: m[1], value: m[2] }));

  test('two or more Label: value lines are a details table, labels in Slate and values in Night', () => {
    const html = render(QUOTE);
    expect(cellsOf(html)).toEqual([
      { label: 'Trade', value: 'Plumbing' },
      { label: 'Suburb', value: 'Newtown' },
      { label: 'Urgency', value: 'Routine' },
      { label: 'Issue', value: 'The kitchen tap is dripping' },
    ]);
    expect(html).toMatch(/color:#55636F[^>]*>Trade</);
    expect(html).toMatch(/color:#13212E[^>]*>Plumbing</);
    // The lines became the table, so they are not also printed as paragraphs.
    expect(html).not.toContain('Trade: Plumbing');
    expect(html).not.toContain('Issue: The kitchen tap');
    expect(paragraphsOf(html)).toEqual(['Harbour Realty is asking for a quote.']);
    // Details are not a decision, so they take no Wattle edge.
    expect(html.match(/<td width="4" bgcolor="#FFC233"/g)).toHaveLength(2);
  });

  test('a URL value stays a button, and a single Label: value line stays a paragraph', () => {
    const html = render('Trade: Plumbing\n\nGive your quote: https://myest8.test/q/abc');
    expect(html).not.toMatch(/font-size:14px/);
    expect(paragraphsOf(html)).toEqual(['Trade: Plumbing']);
    expect(linksOf(html)[0]).toEqual({ href: 'https://myest8.test/q/abc', text: 'Give your quote' });
  });

  test('a value with a colon stays whole, and a label longer than 24 characters is not a detail', () => {
    const html = render("Issue: The tap: it's dripping\nSuburb: Newtown\n\nabcdefghijklmnopqrstuvwxy: kept as text\nUrgency: Routine");
    expect(cellsOf(html)).toEqual([
      { label: 'Issue', value: 'The tap: it&#39;s dripping' },
      { label: 'Suburb', value: 'Newtown' },
    ]);
    expect(paragraphsOf(html)).toEqual(['abcdefghijklmnopqrstuvwxy: kept as text<br>Urgency: Routine']);
  });

  test('a label and a value are escaped', () => {
    const html = render('Trade: Tom & Co\nIssue: <b>tap</b>');
    expect(cellsOf(html)).toEqual([
      { label: 'Trade', value: 'Tom &amp; Co' },
      { label: 'Issue', value: '&lt;b&gt;tap&lt;/b&gt;' },
    ]);
    expect(html).not.toContain('<b>tap');
  });

  test('"Can\'t take this job" is an outlined Harbour button, decided from the label', () => {
    const html = render(QUOTE);
    expect(linksOf(html)).toEqual([
      { href: 'https://myest8.test/q/abc', text: 'Give your quote' },
      { href: 'https://myest8.test/q/abc/decline', text: 'Can&#39;t take this job' },
    ]);
    expect(html).toMatch(/<td bgcolor="#1F5C8B"[^>]*>\s*<a [^>]*color:#FFFFFF[^>]*>Give your quote<\/a>/);
    expect(html).toMatch(/<td bgcolor="#FFFFFF"[^>]*border:1px solid #1F5C8B[^>]*>\s*<a [^>]*color:#1F5C8B[^>]*>Can&#39;t take this job<\/a>/);
  });
});

const linksOf = (html: string) => [...html.matchAll(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ href: m[1], text: m[2] }));

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

describe('every template', () => {
  const LINK = 'https://myest8.test';
  const TUE = '2026-10-27T09:00:00+11:00';
  const WED = '2026-10-28T13:00:00+11:00';
  const choices = [
    { label: 'Tue 27 Oct, 9:00 am (preferred)', url: `${LINK}/v/abc?pick=1` },
    { label: 'Wed 28 Oct, 1:00 pm', url: `${LINK}/v/abc?pick=2` },
    { label: 'None of these work', url: `${LINK}/v/abc?pick=none` },
  ];
  const job = { trade: 'plumbing', urgency: 'routine', description: 'The kitchen tap is dripping', suburb: 'Newtown', quoteLink: `${LINK}/q/abc` } as const;
  const offer = { trade: 'plumbing', propertyAddress: '12 King St, Newtown', quoteLink: `${LINK}/q/abc`, length: '1 day', availability: 'weekday_mornings' } as const;
  const firm = { trade: 'plumbing', suburb: 'Newtown', propertyAddress: '12 King St, Newtown', quoteLink: `${LINK}/q/abc`, issue: 'Replace the tap', inspectedOn: TUE } as const;

  /** Sample data for each template, links included: a template missing from here fails the typecheck. */
  const SAMPLES: { [K in TemplateName]: TemplateData<K>[] } = {
    'tenant.acknowledgement': [{ tenantName: 'Tom', propertyAddress: '12 King St, Newtown' }],
    'tenant.missing_details': [{ tenantName: 'Tom', questions: ['location', 'availability'] }],
    'tenant.upload_link': [{ uploadLink: `${LINK}/u/abc` }, { uploadLink: `${LINK}/u/abc`, alreadyHave: 2 }],
    'tenant.urgent_repair_reminder': [
      { limitCents: 300_00, nominatedTradies: [{ businessName: "Pete's Plumbing", phone: '0400 000 001' }], receiptLink: `${LINK}/u/abc` },
      { limitCents: 300_00, nominatedTradies: [], receiptLink: `${LINK}/u/abc` },
    ],
    'tenant.common_area_passed_on': [{ buildingManagerName: 'Bea Brown' }],
    'tenant.confirmed': [{ trackerLink: `${LINK}/t/abc` }],
    'tenant.rejected': [{ reason: 'This is a common area issue' }],
    'tenant.choose_visit_time': [{ tradieBusinessName: "Pete's Plumbing", trade: 'plumbing', choices }],
    'tenant.pick_visit_time_reminder': [{ choices }],
    'tenant.say_when_home': [{ whenHomeLink: `${LINK}/v/abc?home=1` }],
    'tenant.visit_time': [
      { visitStart: TUE, trade: 'plumbing', tradieBusinessName: "Pete's Plumbing", confirmLink: `${LINK}/v/confirm/abc`, anotherTimeLink: `${LINK}/v/confirm/abc?another=1` },
    ],
    'tenant.visit_booked': [{ visitStart: TUE, anotherTimeLink: `${LINK}/v/abc` }],
    'tenant.visit_moved': [{ visitStart: WED, tradieBusinessName: "Pete's Plumbing", confirmLink: `${LINK}/v/confirm/abc`, anotherTimeLink: `${LINK}/v/confirm/abc?another=1` }],
    'tenant.inspection': [
      { tradieBusinessName: 'Drip Doctors', trade: 'plumbing', visitStart: TUE, confirmLink: `${LINK}/v/confirm/abc`, anotherTimeLink: `${LINK}/v/confirm/abc?another=1` },
    ],
    'tenant.inspection_cancelled': [{ tradieBusinessName: 'Drip Doctors', visitStart: TUE }],
    'tenant.fixed_properly': [{ trade: 'plumbing' as const, tradieBusinessName: "Pete's Plumbing", doneOn: TUE, work: 'Replace the tap washer' }],
    'tenant.reimbursed': [{ propertyAddress: '12 King St, Newtown', amountCents: 180_00 }],
    'tenant.ticket_closed': [{ propertyAddress: '12 King St, Newtown', summary: 'Dripping kitchen tap', jobs: [{ trade: 'plumbing' as const, tradieBusinessName: "Pete's Plumbing", doneOn: TUE, work: 'Replace the tap washer' }] }],
    'tenant.follow_up': [{ text: 'Is the tap still dripping?' }],
    'tradie.quote_request': [job],
    'tradie.quote_reminder': [job],
    'tradie.not_chosen': [{ trade: 'plumbing', suburb: 'Newtown', inspectionStart: TUE }],
    'tradie.offer_times': [offer],
    'tradie.offer_times_reminder': [offer],
    'tradie.offer_new_times': [offer],
    'tradie.offer_times_again': [{ ...offer, note: 'Sunday 10 am works' }],
    'tradie.work_order': [
      {
        propertyAddress: '12 King St, Newtown',
        description: 'The kitchen tap is dripping',
        trade: 'plumbing',
        visitStart: TUE,
        visitEnd: WED,
        approvedCents: 150_00,
        stage: 'firm',
        tenantName: 'Tom Tran',
        tenantContact: '0400 000 002',
        quoteLink: `${LINK}/q/abc`,
      },
    ],
    'tradie.done_too_early': [{ propertyAddress: '12 King St, Newtown', visitStart: TUE, inspection: true }],
    'tradie.visit_moved': [{ propertyAddress: '12 King St, Newtown', visitStart: WED, wasStart: TUE, quoteLink: `${LINK}/q/abc` }],
    'tradie.inspection': [
      { propertyAddress: '12 King St, Newtown', trade: 'plumbing', summary: 'Dripping tap', visitStart: TUE, visitEnd: WED, tenantContact: '0400 000 002', quoteLink: `${LINK}/q/abc` },
    ],
    'tradie.firm_quote_request': [firm],
    'tradie.firm_quote_reminder': [firm],
    'tradie.firm_quote_link': [firm],
    'owner.approval_request': [
      { propertyAddress: '12 King St, Newtown', trade: 'plumbing', tradieBusinessName: "Pete's Plumbing", quotePriceCents: 900_00, repairCostCents: 900_00, maxRepairCostCents: 500_00 },
    ],
    'owner.approval_reminder': [{ propertyAddress: '12 King St, Newtown', trade: 'plumbing', quotePriceCents: 900_00 }],
    'owner.work_booked': [{ propertyAddress: '12 King St, Newtown', trade: 'plumbing', visitStart: TUE }],
    'owner.work_moved': [{ propertyAddress: '12 King St, Newtown', trade: 'plumbing', visitStart: WED }],
    'owner.ticket_closed': [{ propertyAddress: '12 King St, Newtown', summary: 'Dripping kitchen tap', jobs: [{ ...{ trade: 'plumbing' as const, tradieBusinessName: "Pete's Plumbing", doneOn: TUE, work: 'Replace the tap washer' }, approvedCents: 150_00 }], repairCostCents: 150_00 }],
    'owner.urgent_repair_receipt': [{ propertyAddress: '12 King St, Newtown', tenantName: 'Tom Tran', description: 'Burst pipe', amountCents: 250_00, limitCents: 300_00 }],
    'building_manager.common_area_issue': [{ propertyAddress: '12 King St, Newtown', tenantName: 'Tom Tran', message: 'The lift is stuck' }],
    'onboarding.test_message': [{}],
    'onboarding.verification_code': [{ code: '123456' }],
  };

  const rendered = (Object.keys(SAMPLES) as TemplateName[]).flatMap((name) =>
    (SAMPLES[name] as never[]).map((data, i) => {
      const template = templates[name] as { subject: string; text: (d: never, a: { name: string; timeZone: string }) => string };
      const text = template.text(data, { name: AGENCY, timeZone: 'Australia/Sydney' });
      return [`${name}${i ? ` (${i + 1})` : ''}`, text, renderEmail({ agencyName: AGENCY, subject: template.subject, text })] as const;
    }),
  );

  test('the samples carry links, so the checks below have something to check', () => {
    expect(rendered.filter(([, text]) => /https?:\/\//.test(text)).length).toBeGreaterThan(20);
  });

  test.each(rendered)('%s shows no web address as text, and every address is a button saying what it does', (_, text, html) => {
    expect(textOf(html)).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('>Open link<');
    const urls = [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[.,;:!?)]+$/, '').replaceAll('&', '&amp;'));
    // Every link in the email is one of the text's addresses, drawn as a button: an <a> inside a table cell.
    expect(linksOf(html).map((link) => link.href)).toEqual(urls);
    for (const url of urls) expect(html).toMatch(new RegExp(`<td bgcolor="#(1F5C8B|FFFFFF)"[^>]*><a href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  });
});
