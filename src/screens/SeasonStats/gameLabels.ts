/** Compact text for games on the Stats screen. Pure: no React, no DOM. */
import { gameResult, type GamesSummary } from '@/data/stats';
import type { Game } from '@/data/types';
import { parseLocalDate } from '@/lib/format';

/** 'Sep 12' ('Sep 12, 2026' with `withYear`). Anything that isn't a valid date comes back as is. */
export function formatShortDate(isoDate: string, { withYear = false } = {}): string {
  const date = parseLocalDate(isoDate);
  if (!date) return isoDate;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** 'Sep 12 – Oct 3', with the years when the range crosses New Year. One date for a single day. */
export function formatDateRange(first: string, last: string): string {
  if (first === last) return formatShortDate(first);
  const withYear = first.slice(0, 4) !== last.slice(0, 4);
  return `${formatShortDate(first, { withYear })} – ${formatShortDate(last, { withYear })}`;
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
