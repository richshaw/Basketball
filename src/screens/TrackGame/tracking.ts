/**
 * Pure helpers for the live game screen: no React, no DOM, no database.
 */
import { regulationPeriods, STAT_DEFS, type StatDef } from '@/data/stats';
import { MAX_PERIOD, MAX_SCORE, STAT_TYPES, type PeriodFormat, type StatType } from '@/data/types';
import { pad2 } from '@/lib/format';

export type StatCounts = Record<StatType, number>;

/** How many of each stat a game has, for the counts on the buttons. */
export function countByType(events: readonly { type: StatType }[]): StatCounts {
  const counts = Object.fromEntries(STAT_TYPES.map((type) => [type, 0])) as StatCounts;
  for (const { type } of events) {
    // Unknown types (e.g. from a newer app) are skipped, like the stats math does.
    if (Object.hasOwn(counts, type)) counts[type] += 1;
  }
  return counts;
}

/** A stat's definition, or undefined for a type this app doesn't know (e.g. from a newer one). */
function statDef(type: StatType): StatDef | undefined {
  return Object.hasOwn(STAT_DEFS, type) ? STAT_DEFS[type] : undefined;
}

/** The label of a stat type, e.g. '3PT Made' (the type itself if it's unknown). */
export function statLabel(type: StatType): string {
  return statDef(type)?.label ?? type;
}

/** A stat's color: made, miss or other ('other' for a type this app doesn't know). */
export function statKind(type: StatType): StatDef['kind'] {
  return statDef(type)?.kind ?? 'other';
}

/** Local clock time of a timestamp as 'h:mm:ss' (12-hour, no AM/PM), e.g. '7:42:05'. */
export function formatClockTime(timestamp: number): string {
  const time = new Date(timestamp);
  const hours = time.getHours() % 12 || 12;
  return `${hours}:${pad2(time.getMinutes())}:${pad2(time.getSeconds())}`;
}

/** Overtimes the period picker always offers after regulation. */
const OVERTIMES_OFFERED = 4;

/**
 * Periods the period picker offers: regulation plus a few overtimes, and always
 * the one after the current period (up to MAX_PERIOD).
 */
export function periodChoices(current: number, format: PeriodFormat): number[] {
  const last = Math.min(
    MAX_PERIOD,
    Math.max(regulationPeriods(format) + OVERTIMES_OFFERED, current + 1),
  );
  return Array.from({ length: last }, (_, index) => index + 1);
}

/** Personal fouls at which the player is in foul trouble, and fouled out (high school rules). */
export const FOUL_TROUBLE_AT = 4;
export const FOULED_OUT_AT = 5;

export type FoulStatus = 'ok' | 'trouble' | 'out';

export function foulStatus(fouls: number): FoulStatus {
  if (fouls >= FOULED_OUT_AT) return 'out';
  if (fouls >= FOUL_TROUBLE_AT) return 'trouble';
  return 'ok';
}

/**
 * Reads a final-score field: undefined when it's blank, null when it isn't a whole
 * number from 0 to MAX_SCORE, else the number.
 */
export function parseScore(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (!/^\d+$/.test(trimmed)) return null;
  const score = Number(trimmed);
  return score <= MAX_SCORE ? score : null;
}

/**
 * The widest word of a label, in em, given a function that measures a word in em.
 * Stat buttons size their labels so the widest word fits on one line.
 */
export function widestWordEm(label: string, measureEm: (word: string) => number): number {
  let widest = 0;
  for (const word of label.split(/\s+/)) {
    if (word) widest = Math.max(widest, measureEm(word));
  }
  return widest;
}

/**
 * Taps on one control closer together than this are a double tap: only the first
 * counts. Also how long a button that just changed ignores taps.
 */
export const DOUBLE_TAP_MS = 400;

/**
 * Lets through at most one call per `windowMs`: `if (!guard()) return;` at the top
 * of a tap handler ignores the second tap of a double tap.
 */
export function createTapGuard(
  windowMs = DOUBLE_TAP_MS,
  now: () => number = () => performance.now(),
): () => boolean {
  let last = -Infinity;
  return () => {
    const time = now();
    if (time - last < windowMs) return false;
    last = time;
    return true;
  };
}
