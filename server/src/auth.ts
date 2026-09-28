import { createHash, timingSafeEqual } from 'node:crypto';

const HEX64_RE = /^[0-9a-f]{64}$/;

/** accountId and authToken are both exactly 64 lowercase hex chars (256 bits). */
export function isHex64(value: string): boolean {
  return HEX64_RE.test(value);
}

export type BearerToken =
  { kind: 'missing' } | { kind: 'malformed' } | { kind: 'ok'; token: string };

/** Parses `Authorization: Bearer <64 lowercase hex>`. The scheme name is case-insensitive. */
export function parseBearer(header: string | undefined): BearerToken {
  if (header === undefined || header.trim() === '') return { kind: 'missing' };
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  const token = match?.[1];
  if (token === undefined || !isHex64(token)) return { kind: 'malformed' };
  return { kind: 'ok', token };
}

/**
 * SHA-256 of the token's hex string, hex encoded. A fast unsalted hash is appropriate here: the
 * token is 256 bits of key material derived from a random backup code, so it cannot be brute
 * forced. We store the hash so a leaked data directory does not hand out working tokens.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Compared against when an account does not exist, so both paths do the same work.
const PLACEHOLDER_HASH = Buffer.alloc(32);

/** Constant-time check of a presented token against a stored hash (null = no such account). */
export function tokenMatches(token: string, storedHash: string | null): boolean {
  const presented = createHash('sha256').update(token, 'utf8').digest();
  const expected =
    storedHash !== null && isHex64(storedHash) ? Buffer.from(storedHash, 'hex') : PLACEHOLDER_HASH;
  const equal = timingSafeEqual(presented, expected);
  return equal && storedHash !== null && expected !== PLACEHOLDER_HASH;
}
