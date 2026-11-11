// Gmail won't forward to a new address until that address confirms it. It sends
// the Agency's inbound address one email with a confirmation code and a link.
// That email is not a Maintenance Request: myEST8 keeps it so the channels page
// can show the code to the Property Manager, who enters it back in Gmail.

/** The sender of Gmail's forwarding confirmation. */
export const GMAIL_FORWARDING_SENDER = 'forwarding-noreply@google.com';

/** What Gmail's forwarding confirmation gives: its code, its link, and the Gmail address asking to forward. */
export type GmailForwardingConfirmation = { code: string | null; link: string | null; requestedBy: string | null };

export function isGmailForwardingConfirmation(from: string) {
  return from.trim().toLowerCase() === GMAIL_FORWARDING_SENDER;
}

/**
 * Reads the code, the link and the requesting address out of the confirmation's text.
 * The link is kept only when it goes to Google's mail settings, so a forged message
 * from that sender can't put a link to another site on the channels page.
 */
export function readGmailForwardingConfirmation(text: string): GmailForwardingConfirmation | null {
  const code = /confirmation code:\s*(\d{6,12})/i.exec(text)?.[1] ?? null;
  const link = /https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s<>"'()[\]]+/i.exec(text)?.[0] ?? null;
  const requestedBy = /([^\s<>()]+@[^\s<>()]+)\s+has requested to automatically forward/i.exec(text)?.[1]?.toLowerCase() ?? null;
  if (!code && !link) return null;
  return { code, link, requestedBy };
}
