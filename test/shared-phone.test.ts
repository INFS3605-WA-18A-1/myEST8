import { describe, expect, test } from 'vitest';
import { normalizeAddress, phoneProblem } from '../src/shared.ts';

describe('normalizeAddress for phone numbers', () => {
  test.each([
    ['0412 345 678', '+61412345678'],
    ['0412-345-678', '+61412345678'],
    ['+61 412 345 678', '+61412345678'],
    ['0061 412 345 678', '+61412345678'],
    ['61412345678', '+61412345678'],
    ['61 412 345 678', '+61412345678'],
    ['+61 (0)412 345 678', '+61412345678'],
    ['+610412345678', '+61412345678'],
    ['(02) 9000 0000', '+61290000000'],
    ['0044 20 7946 0958', '+442079460958'],
    ['+1 415 555 2671', '+14155552671'],
  ])('%s -> %s', (typed, expected) => {
    expect(normalizeAddress(typed)).toBe(expected);
  });

  test('email addresses are lower-cased and untouched otherwise', () => {
    expect(normalizeAddress(' Sam@Sunrise.Example ')).toBe('sam@sunrise.example');
  });
});

describe('phoneProblem', () => {
  test.each(['+61412345678', '+14155552671', '+61290000000'])('%s is usable', (n) => {
    expect(phoneProblem(n)).toBeNull();
  });

  test.each([
    ['abc', /area code/],
    ['12345', /start with \+/],
    ['+1', /too short/],
    ['+61', /too short/],
    ['+99999999999999999999', /too long/],
    ['+6141234567', /9 digits after \+61/],
    ['+614123456789', /9 digits after \+61/],
    ['+61+412345678', /digits only/],
  ])('%s is refused with a helpful message', (n, message) => {
    expect(phoneProblem(normalizeAddress(n))).toMatch(message);
  });
});
