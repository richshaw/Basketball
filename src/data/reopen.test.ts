import { act, renderHook, waitFor } from '@testing-library/react';
import { liveQuery } from 'dexie';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { db } from './db';
import { useGames } from './hooks';
import { resetDatabase } from '@/test/db';
import {
  isDatabaseClosedError,
  setReopenDelaysForTests,
  stopReopeningDatabase,
  watchDatabase,
  type DatabaseChange,
} from './reopen';
import { createGame, getGame, getGameEvents, listGames, recordStat } from './repo';

const lost = () =>
  new DOMException(
    'Connection to Indexed Database server lost. Refresh the page to try again',
    'UnknownError',
  );

/**
 * WebKit loses its IndexedDB connection, and can't open one again until `restore()`:
 * Dexie closes the database (as its onclose handler does), and every open fails.
 */
function loseConnection() {
  const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
    throw lost();
  });
  db.close({ disableAutoOpen: false });
  return { restore: () => open.mockRestore() };
}

/** What watchDatabase() says, for this test. */
function watchChanges(): DatabaseChange[] {
  const changes: DatabaseChange[] = [];
  onTestFinished(watchDatabase((change) => changes.push(change)));
  return changes;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * An open that answers only when the test says, if ever (as WebKit's open now and then
 * does, long after it was given up on). Its handlers (onsuccess...) run as a real
 * request's do: as listeners, each from when it's first set.
 */
function lateOpen() {
  const request = new EventTarget();
  const handlers = new Map<string, ((event: Event) => void) | null>();
  for (const type of ['success', 'error', 'upgradeneeded', 'blocked']) {
    Object.defineProperty(request, `on${type}`, {
      get: () => handlers.get(type) ?? null,
      set: (handler: ((event: Event) => void) | null) => {
        if (!handlers.has(type)) {
          request.addEventListener(type, (event) => handlers.get(type)?.call(request, event));
        }
        handlers.set(type, handler);
      },
    });
  }
  let result: IDBDatabase | undefined;
  Object.defineProperty(request, 'result', { get: () => result });
  Object.defineProperty(request, 'transaction', { value: null });
  return {
    request: request as IDBOpenDBRequest,
    /** Answers at last, with `connection`. */
    succeed: (connection: IDBDatabase) => {
      result = connection;
      request.dispatchEvent(new Event('success'));
    },
  };
}

/** A connection of its own, as an open elsewhere gets (`open`: IndexedDB's own). */
function openConnection(open: IDBFactory['open']): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = open('hoop-stats');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the database'));
  });
}

/** Writes an event through a raw connection of its own: Dexie, in this page, never hears. */
async function addBehindDexie(event: object) {
  const raw = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('hoop-stats');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the database'));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = raw.transaction('events', 'readwrite');
      transaction.objectStore('events').put(event);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Write failed'));
    });
  } finally {
    raw.close();
  }
}

