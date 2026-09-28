import { randomBytes } from 'node:crypto';

/**
 * Version ids look like `20260928T041523123Z-9f86d081`: a fixed-width UTC timestamp with
 * millisecond precision, a dash, and 8 random lowercase hex chars. Because the timestamp is
 * fixed-width, sorting ids as strings sorts them chronologically.
 *
 * The strict format doubles as path-traversal protection: an id is used as a file name, so
 * anything that does not match exactly is rejected before it gets near the filesystem.
 */
const VERSION_ID_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-[0-9a-f]{8}$/;

/** Length of the timestamp part (`YYYYMMDDTHHMMSSmmmZ`). */
const TIMESTAMP_LENGTH = 19;

function compactTimestamp(timeMs: number): string {
  // 2026-09-28T04:15:23.123Z -> 20260928T041523123Z
  return new Date(timeMs).toISOString().replace(/[-:.]/g, '');
}

export function formatVersionId(timeMs: number, suffix = randomBytes(4).toString('hex')): string {
  return `${compactTimestamp(timeMs)}-${suffix}`;
}

/** Returns the creation time encoded in a version id, or null if the id is not valid. */
export function parseVersionTime(version: string): number | null {
  const m = VERSION_ID_RE.exec(version);
  if (!m) return null;
  const [year, month, day, hour, minute, second, ms] = m.slice(1, 8).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const timeMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // Date.UTC silently rolls over impossible values (month 13, hour 25...); reject those.
  if (Number.isNaN(timeMs) || compactTimestamp(timeMs) !== version.slice(0, TIMESTAMP_LENGTH)) {
    return null;
  }
  return timeMs;
}

export function isVersionId(value: string): boolean {
  return parseVersionTime(value) !== null;
}

/**
 * Picks the id for a new upload. Ids within an account are strictly increasing: if the clock
 * reads the same millisecond as (or earlier than) the newest existing version, the new version
 * is stamped 1 ms after it. This keeps "latest" unambiguous even for rapid uploads or a clock
 * that steps backwards.
 */
export function nextVersionId(
  nowMs: number,
  newestExisting: string | undefined,
  suffix?: string,
): { version: string; createdAtMs: number } {
  const newestMs = newestExisting === undefined ? null : parseVersionTime(newestExisting);
  const createdAtMs = newestMs !== null && newestMs >= nowMs ? newestMs + 1 : nowMs;
  return { version: formatVersionId(createdAtMs, suffix), createdAtMs };
}
