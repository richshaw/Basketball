/**
 * The Hoop Stats data model.
 *
 * Stats are event-sourced: a game plus its stat events is the whole record. Every
 * number on screen (points, rebounds, percentages, season averages) is derived from
 * the events by `src/data/stats.ts`, so totals can never drift out of sync.
 *
 * Timestamps are epoch milliseconds. Ids are opaque strings (UUIDs for new records).
 * There is exactly one player: the daughter whose stats are being recorded.
 */

/** Every stat the live game screen can record (definitions in `STAT_DEFS`, stats.ts). */
export const STAT_TYPES = [
  'fg2_made',
  'fg2_miss',
  'fg3_made',
  'fg3_miss',
  'ft_made',
  'ft_miss',
  'oreb',
  'dreb',
  'ast',
  'stl',
  'blk',
  'tov',
  'foul',
  'deflection',
  'charge',
] as const;
export type StatType = (typeof STAT_TYPES)[number];

/** How a game is split up: 4 quarters (high school) or 2 halves. */
export const PERIOD_FORMATS = ['quarters', 'halves'] as const;
export type PeriodFormat = (typeof PERIOD_FORMATS)[number];

export const HOME_AWAY = ['home', 'away', 'neutral'] as const;
export type HomeAway = (typeof HOME_AWAY)[number];

export const GAME_STATUSES = ['live', 'final'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/**
 * Highest period a game can reach: regulation plus a lot of overtimes. A guard
 * against runaway "next period" taps, since reports list every period up to it.
 */
export const MAX_PERIOD = 20;

/** Highest score either team can have (scores are whole numbers from 0). */
export const MAX_SCORE = 999;

/** Longest text each field accepts. Form inputs can use these as `maxLength`. */
export const TEXT_LIMITS = {
  playerName: 80,
  jerseyNumber: 8,
  opponent: 80,
  season: 60,
  notes: 5000,
} as const;

export interface Player {
  id: string;
  /** May be empty until the parent sets it (see `formatPlayerName` in src/lib/format.ts). */
  name: string;
  /** Free text such as '12' or '00'. */
  jerseyNumber?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Game {
  id: string;
  playerId: string;
  opponent: string;
  /** Local calendar date 'YYYY-MM-DD' (not UTC). Format it with `formatGameDate`. */
  date: string;
  /** Free-text team/season label, e.g. 'Fall 2026' or 'JV Winter'. */
  season?: string;
  homeAway?: HomeAway;
  periodFormat: PeriodFormat;
  /** 1-based. Anything above regulation (4 quarters or 2 halves) is overtime. */
  currentPeriod: number;
  status: GameStatus;
  /** Final score, usually entered when the game ends. */
  teamScore?: number;
  opponentScore?: number;
  notes?: string;
  createdAt: number;
  /** Bumped by every change to the game or its events. */
  updatedAt: number;
  /** Set when the game ends; cleared if it's reopened. */
  endedAt?: number;
}

/**
 * A shot location in FEET on a high-school half court (geometry in src/lib/court.ts).
 * The origin is the center of the basket. +x points to the right sideline as seen
 * from half court facing the basket; +y points toward half court. The baseline is at
 * y = -5.25, the sidelines at x = ±25 and the half-court line at y = 36.75.
 */
export interface CourtPoint {
  x: number;
  y: number;
}

/** One tap on the live game screen. */
export interface StatEvent {
  id: string;
  gameId: string;
  type: StatType;
  /** The game's current period when the stat was recorded. */
  period: number;
  /** Strictly increasing within a game, so event order and undo are exact. */
  createdAt: number;
  /** Where the shot was taken from. Only on 2PT and 3PT shots (fg2_* / fg3_*). */
  location?: CourtPoint;
}

/** App preferences, stored on the device. */
export interface Settings {
  /** Ask where each 2PT/3PT shot was taken. Default true. */
  shotChart: boolean;
  /** Pre-selected in the new game form; remembers the last game's format. */
  defaultPeriodFormat: PeriodFormat;
  /** Pre-filled in the new game form; remembers the last season used. */
  lastSeason?: string;
}
