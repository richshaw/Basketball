import { describe, expect, it } from 'vitest';
import type { RetentionPolicy, VersionStamp } from '../src/retention.js';
import { planRetention } from '../src/retention.js';
import { formatVersionId } from '../src/versionId.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const POLICY: RetentionPolicy = { keepRecent: 20, keepDailyDays: 180 };
const NOW = Date.parse('2026-09-28T18:30:00.000Z');
const TODAY_START = Date.parse('2026-09-28T00:00:00.000Z');

let seq = 0;
function stamp(createdAtMs: number): VersionStamp {
  seq += 1;
  return { version: formatVersionId(createdAtMs, seq.toString(16).padStart(8, '0')), createdAtMs };
}

function ids(list: readonly VersionStamp[]): string[] {
  return list.map((v) => v.version);
}

/** `count` uploads one minute apart, ending at `lastMs` (oldest first). */
function game(lastMs: number, count: number): VersionStamp[] {
  return Array.from({ length: count }, (_, i) => stamp(lastMs - (count - 1 - i) * MINUTE));
}

/** Deterministic PRNG so the randomized test is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

describe('planRetention', () => {
  it('keeps nothing and removes nothing for an empty list', () => {
    expect(planRetention([], NOW, POLICY)).toEqual({ keep: [], remove: [] });
  });

  it('keeps every version while there are no more than keepRecent, however old', () => {
    const ancient = Array.from({ length: 20 }, (_, i) => stamp(NOW - (1000 + i) * DAY));
    const plan = planRetention(ancient, NOW, POLICY);
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toHaveLength(20);
  });

  it('collapses a single game day to the 20 most recent uploads', () => {
    const uploads = game(NOW - HOUR, 100); // every minute for 100 minutes, all today
    const plan = planRetention(uploads, NOW, POLICY);
    expect(ids(plan.keep)).toEqual(ids(uploads.slice(-20).reverse()));
    expect(ids(plan.remove)).toEqual(ids(uploads.slice(0, 80).reverse()));
  });

  it("keeps each earlier day's final snapshot in addition to the 20 most recent", () => {
    const twoDaysAgo = game(TODAY_START - DAY - 2 * HOUR, 30);
    const yesterday = game(TODAY_START - 2 * HOUR, 30);
    const today = game(NOW - HOUR, 30);
    const plan = planRetention([...twoDaysAgo, ...yesterday, ...today], NOW, POLICY);

    expect(ids(plan.keep)).toEqual([
      ...ids(today.slice(-20).reverse()),
      yesterday[29]?.version,
      twoDaysAgo[29]?.version,
    ]);
    expect(plan.remove).toHaveLength(90 - 22);
  });

  it('counts today as the first of the 180 days: day -179 is kept, day -180 is not', () => {
    const recent = game(NOW - HOUR, 20); // fills the "recent" slots so only the daily rule applies
    const day179 = stamp(TODAY_START - 179 * DAY + 12 * HOUR);
    const day180 = stamp(TODAY_START - 180 * DAY + 12 * HOUR);
    const plan = planRetention([day180, day179, ...recent], NOW, POLICY);
    expect(ids(plan.keep)).toContain(day179.version);
    expect(ids(plan.remove)).toEqual([day180.version]);
  });

  it('uses UTC day boundaries', () => {
    const recent = game(NOW - HOUR, 20);
    const earlierOnDay5 = stamp(TODAY_START - 4 * DAY - 2 * HOUR); // 22:00 on day -5
    const lateOnDay5 = stamp(TODAY_START - 4 * DAY - 1); // 23:59:59.999 on day -5
    const earlyOnDay4 = stamp(TODAY_START - 4 * DAY); // 00:00:00.000 on day -4
    const plan = planRetention([earlierOnDay5, lateOnDay5, earlyOnDay4, ...recent], NOW, POLICY);
    // Each is the newest of its own UTC day, so both survive; the earlier day -5 one does not.
    expect(ids(plan.keep)).toEqual(
      expect.arrayContaining([lateOnDay5.version, earlyOnDay4.version]),
    );
    expect(ids(plan.remove)).toEqual([earlierOnDay5.version]);
  });

  it('keeps one snapshot per day across six months of daily use, then drops older days', () => {
    const history: VersionStamp[] = [];
    for (let day = 250; day >= 1; day -= 1) {
      // Three uploads per day at 18:00, 19:00 and 20:00 UTC.
      for (const hour of [18, 19, 20]) history.push(stamp(TODAY_START - day * DAY + hour * HOUR));
    }
    const todayGame = game(NOW - HOUR, 25);
    const plan = planRetention([...history, ...todayGame], NOW, POLICY);

    const kept = new Set(ids(plan.keep));
    // The 20 most recent (all from today's game)...
    for (const v of todayGame.slice(-20)) expect(kept.has(v.version)).toBe(true);
    // ...plus the 20:00 snapshot of each of the previous 179 days...
    for (let day = 1; day <= 179; day += 1) {
      const evening = history.find((v) => v.createdAtMs === TODAY_START - day * DAY + 20 * HOUR);
      expect(evening !== undefined && kept.has(evening.version)).toBe(true);
    }
    // ...and nothing else.
    expect(plan.keep).toHaveLength(20 + 179);
    expect(plan.remove).toHaveLength(history.length + todayGame.length - (20 + 179));
  });

  it('never removes the newest version, even after a long break', () => {
    const lastSeason = game(NOW - 400 * DAY, 50);
    const plan = planRetention(lastSeason, NOW, POLICY);
    expect(plan.keep[0]?.version).toBe(lastSeason[49]?.version);
    expect(plan.keep).toHaveLength(20);
  });

  it('returns the same plan, newest first, regardless of input order', () => {
    const uploads = [...game(NOW - HOUR, 30), ...game(NOW - 3 * DAY, 10)];
    const shuffled = [...uploads];
    const random = seededRandom(7);
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j] as VersionStamp, shuffled[i] as VersionStamp];
    }
    expect(ids(shuffled)).not.toEqual(ids(uploads));

    const fromOrdered = planRetention(uploads, NOW, POLICY);
    const fromShuffled = planRetention(shuffled, NOW, POLICY);
    expect(ids(fromShuffled.keep)).toEqual(ids(fromOrdered.keep));
    expect(ids(fromShuffled.remove)).toEqual(ids(fromOrdered.remove));
    const keptTimes = fromOrdered.keep.map((v) => v.createdAtMs);
    expect(keptTimes).toEqual([...keptTimes].sort((a, b) => b - a));
  });

  it('breaks createdAt ties by version id, deterministically', () => {
    const t = NOW - HOUR;
    const a = { version: formatVersionId(t, '00000001'), createdAtMs: t };
    const b = { version: formatVersionId(t, '00000002'), createdAtMs: t };
    const policy = { keepRecent: 1, keepDailyDays: 0 };
    expect(planRetention([a, b], NOW, policy).keep).toEqual([b]);
    expect(planRetention([b, a], NOW, policy).keep).toEqual([b]);
  });

  it('treats future-dated days (clock skew) as inside the daily window', () => {
    const farFuture = game(NOW + 5 * DAY, 20); // takes all 20 "recent" slots
    const nearFuture = stamp(NOW + 3 * DAY);
    const plan = planRetention([nearFuture, ...farFuture], NOW, POLICY);
    expect(ids(plan.keep)).toContain(nearFuture.version);
  });

  it('always keeps at least the newest version, even with keepRecent below 1', () => {
    const uploads = game(NOW - 400 * DAY, 5);
    const plan = planRetention(uploads, NOW, { keepRecent: 0, keepDailyDays: 0 });
    expect(ids(plan.keep)).toEqual([uploads[4]?.version]);
  });

  it('applies only the recent rule when keepDailyDays is 0', () => {
    const uploads = [stamp(NOW - 3 * DAY), stamp(NOW - 2 * DAY), stamp(NOW - DAY)];
    const plan = planRetention(uploads, NOW, { keepRecent: 2, keepDailyDays: 0 });
    expect(ids(plan.remove)).toEqual([uploads[0]?.version]);
  });

  it('keeps exactly the union of both rules over randomized histories', () => {
    const random = seededRandom(42);
    for (let round = 0; round < 200; round += 1) {
      const policy = {
        keepRecent: 1 + Math.floor(random() * 30),
        keepDailyDays: Math.floor(random() * 200),
      };
      const count = Math.floor(random() * 400);
      // Spread over the past year, plus a little clock skew into tomorrow.
      const versions = Array.from({ length: count }, () =>
        stamp(NOW - Math.floor(random() * 366 * DAY) + DAY),
      );
      const { keep, remove } = planRetention(versions, NOW, policy);

      // Partition: every input lands in exactly one list.
      expect(keep.length + remove.length).toBe(count);
      expect(new Set([...ids(keep), ...ids(remove)]).size).toBe(count);

      // Reference implementation of the rules, written independently.
      const sorted = [...versions].sort(
        (x, y) => y.createdAtMs - x.createdAtMs || (x.version < y.version ? 1 : -1),
      );
      const recent = ids(sorted.slice(0, policy.keepRecent));
      const today = Math.floor(NOW / DAY);
      const newestPerDay = new Map<number, string>();
      for (const v of sorted) {
        const day = Math.floor(v.createdAtMs / DAY);
        if (!newestPerDay.has(day)) newestPerDay.set(day, v.version);
      }
      const daily = [...newestPerDay]
        .filter(([day]) => policy.keepDailyDays > 0 && today - day < policy.keepDailyDays)
        .map(([, id]) => id);

      expect(new Set(ids(keep))).toEqual(new Set([...recent, ...daily]));
      if (count > 0) expect(keep[0]?.version).toBe(sorted[0]?.version);
    }
  });
});
