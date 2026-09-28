/**
 * Pure helpers for the Games list: row titles, dates, results and season groups.
 */
import type { BadgeTone } from '@/components/Badge/Badge';
import { gameResult, type GameStatLine } from '@/data/stats';
import type { Game } from '@/data/types';
import { formatGameDate } from '@/lib/format';

/** "vs Central", or "@ Central" for an away game (home, neutral and unknown read "vs"). */
export function gameTitle(game: Pick<Game, 'opponent' | 'homeAway'>): string {
  return `${game.homeAway === 'away' ? '@' : 'vs'} ${game.opponent}`;
}

/** 'Sun, Sep 27', with the year added for a game outside the current year (`today`'s). */
export function gameDateLabel(date: string, today: string): string {
  return formatGameDate(date, { withYear: date.slice(0, 4) !== today.slice(0, 4) });
}

export interface ResultBadge {
  /** Short text on the badge, e.g. 'W 45–38'. */
  label: string;
  /** What a screen reader says instead, e.g. 'Won 45 to 38'. */
  spoken: string;
  tone: BadgeTone;
}

/** The badge at the end of a game's row: Live, W/L/T with the score, or Final. */
export function resultBadge(
  game: Pick<Game, 'status' | 'teamScore' | 'opponentScore'>,
): ResultBadge {
  if (game.status === 'live') return { label: 'Live', spoken: 'In progress', tone: 'accent' };

  const result = gameResult(game);
  const { teamScore, opponentScore } = game;
  if (result === null || teamScore === undefined || opponentScore === undefined) {
    return { label: 'Final', spoken: 'Final', tone: 'neutral' };
  }
  const label = `${result} ${teamScore}–${opponentScore}`;
  const score = `${teamScore} to ${opponentScore}`;
  switch (result) {
    case 'W':
      return { label, spoken: `Won ${score}`, tone: 'made' };
    case 'L':
      return { label, spoken: `Lost ${score}`, tone: 'miss' };
    case 'T':
      return { label, spoken: `Tied ${score}`, tone: 'neutral' };
  }
}

export interface SeasonGroup {
  /** The season label, or undefined for games without one. */
  season: string | undefined;
  /** Newest first, like the entries passed in. */
  entries: GameStatLine[];
}

/**
 * Splits newest-first games into one group per season. The groups come in the order
 * of each season's newest game, so the current season is on top.
 */
export function groupBySeason(entries: readonly GameStatLine[]): SeasonGroup[] {
  const groups = new Map<string | undefined, SeasonGroup>();
  for (const entry of entries) {
    const season = entry.game.season || undefined;
    const group = groups.get(season);
    if (group) group.entries.push(entry);
    else groups.set(season, { season, entries: [entry] });
  }
  return [...groups.values()];
}

/** "1 point", "14 points". */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
