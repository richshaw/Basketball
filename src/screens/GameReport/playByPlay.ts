/**
 * The play-by-play list as plain data: a game's stats grouped by period, each with
 * her running points. Pure: no React, no database.
 */
import { periodLabel, regulationPeriods, STAT_DEFS } from '@/data/stats';
import type { PeriodFormat, StatEvent } from '@/data/types';

export interface Play {
  event: StatEvent;
  /** Points this stat added: 0 for all but made shots. */
  scored: number;
  /** Her total points after this stat. */
  points: number;
}

export interface PeriodPlays {
  period: number;
  /** 'Q1', 'H2', 'OT' (see `periodLabel`). */
  label: string;
  /** '1st quarter', '2nd half', 'Overtime', '2nd overtime'. */
  name: string;
  plays: Play[];
}

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
 * order they were recorded. Only periods with stats appear. Running points follow
 * that order, so the last play shows the final total.
 */
export function playByPlay(events: readonly StatEvent[], format: PeriodFormat): PeriodPlays[] {
  const ordered = [...events].sort((a, b) => a.period - b.period || a.createdAt - b.createdAt);
  const groups: PeriodPlays[] = [];
  let points = 0;
  for (const event of ordered) {
    const scored = STAT_DEFS[event.type].points;
    points += scored;
    let group = groups.at(-1);
    if (group?.period !== event.period) {
      group = {
        period: event.period,
        label: periodLabel(event.period, format),
        name: periodName(event.period, format),
        plays: [],
      };
      groups.push(group);
    }
    group.plays.push({ event, scored, points });
  }
  return groups;
}

/** Local time on a 12-hour clock without AM/PM, e.g. '6:05' or '12:30'. */
export function formatClockTime(epochMs: number): string {
  const date = new Date(epochMs);
  const hours = date.getHours() % 12 || 12;
  return `${hours}:${String(date.getMinutes()).padStart(2, '0')}`;
}
