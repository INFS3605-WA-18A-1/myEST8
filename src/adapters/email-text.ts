// Reading email text: the sender address, the plain text of an HTML body and the
// reply without the message it quotes. Shared by the email providers.

/** "Name <a@b.example>" or "a@b.example" -> "a@b.example" */
export function emailAddress(field: string) {
  const match = /<([^>]+)>/.exec(field);
  return (match ? match[1]! : field).trim().toLowerCase();
}

export function htmlToText(html: string) {
  return html
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
  const quoteStart = /^On .+ wrote:\s*$/m.exec(text);
  const reply = quoteStart ? text.slice(0, quoteStart.index) : text;
  return reply
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join('\n')
    .trim();
}
