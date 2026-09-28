/**
 * The Stats screen's season filter: which games count, the default choice, and
 * remembering the parent's choice for the rest of the session. Pure apart from the
 * sessionStorage wrapper at the bottom.
 */
import type { Game } from '@/data/types';

/** 'all', or one season's label behind a prefix (so a season named "all" can't clash). */
export type SeasonKey = 'all' | `season:${string}`;

export const ALL_SEASONS: SeasonKey = 'all';

export function seasonKey(season: string): SeasonKey {
  return `season:${season}`;
}

/** The season label a key stands for, or null for all seasons. */
export function seasonOf(key: SeasonKey): string | null {
  return key === ALL_SEASONS ? null : key.slice('season:'.length);
}

/** Whether a game belongs to the chosen season ('all' matches every game). */
export function inSeason(game: Pick<Game, 'season'>, key: SeasonKey): boolean {
  return key === ALL_SEASONS || game.season === seasonOf(key);
}

/**
 * The season to show first: the most recent season with a finished game, else all
 * games (e.g. when no game has a season label). `seasons` is most recent first.
 */
export function defaultSeasonKey(
  seasons: readonly string[],
  finalGames: readonly Pick<Game, 'season'>[],
): SeasonKey {
  const withStats = seasons.find((season) => finalGames.some((game) => game.season === season));
  return withStats === undefined ? ALL_SEASONS : seasonKey(withStats);
}

/**
 * The season to show: the remembered choice while that season still exists,
 * otherwise the default.
 */
export function resolveSeasonKey(
  remembered: SeasonKey | undefined,
  seasons: readonly string[],
  finalGames: readonly Pick<Game, 'season'>[],
): SeasonKey {
  if (remembered === ALL_SEASONS) return remembered;
  if (remembered !== undefined) {
    const season = seasonOf(remembered);
    if (season !== null && seasons.includes(season)) return remembered;
  }
  return defaultSeasonKey(seasons, finalGames);
}

// ---------------------------------------------------------------------------
// Session memory: survives switching tabs and reloads, but not a new session.
// sessionStorage can be missing or throw (private mode, blocked storage), so a
// module variable backs it up.

const STORAGE_PREFIX = 'hoop-stats:stats:';
const memory = new Map<string, string>();

export function readSessionValue(name: string): string | undefined {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_PREFIX + name);
    if (stored !== null) return stored;
  } catch {
    // Fall through to the in-memory copy.
  }
  return memory.get(name);
}

export function writeSessionValue(name: string, value: string): void {
  memory.set(name, value);
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + name, value);
  } catch {
    // The in-memory copy still lasts until the app is closed.
  }
}

/** Forgets everything remembered (for tests). */
export function clearSessionValues(): void {
  memory.clear();
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Nothing stored there.
  }
}

function isSeasonKey(value: string | undefined): value is SeasonKey {
  return value === ALL_SEASONS || (value?.startsWith('season:') ?? false);
}

export function readRememberedSeason(): SeasonKey | undefined {
  const value = readSessionValue('season');
  return isSeasonKey(value) ? value : undefined;
}

export function rememberSeason(key: SeasonKey): void {
  writeSessionValue('season', key);
}
