/**
 * Reactive reads for screens. Each hook re-renders its component whenever the data
 * it read changes, whoever changed it (this screen, another screen, an import).
 *
 * Loading convention: `undefined` means still loading; `null` means not found.
 * Lists are never null (an empty array when there's nothing).
 */
import { liveQuery } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isReloadSafe, watchReloadSafe } from './pendingStats';
import { isDatabaseClosedError, watchDatabase } from './reopen';
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

/**
 * How long a read may go unanswered before it's read again (twice as long each time in
 * a row, up to READ_WATCHDOG_MAX_MS). Dexie's liveQuery drops some failures without a
 * word (an AbortError or a DatabaseClosedError: neither a result nor an error comes
 * back), which would otherwise leave the screen blank, or out of date, for good. Once
 * there's a result on screen, a read that doesn't answer in time is a failed read too.
 */
export const READ_WATCHDOG_MS = 3000;
const READ_WATCHDOG_MAX_MS = 30_000;

/**
 * How long a first read (nothing on screen yet) waits for a database closed for good to
 * open again (reopen.ts tries after 1 s and 3 s) before it counts as a failed read.
 */
export const READ_CLOSED_WAIT_MS = 10_000;

/** The error of a read that didn't answer in time (see READ_WATCHDOG_MS). */
function unansweredRead(): DOMException {
  return new DOMException('Reading saved data did not answer in time.', 'TimeoutError');
}

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
 * again on a timer, never by reloading the page. It's read again at once, failing or
 * not, when the app comes back into view (WebKit may have lost its connection in the
 * background) and when the database closes for good or opens again (reopen.ts). A read
 * that doesn't answer at all is read again too (READ_WATCHDOG_MS), and counts as a
 * failed read once there's a result on screen; so does a DatabaseClosedError, which
 * liveQuery itself drops without a word. A first read has nothing to keep yet: one that
 * finds the database closed waits for it to open again (then it's read again, and fills
 * the screen), and counts as failed only if it's still closed READ_CLOSED_WAIT_MS later.
 */
function useSteadyLiveQuery<K, T>(key: K, query: (key: K) => Promise<T>): SteadyRead<T> {
  // Moves on to read again after a failure, or a read that never answered (a new live
  // query).
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SteadyState<K, T>>(() => ({
    key,
    hasValue: false,
    failures: 0,
  }));
  // Reads in a row that never answered: how far the watchdog has backed off.
  const unanswered = useRef(0);
  // The key whose result is on screen, once there is one.
  const shown = useRef<{ key: K } | undefined>(undefined);
  // Since when a first read has found the database closed (for this key).
  const closedSince = useRef<{ key: K; at: number } | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let closedWait: ReturnType<typeof setTimeout> | undefined;
    const answered = () => {
      clearTimeout(watchdog);
      watchdog = undefined;
      unanswered.current = 0;
    };
    const failed = (error: unknown) => {
      if (!active) return;
      answered();
      setState((current) =>
        Object.is(current.key, key)
          ? { ...current, error, failures: current.failures + 1 }
          : { key, hasValue: false, error, failures: 1 },
      );
    };
    // The database is closed (reopen.ts is opening it again): liveQuery drops this read
    // without a word. With a result on screen, it's a failed read like any other. A
    // first read has nothing to keep: it's read again once the database is open (below),
    // or by the watchdog, and fails only if the database stays closed too long.
    const closed = (error: unknown) => {
      if (!active) return;
      if (shown.current && Object.is(shown.current.key, key)) {
        failed(error);
        return;
      }
      if (!closedSince.current || !Object.is(closedSince.current.key, key)) {
        closedSince.current = { key, at: Date.now() };
      }
      const left = closedSince.current.at + READ_CLOSED_WAIT_MS - Date.now();
      if (left <= 0) {
        failed(error);
        return;
      }
      clearTimeout(closedWait);
      closedWait = setTimeout(() => setAttempt((count) => count + 1), left);
    };
    const subscription = liveQuery(() => {
      // Each run (the first, and again whenever its data changes) must answer in time,
      // or it's read again.
      clearTimeout(watchdog);
      const wait = Math.min(READ_WATCHDOG_MS * 2 ** unanswered.current, READ_WATCHDOG_MAX_MS);
      watchdog = setTimeout(() => {
        unanswered.current += 1;
        // A failed read, once there's something on screen to keep (a first read that
        // never answers is simply read again: there's nothing to show yet).
        setState((current) =>
          Object.is(current.key, key) && current.hasValue
            ? { ...current, error: unansweredRead(), failures: current.failures + 1 }
            : current,
        );
        setAttempt((count) => count + 1);
      }, wait);
      // (Not query(key).catch(): inside liveQuery's zone that would turn the error into
      // one of Dexie's.)
      const read = query(key);
      return (async () => {
        try {
          return await read;
        } catch (error) {
          if (isDatabaseClosedError(error)) closed(error);
          throw error;
        }
      })();
    }).subscribe({
      next: (value) => {
        if (!active) return;
        answered();
        clearTimeout(closedWait);
        shown.current = { key };
        closedSince.current = undefined;
        setState({ key, hasValue: true, value, failures: 0 });
      },
      error: failed,
    });
    return () => {
      active = false;
      clearTimeout(watchdog);
      clearTimeout(closedWait);
      subscription.unsubscribe();
    };
  }, [key, query, attempt]);

  const current = Object.is(state.key, key) ? state : undefined;
  const failures = current?.failures ?? 0;
  const error = current?.error;

  useEffect(() => {
    if (failures === 1) console.error('Reading saved data failed; trying again', error);
  }, [failures, error]);

  useEffect(() => {
    if (failures === 0) return;
    const delay = READ_RETRY_DELAYS_MS[Math.min(failures, READ_RETRY_DELAYS_MS.length) - 1];
    const timer = setTimeout(() => setAttempt((count) => count + 1), delay);
    return () => clearTimeout(timer);
  }, [failures]);

  useEffect(() => {
    const readAgain = () => setAttempt((count) => count + 1);
    const readAgainWhenShown = () => {
      if (document.visibilityState === 'visible') readAgain();
    };
    document.addEventListener('visibilitychange', readAgainWhenShown);
    const unwatch = watchDatabase(readAgain);
    return () => {
      document.removeEventListener('visibilitychange', readAgainWhenShown);
      unwatch();
    };
  }, []);

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

function settingsOrDefaults(): Promise<Settings> {
  return getSettings();
}

/** useSettings that survives a failed read (see SteadyRead), for the live game screen. */
export function useSteadySettings(): SteadyRead<Settings> {
  return useSteadyLiveQuery('settings', settingsOrDefaults);
}

/**
 * Whether reloading the page now would lose nothing (isReloadSafe in pendingStats.ts),
 * kept up to date as the tracking sessions' taps change. For a Reload button: offer it
 * only while this is true, else ask to keep the app open.
 */
export function useReloadSafe(): boolean {
  return useSyncExternalStore(watchReloadSafe, isReloadSafe);
}
