/**
 * Plain-text pieces of a game report: the matchup ("vs Central"), the result
 * ("Won 45–38") and the recap a parent texts to family. Pure: no React, no DOM.
 */
import {
  gameResult,
  periodLabel,
  STAT_LINE_KEYS,
  type GameResult,
  type StatLine,
} from '@/data/stats';
import type { Game, Player } from '@/data/types';
import { formatGameDate, formatMadeAttempted } from '@/lib/format';

/** 'vs Central', or '@ Central' for an away game (home, neutral and unset use 'vs'). */
export function matchupLabel(game: Pick<Game, 'opponent' | 'homeAway'>): string {
  return `${game.homeAway === 'away' ? '@' : 'vs'} ${game.opponent}`;
}

export interface GameOutcome {
  result: GameResult;
  /** 'Won', 'Lost' or 'Tied'. */
  word: string;
  /** Our score first, e.g. '45–38'. */
  score: string;
}

const OUTCOME_WORDS: Record<GameResult, string> = { W: 'Won', L: 'Lost', T: 'Tied' };

/** How the game ended; null unless it's final with both scores (see `gameResult`). */
export function gameOutcome(
  game: Pick<Game, 'status' | 'teamScore' | 'opponentScore'>,
): GameOutcome | null {
  const result = gameResult(game);
  const { teamScore, opponentScore } = game;
  if (!result || teamScore === undefined || opponentScore === undefined) return null;
  return { result, word: OUTCOME_WORDS[result], score: `${teamScore}–${opponentScore}` };
}

/** 'Won 45–38', 'Lost 38–45' or 'Tied 40–40', our score first; null without a result. */
export function resultLabel(
  game: Pick<Game, 'status' | 'teamScore' | 'opponentScore'>,
): string | null {
  const outcome = gameOutcome(game);
  return outcome ? `${outcome.word} ${outcome.score}` : null;
}

type RecapPlayer = Pick<Player, 'name'> | null | undefined;
type RecapGame = Pick<
  Game,
  | 'opponent'
  | 'homeAway'
  | 'date'
  | 'status'
  | 'teamScore'
  | 'opponentScore'
  | 'currentPeriod'
  | 'periodFormat'
>;

/** 'Ava vs Central', or just 'vs Central' before the player has a name. */
export function recapTitle(player: RecapPlayer, game: RecapGame): string {
  const name = player?.name.trim();
  const matchup = matchupLabel(game);
  return name ? `${name} ${matchup}` : matchup;
}

/** The counting stats in the recap, in order. Points always show; the rest only when > 0. */
const RECAP_COUNTS = [
  ['reb', 'REB'],
  ['ast', 'AST'],
  ['stl', 'STL'],
  ['blk', 'BLK'],
] as const satisfies readonly (readonly [keyof StatLine, string])[];

function joinParts(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(' · ');
}

function countOf(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The text a parent sends to family after (or during) a game, e.g.
 *
 *   Ava vs Central — Won 45–38 (Sun, Sep 27)
 *   14 PTS · 6 REB · 3 AST · 2 STL · 1 BLK
 *   FG 5/9 · 3PT 1/3 · FT 3/4
 *   4 deflections · 1 charge taken
 *
 * Stats she didn't get are left out (points always show), as are shot types she
 * didn't attempt and the hustle line when it's empty. With no score entered the
 * result is left out; a live game says "In progress" and the period instead. A game
 * with no stats at all is just the first line. Turnovers and fouls are never listed.
 */
export function buildGameRecap(player: RecapPlayer, game: RecapGame, line: StatLine): string {
  const outcome =
    game.status === 'live'
      ? `In progress, ${periodLabel(game.currentPeriod, game.periodFormat)}`
      : resultLabel(game);
  const date = formatGameDate(game.date);
  const title = recapTitle(player, game);
  const heading = outcome ? `${title} — ${outcome} (${date})` : `${title} (${date})`;

  const hasStats = STAT_LINE_KEYS.some((key) => line[key] > 0);
  if (!hasStats) return heading;

  const counts = joinParts([
    `${line.pts} PTS`,
    ...RECAP_COUNTS.map(([key, label]) => (line[key] > 0 ? `${line[key]} ${label}` : null)),
  ]);
  const shooting = joinParts([
    line.fga > 0 ? `FG ${formatMadeAttempted(line.fgm, line.fga)}` : null,
    line.fg3a > 0 ? `3PT ${formatMadeAttempted(line.fg3m, line.fg3a)}` : null,
    line.fta > 0 ? `FT ${formatMadeAttempted(line.ftm, line.fta)}` : null,
  ]);
  const hustle = joinParts([
    line.deflections > 0 ? countOf(line.deflections, 'deflection', 'deflections') : null,
    line.charges > 0 ? countOf(line.charges, 'charge taken', 'charges taken') : null,
  ]);

  return [heading, counts, shooting, hustle].filter(Boolean).join('\n');
}
