import { describe, expect, it, vi } from 'vitest';
import {
  BACKUP_CODE_LENGTH,
  BackupCodeError,
  formatBackupCode,
  generateBackupCode,
  generateBackupSecret,
  normalizeBackupCode,
  parseBackupCode,
} from './code';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Secret 00 01 02 … 0f and its code, computed by an independent implementation. */
const KNOWN_SECRET = Uint8Array.from({ length: 16 }, (_, index) => index);
const KNOWN_CODE = '000G-40R4-0M30-E209-185G-R38E-1WEC';
const CODE_FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/;

function problemOf(input: string): string | undefined {
  try {
    parseBackupCode(input);
    return undefined;
  } catch (error) {
    if (error instanceof BackupCodeError) return error.problem;
    throw error;
  }
}

/** The code's characters without dashes. */
const chars = (code: string) => code.replace(/-/g, '');

describe('backup codes', () => {
  it('writes 128 bits as 28 Crockford base32 characters in groups of four', () => {
    expect(BACKUP_CODE_LENGTH).toBe(28);
    expect(formatBackupCode(KNOWN_SECRET)).toBe(KNOWN_CODE);
    expect(Array.from(parseBackupCode(KNOWN_CODE))).toEqual(Array.from(KNOWN_SECRET));
  });

  it('makes a fresh random code each time, from crypto.getRandomValues', () => {
    const random = vi.spyOn(crypto, 'getRandomValues');
    const codes = new Set(Array.from({ length: 50 }, generateBackupCode));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(CODE_FORMAT);
    expect(random).toHaveBeenCalledTimes(50);
    expect(generateBackupSecret()).toHaveLength(16);
  });

  it('round-trips any secret', () => {
    for (let i = 0; i < 200; i += 1) {
      const secret = generateBackupSecret();
      expect(Array.from(parseBackupCode(formatBackupCode(secret)))).toEqual(Array.from(secret));
    }
    expect(() => formatBackupCode(new Uint8Array(15))).toThrow(RangeError);
  });

  it('forgives case, spaces, dashes, and O, I or L for 0 and 1', () => {
    const typed = KNOWN_CODE.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l');
    expect(normalizeBackupCode(typed)).toBe(KNOWN_CODE);
    expect(normalizeBackupCode(chars(KNOWN_CODE).replace(/1/g, 'I'))).toBe(KNOWN_CODE);
    expect(
      normalizeBackupCode(
        ` ${chars(KNOWN_CODE)
          .match(/.{1,7}/g)
          ?.join('  ')}\n`,
      ),
    ).toBe(KNOWN_CODE);
    // Dashes from smart punctuation, and non-breaking spaces.
    expect(normalizeBackupCode(KNOWN_CODE.replace(/-/g, '– '))).toBe(KNOWN_CODE);
  });

  it('explains what is wrong with a code, in plain words', () => {
    expect(() => parseBackupCode('  - ')).toThrow('Enter your backup code.');
    expect(problemOf('')).toBe('empty');
    expect(() => parseBackupCode(KNOWN_CODE.replace('W', 'U'))).toThrow(
      'Backup codes don\'t use "U". Check the code and try again.',
    );
    expect(problemOf(`${KNOWN_CODE}!`)).toBe('invalid-character');
    expect(() => parseBackupCode(KNOWN_CODE.slice(0, -1))).toThrow(
      'That code is too short. A backup code has 28 letters and numbers, and this one has 27.',
    );
    expect(problemOf(`${KNOWN_CODE}0`)).toBe('too-long');
    expect(() => parseBackupCode(KNOWN_CODE.replace('WEC', 'WED'))).toThrow(
      'That code has a typo. Check each letter and number, then try again.',
    );
  });

  it('catches every single mistyped character', () => {
    for (const code of [KNOWN_CODE, generateBackupCode(), generateBackupCode()]) {
      const symbols = chars(code);
      for (let position = 0; position < symbols.length; position += 1) {
        for (const replacement of ALPHABET) {
          if (replacement === symbols[position]) continue;
          const typo = symbols.slice(0, position) + replacement + symbols.slice(position + 1);
          expect(problemOf(typo)).toBe('typo');
        }
      }
    }
  });

  it('catches every swap of two neighbouring characters', () => {
    for (const code of [KNOWN_CODE, generateBackupCode(), generateBackupCode()]) {
      const symbols = chars(code);
      for (let position = 0; position + 1 < symbols.length; position += 1) {
        const [a, b] = [symbols[position], symbols[position + 1]];
        if (a === b) continue;
        const swapped = `${symbols.slice(0, position)}${b}${a}${symbols.slice(position + 2)}`;
        expect(problemOf(swapped)).toBe('typo');
      }
    }
  });

  it('catches any two mistyped characters', () => {
    const symbols = chars(generateBackupCode());
    let checked = 0;
    for (let first = 0; first < symbols.length; first += 1) {
      for (let second = first + 1; second < symbols.length; second += 1) {
        // A few replacements per pair of positions keeps this fast.
        for (const shift of [1, 7, 19]) {
          const replace = (text: string, at: number) => {
            const next = ALPHABET[(ALPHABET.indexOf(text.charAt(at)) + shift) % 32] ?? '0';
            return text.slice(0, at) + next + text.slice(at + 1);
          };
          expect(problemOf(replace(replace(symbols, first), second))).toBe('typo');
          checked += 1;
        }
      }
    }
    expect(checked).toBe(378 * 3);
  });
});
