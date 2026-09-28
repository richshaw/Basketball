export interface RetentionPolicy {
  /** Always keep this many of the newest versions (treated as at least 1). */
  keepRecent: number;
  /**
   * Also keep the newest version of each UTC day for this many days, counting today as the
   * first day: with 180, days `today`, `today - 1`, ..., `today - 179` each keep one version.
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

export interface RetentionOptions {
  /**
   * When false, nothing is dropped for being old: the newest version of every day is kept, as
   * if the daily window were unlimited. Used when the clock can't be trusted to measure age.
   * Defaults to true.
   */
  pruneByAge?: boolean;
}

export const DAY_MS = 86_400_000;

function newestFirst(a: VersionStamp, b: VersionStamp): number {
  return a.version < b.version ? 1 : a.version > b.version ? -1 : 0;
}

/**
 * Decides which versions survive: the `keepRecent` newest versions, plus the newest version of
 * each UTC day within the last `keepDailyDays` days. A game day with an upload every minute
 * therefore collapses to its final snapshot once it scrolls out of the recent window, while
 * older days keep their end-of-day snapshot for about six months.
 *
 * "Newest" means most recently uploaded (highest version id); days come from `createdAtMs`.
 * Pure function: no I/O, no clock. The newest version is always kept. Days after `nowMs`'s day
 * (clock skew) count as inside the daily window, so such versions are not pruned for age.
 */
export function planRetention<T extends VersionStamp>(
  versions: readonly T[],
  nowMs: number,
  policy: RetentionPolicy,
  options: RetentionOptions = {},
): RetentionPlan<T> {
  const pruneByAge = options.pruneByAge ?? true;
  const sorted = [...versions].sort(newestFirst);
  const keepRecent = Math.max(1, Math.floor(policy.keepRecent));
  const today = Math.floor(nowMs / DAY_MS);
  const daysSeen = new Set<number>();
  const keep: T[] = [];
  const remove: T[] = [];

  sorted.forEach((v, index) => {
    const day = Math.floor(v.createdAtMs / DAY_MS);
    const newestOfItsDay = !daysSeen.has(day);
    daysSeen.add(day);
    const withinDailyWindow =
      policy.keepDailyDays > 0 && (!pruneByAge || today - day < policy.keepDailyDays);
    if (index < keepRecent || (newestOfItsDay && withinDailyWindow)) {
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
  for (const v of [...versions].sort(newestFirst)) {
    if (keep.length === 0 || (remove.length === 0 && total + v.size <= maxTotalBytes)) {
      keep.push(v);
      total += v.size;
    } else {
      remove.push(v);
    }
  }
  return { keep, remove };
}
