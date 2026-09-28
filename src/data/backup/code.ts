/**
 * Backup codes: the one secret behind the cloud backup. A code is 128 random bits,
 * written as 28 Crockford base32 characters in groups of four:
 *
 *   7K3M-9QXA-B2CD-EF45-GH67-JK89-MN0P
 *
 * The first 26 characters carry the secret (128 bits, then 2 zero bits of padding);
 * the last 2 are a Reed-Solomon check over GF(32), so ANY one or two mistyped (or
 * swapped) characters are caught before a network call, and a longer typo gets
 * through only about once in a thousand tries.
 *
 * Crockford's alphabet has no I, L, O or U, so reading a code aloud or copying it by
 * hand is unambiguous. Parsing is forgiving: any case, spaces and dashes anywhere,
 * and O, I and L are read as 0, 1 and 1.
 *
 * Pure: no storage, no network. See keys.ts for what the secret turns into.
 */

/** Crockford base32. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Letters that are easy to type instead of a digit that looks like them. */
const ALIASES: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };
/** Spaces (including non-breaking ones) and every kind of dash a keyboard or paste might add. */
const SEPARATORS = /[\s\-‐-―−]/g;

/** Bytes of secret in a code: 128 bits. */
export const BACKUP_SECRET_BYTES = 16;
/** Characters that carry the secret: ceil(128 / 5). */
const DATA_SYMBOLS = Math.ceil((BACKUP_SECRET_BYTES * 8) / 5);
const CHECK_SYMBOLS = 2;
/** Letters and numbers in a backup code, not counting dashes. */
export const BACKUP_CODE_LENGTH = DATA_SYMBOLS + CHECK_SYMBOLS;
const GROUP_SIZE = 4;

export type BackupCodeProblem = 'empty' | 'invalid-character' | 'too-short' | 'too-long' | 'typo';

/** A code that can't be right. `message` is written for the parent to read. */
export class BackupCodeError extends Error {
  readonly problem: BackupCodeProblem;

  constructor(problem: BackupCodeProblem, message: string) {
    super(message);
    this.name = 'BackupCodeError';
    this.problem = problem;
  }
}

// ---------------------------------------------------------------------------
// GF(32) arithmetic, for the check characters. Elements are 5-bit numbers; the
// field is built from the primitive polynomial x^5 + x^2 + 1.

const FIELD_POLYNOMIAL = 0b100101;
const FIELD_ORDER = 31;
const EXP: number[] = [];
const LOG: number[] = [];
for (let power = 0, value = 1; power < FIELD_ORDER; power += 1) {
  EXP[power] = value;
  LOG[value] = power;
  value <<= 1;
  if (value & 0b100000) value ^= FIELD_POLYNOMIAL;
}

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[((LOG[a] ?? 0) + (LOG[b] ?? 0)) % FIELD_ORDER] ?? 0;
}

/** α and α²: the generator polynomial's roots, (x + α)(x + α²) = x² + G1·x + G0. */
const ALPHA = EXP[1] ?? 2;
const ALPHA_SQUARED = EXP[2] ?? 4;
const G1 = ALPHA ^ ALPHA_SQUARED;
const G0 = gfMultiply(ALPHA, ALPHA_SQUARED);

/** The two check symbols: the remainder of data(x)·x² divided by the generator. */
function checkSymbols(data: readonly number[]): [number, number] {
  let r0 = 0;
  let r1 = 0;
  for (const symbol of data) {
    const feedback = symbol ^ r0;
    r0 = r1 ^ gfMultiply(feedback, G1);
    r1 = gfMultiply(feedback, G0);
  }
  return [r0, r1];
}

/** A codeword, read as a polynomial (first symbol = highest power), evaluated at `x`. */
function evaluate(symbols: readonly number[], x: number): number {
  let result = 0;
  for (const symbol of symbols) result = gfMultiply(result, x) ^ symbol;
  return result;
}

/** A valid codeword has α and α² as roots, so any 1 or 2 changed symbols are caught. */
function hasValidCheck(symbols: readonly number[]): boolean {
  return evaluate(symbols, ALPHA) === 0 && evaluate(symbols, ALPHA_SQUARED) === 0;
}

