import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashToken, isHex64, parseBearer, tokenMatches } from '../src/auth.js';
import { hex64 } from './helpers.js';

describe('auth helpers', () => {
  it('accepts exactly 64 lowercase hex chars', () => {
    expect(isHex64('a'.repeat(64))).toBe(true);
    expect(isHex64('A'.repeat(64))).toBe(false);
    expect(isHex64('a'.repeat(63))).toBe(false);
    expect(isHex64('a'.repeat(65))).toBe(false);
    expect(isHex64(`${'a'.repeat(63)}g`)).toBe(false);
    expect(isHex64(`${'a'.repeat(64)}\n`)).toBe(false);
  });

  it('parses bearer tokens', () => {
    const token = hex64();
    expect(parseBearer(undefined)).toEqual({ kind: 'missing' });
    expect(parseBearer('')).toEqual({ kind: 'missing' });
    expect(parseBearer(`Bearer ${token}`)).toEqual({ kind: 'ok', token });
    expect(parseBearer(`bearer ${token}`)).toEqual({ kind: 'ok', token });
    expect(parseBearer(`Bearer ${token.toUpperCase()}`)).toEqual({ kind: 'malformed' });
    expect(parseBearer(`Basic ${token}`)).toEqual({ kind: 'malformed' });
    expect(parseBearer(token)).toEqual({ kind: 'malformed' });
    expect(parseBearer('Bearer')).toEqual({ kind: 'malformed' });
    expect(parseBearer(`Bearer ${token} extra`)).toEqual({ kind: 'malformed' });
  });

  it('stores sha256 of the token and compares in constant time', () => {
    const token = hex64();
    const stored = hashToken(token);
    expect(stored).toBe(createHash('sha256').update(token).digest('hex'));
    expect(stored).not.toContain(token);
    expect(tokenMatches(token, stored)).toBe(true);
    expect(tokenMatches(hex64(), stored)).toBe(false);
    expect(tokenMatches(token, null)).toBe(false);
    expect(tokenMatches(token, 'not-a-hash')).toBe(false);
  });

  it('never matches the placeholder used for unknown accounts', () => {
    // The placeholder is 32 zero bytes; no token can be accepted against a missing account.
    expect(tokenMatches(hex64(), null)).toBe(false);
    expect(tokenMatches(hex64(), '0'.repeat(64))).toBe(false);
  });
});