beforeEach(() => {
  // Dexie warns as it works around a failed open; that's expected here.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('opening the database again once it closed for good', () => {
  it('says it closed, opens it again once it can, and says so', async () => {
    setReopenDelaysForTests([30]);
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const changes = watchChanges();
    const connection = loseConnection();

    // The next read opens it, and that fails: Dexie gives up, and every read (and write)
    // from then on fails at once, whatever happens to the connection.
    await expect(getGame(game.id)).rejects.toMatchObject({ name: 'DatabaseClosedError' });
    await vi.waitFor(() => expect(changes).toEqual(['closed']));
    const error = await getGame(game.id).catch((failure: unknown) => failure);
    expect(isDatabaseClosedError(error)).toBe(true);
    // Tried again, and still closed while the connection is lost.
    await sleep(100);
    expect(db.isOpen()).toBe(false);
    expect(changes).toEqual(['closed']);

    connection.restore();
    await vi.waitFor(() => expect(changes).toEqual(['closed', 'reopened']));
    expect(db.isOpen()).toBe(true);
    expect(await getGame(game.id)).toEqual(game);
  });

  it('waits longer between tries, and tries at once when the app comes back into view', async () => {
    setReopenDelaysForTests([60, 400]);
    const opens = vi.spyOn(db, 'open');
    const changes = watchChanges();
    const connection = loseConnection();
    await expect(listGames()).rejects.toThrow();
    // (That read opened it: once.)
    expect(opens).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(changes).toEqual(['closed']));

    // 60 ms later, then every 400 ms.
    await vi.waitFor(() => expect(opens).toHaveBeenCalledTimes(2), { timeout: 1000 });
    await sleep(200);
    expect(opens).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(opens).toHaveBeenCalledTimes(3), { timeout: 1000 });

    // The app comes back into view: tried at once, and it opens.
    connection.restore();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => expect(changes).toEqual(['closed', 'reopened']), { timeout: 200 });
    expect(opens).toHaveBeenCalledTimes(4);
    // Open: nothing more is tried.
    await sleep(500);
    expect(opens).toHaveBeenCalledTimes(4);
  });

  it('gives up on a try that never answers, so the next ones still run', async () => {
    setReopenDelaysForTests([50], 200);
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const changes = watchChanges();
    // Lost: every open throws; the next read fails, and Dexie gives up.
    const realOpen = indexedDB.open.bind(indexedDB);
    let mode: 'throw' | 'hang' | 'work' = 'throw';
    vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
      if (mode === 'throw') throw lost();
      // Never fires success or error (as WebKit's open can, once in a while).
      if (mode === 'hang') return lateOpen().request;
      return realOpen(name, version);
    });
    db.close({ disableAutoOpen: false });
    await getGame(game.id).catch(() => undefined);
    await vi.waitFor(() => expect(changes).toEqual(['closed']));

    // The next try's open never answers. Then the connection is really back, and the app
    // comes back into view: a try that answers opens it.
    mode = 'hang';
    await sleep(150);
    mode = 'work';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => expect(changes).toEqual(['closed', 'reopened']), { timeout: 2000 });
    expect(db.isOpen()).toBe(true);
    expect(await getGame(game.id)).toEqual(game);
  });

  it('closes the connection a try it gave up on answers with at last, keeping its own', async () => {
    setReopenDelaysForTests([50], 200);
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const changes = watchChanges();
    const realOpen = indexedDB.open.bind(indexedDB);
    let mode: 'throw' | 'late' | 'work' = 'throw';
    const late: ReturnType<typeof lateOpen>[] = [];
    vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
      if (mode === 'throw') throw lost();
      if (mode === 'late') {
        const open = lateOpen();
        late.push(open);
        return open.request;
      }
      return realOpen(name, version);
    });
    db.close({ disableAutoOpen: false });
    await getGame(game.id).catch(() => undefined);
    await vi.waitFor(() => expect(changes).toEqual(['closed']));

    // The next try's open doesn't answer: it's given up on after 200 ms, and the try
    // after it opens the database.
    mode = 'late';
    await vi.waitFor(() => expect(late).toHaveLength(1));
    mode = 'work';
    await vi.waitFor(() => expect(changes).toEqual(['closed', 'reopened']), { timeout: 2000 });
    const connection = db.backendDB();

    // The open given up on answers at last: its connection is closed at once, and Dexie
    // keeps the one it has (taking the late one would leave that open, and a connection
    // nobody closes blocks the next schema upgrade).
    const lateConnection = await openConnection(realOpen);
    late[0]?.succeed(lateConnection);
    expect(db.backendDB()).toBe(connection);
    expect(() => lateConnection.transaction('games')).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );
    expect(await getGame(game.id)).toEqual(game);
  });

  it('gives up on a try under way when it stops (after a test), not later', async () => {
    setReopenDelaysForTests([50], 200);
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const changes = watchChanges();
    let mode: 'throw' | 'late' = 'throw';
    const late: ReturnType<typeof lateOpen>[] = [];
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      if (mode === 'throw') throw lost();
      const request = lateOpen();
      late.push(request);
      return request.request;
    });
    db.close({ disableAutoOpen: false });
    await getGame(game.id).catch(() => undefined);
    await vi.waitFor(() => expect(changes).toEqual(['closed']));
    mode = 'late';
    await vi.waitFor(() => expect(late).toHaveLength(1));

    // The test ends with that try under way: the setup stops trying, and the next test's
    // opens the database afresh.
    stopReopeningDatabase();
    open.mockRestore();
    await sleep(0);
    await resetDatabase();
    // The try's limit passes, and the database stays open.
    await sleep(300);
    expect(db.isOpen()).toBe(true);
    expect(await listGames()).toEqual([]);
  });

  it('leaves a database that opens again by itself alone', async () => {
    const opens = vi.spyOn(db, 'open');
    const changes = watchChanges();
    // Closed (the connection was lost, say), but it can open again: the next read does.
    db.close({ disableAutoOpen: false });
    expect(await listGames()).toEqual([]);
    await sleep(50);
    expect(opens).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([]);
    expect(db.isOpen()).toBe(true);
  });

  it("has live queries read IndexedDB again once it is open, not Dexie's cached results, telling no other tab", async () => {
    setReopenDelaysForTests([30]);
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const first = await recordStat(game.id, 'stl');
    const seen: string[][] = [];
    const subscription = liveQuery(() => getGameEvents(game.id)).subscribe({
      next: (events) => seen.push(events.map((event) => event.type)),
    });
    onTestFinished(() => subscription.unsubscribe());
    await vi.waitFor(() => expect(seen).toEqual([['stl']]));
    // A save that landed though this page never heard of it (as when WebKit loses the
    // connection just after a commit).
    await addBehindDexie({ ...first, id: 'landed', type: 'blk', createdAt: first.createdAt + 1 });

    const changes = watchChanges();
    const connection = loseConnection();
    await expect(getGame(game.id)).rejects.toThrow();
    await vi.waitFor(() => expect(changes).toEqual(['closed']));
    const told = vi.spyOn(BroadcastChannel.prototype, 'postMessage');
    connection.restore();
    await vi.waitFor(() => expect(changes).toEqual(['closed', 'reopened']));
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(['stl', 'blk']));
    // Nothing changed for other tabs: none is told.
    expect(told).not.toHaveBeenCalled();
  });

  it('has every live query read again once it is open, even one whose read was dropped', async () => {
    setReopenDelaysForTests([30]);
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const changes = watchChanges();
    const connection = loseConnection();
    await expect(listGames()).rejects.toThrow();
    await vi.waitFor(() => expect(changes).toEqual(['closed']));

    // A screen opened meanwhile: liveQuery drops its failed read without a word, so it
    // shows "loading".
    const { result } = renderHook(() => useGames());
    await sleep(100);
    expect(result.current).toBeUndefined();

    connection.restore();
    await waitFor(() => expect(result.current).toEqual([game]));
  });
});
