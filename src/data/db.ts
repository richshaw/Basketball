/**
 * The IndexedDB database (Dexie). Screens never import this: they read through
 * hooks.ts and write through repo.ts, which keep the change markers below correct.
 */
import { Dexie, type Table } from 'dexie';
import type { Game, Player, StatEvent } from './types';

export const DB_NAME = 'hoop-stats';

/** A key/value record in the `meta` table. */
export interface MetaRecord {
  key: string;
  value: unknown;
}

/** Keys in the `meta` table owned by the data layer. Other modules add their own keys. */
export const META_KEYS = {
  /** The stored `Settings` (read them with getSettings(), which fills in defaults). */
  settings: 'settings',
  /** Epoch ms of the latest write to the stats data; strictly increasing. */
  lastChangeAt: 'lastChangeAt',
} as const;

export class HoopStatsDatabase extends Dexie {
  declare players: Table<Player, string>;
  declare games: Table<Game, string>;
  declare events: Table<StatEvent, string>;
  declare meta: Table<MetaRecord, string>;

  constructor(name: string = DB_NAME) {
    super(name);

    // Schema history. Never edit a version that has shipped: add the next one, e.g.
    //   this.version(2).stores({ games: 'id, status, date' })
    //     .upgrade((tx) => tx.table('games').toCollection().modify((game) => { ... }));
    // listing only the tables that change. Dexie upgrades older databases in order.
    // Only indexed fields are listed (records can hold any other fields), and only
    // fields something queries by: every index is rewritten on every write, and a
    // game is written on every tap.
    this.version(1).stores({
      players: 'id',
      // status: the live game. Game lists are small and sorted in memory.
      games: 'id, status',
      // gameId: deleting a game's events. [gameId+createdAt]: a game's events in order.
      events: 'id, gameId, [gameId+createdAt]',
      meta: 'key',
    });
  }
}

export const db = new HoopStatsDatabase();

/** One game's events in `createdAt` order (a Dexie collection over the compound index). */
export function eventsOfGame(gameId: string) {
  return db.events
    .where('[gameId+createdAt]')
    .between([gameId, Dexie.minKey], [gameId, Dexie.maxKey], true, true);
}

/**
 * The next value for a timestamp that must strictly increase: `now`, or one more
 * than `previous` if the clock hasn't moved on (same millisecond, or set back).
 */
export function nextTimestamp(now: number, previous: number | undefined): number {
  return previous === undefined ? now : Math.max(now, previous + 1);
}

/**
 * Bumps `meta.lastChangeAt`. Every write must call this inside its transaction
 * (which must include `db.meta`), so the backup can tell when data changed.
 */
export async function touchLastChange(now: number): Promise<number> {
  const previous = await db.meta.get(META_KEYS.lastChangeAt);
  const value = nextTimestamp(
    now,
    typeof previous?.value === 'number' ? previous.value : undefined,
  );
  await db.meta.put({ key: META_KEYS.lastChangeAt, value });
  return value;
}
