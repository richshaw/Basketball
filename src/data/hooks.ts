/**
 * Reactive reads for screens. Each hook re-renders its component whenever the data
 * it read changes, whoever changed it (this screen, another screen, an import).
 *
 * Loading convention: `undefined` means still loading; `null` means not found.
 * Lists are never null (an empty array when there's nothing).
 */
import { liveQuery } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import {
  getAllEvents,
  getGame,
  getGameEvents,
  getLiveGame,
  getPlayer,
  getSettings,
  listGames,
  listSeasons,
} from './repo';
import type { Game, Player, Settings, StatEvent } from './types';

/**
 * useLiveQuery keeps returning the previous result after its deps change, until the
 * new query finishes. Tagging each result with its key means a screen that switches
 * from game A to game B sees "loading", never game A's data under game B's id.
 */
function useKeyedLiveQuery<K, T>(key: K, query: (key: K) => Promise<T>): T | undefined {
  const result = useLiveQuery(async () => ({ key, value: await query(key) }), [key, query]);
  return result !== undefined && Object.is(result.key, key) ? result.value : undefined;
}

async function playerOrNull(): Promise<Player | null> {
  return (await getPlayer()) ?? null;
}

async function liveGameOrNull(): Promise<Game | null> {
  return (await getLiveGame()) ?? null;
}

async function gameOrNull(id: string | undefined): Promise<Game | null> {
  return id === undefined ? null : ((await getGame(id)) ?? null);
}

function eventsOf(id: string | undefined): Promise<StatEvent[]> {
  return id === undefined ? Promise.resolve([]) : getGameEvents(id);
}

/** The player, or null before one has been set up. */
export function usePlayer(): Player | null | undefined {
  return useLiveQuery(playerOrNull);
}

/** Every game, newest first (date desc, then createdAt desc). */
export function useGames(): Game[] | undefined {
  return useLiveQuery(listGames);
}

/** One game (e.g. from the route's `gameId`), or null if there's no such game. */
export function useGame(id: string | undefined): Game | null | undefined {
  return useKeyedLiveQuery(id, gameOrNull);
}

/** One game's events, oldest first; empty for a missing game. */
export function useGameEvents(id: string | undefined): StatEvent[] | undefined {
  return useKeyedLiveQuery(id, eventsOf);
}

/** The live game updated most recently, or null if no game is live. */
export function useLiveGame(): Game | null | undefined {
  return useLiveQuery(liveGameOrNull);
}

/** Distinct season labels, most recent first. */
export function useSeasons(): string[] | undefined {
  return useLiveQuery(listSeasons);
}

/** The settings, with defaults filled in. */
export function useSettings(): Settings | undefined {
  return useLiveQuery(getSettings);
}

/** Every event of every game (for season stats; pair with statLinesForGames). */
export function useAllEvents(): StatEvent[] | undefined {
  return useLiveQuery(getAllEvents);
}

// ---------------------------------------------------------------------------
// Reads that survive a failure (the live game screen)

/** A read that stays on screen when reading fails (see useSteadyLiveQuery). */
export interface SteadyRead<T> {
  /** The latest result, or undefined while loading. After a failed read, the last good one. */
  readonly value: T | undefined;
  /** The latest read failed: `value` may be out of date. It's read again soon. */
  readonly failed: boolean;
  /** Why it failed, while it does. */
  readonly error?: unknown;
}

/**
 * How long a failed read waits to be tried again: longer each time in a row, then the
 * last one from then on. The app coming back into view tries again at once.
 */
export const READ_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 10_000];

interface SteadyState<K, T> {
  key: K;
  hasValue: boolean;
  value?: T;
  error?: unknown;
  /** Reads in a row that failed. */
  failures: number;
}

/**
 * Like useKeyedLiveQuery, for a screen that must stay up mid-game: a failed read never
 * throws (useLiveQuery rethrows it while rendering, so the route's error screen would
 * replace the screen, e.g. once WebKit loses its IndexedDB connection in the
 * background). The last good result stays, with `failed` set, and the read is tried
 * again when the app comes back into view and on a timer (Dexie reopens a lost
 * connection on the next query), never by reloading the page.
 */
function useSteadyLiveQuery<K, T>(key: K, query: (key: K) => Promise<T>): SteadyRead<T> {
  // Moves on to read again after a failure (a new live query).
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SteadyState<K, T>>(() => ({
    key,
    hasValue: false,
    failures: 0,
  }));

  useEffect(() => {
    const subscription = liveQuery(() => query(key)).subscribe({
      next: (value) => setState({ key, hasValue: true, value, failures: 0 }),
      error: (error: unknown) =>
        setState((current) =>
          Object.is(current.key, key)
            ? { ...current, error, failures: current.failures + 1 }
            : { key, hasValue: false, error, failures: 1 },
        ),
    });
    return () => subscription.unsubscribe();
  }, [key, query, attempt]);

  const current = Object.is(state.key, key) ? state : undefined;
  const failures = current?.failures ?? 0;
  const error = current?.error;

  useEffect(() => {
    if (failures === 1) console.error('Reading saved data failed; trying again', error);
  }, [failures, error]);

  useEffect(() => {
    if (failures === 0) return;
    const readAgain = () => setAttempt((count) => count + 1);
    const delay = READ_RETRY_DELAYS_MS[Math.min(failures, READ_RETRY_DELAYS_MS.length) - 1];
    const timer = setTimeout(readAgain, delay);
    const readAgainWhenShown = () => {
      if (document.visibilityState === 'visible') readAgain();
    };
    document.addEventListener('visibilitychange', readAgainWhenShown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', readAgainWhenShown);
    };
  }, [failures]);

  return {
    value: current?.hasValue ? current.value : undefined,
    failed: failures > 0,
    error,
  };
}

/** useGame that survives a failed read (see SteadyRead), for the live game screen. */
export function useSteadyGame(id: string | undefined): SteadyRead<Game | null> {
  return useSteadyLiveQuery(id, gameOrNull);
}

/** useGameEvents that survives a failed read (see SteadyRead), for the live game screen. */
export function useSteadyGameEvents(id: string | undefined): SteadyRead<StatEvent[]> {
  return useSteadyLiveQuery(id, eventsOf);
}