// ---------------------------------------------------------------------------
// Bytes <-> 5-bit symbols (big-endian bit order).

function bytesToSymbols(bytes: Uint8Array): number[] {
  const symbols: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      symbols.push((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) symbols.push((buffer << (5 - bits)) & 31);
  return symbols;
}

/** The bytes, or null if the padding bits after the last byte aren't zero. */
function symbolsToBytes(
  symbols: readonly number[],
  length: number,
): Uint8Array<ArrayBuffer> | null {
  const bytes = new Uint8Array(length);
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const symbol of symbols) {
    buffer = (buffer << 5) | symbol;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (index < length) bytes[index] = (buffer >> bits) & 0xff;
      index += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  return index === length && buffer === 0 ? bytes : null;
}

// ---------------------------------------------------------------------------

function groupCode(characters: string): string {
  const groups: string[] = [];
  for (let start = 0; start < characters.length; start += GROUP_SIZE) {
    groups.push(characters.slice(start, start + GROUP_SIZE));
  }
  return groups.join('-');
}

/** Formats a 16-byte secret as a code, e.g. '7K3M-9QXA-B2CD-EF45-GH67-JK89-MN0P'. */
export function formatBackupCode(secret: Uint8Array): string {
  if (secret.length !== BACKUP_SECRET_BYTES) {
    throw new RangeError(`A backup secret is ${BACKUP_SECRET_BYTES} bytes, not ${secret.length}`);
  }
  const data = bytesToSymbols(secret);
  const symbols = [...data, ...checkSymbols(data)];
  return groupCode(symbols.map((symbol) => ALPHABET.charAt(symbol)).join(''));
}

/** 16 fresh random bytes from the platform's secure random number generator. */
export function generateBackupSecret(): Uint8Array<ArrayBuffer> {
  const secret = new Uint8Array(BACKUP_SECRET_BYTES);
  crypto.getRandomValues(secret);
  return secret;
}

/** A new random backup code (128 bits from `crypto.getRandomValues`). */
export function generateBackupCode(): string {
  return formatBackupCode(generateBackupSecret());
}

/**
 * The secret in a code the parent typed or pasted. Ignores case, spaces and dashes,
 * and reads O as 0 and I or L as 1. Throws BackupCodeError, with a message for the
 * parent, if it can't be a backup code (wrong length, a typo, a stray character).
 */
export function parseBackupCode(input: string): Uint8Array<ArrayBuffer> {
  const characters = input.replace(SEPARATORS, '').toUpperCase();
  if (characters.length === 0) {
    throw new BackupCodeError('empty', 'Enter your backup code.');
  }

  const symbols: number[] = [];
  for (const character of characters) {
    const symbol = ALPHABET.indexOf(ALIASES[character] ?? character);
    if (symbol === -1) {
      throw new BackupCodeError(
        'invalid-character',
        `Backup codes don't use "${character}". Check the code and try again.`,
      );
    }
    symbols.push(symbol);
  }

  if (symbols.length !== BACKUP_CODE_LENGTH) {
    const tooShort = symbols.length < BACKUP_CODE_LENGTH;
    throw new BackupCodeError(
      tooShort ? 'too-short' : 'too-long',
      `That code is too ${tooShort ? 'short' : 'long'}. A backup code has ` +
        `${BACKUP_CODE_LENGTH} letters and numbers, and this one has ${symbols.length}.`,
    );
  }

  const secret = hasValidCheck(symbols)
    ? symbolsToBytes(symbols.slice(0, DATA_SYMBOLS), BACKUP_SECRET_BYTES)
    : null;
  if (!secret) {
    throw new BackupCodeError(
      'typo',
      'That code has a typo. Check each letter and number, then try again.',
    );
  }
  return secret;
}

/** The code in its standard form ('7K3M-9QXA-…'). Throws BackupCodeError like parseBackupCode. */
export function normalizeBackupCode(input: string): string {
  return formatBackupCode(parseBackupCode(input));
}
