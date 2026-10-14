import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/channel-secrets.ts';

const key = () => randomBytes(32).toString('base64');

describe('channel secrets', () => {
  test('a secret comes back as it went in', () => {
    const k = key();
    const sealed = encryptSecret(k, '1//0gRefreshToken-éü');
    expect(decryptSecret(k, sealed)).toBe('1//0gRefreshToken-éü');
  });

  test('the stored bytes do not contain the secret, and differ every time', () => {
    const k = key();
    const a = encryptSecret(k, 'refresh-token-value');
    const b = encryptSecret(k, 'refresh-token-value');
    expect(Buffer.from(a).includes('refresh-token-value')).toBe(false);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  test('another key cannot open it', () => {
    const sealed = encryptSecret(key(), 'refresh-token-value');
    expect(() => decryptSecret(key(), sealed)).toThrow();
  });

  test('a changed byte is detected', () => {
    const k = key();
    const sealed = encryptSecret(k, 'refresh-token-value');
    sealed[sealed.length - 1] = sealed[sealed.length - 1]! ^ 1;
    expect(() => decryptSecret(k, sealed)).toThrow();
  });

  test('a truncated value is refused', () => {
    expect(() => decryptSecret(key(), new Uint8Array([1, 2, 3]))).toThrow();
  });

  test('a key that is not 32 bytes is refused up front', () => {
    expect(() => encryptSecret(Buffer.from('too short').toString('base64'), 'x')).toThrow(/32 bytes/);
    expect(() => encryptSecret('', 'x')).toThrow(/CHANNEL_SECRET_KEY/);
  });
});
