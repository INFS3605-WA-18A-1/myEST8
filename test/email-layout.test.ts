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
    const edged = html.match(/<tr><td width="4" bgcolor="#FFC233"[^>]*><\/td>.*?<\/tr>/s)![0];
    expect(edged).toContain('<ol');
    expect(edged).not.toContain('<p ');
  });

  test('an email that asks for nothing has no Wattle', () => {
    expect(render("Hi Kevin, this is Harbour Realty. We've got your message.")).not.toContain('#FFC233');
  });
});
