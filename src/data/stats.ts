/**
 * Stat definitions and stat math. Pure functions only: no database, no React.
 *
 * Everything is derived from stat events (see types.ts), so these functions are the
 * single source of truth for points, rebounds, percentages and season numbers.
 */
import { MAX_PERIOD, type Game, type PeriodFormat, type StatEvent, type StatType } from './types';

export type ShotType = 'fg2' | 'fg3' | 'ft';

export interface StatDef {
  /** Full label for buttons, the event log and reports, e.g. '2PT Made', 'Off Reb'. */
  label: string;
  /** Compact, still unique label for tight spots, e.g. 'Made 2', 'OReb'. */
  shortLabel: string;
  /** 'made' / 'miss' for shot attempts (color them), 'other' for everything else. */
  kind: 'made' | 'miss' | 'other';
  /** Points the stat adds to the player's total. */
  points: number;
  /** The shot this is an attempt of; only set on shot types. */
  shot?: ShotType;
}

/** Definitions for every stat type, in `STAT_TYPES` order. */
export const STAT_DEFS: Record<StatType, StatDef> = {
  fg2_made: { label: '2PT Made', shortLabel: 'Made 2', kind: 'made', points: 2, shot: 'fg2' },
  fg2_miss: { label: '2PT Miss', shortLabel: 'Miss 2', kind: 'miss', points: 0, shot: 'fg2' },
  fg3_made: { label: '3PT Made', shortLabel: 'Made 3', kind: 'made', points: 3, shot: 'fg3' },
  fg3_miss: { label: '3PT Miss', shortLabel: 'Miss 3', kind: 'miss', points: 0, shot: 'fg3' },
  ft_made: { label: 'FT Made', shortLabel: 'Made FT', kind: 'made', points: 1, shot: 'ft' },
  ft_miss: { label: 'FT Miss', shortLabel: 'Miss FT', kind: 'miss', points: 0, shot: 'ft' },
  oreb: { label: 'Off Reb', shortLabel: 'OReb', kind: 'other', points: 0 },
  dreb: { label: 'Def Reb', shortLabel: 'DReb', kind: 'other', points: 0 },
  ast: { label: 'Assist', shortLabel: 'Ast', kind: 'other', points: 0 },
  stl: { label: 'Steal', shortLabel: 'Stl', kind: 'other', points: 0 },
  blk: { label: 'Block', shortLabel: 'Blk', kind: 'other', points: 0 },
  tov: { label: 'Turnover', shortLabel: 'TO', kind: 'other', points: 0 },
  foul: { label: 'Foul', shortLabel: 'Foul', kind: 'other', points: 0 },
  deflection: { label: 'Deflection', shortLabel: 'Defl', kind: 'other', points: 0 },
  charge: { label: 'Charge Taken', shortLabel: 'Charge', kind: 'other', points: 0 },
};

/**
 * The definition of a stat type, or undefined for one this version doesn't know (e.g.
 * data from a newer app), which screens show by its type and reports leave out, as
 * `computeStatLine` does.
 */
export function statDefOf(type: string): StatDef | undefined {
  return Object.hasOwn(STAT_DEFS, type) ? STAT_DEFS[type as StatType] : undefined;
}

/** Field goal attempts: the only stat types that can carry a shot location. */
export const FIELD_GOAL_TYPES = ['fg2_made', 'fg2_miss', 'fg3_made', 'fg3_miss'] as const;
export type FieldGoalType = (typeof FIELD_GOAL_TYPES)[number];

export function isFieldGoalType(type: StatType): type is FieldGoalType {
  const shot = STAT_DEFS[type]?.shot;
  return shot === 'fg2' || shot === 'fg3';
}

/** A box-score line. Field goals (fg*) count 2PT and 3PT shots, never free throws. */
export interface StatLine {
  pts: number;
  fgm: number;
  fga: number;
  fg2m: number;
  fg2a: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  /** oreb + dreb */
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  /** Personal fouls. */
  pf: number;
  deflections: number;
  charges: number;
}

/** Every StatLine field, in box-score order. */
export const STAT_LINE_KEYS = [
  'pts',
  'fgm',
  'fga',
  'fg2m',
  'fg2a',
  'fg3m',
  'fg3a',
  'ftm',
  'fta',
  'oreb',
  'dreb',
  'reb',
  'ast',
  'stl',
  'blk',
  'tov',
  'pf',
  'deflections',
  'charges',
] as const satisfies readonly (keyof StatLine)[];

