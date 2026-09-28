import { compareNewestFirst } from './versionId.js';

export interface RetentionPolicy {
  /** Always keep this many of the newest versions (treated as at least 1). */
  keepRecent: number;
  /**
   * Also keep the newest version of each of the last this-many UTC days that have uploads.
   * Days without uploads don't count, so this is a number of snapshots, not an age limit.
   */
  keepDailyDays: number;
}

export interface VersionStamp {
  /** Version id; ids sort (as strings) in upload order. */
  version: string;
  createdAtMs: number;
}

export interface SizedVersionStamp extends VersionStamp {
  size: number;
}

export interface RetentionPlan<T extends VersionStamp> {
  /** Versions to keep, newest first. */
  keep: T[];
  /** Versions to delete, newest first. */
  remove: T[];
}

export const DAY_MS = 86_400_000;

/**
 * Decides which versions survive: the `keepRecent` newest versions, plus the newest version of
 * each of the last `keepDailyDays` UTC days that have uploads. A game day with an upload every
 * minute therefore collapses to its final snapshot once it scrolls out of the recent window,
 * while earlier days keep their end-of-day snapshot.
 *
 * Pure and clock-independent: "newest" means most recently uploaded (highest version id), and
 * days are ranked by their newest upload, so the server's idea of "now" plays no part. An
 * account therefore never holds more than `keepRecent + keepDailyDays` versions, an account
 * used rarely keeps its history however old it is, and a wrong clock can push out at most one
 * day per day it invents. The newest version is always kept.
 */
export function planRetention<T extends VersionStamp>(
  versions: readonly T[],
  policy: RetentionPolicy,
): RetentionPlan<T> {
  const keepRecent = Math.max(1, Math.floor(policy.keepRecent));
  const daysSeen = new Set<number>();
  const keep: T[] = [];
  const remove: T[] = [];

  [...versions].sort(compareNewestFirst).forEach((v, index) => {
    const day = Math.floor(v.createdAtMs / DAY_MS);
    let newestOfARecentDay = false;
    if (!daysSeen.has(day)) {
      daysSeen.add(day);
      newestOfARecentDay = daysSeen.size <= policy.keepDailyDays;
    }
    if (index < keepRecent || newestOfARecentDay) {
      keep.push(v);
    } else {
      remove.push(v);
    }
  });

  return { keep, remove };
}

/**
 * Enforces a per-account storage budget: keeps the newest versions whose sizes add up to at
 * most `maxTotalBytes` and drops the rest, oldest first. The newest version is always kept,
 * even if it alone is over budget. Pure function.
 */
export function capTotalSize<T extends SizedVersionStamp>(
  versions: readonly T[],
  maxTotalBytes: number,
): RetentionPlan<T> {
  const keep: T[] = [];
  const remove: T[] = [];
  let total = 0;
  for (const v of [...versions].sort(compareNewestFirst)) {
    if (keep.length === 0 || (remove.length === 0 && total + v.size <= maxTotalBytes)) {
      keep.push(v);
      total += v.size;
    } else {
      remove.push(v);
    }
  }
  return { keep, remove };
}
