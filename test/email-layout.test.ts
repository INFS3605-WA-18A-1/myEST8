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
