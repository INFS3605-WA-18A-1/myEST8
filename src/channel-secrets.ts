// Encrypts the secrets kept for an Agency's channels (a Gmail refresh token) so
// a copy of the database alone doesn't hold working credentials. AES-256-GCM with
// a key from CHANNEL_SECRET_KEY (32 bytes, base64: `openssl rand -base64 32`).
// Stored as one byte of version, a 12-byte nonce, the 16-byte tag, then the ciphertext.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

function keyBytes(key: string): Buffer {
  if (!key) throw new Error('CHANNEL_SECRET_KEY is not set: generate one with `openssl rand -base64 32` (see docs/channels-setup.md).');
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32) throw new Error('CHANNEL_SECRET_KEY must be 32 bytes, base64 encoded: generate one with `openssl rand -base64 32`.');
  return bytes;
}

export function encryptSecret(key: string, plaintext: string): Uint8Array {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), ciphertext]));
}

/** Throws when the key is wrong or the stored bytes were changed. */
export function decryptSecret(key: string, sealed: Uint8Array): string {
  const bytes = Buffer.from(sealed);
  if (bytes.length < 1 + NONCE_LENGTH + TAG_LENGTH || bytes[0] !== VERSION) throw new Error('The stored channel secret is not in a format this version can read.');
  const nonce = bytes.subarray(1, 1 + NONCE_LENGTH);
  const tag = bytes.subarray(1 + NONCE_LENGTH, 1 + NONCE_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes.subarray(1 + NONCE_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8');
}
