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
  version: string;
  createdAtMs: number;
}

export interface RetentionPlan<T extends VersionStamp> {
  /** Versions to keep, newest first. */
  keep: T[];
  /** Versions to delete, newest first. */
  remove: T[];
}

const DAY_MS = 86_400_000;

function newestFirst(a: VersionStamp, b: VersionStamp): number {
  if (a.createdAtMs !== b.createdAtMs) return b.createdAtMs - a.createdAtMs;
  return a.version < b.version ? 1 : a.version > b.version ? -1 : 0;
}

/**
 * Decides which versions survive: the `keepRecent` newest versions, plus the newest version of
 * each UTC day within the last `keepDailyDays` days. A game day with an upload every minute
 * therefore collapses to its final snapshot once it scrolls out of the recent window, while
 * older days keep their end-of-day snapshot for about six months.
 *
 * Pure function: no I/O, no clock. The newest version is always kept. Days after `nowMs`'s
 * day (clock skew) count as inside the daily window, so such versions are not pruned for age.
 */
export function planRetention<T extends VersionStamp>(
  versions: readonly T[],
  nowMs: number,
  policy: RetentionPolicy,
): RetentionPlan<T> {
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
    const withinDailyWindow = policy.keepDailyDays > 0 && today - day < policy.keepDailyDays;
    if (index < keepRecent || (newestOfItsDay && withinDailyWindow)) {
      keep.push(v);
    } else {
      remove.push(v);
    }
  });

  return { keep, remove };
}
