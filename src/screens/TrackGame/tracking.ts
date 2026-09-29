/**
 * Pure helpers for the live game screen: no React, no DOM, no database.
 */
import { regulationPeriods, statDefOf, type StatDef } from '@/data/stats';
import {
  MAX_PERIOD,
  MAX_SCORE,
  STAT_TYPES,
  type CourtPoint,
  type PeriodFormat,
  type StatType,
} from '@/data/types';
import { isThreePoint } from '@/lib/court';
import type { NotSaved } from './session';

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
  return statDefOf(type)?.label ?? type;
}

/** A stat's color: made, miss or other ('other' for a type this app doesn't know). */
export function statKind(type: StatType): StatDef['kind'] {
  return statDefOf(type)?.kind ?? 'other';
}

/** A saved stat or a tap, as the screen counts them. */
export interface Counted {
  readonly id: string;
  readonly type: StatType;
  /** Where a 2PT/3PT shot was taken, when its spot was marked. */
  readonly location?: CourtPoint;
}

/**
 * The game's saved stats plus the taps not among them yet, each once (by id), less the
 * stats being taken back (`takenBack`, by id): what the screen counts, from the moment
 * of each tap and each Undo.
 */
export function withTaps(
  saved: readonly Counted[],
  taps: readonly Counted[],
  takenBack: readonly string[] = [],
): readonly Counted[] {
  const gone = new Set(takenBack);
  const counted = gone.size === 0 ? saved : saved.filter((stat) => !gone.has(stat.id));
  if (taps.length === 0) return counted;
  const savedIds = new Set(saved.map((stat) => stat.id));
  const notSaved = taps.filter((tap) => !savedIds.has(tap.id) && !gone.has(tap.id));
  return notSaved.length === 0 ? counted : [...counted, ...notSaved];
}

/**
 * The last-action line's note on a shot's spot, with the shot chart on: how to mark it
 * while the court takes it (`open`), then that it's marked. A spot on the other side
 * of the 3-point line from the button tapped says so (the button still counts).
 * Undefined when there's nothing to say.
 */
export function spotNote(
  type: StatType,
  spot: CourtPoint | undefined,
  open: boolean,
): string | undefined {
  if (!spot) return open ? 'Tap the court to mark the spot' : undefined;
  const three = statDefOf(type)?.shot === 'fg3';
  if (isThreePoint(spot) === three) return 'Spot marked';
  return three ? 'Spot marked · inside the arc' : 'Spot marked · beyond the arc';
}

/**
 * What happens to stats not saved yet: kept on this phone (the pending-stats journal)
 * and saved automatically, even after a relaunch; or (with no room to keep them) saved
 * automatically only while the app stays open (the app-wide retry, pendingSaves.ts).
 */
export function unsavedNote(count: number, kept: boolean): string {
  // "It's" or "They're", starting a sentence and inside one.
  const [starting, inside] = count === 1 ? ["It's", "it's"] : ["They're", "they're"];
  return kept
    ? `${starting} kept on this phone and will be saved automatically.`
    : `${starting} not kept on this phone. Keep the app open until ${inside} saved.`;
}

/**
 * E.g. "1 stat isn't saved yet" or "2 stats aren't saved yet". A shot saved without
 * the spot marked for it says so: "1 shot's spot isn't saved yet" (or, with a stat
 * too, "1 stat and 1 shot's spot aren't saved yet").
 */
export function notSavedTitle({ count, spots }: Pick<NotSaved, 'count' | 'spots'>): string {
  const stats = count - spots;
  const parts: string[] = [];
  if (stats > 0 || spots === 0) parts.push(stats === 1 ? '1 stat' : `${stats} stats`);
  if (spots > 0) parts.push(spots === 1 ? "1 shot's spot" : `${spots} shots' spots`);
  return `${parts.join(' and ')} ${count === 1 ? "isn't" : "aren't"} saved yet`;
}

/** E.g. "1 stat isn't saved yet. It's kept on this phone and will be saved automatically." */
export function notSavedMessage(notSaved: NotSaved): string {
  return `${notSavedTitle(notSaved)}. ${unsavedNote(notSaved.count, notSaved.kept)}`;
}

/** What the end-game sheet, and the line under it, say when the game couldn't be ended. */
export const END_GAME_FAILED = "Couldn't end the game. Try again.";

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

/** What measuring text needs from a canvas 2D context. */
export interface TextMeasurer {
  font: string;
  measureText(text: string): { width: number };
}

/** The px size in a CSS font shorthand as a canvas gives it back, e.g. 24 in '700 24px serif'. */
function fontSizePx(font: string): number | undefined {
  const match = /(?:^|\s)(\d*\.?\d+)px(?:[\s/]|$)/.exec(font);
  return match ? Number(match[1]) : undefined;
}

/**
 * The widest of `words` in em, measured on a canvas in `font` (a CSS font of `size`
 * px). Undefined if the canvas didn't take that font: it ignores one it can't parse
 * and keeps its own, and measuring in that would give the wrong widths.
 */
export function widestWordOnCanvas(
  context: TextMeasurer,
  font: string,
  size: number,
  words: readonly string[],
): number | undefined {
  context.font = font;
  const taken = fontSizePx(context.font);
  if (taken === undefined || Math.abs(taken - size) > 0.01) return undefined;
  let widest = 0;
  for (const word of words) {
    widest = Math.max(
      widest,
      widestWordEm(word, (each) => context.measureText(each).width / size),
    );
  }
  return widest > 0 ? widest : undefined;
}

/**
 * Taps on one control closer together than this are a double tap: only the first
 * counts. Also how long the last-action line's button ignores taps after an Undo.
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
