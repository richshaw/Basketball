/** Compact text for games on the Stats screen. Pure: no React, no DOM. */
import { gameResult, type GamesSummary } from '@/data/stats';
import type { Game } from '@/data/types';
import { formatGameDate } from '@/lib/format';

/**
 * Whether the games' dates need their years to be told apart: they fall in more than
 * one calendar year (e.g. all seasons, or a season that runs past New Year).
 */
export function spansYears(games: readonly Pick<Game, 'date'>[]): boolean {
  const year = games[0]?.date.slice(0, 4);
  return games.some((game) => game.date.slice(0, 4) !== year);
}

/**
 * 'Aug 1 – Sep 24' ('Aug 1, 2025 – Sep 24, 2026' with `withYear`): the first and last
 * game days, without weekdays. One date for a single day.
 */
export function formatDateRange(first: string, last: string, { withYear = false } = {}): string {
  const day = (date: string) => formatGameDate(date, { withYear, weekday: false });
  return first === last ? day(first) : `${day(first)} – ${day(last)}`;
}

/** 'vs Lincoln' for home and neutral games, 'at Lincoln' for away games. */
export function opponentLabel(game: Pick<Game, 'opponent' | 'homeAway'>): string {
  return `${game.homeAway === 'away' ? 'at' : 'vs'} ${game.opponent}`;
}

/** The final score as '45–38' (ours first), or null when it wasn't entered. */
export function formatScore(game: Pick<Game, 'teamScore' | 'opponentScore'>): string | null {
  const { teamScore, opponentScore } = game;
  return teamScore === undefined || opponentScore === undefined
    ? null
    : `${teamScore}–${opponentScore}`;
}

/** 'W 45–38', 'L 30–35', 'T 40–40', or null for a game without a result. */
export function formatResult(game: Pick<Game, 'status' | 'teamScore' | 'opponentScore'>) {
  const result = gameResult(game);
  const score = formatScore(game);
  return result && score ? `${result} ${score}` : null;
}

/** '7–3', or '7–3–1' with ties. Null when no game has a result (no final scores entered). */
export function formatRecord({ wins, losses, ties }: GamesSummary['record']): string | null {
  if (wins + losses + ties === 0) return null;
  return ties > 0 ? `${wins}–${losses}–${ties}` : `${wins}–${losses}`;
}

/** '1 game', '10 games'. */
export function formatGameCount(count: number): string {
  return `${count} ${count === 1 ? 'game' : 'games'}`;
}
