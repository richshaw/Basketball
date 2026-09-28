/**
 * Version ids look like `0000000042-20260928T041523123Z`: a zero-padded per-account sequence
 * number, then the UTC time the upload started, to the millisecond. Both are assigned when the
 * upload starts, so a slow upload of older data can never end up sorting after a newer one.
 *
 * The sequence comes first, so sorting ids as strings sorts them in upload order even if the
 * server clock was wrong for a while (a clock that jumped ahead can never pin later ids to the
 * future). The timestamp is what the API reports as `createdAt`.
 *
 * The strict format doubles as path-traversal protection: an id is used as a file name, so
 * anything that does not match exactly is rejected before it gets near the filesystem.
 */
const VERSION_ID_RE = /^(\d{10})-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/;
const SEQUENCE_DIGITS = 10;
export const MAX_SEQUENCE = 10 ** SEQUENCE_DIGITS - 1;
const MAX_TIME_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

function compactTimestamp(timeMs: number): string {
  // 2026-09-28T04:15:23.123Z -> 20260928T041523123Z
  return new Date(timeMs).toISOString().replace(/[-:.]/g, '');
}

export function formatVersionId(sequence: number, timeMs: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new RangeError(`version sequence out of range: ${sequence}`);
  }
  if (!Number.isSafeInteger(timeMs) || timeMs < 0 || timeMs > MAX_TIME_MS) {
    throw new RangeError(`version timestamp out of range: ${timeMs}`);
  }
  return `${String(sequence).padStart(SEQUENCE_DIGITS, '0')}-${compactTimestamp(timeMs)}`;
}

export interface ParsedVersionId {
  sequence: number;
  createdAtMs: number;
}

/** Returns the sequence and creation time encoded in a version id, or null if it is invalid. */
export function parseVersionId(version: string): ParsedVersionId | null {
  const m = VERSION_ID_RE.exec(version);
  if (!m) return null;
  const [sequence, year, month, day, hour, minute, second, ms] = m.slice(1, 9).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (sequence < 1) return null;
  const createdAtMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // Date.UTC silently rolls over impossible values (month 13, hour 25...); reject those.
  if (
    Number.isNaN(createdAtMs) ||
    compactTimestamp(createdAtMs) !== version.slice(SEQUENCE_DIGITS + 1)
  ) {
    return null;
  }
  return { sequence, createdAtMs };
}

export function isVersionId(value: string): boolean {
  return parseVersionId(value) !== null;
}

/** Sort comparator: newest (highest sequence) first. */
export function compareNewestFirst(a: { version: string }, b: { version: string }): number {
  return a.version < b.version ? 1 : a.version > b.version ? -1 : 0;
}