/** The StatLine fields (besides pts) that each stat type counts toward. */
const COUNTS: Record<StatType, readonly (keyof StatLine)[]> = {
  fg2_made: ['fgm', 'fga', 'fg2m', 'fg2a'],
  fg2_miss: ['fga', 'fg2a'],
  fg3_made: ['fgm', 'fga', 'fg3m', 'fg3a'],
  fg3_miss: ['fga', 'fg3a'],
  ft_made: ['ftm', 'fta'],
  ft_miss: ['fta'],
  oreb: ['oreb', 'reb'],
  dreb: ['dreb', 'reb'],
  ast: ['ast'],
  stl: ['stl'],
  blk: ['blk'],
  tov: ['tov'],
  foul: ['pf'],
  deflection: ['deflections'],
  charge: ['charges'],
};

export function emptyStatLine(): StatLine {
  return {
    pts: 0,
    fgm: 0,
    fga: 0,
    fg2m: 0,
    fg2a: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
    deflections: 0,
    charges: 0,
  };
}

/** Adds one event to a line in place. Unknown types (e.g. from a newer app) are ignored. */
function countEvent(line: StatLine, type: StatType): void {
  const fields = COUNTS[type] as readonly (keyof StatLine)[] | undefined;
  if (!fields) return;
  line.pts += STAT_DEFS[type].points;
  for (const field of fields) line[field] += 1;
}

/** Totals for a list of events (e.g. one game's events). */
export function computeStatLine(events: readonly Pick<StatEvent, 'type'>[]): StatLine {
  const line = emptyStatLine();
  for (const event of events) countEvent(line, event.type);
  return line;
}

/** Field-by-field sum of two lines; the inputs aren't changed. */
export function addStatLines(a: StatLine, b: StatLine): StatLine {
  const sum = emptyStatLine();
  for (const key of STAT_LINE_KEYS) sum[key] = a[key] + b[key];
  return sum;
}

/** Periods in regulation: 4 quarters or 2 halves. */
export function regulationPeriods(format: PeriodFormat): number {
  return format === 'halves' ? 2 : 4;
}

/** 'Q1'…'Q4' or 'H1', 'H2', then 'OT', '2OT', '3OT'… */
export function periodLabel(period: number, format: PeriodFormat): string {
  const regulation = regulationPeriods(format);
  if (period <= regulation) return `${format === 'halves' ? 'H' : 'Q'}${period}`;
  const overtime = period - regulation;
  return overtime === 1 ? 'OT' : `${overtime}OT`;
}

export interface PeriodStatLine {
  /** 1-based period number. */
  period: number;
  /** e.g. 'Q2' or '2OT' (see `periodLabel`). */
  label: string;
  line: StatLine;
}

/**
 * One line per period, in order, from period 1 through the later of the game's
 * current period and the highest period with an event. Empty periods are included.
 */
export function statLinesByPeriod(
  events: readonly Pick<StatEvent, 'type' | 'period'>[],
  game: Pick<Game, 'currentPeriod' | 'periodFormat'>,
): PeriodStatLine[] {
  let last = game.currentPeriod;
  for (const event of events) last = Math.max(last, event.period);
  last = Math.min(Math.max(Math.floor(last), 1), MAX_PERIOD);

  const lines: PeriodStatLine[] = [];
  for (let period = 1; period <= last; period++) {
    lines.push({ period, label: periodLabel(period, game.periodFormat), line: emptyStatLine() });
  }
  for (const event of events) {
    const entry = lines[event.period - 1];
    if (entry) countEvent(entry.line, event.type);
  }
  return lines;
}

/**
 * Shooting percentage from 0 to 100 (not a fraction), or null with no attempts.
 * Multiplies before dividing so a true .5 stays exact: 23/40 is 57.5 (shown as 58%),
 * where (23 / 40) * 100 would be 57.49999… (shown as 57%).
 */
export function percentage(made: number, attempted: number): number | null {
  return attempted > 0 ? (made * 100) / attempted : null;
}

export type GameResult = 'W' | 'L' | 'T';

