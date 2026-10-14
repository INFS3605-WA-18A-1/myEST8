// Shared reading of an email body: the address, HTML made into text, and the
// quoted reply under a message. Gmail and Resend both use these.

/** "Name <a@b.example>" or "a@b.example" -> "a@b.example" */
export function emailAddress(field: string) {
  const match = /<([^>]+)>/.exec(field);
  return (match ? match[1]! : field).trim().toLowerCase();
}

/** Tags removed, with line breaks kept where the HTML had them. */
export function htmlToText(html: string) {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|\/p|\/div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Drops the quoted message under a reply, so "YES" isn't read alongside the request it answers. */
export function withoutQuotedReply(text: string) {
  // Gmail wraps "On Tue, 6 Oct 2026 at 9:00, Name <a@b> wrote:" over two lines when it's long.
  const quoteStart = /^On [^\n]*(?:\n[^\n]*)?wrote:\s*$/m.exec(text);
  const reply = quoteStart ? text.slice(0, quoteStart.index) : text;
  return reply
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join('\n')
    .trim();
}
