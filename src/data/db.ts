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

/** The opens IndexedDB hasn't answered yet, and a way to give up on them. */
interface OpenGuard {
  /** IndexedDB for Dexie to open the database through (its `indexedDB` option). */
  factory: IDBFactory;
  /** Gives up on every open under way: a connection one answers with is closed. */
  giveUp(): void;
}

/**
 * IndexedDB, opened so that an open Dexie gave up on never hands it a connection. Its
 * close() cancels an open under way (src/data/reopen.ts closes it when a try doesn't
 * answer, as WebKit's open now and then doesn't), but IndexedDB may still answer that
 * open later, and Dexie would take the connection, in place of the one it has by then,
 * leaving that one open: a connection nobody closes blocks the next schema upgrade. So
 * the answer is caught before Dexie hears of it: the connection is closed (an upgrade it
 * would start is called off, which closes it too).
 */
function guardOpens(indexedDB: IDBFactory): OpenGuard {
  const unanswered = new Set<IDBOpenDBRequest>();
  const givenUp = new WeakSet<IDBOpenDBRequest>();
  const watch = (request: IDBOpenDBRequest): IDBOpenDBRequest => {
    unanswered.add(request);
    // Added before Dexie sets its handlers (onsuccess...), so these run first.
    request.addEventListener('upgradeneeded', (event) => {
      if (!givenUp.has(request)) return;
      event.stopImmediatePropagation();
      request.transaction?.abort();
    });
    request.addEventListener('success', (event) => {
      unanswered.delete(request);
      if (!givenUp.has(request)) return;
      event.stopImmediatePropagation();
      request.result.close();
    });
    request.addEventListener('error', () => {
      unanswered.delete(request);
    });
    return request;
  };
  return {
    factory: {
      open: (name, version) =>
        watch(version === undefined ? indexedDB.open(name) : indexedDB.open(name, version)),
      deleteDatabase: (name) => indexedDB.deleteDatabase(name),
      databases: () => indexedDB.databases(),
      cmp: (first: unknown, second: unknown) => indexedDB.cmp(first, second),
    },
    giveUp: () => {
      for (const request of unanswered) givenUp.add(request);
    },
  };
}

export class HoopStatsDatabase extends Dexie {
  declare players: Table<Player, string>;
  declare games: Table<Game, string>;
  declare events: Table<StatEvent, string>;
  declare meta: Table<MetaRecord, string>;
  private readonly opens: OpenGuard;

  constructor(name: string = DB_NAME) {
    const opens = guardOpens(Dexie.dependencies.indexedDB);
    super(name, { indexedDB: opens.factory });
    this.opens = opens;

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

  /**
   * Closes it. Unless opening stays on (`disableAutoOpen: false`, which lets an open
   * under way finish), an open under way is cancelled, and the connection it may still
   * answer with is closed (guardOpens).
   */
  override close(closeOptions?: { disableAutoOpen: boolean }): void {
    if (closeOptions?.disableAutoOpen !== false) this.opens.giveUp();
    super.close(closeOptions);
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
