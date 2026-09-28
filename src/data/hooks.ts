/**
 * Reactive reads for screens. Each hook re-renders its component whenever the data
 * it read changes, whoever changed it (this screen, another screen, an import).
 *
 * Loading convention: `undefined` means still loading; `null` means not found.
 * Lists are never null (an empty array when there's nothing).
 */
import { useLiveQuery } from 'dexie-react-hooks';
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
