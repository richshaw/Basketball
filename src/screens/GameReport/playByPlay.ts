/**
 * The play-by-play list as plain data: a game's stats grouped by period, with the
 * points each play and each period added. Pure: no React, no database.
 */
import { periodLabel, regulationPeriods, statDefOf, type StatDef } from '@/data/stats';
import type { PeriodFormat, StatEvent } from '@/data/types';

export interface Play {
  event: StatEvent;
  /** What the stat is (label, kind, points). */
  def: StatDef;
  /** Points this stat added: 0 for all but made shots. */
  scored: number;
}

export interface PeriodPlays {
  period: number;
  /** 'Q1', 'H2', 'OT' (see `periodLabel`). */
  label: string;
  /** '1st quarter', '2nd half', 'Overtime', '2nd overtime'. */
  name: string;
  plays: Play[];
  /** Points she scored in this period. */
  points: number;
  /** Her points so far at the end of this period. */
  total: number;
}

/** A game with this many plays or fewer shows every period's plays at first. */
export const EXPAND_ALL_UP_TO = 15;

function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** A period spelled out: '1st quarter', '2nd half', 'Overtime', '2nd overtime'. */
export function periodName(period: number, format: PeriodFormat): string {
  const regulation = regulationPeriods(format);
  if (period <= regulation) return `${ordinal(period)} ${format === 'halves' ? 'half' : 'quarter'}`;
  const overtime = period - regulation;
  return overtime === 1 ? 'Overtime' : `${ordinal(overtime)} overtime`;
}

/**
 * Stats grouped by period, in order: periods ascending, and within each period the
 * order they were recorded. Only periods with stats appear, and stat types this
 * version doesn't know are left out.
 */
export function playByPlay(events: readonly StatEvent[], format: PeriodFormat): PeriodPlays[] {
  const ordered = [...events].sort((a, b) => a.period - b.period || a.createdAt - b.createdAt);
  const groups: PeriodPlays[] = [];
  let total = 0;
  for (const event of ordered) {
    const def = statDefOf(event.type);
    if (!def) continue;
    let group = groups.at(-1);
    if (group?.period !== event.period) {
      group = {
        period: event.period,
        label: periodLabel(event.period, format),
        name: periodName(event.period, format),
        plays: [],
        points: 0,
        total,
      };
      groups.push(group);
    }
    total += def.points;
    group.points += def.points;
    group.total = total;
    group.plays.push({ event, def, scored: def.points });
  }
  return groups;
}

/** The total number of plays in these periods. */
export function countPlays(groups: readonly PeriodPlays[]): number {
  return groups.reduce((sum, group) => sum + group.plays.length, 0);
}

function countOf(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * What happened in a period, for its header: '10 plays · 8 pts', with her running
 * total from the second period she scored in on: '7 plays · 5 pts · 13 total'.
 */
export function periodSummary(group: PeriodPlays): string {
  const parts = [countOf(group.plays.length, 'play', 'plays'), countOf(group.points, 'pt', 'pts')];
  if (group.total !== group.points) parts.push(`${group.total} total`);
  return parts.join(' · ');
}
