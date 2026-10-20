// Signed, expiring no-login links to stored files (src/files.ts), served at
// /media/:id (signed-in Property Managers reach files at /files/:id instead).
//
// Twilio sends MMS and WhatsApp media by fetching a public URL, so an attachment
// on SMS or WhatsApp goes as a link like
//   {baseUrl}/media/42?expires=1791000000&signature=<base64url HMAC-SHA256>
// The signature covers the file id and the expiry, keyed by a server secret, so a
// link can't be made for another file or kept working past its expiry. Unlike the
// upload and tracker tokens (issue 12), a file link expires on its own: it only
// has to live long enough for the provider to fetch the file.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from './ports.ts';

/** Long enough for Twilio to fetch the media of a queued message, short enough not to linger in a thread. */
const FILE_LINK_TTL_MS = 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

export interface FileLinks {
  /** A link to the stored file that works until the TTL runs out. */
  url(fileId: number): string;
  /** Whether a request's id, expiry and signature are a link this server made and that hasn't expired. */
  check(fileId: string, expires: string | undefined, signature: string | undefined): boolean;
}

export function createFileLinks({
  secret,
  baseUrl,
  clock,
  ttlMs = FILE_LINK_TTL_MS,
}: {
  /** FILE_LINK_SECRET: at least 32 characters of randomness, the same on every server. */
  secret: string;
  /** The public address providers can reach, "https://myest8.example". */
  baseUrl: string;
  clock: Clock;
  ttlMs?: number;
}): FileLinks {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`The file link secret must be at least ${MIN_SECRET_LENGTH} characters`);
  const sign = (fileId: string, expires: string) => createHmac('sha256', secret).update(`file:${fileId}:${expires}`).digest();
  const root = baseUrl.replace(/\/$/, '');

  return {
    url(fileId) {
      const expires = String(Math.floor((clock.now().getTime() + ttlMs) / 1000));
      const signature = sign(String(fileId), expires).toString('base64url');
      return `${root}/media/${fileId}?${new URLSearchParams({ expires, signature })}`;
    },

    check(fileId, expires, signature) {
      if (!/^[1-9]\d{0,15}$/.test(fileId) || !expires || !/^\d{1,12}$/.test(expires) || !signature) return false;
      if (Number(expires) * 1000 <= clock.now().getTime()) return false;
      const expected = sign(fileId, expires);
      const given = Buffer.from(signature, 'base64url');
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}