/** Win, loss or tie; null unless the game is final and both scores are set. */
export function gameResult(
  game: Pick<Game, 'status' | 'teamScore' | 'opponentScore'>,
): GameResult | null {
  const { status, teamScore, opponentScore } = game;
  if (status !== 'final' || teamScore === undefined || opponentScore === undefined) return null;
  if (teamScore > opponentScore) return 'W';
  if (teamScore < opponentScore) return 'L';
  return 'T';
}

/** Groups events by game id, keeping each game's events in their original order. */
export function groupEventsByGame<E extends Pick<StatEvent, 'gameId'>>(
  events: readonly E[],
): Map<string, E[]> {
  const byGame = new Map<string, E[]>();
  for (const event of events) {
    const list = byGame.get(event.gameId);
    if (list) list.push(event);
    else byGame.set(event.gameId, [event]);
  }
  return byGame;
}

export interface GameStatLine {
  game: Game;
  line: StatLine;
}

/** Pairs each game with its stat line, e.g. `statLinesForGames(games, allEvents)`. */
export function statLinesForGames(
  games: readonly Game[],
  events: readonly Pick<StatEvent, 'gameId' | 'type'>[],
): GameStatLine[] {
  const byGame = groupEventsByGame(events);
  return games.map((game) => ({ game, line: computeStatLine(byGame.get(game.id) ?? []) }));
}

/** The stats that season highs are tracked for. */
export const HIGH_STATS = ['pts', 'reb', 'ast', 'stl', 'blk', 'deflections'] as const;
export type HighStat = (typeof HIGH_STATS)[number];

export interface GameHigh {
  value: number;
  gameId: string;
}

export interface GamesSummary {
  gamesPlayed: number;
  /** Only games with a result count (final, with both scores). */
  record: { wins: number; losses: number; ties: number };
  totals: StatLine;
  /**
   * Per-game averages of every field, rounded half up to one decimal from the integer
   * totals (17 in 20 games is 0.9, not the 0.8 that 0.85 in floating point gives).
   * All 0 when no games were passed.
   */
  averages: StatLine;
  /** From the totals (made / attempted over all games), 0-100 or null. */
  shooting: {
    fgPct: number | null;
    fg2Pct: number | null;
    fg3Pct: number | null;
    ftPct: number | null;
  };
  /**
   * Best single game for each stat. Ties go to the earliest game (date, then createdAt).
   * null when no game has at least 1.
   */
  highs: Record<HighStat, GameHigh | null>;
}

function compareGamesOldestFirst(a: Game, b: Game): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.createdAt - b.createdAt;
}

/**
 * Season numbers for the games passed in. Callers choose the games: usually the
 * final games of one season, e.g.
 * `summarizeGames(statLinesForGames(games.filter(g => g.status === 'final' && g.season === s), events))`.
 * Every entry counts as a game played.
 */
export function summarizeGames(entries: readonly GameStatLine[]): GamesSummary {
  const gamesPlayed = entries.length;
  const record = { wins: 0, losses: 0, ties: 0 };
  let totals = emptyStatLine();
  const highs: Record<HighStat, GameHigh | null> = {
    pts: null,
    reb: null,
    ast: null,
    stl: null,
    blk: null,
    deflections: null,
  };

  const oldestFirst = [...entries].sort((a, b) => compareGamesOldestFirst(a.game, b.game));
  for (const { game, line } of oldestFirst) {
    const result = gameResult(game);
    if (result === 'W') record.wins++;
    else if (result === 'L') record.losses++;
    else if (result === 'T') record.ties++;

    totals = addStatLines(totals, line);

    for (const stat of HIGH_STATS) {
      const best = highs[stat];
      if (line[stat] > 0 && (!best || line[stat] > best.value)) {
        highs[stat] = { value: line[stat], gameId: game.id };
      }
    }
  }

  const averages = emptyStatLine();
  if (gamesPlayed > 0) {
    // total * 10 / games is exact at a true .x5, so Math.round rounds it up as it should.
    for (const key of STAT_LINE_KEYS) {
      averages[key] = Math.round((totals[key] * 10) / gamesPlayed) / 10;
    }
  }

  return {
    gamesPlayed,
    record,
    totals,
    averages,
    shooting: {
      fgPct: percentage(totals.fgm, totals.fga),
      fg2Pct: percentage(totals.fg2m, totals.fg2a),
      fg3Pct: percentage(totals.fg3m, totals.fg3a),
      ftPct: percentage(totals.ftm, totals.fta),
    },
    highs,
  };
}
