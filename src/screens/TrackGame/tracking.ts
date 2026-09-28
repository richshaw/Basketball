/**
 * Pure helpers for the live game screen: no React, no DOM, no database.
 */
import { regulationPeriods, STAT_DEFS } from '@/data/stats';
import { MAX_PERIOD, STAT_TYPES, type Game, type PeriodFormat, type StatType } from '@/data/types';

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

/** The label of a stat type, e.g. '3PT Made' (the type itself if it's unknown). */
export function statLabel(type: StatType): string {
  return (STAT_DEFS[type] as (typeof STAT_DEFS)[StatType] | undefined)?.label ?? type;
}

/** 'vs Central', or '@ Central' for an away game. */
export function matchupTitle(game: Pick<Game, 'opponent' | 'homeAway'>): string {
  return `${game.homeAway === 'away' ? '@' : 'vs'} ${game.opponent}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
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

/** Highest score the data layer accepts. */
const MAX_SCORE = 999;

/**
 * Reads a final-score field: undefined when it's blank, null when it isn't a whole
 * number from 0 to 999, else the number.
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
 * Stat buttons size their label so this word fits on one line.
 */
export function widestWordEm(label: string, measureEm: (word: string) => number): number {
  let widest = 0;
  for (const word of label.split(/\s+/)) {
    if (word) widest = Math.max(widest, measureEm(word));
  }
  return widest;
}
